export function checkEnv(variables: string[], env: NodeJS.ProcessEnv): boolean {
  variables.forEach(variable => {
    if (!env[variable]) {
      throw new Error(`Environment variable ${variable} is not set`)
    }
  })
  return true
}
