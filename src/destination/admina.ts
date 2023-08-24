import axios, {AxiosError} from 'axios'
import {checkEnv} from '../util/env'

export interface AppInfo {
  displayName: string
  identifierUris: string[]
  users: UserInfo[]
}
export interface UserInfo {
  email: string
  displayName: string
}

export async function registerCustomService(
  app: AppInfo,
  inputs: Record<string, string>
): Promise<void> {
  const admina = new Admina(inputs)
  await admina.registerCustomService(app)
}

class Admina {
  private endpoint: string
  private orgId: string
  private apiKey: string
  private request_header: any

  constructor(inputs: Record<string, string>) {
    checkEnv(['admina_org_id', 'admina_api_token'], inputs)
    this.endpoint = 'https://api.itmc.i.moneyforward.com'
    this.orgId = inputs['admina_org_id']
    this.apiKey = inputs['admina_api_token']
    this.request_header = {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  }

  public async registerCustomService(appInfo: AppInfo): Promise<void> {
    const SSO_SERVICE_NAME = 'Single Sign-On' // The service name is fixed.

    // Check if the Service already exists in the Organization
    const encodedServiceName = encodeURIComponent(SSO_SERVICE_NAME)
    const serviceListEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/services?keyword=${encodedServiceName}`
    const serviceListResponse = await axios.get(
      serviceListEndpoint,
      this.request_header
    )

    const sso_service = serviceListResponse.data.items[0]
    const sso_workspaces = sso_service ? sso_service.workspaces : [] //　完全に新規登録
    const targetWorkspaceName = appInfo.displayName

    let serviceId = sso_service ? sso_service.id : null
    let serviceName = sso_service ? sso_service.name : null
    let workspaceId: number = -1 // dummy

    // Check if the Workspace already exists in the Service
    for (const workspace of sso_workspaces) {
      if (workspace.workspaceName === appInfo.displayName) {
        workspaceId = workspace.id
        break
      }
    }

    if (workspaceId == -1) {
      // Create Workspace if it does not exist
      const customWsEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspaces/custom`
      const customWsPayload = {
        serviceName: SSO_SERVICE_NAME,
        serviceUrl: appInfo.identifierUris[0],
        workspaceName: targetWorkspaceName
      }
      const customWsConfig = {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
      const customServiceResponse = await axios.post(
        customWsEndpoint,
        customWsPayload,
        customWsConfig
      )
      workspaceId = customServiceResponse.data.workspace.id
      serviceId = customServiceResponse.data.service.id
      console.log(
        'Workspace created | ServiceName:',
        serviceName + '(' + serviceId + ')',
        ',WorkspaceName:',
        targetWorkspaceName + '(' + workspaceId + ')'
      )
    } else {
      // Skip Workspace Creation if it already exist
      console.log(
        'Workspace already exists | ServiceName:',
        serviceName + '(' + serviceId + ')',
        ', WorkspaceName:',
        targetWorkspaceName + '(' + workspaceId + ')'
      )
    }

    await this.registerUserAccountToCustomWorkspace(
      serviceId,
      workspaceId,
      targetWorkspaceName,
      appInfo.users
    )
  }

  private async registerUserAccountToCustomWorkspace(
    serviceId: number,
    workspaceId: number,
    wsName: string,
    users: UserInfo[]
  ): Promise<void> {
    const accountListEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/services/${serviceId}/accounts?workspaceId=${workspaceId}`
    const accountListResponse = await axios.get(
      accountListEndpoint,
      this.request_header
    )
    const accountEmails = accountListResponse.data.items.map(
      (account: any) => account.email
    )

    // Obtain a list of accounts for each creation, renewal, and deletion
    const existingUsers = users.filter((user: UserInfo) =>
      accountEmails.includes(user.email)
    )
    const newUsers = users.filter(
      (user: UserInfo) => !accountEmails.includes(user.email)
    )
    const deletedUsers: {email: string; displayName: string}[] =
      accountListResponse.data.items.filter(
        (account: any) =>
          !users.find((user: UserInfo) => user.email === account.email)
      )

    console.log(
      `Register data into ${wsName}: existingUsers`,
      existingUsers.length,
      ', newUsers',
      newUsers.length,
      ', deleteAccounts',
      deletedUsers.length
    )

    const CHUNK_SIZE = 200
    function chunkArray<T>(array: T[], chunkSize: number): T[][] {
      const results = []
      while (array.length) {
        results.push(array.splice(0, chunkSize))
      }
      return results
    }

    // Register accounts
    const registerEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspace/${workspaceId}/accounts/custom`
    try {
      // Create New Users
      for (const chunk of chunkArray(newUsers, CHUNK_SIZE)) {
        const createData = {
          create: chunk.map(user => ({
            email: user.email,
            displayName: user.displayName,
            userName: user.displayName,
            roles: ['user']
          }))
        }
        await axios.post(registerEndpoint, createData, this.request_header)
      }
      // Update Existing Users
      for (const chunk of chunkArray(existingUsers, CHUNK_SIZE)) {
        const updateData = {
          update: chunk.map(user => ({
            email: user.email,
            displayName: user.displayName,
            userName: user.displayName,
            roles: ['user']
          }))
        }
        await axios.post(registerEndpoint, updateData, this.request_header)
      }

      // Delete Users
      for (const chunk of chunkArray(deletedUsers, CHUNK_SIZE)) {
        const deleteData = {
          delete: chunk.map(account => ({
            email: account.email,
            displayName: account.displayName
          }))
        }
        await axios.post(registerEndpoint, deleteData, this.request_header)
      }
    } catch (error: any) {
      if (error && (error as AxiosError).response) {
        const axiosError = error as AxiosError
        console.error(
          `Error occurred while registering user account into [${wsName}]:`,
          axiosError.message,
          axiosError.response?.data
        )
      } else if (error instanceof Error) {
        console.error(
          `Error occurred while registering user account into [${wsName}]:`,
          error.message
        )
      } else {
        console.error(
          `An unknown error occurred while registering user account into [${wsName}]:`,
          error
        )
      }
    }
  }
}
