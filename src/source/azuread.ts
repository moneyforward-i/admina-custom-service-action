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

class AzureAD {
  private clientId: string
  private tenantId: string
  private clientSecret: string
  private register_zero_user_app: boolean
  private register_disabled_app: boolean
  private target_services: string[]

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
  }

  private async getAccessToken() {
    console.log('Getting access token...')
    const url = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`

    const params = new URLSearchParams()
    params.append('grant_type', 'client_credentials')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('scope', 'https://graph.microsoft.com/.default')

    try {
      const response = await axios.post(url, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })
      return response.data.access_token
    } catch (error: any) {
      if (error instanceof Error) {
        throw new Error(`Failed to get access token: ${error.message}`)
      } else {
        throw new Error(
          `An unknown error occurred while getting access token: ${error}`
        )
      }
    }
  }

  private async getEnterpriseApplications(
    accessToken: string,
    serviceNames: string[] = [],
    baseURL = 'https://graph.microsoft.com/v1.0/applications'
  ): Promise<AppInfo[]> {
    const filterQueries = serviceNames
      .map(name => `(displayName eq '${name}')`)
      .join(' or ')
    const url = new URL(baseURL)
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
      console.error('Fail to fetch application detals.', error)
    })
    if (errors.length > 0) {
      throw new Error(
        'Fail to fetch application details, please check the errors'
      )
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

  private async getUsers(
    accessToken: string,
    url: string
  ): Promise<UserInfo[]> {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    //const users: string[] = response.data.value;
    const user_principals: string[] = response.data.value
      .filter((user: any) => user.principalId !== null)
      .map((user: any) => user.principalId)

    // PromisePoolで並列処理を実行
    let userInfos = [] as UserInfo[]
    const {results, errors} = await PromisePool.for(user_principals)
      .withConcurrency(5) // 並列数を5に制限
      .process(async (principal_id: string) => {
        const userUrl = `https://graph.microsoft.com/v1.0/users/${principal_id}`
        const userResponse = await axios.get(userUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
        return {
          email: userResponse.data.userPrincipalName,
          displayName: userResponse.data.displayName,
          principalId: principal_id
        } as UserInfo
      })
    userInfos = results
    errors.forEach(error => {
      console.error('Fail to fetch user detals.', error)
    })
    if (errors.length > 0) {
      throw new Error('Fail to fetch user details, please check the errors')
    }

    if (response.data['@odata.nextLink']) {
      const nextUsers = await this.getUsers(
        accessToken,
        response.data['@odata.nextLink']
      )
      userInfos = userInfos.concat(nextUsers)
    }

    return userInfos
  }

  private async getAppInfos(
    accessToken: string,
    app: AppInfo
  ): Promise<AppInfo> {
    const url = `https://graph.microsoft.com/v1.0/servicePrincipals/${app.principleId}/appRoleAssignedTo`
    const usersInfo = await this.getUsers(accessToken, url)

    const appInfoWithUsers: AppInfo = {
      appId: app.appId,
      displayName: app.displayName,
      principleId: app.principleId,
      signInAudience: app.signInAudience,
      identifierUris: app.identifierUris,
      tags: app.tags,
      users: usersInfo
    }

    console.log(`Detected ${usersInfo.length} users in ${app.displayName}`)

    return appInfoWithUsers
  }

  public async fetchSsoApps(): Promise<AppInfo[]> {
    try {
      const accessToken = await this.getAccessToken()
      const enterpriseApplications = await this.getEnterpriseApplications(
        accessToken,
        this.target_services
      )
      console.log(`Detected ${enterpriseApplications.length} SSO apps`)
      let filteredResults = [] as AppInfo[]

      const {results, errors} = await PromisePool.for(enterpriseApplications)
        .withConcurrency(5) // 並列数を5に制限
        .process(appInfo =>
          this.getAppInfos(accessToken, appInfo).catch(err => {
            throw new Error(
              `Failed to get assigned users for app ${appInfo.appId}: ${err}`
            )
          })
        )
      errors.forEach(error => {
        console.error('Fail to fetch applications.', error)
      })
      if (errors.length > 0) {
        throw new Error('Fail to fetch applications, please check the errors')
      }

      filteredResults = results.filter(appInfo => appInfo !== null) as AppInfo[]

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
      throw new Error(`Error fetching SSO apps: ${error}`)
    }
  }
}

export const fetchApps = (
  inputs: Record<string, string>
): Promise<AppInfo[]> => {
  const aad = new AzureAD(inputs)
  return aad.fetchSsoApps()
}
