import { stats } from "./measure.ts"
import type { Measurements, Outcome } from "./report.ts"
import type { Scenario } from "./scenarios.ts"

const normalize = (text: string) => text.replace(/\s+/g, " ").trim()
const outcomeOf = async (run: () => Promise<string>, expected: string): Promise<Outcome> => {
  try {
    const text = normalize(await run())
    return text === expected
      ? { _tag: "Read", text }
      : { _tag: "Failed", error: `Read ${JSON.stringify(text)}, expected ${JSON.stringify(expected)}` }
  } catch (error) {
    return { _tag: "Failed", error: normalize(String((error as Error)?.message ?? error)) }
  }
}

type Result = Measurements["scenarios"][number]
export const runScenarios = async (
  chosen: ReadonlyArray<Scenario>,
  runs: number,
  runners: (scenario: Scenario) => Record<"strider" | "playwright", () => Promise<string>>,
  log: (line: string) => void
): Promise<Array<Result>> => {
  const results: Array<Result> = []
  for (const scenario of chosen) {
    log(`scenario ${scenario.name}`)
    const run = runners(scenario)
    const outcome = {
      strider: await outcomeOf(run.strider, scenario.expected),
      playwright: await outcomeOf(run.playwright, scenario.expected)
    }
    const times = { strider: [] as Array<number>, playwright: [] as Array<number> }
    const attempts = { strider: 0, playwright: 0 }
    const failures: Array<Result["failures"][number]> = []
    for (let i = 0; i < runs; i++) {
      const order = i % 2 === 0 ? (["strider", "playwright"] as const) : (["playwright", "strider"] as const)
      for (const library of order) {
        attempts[library]++
        const started = performance.now()
        const result = await outcomeOf(run[library], scenario.expected)
        if (result._tag === "Read") times[library].push(performance.now() - started)
        else {
          failures.push({ library, repetition: i + 1, error: result.error })
          log(`${scenario.name}, ${library}, timed repetition ${i + 1}: failed: ${result.error}`)
        }
      }
    }
    results.push({
      scenario,
      outcome,
      attempts,
      failures,
      times: { strider: stats(times.strider), playwright: stats(times.playwright) }
    })
  }
  return results
}

// Publish before returning the CLI status, including when every timed attempt failed.
export const publish = (results: ReadonlyArray<Result>, write: () => void): number => {
  write()
  return results.some((result) =>
      result.failures.length > 0 || result.outcome.strider._tag === "Failed" ||
      result.outcome.playwright._tag === "Failed"
    )
    ? 1
    : 0
}
