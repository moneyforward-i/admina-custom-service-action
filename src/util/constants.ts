/**
 * Application-wide constants
 */
export const API_CONFIG = {
  ADMINA_ENDPOINT: 'https://api.itmc.i.moneyforward.com',
  GRAPH_API_ENDPOINT: 'https://graph.microsoft.com/v1.0',
  GRAPH_AUTH_ENDPOINT: 'https://login.microsoftonline.com',
  SSO_SERVICE_NAME: 'Single Sign-On',
  CHUNK_SIZE: 3000,
  CONCURRENT_REQUESTS: 5,
  TOKEN_REFRESH_BUFFER_SEC: 600, // 10 minutes
  API_TIMEOUT_MS: 600000, // 100 seconds
  MAX_ITEMS_PER_PAGE: 999
} as const

export const SSO_APP_TAGS = [
  'WindowsAzureActiveDirectoryIntegratedApp',
  'WindowsAzureActiveDirectoryGalleryApplication',
  'WindowsAzureActiveDirectoryCustomSingleSignOnApplication'
] as const

export const WORKSPACE_NOT_FOUND = -1

