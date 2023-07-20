import * as Integration from './integrate/integrate'

type CoreType = {
  getInput: (name: string) => string
  setFailed: (message: string) => void
}
let core: CoreType
if (process.env.GITHUB_ACTIONS) {
  // GITHUB_ACTIONS environment variable is automatically set in GitHub Actions
  core = require('@actions/core')
} else {
  core = {
    getInput: name => process.env[name] || '',
    setFailed: message => console.error(message)
  }
}
async function run() {
  try {
    const subcommand = core.getInput('subcommand')

    // Check if the subcommand is 'sync'
    if (subcommand === 'sync') {
      console.log('Starting sync...')
      const source = core.getInput('source')
      const destination = core.getInput('destination')
      console.log(`Start Sync Data from ${source} to ${destination} .`)

      await Integration.Sync(source, destination, process.env)
    } else {
      throw new Error(`Unsupported subcommand: ${subcommand}`)
    }
  } catch (error: any) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(error)
    }
  }
  console.log('Sync finished.')
}

run()
