/**
 * RESULTS.md: what `pnpm scenarios` found, with the machine, the browser and the libraries' versions it found it
 * on. Written whole each run.
 */
import type { Stats } from "./measure.ts"
import type { Scenario } from "./scenarios.ts"

export type Outcome = { readonly _tag: "Read"; readonly text: string } | {
  readonly _tag: "Failed"
  readonly error: string
}

export interface Measurements {
  readonly metadata?: Record<string, unknown>
  readonly unsupported?: ReadonlyArray<string>
  readonly date: string
  readonly machine: string
  readonly node: string
  readonly browser: string
  readonly striderCommit: string
  readonly playwright: string
  readonly runs: number
  readonly launch: { readonly strider: Stats; readonly playwright: Stats }
  readonly scenarios: ReadonlyArray<{
    readonly scenario: Scenario
    /** No Playwright outcome for a scenario without a Playwright twin */
    readonly outcome: { readonly strider: Outcome; readonly playwright: Outcome | undefined }
    readonly attempts: { readonly strider: number; readonly playwright: number }
    readonly failures: ReadonlyArray<
      { readonly library: "strider" | "playwright"; readonly repetition: number; readonly error: string }
    >
    readonly samples: ReadonlyArray<
      {
        readonly library: "strider" | "playwright"
        readonly repetition: number
        readonly ms: number
        readonly outcome: Outcome
      }
    >
    readonly times: { readonly strider: Stats; readonly playwright: Stats }
  }>
  readonly q82: ReadonlyArray<{ readonly label: string; readonly cpu: Stats }>
  readonly q82WaitMs: number
  readonly q103: ReadonlyArray<{ readonly label: string; readonly load: Stats }>
  readonly tells: { readonly strider: Record<string, unknown>; readonly playwright: Record<string, unknown> }
  readonly flags: { readonly strider: ReadonlyArray<string>; readonly playwright: ReadonlyArray<string> }
  /** `scenarios.ts`, whose regions are each implementation. */
  readonly source: string
}

export const gap = (strider: number, playwright: number) =>
  !Number.isFinite(strider) || !Number.isFinite(playwright) || playwright <= 0
    ? "–"
    : `${strider >= playwright ? "+" : ""}${((strider / playwright - 1) * 100).toFixed(1)}%`

const ms = (value: number) => (Number.isNaN(value) ? "–" : `${Math.round(value)} ms`)
const timing = (stats: Stats) => (stats.runs === 0 ? "–" : `p50 ${ms(stats.median)} (p90 ${ms(stats.p90)})`)
const cell = (value: unknown) => String(value ?? "–").replace(/\|/g, "\\|").replace(/\n/g, " ")

const regions = (source: string) => {
  const found = new Map<string, string>()
  for (const match of source.matchAll(/\/\/ #region (\S+)\n([\s\S]*?)\/\/ #endregion/g)) {
    found.set(match[1]!, match[2]!.trimEnd())
  }
  return found
}
const lines = (code: string | undefined) => (code ?? "").split("\n").filter((line) => line.trim() !== "").length

const outcomeText = (outcome: Outcome | undefined, expected: string) =>
  outcome === undefined
    ? "–"
    : outcome._tag === "Failed"
    ? `failed: ${cell(outcome.error)}`
    : outcome.text === expected
    ? `✓ \`${cell(outcome.text)}\``
    : `✗ \`${cell(outcome.text)}\`, expected \`${cell(expected)}\``

export const report = (m: Measurements): string => {
  const code = regions(m.source)
  const out: Array<string> = []
  out.push("# Strider and Playwright, side by side")
  out.push("")
  out.push(
    `*Written by \`pnpm scenarios\` on ${m.date}: ${m.browser}, the integration environment's, driven headless by Strider at \`${m.striderCommit}\` and by Playwright ${m.playwright} through \`playwright-core\`; Node ${m.node}; ${m.machine}. Timings are each scenario's wall time over ${m.runs} scheduled runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Don't edit: run \`pnpm scenarios\` again.*`
  )
  out.push("")
  if (m.metadata !== undefined) out.push("```json", JSON.stringify(m.metadata, null, 2), "```", "")
  for (const reason of m.unsupported ?? []) out.push(`- Unsupported comparison: ${reason}`)
  out.push("")
  out.push("## Scenarios")
  out.push("")
  out.push(
    "Each scenario is written with each library as its own documentation would write it, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed."
  )
  out.push("")
  out.push(
    "| Scenario | Strider | Playwright | Strider read | Playwright read | Lines, Strider / Playwright | p50 gap | p90 gap |"
  )
  out.push("|---|---|---|---|---|---|---|---|")
  for (const { scenario, outcome, times, attempts, failures } of m.scenarios) {
    const run = (library: "strider" | "playwright") =>
      `${timing(times[library])}; ${times[library].runs}/${attempts[library]} successful`
    const complete = failures.length === 0 && outcome.strider._tag === "Read" && outcome.playwright?._tag === "Read"
    const gaps = outcome.playwright === undefined ? "– | –" : complete
      ? `${gap(times.strider.median, times.playwright.median)} | ${gap(times.strider.p90, times.playwright.p90)}`
      : "incomplete | incomplete"
    const twin = code.get(`${scenario.name}/playwright`)
    out.push(
      `| ${scenario.title} | ${run("strider")} | ${outcome.playwright === undefined ? "–" : run("playwright")} | ${
        outcomeText(outcome.strider, scenario.expected)
      } | ${outcomeText(outcome.playwright, scenario.expected)} | ${lines(code.get(`${scenario.name}/strider`))} / ${
        twin === undefined ? "–" : lines(twin)
      } | ${gaps} |`
    )
  }
  out.push("")
  out.push(
    "Gaps are (Strider / Playwright − 1) × 100, positive means Strider is slower. p50 uses the existing upper-median estimator and p90 the sorted sample at floor(0.9 × n). Gaps are withheld if either library failed. Timing counts are successful/attempted repetitions; failed attempts are excluded from statistics. Initial outcomes above are retained separately."
  )
  out.push("")
  for (const { scenario, failures } of m.scenarios) {
    for (const failure of failures) {
      out.push(
        `- ${cell(scenario.title)}, ${failure.library}, timed repetition ${failure.repetition}: failed: ${
          cell(failure.error)
        }`
      )
    }
  }
  out.push("")
  if (!m.scenarios.some(({ scenario }) => scenario.name === "launch")) {
    out.push(`**Launch:** Strider ${timing(m.launch.strider)}, Playwright ${timing(m.launch.playwright)}.`, "")
  }
  if (m.q82.length > 0 || m.q103.length > 0) {
    out.push(
      "Chromium diagnostics below are grouped sequential controls, not paired Firefox comparisons or performance gates.",
      ""
    )
  }
  if (m.q82.length > 0) {
    out.push("## Chromium only: what a waiting expectation costs the page (Q82)")
    out.push("")
    out.push(
      `Strider evaluates a waiting expectation at every animation frame (QUIRKS.md, Q82). A page animating 200 of its 3000 elements each frame shows \`#ready\` after ${m.q82WaitMs} ms; the renderers' CPU time per second is read from \`/proc\` while each library waits for it, and while each leaves the page alone for as long.`
    )
    out.push("")
    out.push("| | Renderer CPU per second |")
    out.push("|---|---|")
    for (const row of m.q82) out.push(`| ${row.label} | ${timing(row.cpu)} |`)
    out.push("")
  }
  if (m.q103.length > 0) {
    out.push("## Chromium only: what an interceptor installed costs a load (Q103)")
    out.push("")
    out.push(
      "Strider keeps Chromium's `Fetch` interceptor enabled. The public page layer also handles authentication challenges, which pauses document requests at their request stage even without a user route; subresources are not all paused. The no-route row therefore includes that retained scheduling and interception cost. Q103's historical no-match-only description does not describe this full page workload. A page with 300 images, each a request, loaded to its `load` event:"
    )
    out.push("")
    out.push("| | Load |")
    out.push("|---|---|")
    for (const row of m.q103) out.push(`| ${row.label} | ${timing(row.load)} |`)
    out.push("")
  }
  const tellNames = [...new Set([...Object.keys(m.tells.strider), ...Object.keys(m.tells.playwright)])]
  if (tellNames.length > 0) {
    out.push("## What each leaves for a page to see")
    out.push("")
    out.push(
      "What a page's own script reads about the browser driving it (`/tells` in `src/site.ts`), headless, as each launches by default:"
    )
    out.push("")
    out.push("| | Strider | Playwright |")
    out.push("|---|---|---|")
    for (const name of tellNames) {
      out.push(`| ${cell(name)} | ${cell(m.tells.strider[name])} | ${cell(m.tells.playwright[name])} |`)
    }
    out.push("")
    out.push("The arguments each launched Chromium with:")
    out.push("")
    out.push("```")
    out.push(`Strider:    ${m.flags.strider.join(" ")}`)
    out.push(`Playwright: ${m.flags.playwright.join(" ")}`)
    out.push("```")
    out.push("")
  }
  out.push("## The code")
  out.push("")
  for (const { scenario } of m.scenarios) {
    out.push(`### ${scenario.title}`)
    out.push("")
    out.push(scenario.description, "")
    out.push("```ts")
    out.push(
      code.get(`${scenario.name}/strider`) ?? "// Launch implementation: bin.ts in the retained source artifacts."
    )
    out.push("```")
    out.push("")
    const twin = code.get(`${scenario.name}/playwright`)
    if (twin !== undefined) {
      out.push("```ts")
      out.push(twin)
      out.push("```")
      out.push("")
    }
    if (scenario.note !== undefined) {
      out.push(scenario.note)
      out.push("")
    }
  }
  return out.join("\n")
}
