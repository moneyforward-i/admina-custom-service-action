import axios, { AxiosError } from 'axios'
import { checkEnv } from '../util/env'
import { AppInfo, UserInfo } from '../source/azuread'
import { API_CONFIG } from '../util/constants'

export async function registerCustomService(
  app: AppInfo,
  inputs: Record<string, string>
): Promise<void> {
  const admina = new Admina(inputs)
  await admina.registerCustomService(app)
}

interface AdminaService {
  id: number
  name: string
  workspaces: AdminaWorkspace[]
}

interface AdminaWorkspace {
  id: number
  workspaceName: string
}

interface AdminaRequestHeader {
  headers: {
    Authorization: string
    'Content-Type': string
  }
}

interface WorkspaceCreationResult {
  workspaceId: number
  serviceId: number
  serviceName: string
}

class Admina {
  private endpoint: string
  private orgId: string
  private apiKey: string
  private readonly requestHeader: AdminaRequestHeader

  constructor(inputs: Record<string, string>) {
    checkEnv(['admina_org_id', 'admina_api_token'], inputs)
    this.endpoint = API_CONFIG.ADMINA_ENDPOINT
    this.orgId = inputs['admina_org_id']
    this.apiKey = inputs['admina_api_token']
    this.requestHeader = {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    }
  }

  public async registerCustomService(appInfo: AppInfo): Promise<void> {
    // Validate workspace name
    const targetWorkspaceName = appInfo.displayName.trim()
    if (!targetWorkspaceName || targetWorkspaceName.length === 0) {
      console.error(`❌ Workspace name is empty for app ${appInfo.displayName}. Skipping.`)
      return
    }

    // Check if the Service already exists in the Organization
    const ssoService = await this.findOrCreateService()
    const existingWorkspace = this.findWorkspaceByName(ssoService, targetWorkspaceName)

    let workspaceId: number
    let serviceId: number

    if (existingWorkspace) {
      // Use existing workspace
      workspaceId = existingWorkspace.id
      serviceId = ssoService.id
      console.log(
        `Workspace already exists | Service: ${ssoService.name}(${serviceId}), Workspace: ${targetWorkspaceName}(${workspaceId})`
      )
    } else {
      // Create new workspace
      try {
        const result = await this.createWorkspace(
          API_CONFIG.SSO_SERVICE_NAME,
          targetWorkspaceName
        )
        workspaceId = result.workspaceId
        serviceId = result.serviceId
      } catch (error) {
        // Error already logged in createWorkspace
        console.error(`Skipping account registration for ${targetWorkspaceName} due to workspace creation failure`)
        return // Skip account registration if workspace creation fails
      }
    }

    // Ensure serviceId is valid before proceeding to account registration
    if (!serviceId || typeof serviceId !== 'number' || serviceId <= 0) {
      console.error(
        `❌ Invalid or missing serviceId (${serviceId}) for workspace ${targetWorkspaceName}. Skipping account registration.`
      )
      return
    }

    await this.registerUserAccountToCustomWorkspace(
      serviceId,
      workspaceId,
      targetWorkspaceName,
      appInfo.users
    )
  }

  private async findOrCreateService(): Promise<AdminaService> {
    const encodedServiceName = encodeURIComponent(API_CONFIG.SSO_SERVICE_NAME)
    const serviceListEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/services?keyword=${encodedServiceName}`

    const serviceListResponse = await axios.get(
      serviceListEndpoint,
      this.requestHeader
    )

    const ssoService = serviceListResponse.data.items[0]

    // Return the service with empty workspaces array if not found (will be created on first workspace creation)
    return ssoService || { id: null, name: null, workspaces: [] }
  }

  private findWorkspaceByName(
    service: AdminaService,
    workspaceName: string
  ): AdminaWorkspace | undefined {
    if (!service.workspaces || service.workspaces.length === 0) {
      return undefined
    }

    return service.workspaces.find(
      workspace => workspace.workspaceName === workspaceName
    )
  }

  private async createWorkspace(
    serviceName: string,
    workspaceName: string
  ): Promise<WorkspaceCreationResult> {
    const customWsEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspaces/custom`

    const customWsPayload: {
      customWorkspaceType: string
      serviceName: string
      workspaceName: string
    } = {
      customWorkspaceType: 'manual_import',
      serviceName: serviceName,
      workspaceName: workspaceName
    }

    console.log(`Creating workspace: ${workspaceName} (customWorkspaceType: manual_import)`)

    try {
      const response = await axios.post(
        customWsEndpoint,
        customWsPayload,
        this.requestHeader
      )

      const { workspace, service } = response.data
      const createdServiceName = service?.name || serviceName

      console.log(
        `✅ Workspace created | Service: ${createdServiceName}(${service.id}), Workspace: ${workspaceName}(${workspace.id})`
      )

      return {
        workspaceId: workspace.id,
        serviceId: service.id,
        serviceName: createdServiceName
      }
    } catch (error: any) {
      if (error && (error as AxiosError).response) {
        const axiosError = error as AxiosError
        console.error(
          `❌ Failed to create workspace for ${workspaceName}:`,
          axiosError.message,
          axiosError.response?.data,
          'Payload:',
          customWsPayload
        )
      } else if (error instanceof Error) {
        console.error(
          `❌ Failed to create workspace for ${workspaceName}:`,
          error.message,
          'Payload:',
          customWsPayload
        )
      } else {
        console.error(
          `❌ Unknown error during workspace creation for ${workspaceName}:`,
          error,
          'Payload:',
          customWsPayload
        )
      }
      throw error
    }
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
      this.requestHeader
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
    const deletedUsers: { email: string; displayName: string }[] =
      accountListResponse.data.items.filter(
        (account: any) =>
          !users.find((user: UserInfo) => user.email === account.email)
      )

    console.log(
      `Register data into ${wsName}: existingUsers ${existingUsers.length}, newUsers ${newUsers.length}, deleteAccounts ${deletedUsers.length}`
    )

    function chunkArray<T>(array: T[], chunkSize: number): T[][] {
      const results = []
      const arrayCopy = [...array] // Create a copy to avoid mutating the original
      while (arrayCopy.length) {
        results.push(arrayCopy.splice(0, chunkSize))
      }
      return results
    }

    // Register accounts
    const registerEndpoint = `${this.endpoint}/api/v1/organizations/${this.orgId}/workspaces/${workspaceId}/accounts/custom`
    try {
      // Create New Users
      for (const chunk of chunkArray(newUsers, API_CONFIG.CHUNK_SIZE)) {
        const createData = {
          create: chunk.map(user => ({
            email: user.email,
            displayName: user.displayName,
            userName: user.displayName
          }))
        }
        await axios.post(registerEndpoint, createData, this.requestHeader)
      }

      // Update Existing Users
      for (const chunk of chunkArray(existingUsers, API_CONFIG.CHUNK_SIZE)) {
        const updateData = {
          update: chunk.map(user => ({
            email: user.email,
            displayName: user.displayName,
            userName: user.displayName
          }))
        }
        await axios.post(registerEndpoint, updateData, this.requestHeader)
      }

      // Delete Users
      for (const chunk of chunkArray(deletedUsers, API_CONFIG.CHUNK_SIZE)) {
        const deleteData = {
          delete: chunk.map(account => ({
            email: account.email,
            displayName: account.displayName
          }))
        }
        await axios.post(registerEndpoint, deleteData, this.requestHeader)
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
