// Source
import * as azuread from '../source/azuread'

// Destination
import * as admina from '../destination/admina'

export async function transformDataToAdmina(
  data: azuread.AppInfo
): Promise<admina.AppInfo> {
  try {
    const app: admina.AppInfo = {
      displayName: data.displayName,
      identifierUris: data.identifierUris,
      users: data.users.map(user => {
        return {
          email: user.email,
          displayName: user.displayName
        }
      })
    }
    return app
  } catch (error) {
    console.log('tansform data error:', error)
    throw new Error(`Error in transformDataToAdmina`)
  }
}
