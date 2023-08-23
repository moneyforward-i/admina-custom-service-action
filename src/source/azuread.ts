import axios from 'axios'
import { checkEnv } from '../util/env'
import { PromisePool } from '@supercharge/promise-pool'

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
    this.target_services = inputs['target_services'] ? inputs['target_services'].split(',') : [];
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
    const filterQueries = serviceNames.map(name => `(displayName eq '${name}')`).join(' or ');
    const url = new URL(baseURL);
    if (filterQueries) {
      url.searchParams.set('$filter', filterQueries);
    }
    const response = await axios.get(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const apps = response.data.value

    // AppInfo型として必要なプロパティを定義
    const appInfoKeys = ['appId', 'displayName', 'signInAudience', 'identifierUris', 'tags'] as const

    // 型ガード関数を定義
    const isAppInfo = (obj: unknown): obj is AppInfo => {
      return appInfoKeys.every(key => Object.prototype.hasOwnProperty.call(obj, key))
    }
    // PromisePoolで並列処理を実行
    let appInfos = [] as AppInfo[]
    try {
      const { results, errors } = await PromisePool
        .for<AppInfo>(apps.filter(isAppInfo)) // 型ガードでフィルタリング
        .withConcurrency(5) // 並列数を5に制限
        .process(async (app: AppInfo) => {
          // Get the service principal id
          const servicePrincipalUrl = new URL('https://graph.microsoft.com/v1.0/servicePrincipals');
          servicePrincipalUrl.searchParams.set('$filter', `appId eq '${app.appId}'`)
          const servicePrincipalResponse = await axios.get(servicePrincipalUrl.toString(), {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          })
          const servicePrincipalId = servicePrincipalResponse.data.value[0]?.id
          const tags: string[] = servicePrincipalResponse.data.value[0]?.tags ?? []
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
        if (error instanceof Error) {
          throw new Error(error.message);
        }
      })
      appInfos = results
    } catch (error) {
      throw new Error(`Fail to fetch applications from AzureAd: ${error}`);
    }

    // After the Promise.all is resolved, then filter the apps
    appInfos = appInfos.filter(
      appInfo =>
        appInfo.tags &&
        appInfo.tags.some(tag =>
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

  private async getUserPrincipals(accessToken: string, url: string): Promise<string[]> {
    let userPrincipals = [] as string[]
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    // console.log(response.data)
    // {
    //   id: 'dummyNr6HU2hSSmwM_pdN5-_UE-dummyuzEg3Pt098I',
    //   deletedDateTime: null,
    //   appRoleId: 'dummmmmy-c3bd-439b-9a66-3a2aee01d14f',
    //   createdDateTime: '2021-08-10T04:02:58.0119555Z',
    //   principalDisplayName: 'SAMPLE_GROUP_NAME',
    //   principalId: 'dummmmmy-fada-4d1d-a149-29b033fa5d37',
    //   principalType: 'Group',
    //   resourceDisplayName: 'APPNAME',
    //   resourceId: 'dummmmmy-4997-4c24-96df-f13f09e2419d'
    // }
    const users = response.data.value.filter((user: any) => user.principalType === 'User' && user.principalId !== null)
    const groups = response.data.value.filter((group: any) => group.principalType === 'Group' && group.principalId !== null)

    //console.log(`Getting ${users.length} users and ${groups.length} groups ...`)
    const newUserPrincipals = users.map((user: any) => user.principalId)

    userPrincipals.concat(newUserPrincipals)

    for (const group of groups) {
      console.log(`Getting group members from ${group.principalDisplayName}:${group.principalType}...: ${group.principalId}`)
      const groupMembersUrl = `https://graph.microsoft.com/v1.0/groups/${group.principalId}/members`
      const groupMembers = await this.getGroupMembers(accessToken, groupMembersUrl)
      const groupMemberIds = groupMembers.map((member: any) => member.id)
      userPrincipals = userPrincipals.concat(groupMemberIds)
      console.log(`Getting ${groupMembers.length} group members from ${group.principalDisplayName}`)
    }

    if (response.data['@odata.nextLink']) {
      const nextUserPrincipals = await this.getUserPrincipals(accessToken, response.data['@odata.nextLink'])
      userPrincipals = userPrincipals.concat(nextUserPrincipals)
    }

    return userPrincipals
  }

  private async getGroupMembers(accessToken: string, url: string): Promise<any[]> {
    let members = [] as any[]
    //console.log(`Getting group members from ${url} ...`)
    try {
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      //console.log(response.data)
      // {
      //   '@odata.type': '#microsoft.graph.user',
      //   id: 'dummmmmy-60c8-426a-8a23-0380aa0df0a0',
      //   businessPhones: [],
      //   displayName: 'LastName FirstName',
      //   givenName: 'xxxx',
      //   jobTitle: null,
      //   mail: 'xxxx@example.com',
      //   mobilePhone: null,
      //   officeLocation: null,
      //   preferredLanguage: null,
      //   surname: 'xxxx',
      //   userPrincipalName: 'xxxx@example.com'
      // },
      const users = response.data.value.filter((user: any) => user["@odata.type"] === "#microsoft.graph.user" && user.Id !== null);
      const groups = response.data.value.filter((group: any) => group["@odata.type"] === "#microsoft.graph.group" && group.Id !== null);
      //console.log(`Getting more ${users.length} users and ${groups.length} groups ...`)

      members = members.concat(users)

      for (const group of groups) {
        const groupMembersUrl = `https://graph.microsoft.com/v1.0/groups/${group.principalId}/members`
        const groupMembers = await this.getGroupMembers(accessToken, groupMembersUrl)
        members = members.concat(groupMembers)
      }

      if (response.data['@odata.nextLink']) {
        const nextMembers = await this.getGroupMembers(accessToken, response.data['@odata.nextLink'])
        members = members.concat(nextMembers)
      }
    } catch (error: any) {
      //console.log(error)
    }
    //console.log(`Got ${members.length} members from ${url} ... `)
    return members
  }

  private async getUserInfo(accessToken: string, principal_id: string): Promise<UserInfo> {
    const userUrl = `https://graph.microsoft.com/v1.0/users/${principal_id}`
    //console.log(`Getting user info from ${userUrl} ...`)
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
  }

  private async getUsers(accessToken: string, url: string): Promise<UserInfo[]> {
    const principals = await this.getUserPrincipals(accessToken, url)
    const uniquePrincipals = [...new Set(principals)];
    console.log('the length of uniquePrincipals is ' + uniquePrincipals.length)
    console.log('the length of principals is ' + principals.length)


    console.log(`Getting ${principals.length} users from ${url} ...`)
    const { results } = await PromisePool
      .for(principals)
      .withConcurrency(5) // 並列数を5に制限
      .process(async (principal_id: string) => {
        return await this.getUserInfo(accessToken, principal_id)
      })

    return results
  }

  // private async listGroups(accessToken: string): Promise<void> {
  //   const url = `https://graph.microsoft.com/v1.0/groups`
  //   const response = await axios.get(url, {
  //     headers: {
  //       Authorization: `Bearer ${accessToken}`
  //     }
  //   })
  //   //console.log(response.data)

  //   for (const group of response.data.value) {
  //     console.log(group.displayName)
  //     this.getGroupMembers(accessToken, `https://graph.microsoft.com/v1.0/groups/${group.id}/members`)
  //   }
  // }


  private async getAppInfos(
    accessToken: string,
    app: AppInfo
  ): Promise<AppInfo> {
    console.log(`Start to get ${app.displayName}'s AppInfos ...`)
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

      try {
        const { results, errors } = await PromisePool
          .for(enterpriseApplications)
          .withConcurrency(1) // 並列数を5に制限
          .process(appInfo =>
            this.getAppInfos(accessToken, appInfo).catch(err => {
              throw new Error(`Failed to get assigned users for app ${appInfo.appId}: ${err}`)
            })
          )
        errors.forEach(error => {
          throw new Error(error.message);
        })
        filteredResults = results.filter(appInfo => appInfo !== null) as AppInfo[]
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(error.message);
        } else {
          throw new Error(`Failed to fetch list of applications. :${error}`);
        }
      }

      if (!this.register_zero_user_app) {
        console.log(`Filtering apps with zero users...`)
        filteredResults = filteredResults.filter(appInfo => appInfo.users.length > 0)
        console.log(`The number after applying the filter is ${filteredResults.length}`)
      }

      if (!this.register_disabled_app) {
        console.log(`Filtering disabled apps...`)
        filteredResults = filteredResults.filter(appInfo => !appInfo.tags.includes('HideApp'))
        console.log(`The number after applying the filter is ${filteredResults.length}`)
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
