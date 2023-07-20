// Source
import * as AzureAdSource from '../source/azuread'

// Transform
import * as AzureAdTransform from '../transform/azuread'

// Destination
import * as AdminaDist from '../destination/admina'

// Data
import {Source, Destination} from '../integrate/enum'

export const Sync = async (
  src: string,
  dist: string,
  env: NodeJS.ProcessEnv
) => {
  const destination = Destination[dist as keyof typeof Destination]
  const source = Source[src as keyof typeof Source]

  if (destination === undefined) {
    throw new Error(`Unsupported destination: ${dist}`)
  }
  if (source === undefined) {
    throw new Error(`Unsupported source: ${src}`)
  }

  switch (destination) {
    case Destination.Admina:
      // Call the sync function for Azure AD with all environment variables
      await syncToAdmina(source, env)
      break
    default:
      throw new Error(`Undeveloped destination: ${destination}`)
  }
}

const syncToAdmina = async (source: Source, env: NodeJS.ProcessEnv) => {
  switch (source) {
    case Source.AzureAd:
      // Get AzureAd Data
      console.log('Getting Azure AD data...')
      const azureAdData = await AzureAdSource.fetchApps(env)
      console.log('Registering custom service...')
      await Promise.all(
        azureAdData.map(async (app: AzureAdSource.AppInfo) => {
          AdminaDist.registerCustomService(
            await AzureAdTransform.transformDataToAdmina(app),
            env
          )
        })
      )
      break
    default:
      throw new Error(`Undeveloped source: ${source}`)
  }
}
