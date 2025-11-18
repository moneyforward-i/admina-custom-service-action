// Source
import * as azuread from '../source/azuread'

/**
 * Transform Azure AD AppInfo to Admina format
 * Currently, AppInfo is shared between source and destination, so no transformation is needed
 * This function exists for future extensibility if transformation logic is required
 */
export async function transformDataToAdmina(
  data: azuread.AppInfo
): Promise<azuread.AppInfo> {
  try {
    // Future: Add transformation logic if needed
    // Currently, AppInfo is shared between source and destination
    return data
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('Transform data error:', errorMsg)
    throw new Error(`Error in transformDataToAdmina: ${errorMsg}`)
  }
}
