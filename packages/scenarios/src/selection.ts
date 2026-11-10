/**
 * Which scenarios a run measures. `only` is a comma-separated list of exact names. With none, an ordinary run
 * takes every scenario and a paired one every scenario that has a Playwright twin, since a comparison needs both.
 */
export const selectScenarios = <S extends { readonly name: string; readonly playwright?: unknown }>(
  scenarios: ReadonlyArray<S>,
  only: string | undefined,
  paired: boolean
): ReadonlyArray<S> => {
  if (only === undefined || only === "") {
    return paired ? scenarios.filter((scenario) => scenario.playwright !== undefined) : scenarios
  }
  const names = only.split(",").map((name) => name.trim())
  const unknown = names.filter((name) => !scenarios.some((scenario) => scenario.name === name))
  if (unknown.length > 0) throw new Error(`Unknown scenarios: ${unknown.join(", ")}`)
  return scenarios.filter((scenario) => names.includes(scenario.name))
}
