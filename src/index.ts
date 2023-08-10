import * as Integration from './integrate/integrate'
import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'

type CoreType = {
  getInput: (name: string) => string
  setFailed: (message: string) => void
  debug: (message: string) => void
}
let core: CoreType
if (process.env.GITHUB_ACTIONS) {
  // GITHUB_ACTIONS environment variable is automatically set in GitHub Actions
  core = require('@actions/core')
} else {
  core = {
    getInput: name => process.env[name] || '',
    setFailed: message => console.error(message),
    debug: message => {
      if (process.env.ACTIONS_RUNNER_DEBUG === 'true') {
        console.debug(message)
      }
    }
  }
}
async function run() {
  try {
    // 入力キーを取得
    const inputs = getInputsFromKeys(getInputKeysFromActionYml(), core)
    const subcommand = inputs['subcommand']

    // Check if the subcommand is 'sync'
    if (subcommand === 'sync') {
      console.log('Starting sync...')
      const source = inputs['source']
      const destination = inputs['destination']
      console.log(`Start Sync Data from ${source} to ${destination} .`)

      await Integration.Sync(source, destination, inputs)
      console.log('Sync finished.')
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
}

function getInputKeysFromActionYml(): string[] {
  const actionYmlPath = path.resolve(__dirname, '../action.yml')
  const actionYmlContent = fs.readFileSync(actionYmlPath, 'utf8')
  const actionYml = yaml.parse(actionYmlContent)

  return Object.keys(actionYml.inputs)
}

function getInputsFromKeys(
  inputKeys: string[],
  core: CoreType
): Record<string, string> {
  core.debug(`Logging inputs from actions`)
  return inputKeys.reduce(
    (acc, key) => {
      const value = core.getInput(key)
      acc[key] = value

      const debugValue = value ? '****' : 'empty'
      core.debug(`... ${key}: ${debugValue}`)

      return acc
    },
    {} as Record<string, string>
  )
}

run()
