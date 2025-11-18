import axios, { AxiosResponse } from 'axios'
import { checkEnv } from '../util/env'
import { PromisePool } from '@supercharge/promise-pool'
import { API_CONFIG, SSO_APP_TAGS } from '../util/constants'

export interface AppInfo {
  appId: string
  displayName: string
  principalId: string
  signInAudience: string
  identifierUris: string[]
  tags: string[]
  users: UserInfo[]
  serviceUrl?: string
}

export interface UserInfo {
  email: string
  displayName: string
  principalId: string
}

export interface Group {
  principalId: string
  displayName: string
  members: string[]
}

interface GraphApiResponse<T> {
  value: T[]
  '@odata.nextLink'?: string
}

interface ServicePrincipalResponse {
  id: string
  tags?: string[]
}

interface ApplicationResponse {
  appId: string
  displayName: string
  signInAudience: string
  identifierUris: string[]
  tags?: string[]
  web?: {
    homePageUrl?: string
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
}

class AzureAD {
  private clientId: string
  private tenantId: string
  private clientSecret: string
  private registerZeroUserApp: boolean
  private registerDisabledApp: boolean
  private targetServices: string[]
  private accessToken: string
  private tokenExpiryTime: number
  private groups: Group[] = []
  private users: UserInfo[] = []
  private preloadCache: boolean

  constructor(inputs: Record<string, string>) {
    checkEnv(['ms_client_id', 'ms_tenant_id', 'ms_client_secret'], inputs)
    this.clientId = inputs['ms_client_id']
    this.tenantId = inputs['ms_tenant_id']
    this.clientSecret = inputs['ms_client_secret']
    this.registerZeroUserApp = inputs['register_zero_user_app'] === 'true'
    this.registerDisabledApp = inputs['register_disabled_app'] === 'true'
    this.targetServices = inputs['target_services']
      ? inputs['target_services'].split(',')
      : []
    this.preloadCache = inputs['preload_cache']
      ? inputs['preload_cache'] === 'true'
      : true
    this.accessToken = ''
    this.tokenExpiryTime = Math.floor(Date.now() / 1000)
  }

  private async getAccessToken(): Promise<{ token: string; expiresIn: number }> {
    console.log('🔐 Getting access token...')
    const url = new URL(
      `${API_CONFIG.GRAPH_AUTH_ENDPOINT}/${this.tenantId}/oauth2/v2.0/token`
    )

    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', 'https://graph.microsoft.com/.default')

    try {
      const response = await axios.post<TokenResponse>(url.toString(), params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      return {
        token: response.data.access_token,
        expiresIn: response.data.expires_in
      }
    } catch (error) {
      console.error('Failed to get access token', error)
      throw new Error('An unknown error occurred while getting access token')
    }
  }

  private async ensureValidToken(): Promise<string> {
    const currentTime = Math.floor(Date.now() / 1000)

    if (
      !this.tokenExpiryTime ||
      currentTime >= this.tokenExpiryTime - API_CONFIG.TOKEN_REFRESH_BUFFER_SEC
    ) {
      console.log('🔄 Refreshing access token...')
      const { token, expiresIn } = await this.getAccessToken()
      this.accessToken = token
      this.tokenExpiryTime = currentTime + expiresIn
    }

    return this.accessToken
  }

  private async getEnterpriseApplications(
    accessToken: string,
    serviceNames: string[] = [],
    nextUrl?: string
  ): Promise<AppInfo[]> {
    const filterQueries = serviceNames
      .map(name => `(displayName eq '${name}')`)
      .join(' or ')
    const url = nextUrl
      ? new URL(nextUrl)
      : new URL(`${API_CONFIG.GRAPH_API_ENDPOINT}/applications`)
    url.searchParams.set('$top', String(API_CONFIG.MAX_ITEMS_PER_PAGE))
    if (filterQueries) {
      url.searchParams.set('$filter', filterQueries)
    }

    const response = await axios.get<GraphApiResponse<ApplicationResponse>>(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )
    const apps = response.data.value

    // Type guard function
    const appInfoKeys = [
      'appId',
      'displayName',
      'signInAudience',
      'identifierUris',
      'tags'
    ] as const

    const isAppInfo = (obj: unknown): obj is ApplicationResponse => {
      return appInfoKeys.every(key =>
        Object.prototype.hasOwnProperty.call(obj, key)
      )
    }

    // Process apps in parallel with PromisePool
    let appInfos: AppInfo[] = []
    const { results, errors } = await PromisePool.for<ApplicationResponse>(
      apps.filter(isAppInfo)
    )
      .withConcurrency(API_CONFIG.CONCURRENT_REQUESTS)
      .process(async (app: ApplicationResponse) => {
        // Get the service principal id
        const servicePrincipalUrl = new URL(
          `${API_CONFIG.GRAPH_API_ENDPOINT}/servicePrincipals`
        )
        servicePrincipalUrl.searchParams.set(
          '$filter',
          `appId eq '${app.appId}'`
        )
        const servicePrincipalResponse = await axios.get<
          GraphApiResponse<ServicePrincipalResponse>
        >(servicePrincipalUrl.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
        const servicePrincipalId = servicePrincipalResponse.data.value[0]?.id
        const tags: string[] =
          servicePrincipalResponse.data.value[0]?.tags ?? []

        // Skip if Service Principal not found
        if (!servicePrincipalId) {
          console.warn(
            `⚠️ Service Principal not found for app ${app.displayName} (appId: ${app.appId}). Skipping.`
          )
          return null as any
        }

        // Get serviceUrl: prioritize web.homePageUrl, fallback to identifierUris[0]
        let serviceUrl: string | undefined
        const webHomePageUrl = app.web?.homePageUrl
        if (webHomePageUrl) {
          serviceUrl = webHomePageUrl
        } else if (app.identifierUris && app.identifierUris.length > 0) {
          serviceUrl = app.identifierUris[0]
        }

        const appInfo: AppInfo = {
          appId: app.appId,
          displayName: app.displayName,
          principalId: servicePrincipalId,
          signInAudience: app.signInAudience,
          identifierUris: app.identifierUris,
          tags: tags,
          users: [],
          serviceUrl: serviceUrl
        }
        return appInfo
      })

    errors.forEach(error => {
      console.error('Error processing app:', error)
    })

    // Filter out nulls (apps without Service Principal)
    appInfos = results.filter((app): app is AppInfo => app !== null)

    // Filter apps by SSO tags
    appInfos = appInfos.filter(
      appInfo =>
        appInfo.tags &&
        appInfo.tags.some(tag => SSO_APP_TAGS.some(ssoTag => tag.startsWith(ssoTag)))
    )

    if (response.data['@odata.nextLink']) {
      const nextApps = await this.getEnterpriseApplications(
        accessToken,
        serviceNames,
        response.data['@odata.nextLink']
      )
      appInfos = appInfos.concat(nextApps)
    }
    console.log(`Getting ${appInfos.length} apps ... and more.`)
    return appInfos
  }

  private async getUserPrincipals(
    accessToken: string,
    url: string
  ): Promise<string[]> {
    let userPrincipals: string[] = []
    const response = await axios.get<GraphApiResponse<any>>(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    const users = response.data.value.filter(
      (user: any) => user.principalType === 'User' && user.principalId !== null
    )
    const groups = response.data.value.filter(
      (group: any) =>
        group.principalType === 'Group' && group.principalId !== null
    )

    console.log(
      `Getting ${users.length} users and ${groups.length} groups ...: ${response.data.value.length}`
    )
    const newUserPrincipals = users.map((user: any) => user.principalId)

    userPrincipals = userPrincipals.concat(newUserPrincipals)

    for (const group of groups) {
      console.log(
        `Getting group members from [${group.principalDisplayName}](${group.principalId})`
      )
      const groupMembers = await this.getGroupMembers(
        accessToken,
        group.principalId
      )
      userPrincipals = userPrincipals.concat(groupMembers)
    }

    if (response.data['@odata.nextLink']) {
      const nextUserPrincipals = await this.getUserPrincipals(
        accessToken,
        response.data['@odata.nextLink']
      )
      userPrincipals = userPrincipals.concat(nextUserPrincipals)
    }

    return userPrincipals
  }

  private async getGroupMembers(
    accessToken: string,
    groupPrincipalId: string,
    nextUrl?: string
  ): Promise<string[]> {
    // Check cache
    const group = this.groups.find(g => g.principalId === groupPrincipalId)
    if (group) {
      return group.members
    }

    const url = nextUrl
      ? nextUrl
      : `${API_CONFIG.GRAPH_API_ENDPOINT}/groups/${groupPrincipalId}/members?$top=${API_CONFIG.MAX_ITEMS_PER_PAGE}`
    let groupMembers: string[] = []
    try {
      const response = await axios.get<GraphApiResponse<any>>(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      const members = response.data.value.filter(
        (member: any) =>
          member['@odata.type'] === '#microsoft.graph.user' &&
          member.id !== null
      )
      const groups = response.data.value.filter(
        (group: any) =>
          group['@odata.type'] === '#microsoft.graph.group' && group.id !== null
      )

      groupMembers = groupMembers.concat(
        members.map((member: any) => member.id)
      )

      for (const group of groups) {
        const list = await this.getGroupMembers(accessToken, group.id)
        groupMembers = groupMembers.concat(list)
      }

      if (response.data['@odata.nextLink']) {
        const nextMembers = await this.getGroupMembers(
          accessToken,
          groupPrincipalId,
          response.data['@odata.nextLink']
        )
        groupMembers = groupMembers.concat(nextMembers)
      }
    } catch (error) {
      console.error(error)
      throw new Error(`Failed to fetch group members. [ID:${groupPrincipalId}]`)
    }
    return groupMembers
  }

  private async getUserInfo(
    accessToken: string,
    principalId: string
  ): Promise<UserInfo> {
    // Check cache
    const user = this.users.find(u => u.principalId === principalId)
    if (user) {
      return user
    }

    const baseUrl = `${API_CONFIG.GRAPH_API_ENDPOINT}/users/${principalId}`
    const userResponse = await axios.get<any>(baseUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: API_CONFIG.API_TIMEOUT_MS
    })

    return {
      email: userResponse.data.userPrincipalName,
      displayName: userResponse.data.displayName,
      principalId: principalId
    }
  }

  private async getUsers(
    accessToken: string,
    url: string
  ): Promise<UserInfo[]> {
    const principals = await this.getUserPrincipals(accessToken, url)
    const uniquePrincipals = [...new Set(principals)]
    console.log('The length of uniquePrincipals is ' + uniquePrincipals.length)

    console.log(
      `Fetched ${uniquePrincipals.length} users ... and start to fetch the user info`
    )
    const { results, errors } = await PromisePool.for(uniquePrincipals)
      .withConcurrency(API_CONFIG.CONCURRENT_REQUESTS)
      .process(async (principalId: string) => {
        return await this.getUserInfo(accessToken, principalId)
      })
    errors.forEach(error => {
      console.error('Failed to get users:', error)
    })
    if (errors.length > 0) {
      throw new Error('Failed to get users.')
    }

    return results
  }

  private async preLoadAllGroups(accessToken: string): Promise<void> {
    console.log('👥 Start preload group entity cache ...')

    try {
      let url: URL | null = new URL(`${API_CONFIG.GRAPH_API_ENDPOINT}/groups`)
      url.searchParams.set('$filter', 'securityEnabled eq true')
      url.searchParams.set('$top', '50')

      while (url) {
        const response: AxiosResponse<GraphApiResponse<any>> = await axios.get<GraphApiResponse<any>>(
          url.toString(),
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        )

        // Get Group members
        const activeGroups = response.data.value.filter(
          (g: any) => !g.deletedDateTime
        )
        const { results, errors } = await PromisePool.for(activeGroups)
          .withConcurrency(API_CONFIG.CONCURRENT_REQUESTS)
          .process(async (group: any) => {
            const list = await this.getGroupMembers(accessToken, group.id)
            return {
              principalId: group.id,
              displayName: group.displayName,
              members: list
            } as Group
          })

        errors.forEach(error => {
          console.error('Error processing group:', error)
        })
        if (errors.length > 0) {
          throw new Error('Failed to preload group members.')
        }

        for (const result of results) {
          this.groups.push(result)
          console.log(
            `✔ Preloaded ${result.members.length} members to ${result.displayName} ... (ID:${result.principalId})`
          )
        }

        if (!response.data['@odata.nextLink']) {
          console.log(
            '🫖 Now Loading ... ' + this.groups.length + ' groups cached'
          )
          break
        }
        url = new URL(response.data['@odata.nextLink'])
        console.log(
          '🫖 Now Loading ... ' + this.groups.length + ' groups cached'
        )
      }
    } catch (error) {
      console.error('Failed to load group cache:', error)
      throw new Error('Failed to preload groups. Please check the errors')
    }
  }

  private async preLoadMembers(accessToken: string): Promise<void> {
    console.log('🫥 Start preload member entity cache ...')
    let url: string | null = `${API_CONFIG.GRAPH_API_ENDPOINT}/users?$top=${API_CONFIG.MAX_ITEMS_PER_PAGE}`

    while (url) {
      const response: AxiosResponse<GraphApiResponse<any>> = await axios.get<GraphApiResponse<any>>(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })

      const users: UserInfo[] = response.data.value.map((user: any) => ({
        email: user.userPrincipalName,
        displayName: user.displayName,
        principalId: user.id
      }))

      this.users = this.users.concat(users)

      url = response.data['@odata.nextLink'] || null
      console.log('🫖 Now Loading ... ' + this.users.length + ' users cached')
    }
    console.log('🫖 Finish preload member entity cache.')
  }

  private handleApiError(error: any, context: string): never {
    const errorMsg =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Unknown error'
    const errorDetails = error?.response?.data
      ? JSON.stringify(error.response.data)
      : ''

    console.error(`❌ ${context}`)
    console.error(`   Error: ${errorMsg}`)
    if (errorDetails) {
      console.error(`   Details: ${errorDetails}`)
    }
    throw new Error(`${context}: ${errorMsg}`)
  }

  private async getAppInfos(
    accessToken: string,
    app: AppInfo
  ): Promise<AppInfo> {
    console.log(
      `🚀 Start to get [${app.displayName}]'s AppInfos ... (ID:${app.principalId})`
    )

    if (!app.principalId) {
      const errorMsg = `Service Principal ID is missing for app ${app.displayName} (appId: ${app.appId})`
      console.error(`❌ ${errorMsg}`)
      throw new Error(errorMsg)
    }

    const url = new URL(
      `${API_CONFIG.GRAPH_API_ENDPOINT}/servicePrincipals/${app.principalId}/appRoleAssignedTo`
    )
    url.searchParams.set('$top', String(API_CONFIG.MAX_ITEMS_PER_PAGE))

    try {
      const usersInfo = await this.getUsers(accessToken, url.toString())
      const appInfoWithUsers: AppInfo = {
        appId: app.appId,
        displayName: app.displayName,
        principalId: app.principalId,
        signInAudience: app.signInAudience,
        identifierUris: app.identifierUris,
        tags: app.tags,
        users: usersInfo,
        serviceUrl: app.serviceUrl
      }
      console.log(
        `✅ Detected ${usersInfo.length} users in ${app.displayName} ... (${app.principalId})`
      )
      return appInfoWithUsers
    } catch (error: any) {
      this.handleApiError(
        error,
        `Failed to get [${app.displayName}]'s AppInfos ... (${app.principalId})`
      )
    }
  }

  public async fetchSsoApps(): Promise<AppInfo[]> {
    await this.getAccessToken().then(async ({ token, expiresIn }) => {
      this.accessToken = token
      this.tokenExpiryTime = this.tokenExpiryTime + expiresIn

      // Preload cache
      if (this.preloadCache) {
        await this.preLoadMembers(token).then(async () => {
          await this.preLoadAllGroups(token)
        })
        console.log(
          'Preloaded ... Members is ' + this.users.length,
          'Groups is ' + this.groups.length
        )
      }
    })

    try {
      const enterpriseApplications = await this.getEnterpriseApplications(
        this.accessToken,
        this.targetServices
      )
      console.log(`Detected ${enterpriseApplications.length} SSO apps`)
      let filteredResults: AppInfo[] = []

      try {
        const results: AppInfo[] = []
        for (const appInfo of enterpriseApplications) {
          try {
            // Ensure valid token before processing each app
            const token = await this.ensureValidToken()
            const appInfoWithUsers = await this.getAppInfos(token, appInfo)
            results.push(appInfoWithUsers)
          } catch (error: any) {
            console.error(
              `⚠️ Skipping app ${appInfo.displayName} due to error:`,
              error.message || error
            )
            // Continue processing other apps instead of failing completely
          }
        }

        filteredResults = results.filter(
          appInfo => appInfo !== null
        ) as AppInfo[]
      } catch (error) {
        console.error('Failed to fetch list of applications:', error)
        throw new Error('Failed to fetch list of applications.')
      }

      if (!this.registerZeroUserApp) {
        console.log('Filtering apps with zero users...')
        filteredResults = filteredResults.filter(
          appInfo => appInfo.users.length > 0
        )
        console.log(
          `The number after applying the filter is ${filteredResults.length}`
        )
      }

      if (!this.registerDisabledApp) {
        console.log('Filtering disabled apps...')
        filteredResults = filteredResults.filter(
          appInfo => !appInfo.tags.includes('HideApp')
        )
        console.log(
          `The number after applying the filter is ${filteredResults.length}`
        )
      }

      return filteredResults
    } catch (error) {
      console.error('Error fetching SSO apps:', error)
      throw new Error('Failed to fetch SSO apps')
    }
  }
}

export const fetchApps = (
  inputs: Record<string, string>
): Promise<AppInfo[]> => {
  const aad = new AzureAD(inputs)
  return aad.fetchSsoApps()
}
