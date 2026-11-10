/**
 * Which scenarios a run measures. `only` is a comma-separated list of exact names. With none, an ordinary run
 * takes every scenario and a paired one every scenario that needs no recording of a public site, which a hosted
 * runner doesn't have.
 */
export const selectScenarios = <
  S extends { readonly name: string; readonly recording?: unknown }
>(
  scenarios: ReadonlyArray<S>,
  only: string | undefined,
  paired: boolean
): ReadonlyArray<S> => {
  if (only === undefined || only === "") {
    return paired ? scenarios.filter((scenario) => scenario.recording === undefined) : scenarios
  }
  const names = only.split(",").map((name) => name.trim())
  const unknown = names.filter((name) => !scenarios.some((scenario) => scenario.name === name))
  if (unknown.length > 0) throw new Error(`Unknown scenarios: ${unknown.join(", ")}`)
  return scenarios.filter((scenario) => names.includes(scenario.name))
}

/** The scenarios that run on `engine`: every one on Chromium, and on Firefox those not marked Chromium-only. */
export const supportedOn = <S extends { readonly chromiumOnly?: unknown }>(
  scenarios: ReadonlyArray<S>,
  engine: "chromium" | "firefox"
): ReadonlyArray<S> =>
  engine === "chromium"
    ? scenarios
    : scenarios.filter((scenario) => scenario.chromiumOnly === undefined)
