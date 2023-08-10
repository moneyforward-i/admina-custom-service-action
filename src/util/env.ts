export function checkEnv(
  variables: string[],
  inputs: Record<string, string>
): boolean {
  variables.forEach(variable => {
    if (!inputs[variable]) {
      throw new Error(`Environment variable ${variable} is not set`)
    }
  })
  return true
}
