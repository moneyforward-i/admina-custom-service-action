// Source
import * as AzureAdSource from '../source/azuread'

// Transform
import * as AzureAdTransform from '../transform/azuread'

// Destination
import * as AdminaDist from '../destination/admina'

// Data
import {Source, Destination} from '../integrate/enum'

import {PromisePool} from '@supercharge/promise-pool'

export const Sync = async (
  src: string,
  dist: string,
  inputs: Record<string, string>
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
      await syncToAdmina(source, inputs)
      break
    default:
      throw new Error(`Undeveloped destination: ${destination}`)
  }
}

const syncToAdmina = async (source: Source, inputs: Record<string, string>) => {
  switch (source) {
    case Source.AzureAd:
      // Get AzureAd Data
      console.log('Getting Azure AD data...')
      const azureAdData = await AzureAdSource.fetchApps(inputs)
      console.log('Registering custom service...')
      const {results, errors} = await PromisePool.for(azureAdData)
        .withConcurrency(2) // Limit the parallel processes to 2.
        .process(async (app: AzureAdSource.AppInfo) => {
          await AdminaDist.registerCustomService(
            await AzureAdTransform.transformDataToAdmina(app),
            inputs
          )
        })

      errors.forEach(error => {
        console.log('Failed to register service', error)
      })
      if (errors.length > 0) {
        throw new Error('Failed to register services.')
      }

      break
    default:
      throw new Error(`Undeveloped source: ${source}`)
  }
}
