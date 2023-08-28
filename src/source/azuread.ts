import axios from 'axios'
import {checkEnv} from '../util/env'
import {PromisePool} from '@supercharge/promise-pool'

export interface AppInfo {
  appId: string
  displayName: string
  principleId: string
  signInAudience: string
  identifierUris: string[]
  tags: string[]
  users: UserInfo[]
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

class AzureAD {
  private clientId: string
  private tenantId: string
  private clientSecret: string
  private register_zero_user_app: boolean
  private register_disabled_app: boolean
  private target_services: string[]
  private access_token: string
  private token_expiry_time: number
  private groups: Group[] = []
  private users: UserInfo[] = []
  private preload_cache: boolean

  constructor(inputs: Record<string, string>) {
    checkEnv(['ms_client_id', 'ms_tenant_id', 'ms_client_secret'], inputs)
    this.clientId = inputs['ms_client_id']
    this.tenantId = inputs['ms_tenant_id']
    this.clientSecret = inputs['ms_client_secret']
    this.register_zero_user_app = inputs['register_zero_user_app'] === 'true'
    this.register_disabled_app = inputs['register_disabled_app'] === 'true'
    this.target_services = inputs['target_services']
      ? inputs['target_services'].split(',')
      : []
    this.preload_cache = inputs['preload_cache']
      ? inputs['preload_cache'] === 'true'
      : true
    this.access_token = ''
    this.token_expiry_time = Math.floor(Date.now() / 1000)
  }

  private async getAccessToken(): Promise<{token: string; expiresIn: number}> {
    console.log('🔐 Getting access token...')
    const url = new URL(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`
    )

    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', 'https://graph.microsoft.com/.default')

    try {
      const response = await axios.post(url.toString(), params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      return {
        token: response.data.access_token,
        expiresIn: response.data.expires_in
      }
    } catch (error) {
      console.log('Failed to get access token', error)
      throw new Error(`An unknown error occurred while getting access token`)
    }
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
      : new URL('https://graph.microsoft.com/v1.0/applications')
    url.searchParams.set('$top', '999')
    if (filterQueries) {
      url.searchParams.set('$filter', filterQueries)
    }

    const response = await axios.get(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const apps = response.data.value

    // AppInfo型として必要なプロパティを定義
    const appInfoKeys = [
      'appId',
      'displayName',
      'signInAudience',
      'identifierUris',
      'tags'
    ] as const

    // 型ガード関数を定義
    const isAppInfo = (obj: unknown): obj is AppInfo => {
      return appInfoKeys.every(key =>
        Object.prototype.hasOwnProperty.call(obj, key)
      )
    }
    // PromisePoolで並列処理を実行
    let appInfos = [] as AppInfo[]
    const {results, errors} = await PromisePool.for<AppInfo>(
      apps.filter(isAppInfo)
    ) // 型ガードでフィルタリング
      .withConcurrency(5) // 並列数を5に制限
      .process(async (app: AppInfo) => {
        // Get the service principal id
        const servicePrincipalUrl = new URL(
          'https://graph.microsoft.com/v1.0/servicePrincipals'
        )
        servicePrincipalUrl.searchParams.set(
          '$filter',
          `appId eq '${app.appId}'`
        )
        const servicePrincipalResponse = await axios.get(
          servicePrincipalUrl.toString(),
          {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          }
        )
        const servicePrincipalId = servicePrincipalResponse.data.value[0]?.id
        const tags: string[] =
          servicePrincipalResponse.data.value[0]?.tags ?? []
        const appInfo: AppInfo = {
          appId: app.appId,
          displayName: app.displayName,
          principleId: servicePrincipalId,
          signInAudience: app.signInAudience,
          identifierUris: app.identifierUris,
          tags: tags,
          users: []
        }
        return appInfo
      })
    errors.forEach(error => {
      console.log(error)
      throw new Error(`Fail to get app info.[${serviceNames}]`)
    })
    if (errors.length > 0) {
      throw new Error('Fail to get app info.')
    }

    appInfos = results

    // After the Promise.all is resolved, then filter the apps
    appInfos = appInfos.filter(
      appInfo =>
        appInfo.tags &&
        appInfo.tags.some(
          tag =>
            tag === 'WindowsAzureActiveDirectoryIntegratedApp' ||
            tag.startsWith('WindowsAzureActiveDirectoryGalleryApplication') ||
            tag === 'WindowsAzureActiveDirectoryCustomSingleSignOnApplication'
        )
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
    let userPrincipals = [] as string[]
    const response = await axios.get(url, {
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
      `Getting ${users.length} users and ${groups.length} groups ...: ${response.data.value.length}}`
    )
    const newUserPrincipals = users.map((user: any) => user.principalId)

    userPrincipals.concat(newUserPrincipals)

    for (const group of groups) {
      console.log(
        `Getting group members from[${group.principalDisplayName} ](${group.principalId})`
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
    // check cache
    const group = this.groups.find(g => g.principalId === groupPrincipalId)
    if (group) {
      return group.members
    }

    const url = nextUrl
      ? nextUrl
      : `https://graph.microsoft.com/v1.0/groups/${groupPrincipalId}/members?$top=999`
    let group_members = [] as string[]
    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      const members = response.data.value.filter(
        (member: any) =>
          member['@odata.type'] === '#microsoft.graph.user' &&
          member.Id !== null
      )
      const groups = response.data.value.filter(
        (group: any) =>
          group['@odata.type'] === '#microsoft.graph.group' && group.Id !== null
      )

      group_members = group_members.concat(
        members.map((member: any) => member.id)
      )

      for (const group of groups) {
        const list = await this.getGroupMembers(accessToken, group.id)
        group_members = group_members.concat(list)
      }

      if (response.data['@odata.nextLink']) {
        const nextMembers = await this.getGroupMembers(
          accessToken,
          '--',
          response.data['@odata.nextLink']
        )
        group_members = group_members.concat(nextMembers)
      }
    } catch (error) {
      console.log(error)
      throw new Error(`Fail to fetch group members. [ID:${groupPrincipalId}]`)
    }
    return group_members
  }

  private async getUserInfo(
    accessToken: string,
    principalId: string
  ): Promise<UserInfo> {
    // check cache
    const user = this.users.find(u => u.principalId === principalId)
    if (user) {
      return user
    }

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${principalId}`
    //console.log(`Getting user info from ${userUrl} ...`)
    const userResponse = await axios.get(baseUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      timeout: 600000 //100sec timeout
    })

    return {
      email: userResponse.data.userPrincipalName,
      displayName: userResponse.data.displayName,
      principalId: principalId
      //groups: groups
    } as UserInfo
  }

  private async getUsers(
    accessToken: string,
    url: string
  ): Promise<UserInfo[]> {
    const principals = await this.getUserPrincipals(accessToken, url)
    const uniquePrincipals = [...new Set(principals)]
    console.log('the length of uniquePrincipals is ' + uniquePrincipals.length)
    //console.log('the length of principals is ' + principals.length)

    console.log(
      `Fetched ${uniquePrincipals.length} users ... and start to fetch the user info`
    )
    const {results, errors} = await PromisePool.for(uniquePrincipals)
      .withConcurrency(5) // 並列数を5に制限
      .process(async (principal_id: string) => {
        return await this.getUserInfo(accessToken, principal_id)
      })
    errors.forEach(error => {
      console.log('Fail to get users', error)
    })
    if (errors.length > 0) {
      throw new Error('Fail to get users.')
    }

    return results
  }

  private async preLoadAllGroups(accessToken: string): Promise<void> {
    console.log('👥 Start preload group eneity cache ...')

    try {
      // Groupの一覧を取得

      let url = new URL('https://graph.microsoft.com/v1.0/groups')
      url.searchParams.set('$filter', 'securityEnabled eq true')
      url.searchParams.set('$top', '50')

      while (url) {
        // https://learn.microsoft.com/graph/api/group-get?view=graph-rest-1.0&tabs=http#response-1
        const response = await axios.get(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
        // Groupのメンバーを取得
        const activeGroups = response.data.value.filter(
          (g: any) => !g.deletedDateTime
        )
        const {results, errors} = await PromisePool.for(activeGroups)
          .withConcurrency(5)
          .process(async (group: any) => {
            let list = await this.getGroupMembers(accessToken, group.id)
            return {
              principalId: group.id,
              displayName: group.displayName,
              members: list
            } as Group
          })

        errors.forEach(error => {
          console.error('Error processing group', error)
        })
        if (errors.length > 0) {
          throw new Error('Fail to preload group members.')
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
        url = new URL(response.data['@odata.nextLink']) // 次のページがある場合、URLを更新
        console.log(
          '🫖 Now Loading ... ' + this.groups.length + ' groups cached'
        )
      }
    } catch (error) {
      console.log('Fail to load group cache', error)
      throw new Error(`Fail to preload groups. Please check the errors `)
    }
  }

  private async preLoadMembers(accessToken: string): Promise<void> {
    console.log('🫥 Start preload member eneity cache ...')
    let url = 'https://graph.microsoft.com/v1.0/users?$top=999'

    while (url) {
      const response = await axios.get(url, {
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

      url = response.data['@odata.nextLink'] || null // 次のページがある場合、URLを更新
      console.log('🫖 Now Loading ... ' + this.users.length + ' users cached')
    }
    console.log('🫖 Finish preload member eneity cache.')
  }

  private async getAppInfos(
    accessToken: string,
    app: AppInfo
  ): Promise<AppInfo> {
    console.log(
      `🚀 Start to get [ ${app.displayName} ]'s AppInfos ... (ID:${app.principleId})`
    )
    const url = new URL(
      `https://graph.microsoft.com/v1.0/servicePrincipals/${app.principleId}/appRoleAssignedTo`
    )
    url.searchParams.set('$top', '999')

    try {
      const usersInfo = await this.getUsers(accessToken, url.toString())
      const appInfoWithUsers: AppInfo = {
        appId: app.appId,
        displayName: app.displayName,
        principleId: app.principleId,
        signInAudience: app.signInAudience,
        identifierUris: app.identifierUris,
        tags: app.tags,
        users: usersInfo
      }
      console.log(
        `✅ Detected ${usersInfo.length} users in ${app.displayName} ... (${app.principleId})`
      )
      return appInfoWithUsers
    } catch (error) {
      console.log(
        `❌ Fail to get [ ${app.displayName} ]'s AppInfos ... (${app.principleId})`
      )
      throw new Error('Fail to get app info.')
    }
  }

  public async fetchSsoApps(): Promise<AppInfo[]> {
    await this.getAccessToken().then(async ({token, expiresIn}) => {
      this.access_token = token
      this.token_expiry_time = this.token_expiry_time + expiresIn

      // Preload cache
      if (this.preload_cache) {
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
        this.access_token,
        this.target_services
      )
      console.log(`Detected ${enterpriseApplications.length} SSO apps`)
      let filteredResults = [] as AppInfo[]

      try {
        let results = [] as AppInfo[]
        for (const appInfo of enterpriseApplications) {
          // アクセストークンの有効期限をチェック
          const currentTime = Math.floor(Date.now() / 1000)
          if (
            !this.token_expiry_time ||
            currentTime >= this.token_expiry_time - 600
          ) {
            // 5分の猶予
            const tokenData = await this.getAccessToken()
            this.access_token = tokenData.token
            this.token_expiry_time = currentTime + tokenData.expiresIn // 有効期限を更新
          }

          const appInfoWithUsers = await this.getAppInfos(
            this.access_token,
            appInfo
          )
          results.push(appInfoWithUsers)
        }
        // const { results, errors } = await PromisePool
        //   .for(enterpriseApplications)
        //   .withConcurrency(1) // 並列数を5に制限
        //   .process(appInfo =>
        //     this.getAppInfos(access_token, appInfo) //.catch(err => {
        //     //  throw new Error(`Failed to get assigned users for app ${appInfo.appId}: ${err}`)
        //     //})
        //   )
        // errors.forEach(error => {
        //   throw new Error(error.message);
        // })
        filteredResults = results.filter(
          appInfo => appInfo !== null
        ) as AppInfo[]
      } catch (error) {
        console.log('Fail to fetch list of applications', error)
        throw new Error(`Failed to fetch list of applications.`)
      }

      if (!this.register_zero_user_app) {
        console.log(`Filtering apps with zero users...`)
        filteredResults = filteredResults.filter(
          appInfo => appInfo.users.length > 0
        )
        console.log(
          `The number after applying the filter is ${filteredResults.length}`
        )
      }

      if (!this.register_disabled_app) {
        console.log(`Filtering disabled apps...`)
        filteredResults = filteredResults.filter(
          appInfo => !appInfo.tags.includes('HideApp')
        )
        console.log(
          `The number after applying the filter is ${filteredResults.length}`
        )
      }

      return filteredResults
    } catch (error) {
      console.log('Error fetching SSO apps', error)
      throw new Error(`Fail to fetch SSO apps`)
    }
  }
}

export const fetchApps = (
  inputs: Record<string, string>
): Promise<AppInfo[]> => {
  const aad = new AzureAD(inputs)
  return aad.fetchSsoApps()
}
