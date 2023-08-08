import axios from 'axios'
import {checkEnv} from '../util/env'

export interface AppInfo {
  appId: string
  displayName: string
  principleId: string
  applicationTemplateId?: string
  identifierUris: string[]
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

  constructor(env: NodeJS.ProcessEnv) {
    checkEnv(['ms_client_id', 'ms_tenant_id', 'ms_client_secret'], env)
    this.clientId = env.ms_client_id as string
    this.tenantId = env.ms_tenant_id as string
    this.clientSecret = env.ms_client_secret as string
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
    url = 'https://graph.microsoft.com/v1.0/applications'
  ) {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const apps = response.data.value

    // Map each app to the AppInfo interface and get the corresponding service principal id
    let appInfos = await Promise.all(
      apps.map(async (app: AppInfo) => {
        // Get the service principal id
        const servicePrincipalUrl = `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${app.appId}'`
        const servicePrincipalResponse = await axios.get(servicePrincipalUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        })
        const servicePrincipalId = servicePrincipalResponse.data.value[0]?.id
        const appInfo: AppInfo = {
          appId: app.appId,
          displayName: app.displayName,
          principleId: servicePrincipalId,
          applicationTemplateId: app.applicationTemplateId,
          identifierUris: app.identifierUris,
          users: []
        }
        return appInfo
      })
    )
    // After the Promise.all is resolved, then filter the apps
    appInfos = appInfos.filter(
      appInfo => appInfo.applicationTemplateId !== null
    )

    if (response.data['@odata.nextLink']) {
      const nextApps = await this.getEnterpriseApplications(
        accessToken,
        response.data['@odata.nextLink']
      )
      appInfos = appInfos.concat(nextApps)
    }

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

    const userInfoPromises = user_principals.map(async principal_id => {
      const userUrl = `https://graph.microsoft.com/v1.0/users/${principal_id}`
      const userResponse = await axios.get(userUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      })
      const userInfo: UserInfo = {
        email: userResponse.data.userPrincipalName,
        displayName: userResponse.data.displayName,
        principalId: principal_id
      }
      return userInfo
    })
    let userInfos = await Promise.all(userInfoPromises)

    if (response.data['@odata.nextLink']) {
      const nextUsers = await this.getUsers(
        accessToken,
        response.data['@odata.nextLink']
      )
      userInfos = userInfos.concat(nextUsers)
    }

    return userInfos
  }

  private async getAppAssignedUsers(
    accessToken: string,
    app: AppInfo
  ): Promise<AppInfo> {
    const url = `https://graph.microsoft.com/v1.0/servicePrincipals/${app.principleId}/appRoleAssignedTo`
    const usersInfo = await this.getUsers(accessToken, url)

    const appInfoWithUsers: AppInfo = {
      appId: app.appId,
      displayName: app.displayName,
      principleId: app.principleId,
      applicationTemplateId: app.applicationTemplateId,
      identifierUris: app.identifierUris,
      users: usersInfo
    }

    console.log(`Detected ${usersInfo.length} users in ${app.displayName}`)

    return appInfoWithUsers
  }

  public async fetchSsoApps(): Promise<AppInfo[]> {
    try {
      const accessToken = await this.getAccessToken()
      const enterpriseApplications = await this.getEnterpriseApplications(
        accessToken
      )

      const dataPromises = enterpriseApplications.map(appInfo =>
        this.getAppAssignedUsers(accessToken, appInfo).catch(err => {
          console.error(
            `Failed to get assigned users for app ${appInfo.id}: ${err}`
          )
          return null
        })
      )
      const data = await Promise.all(dataPromises)
      return data.filter(appInfo => appInfo !== null) as AppInfo[]
    } catch (error) {
      throw new Error(`Error fetching SSO apps: ${error}`)
    }
  }
}

export const fetchApps = (env: NodeJS.ProcessEnv): Promise<AppInfo[]> => {
  const aad = new AzureAD(env)
  return aad.fetchSsoApps()
}
