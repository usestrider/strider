/**
 * RESULTS.md: what `pnpm scenarios` found, with the machine, the browser and the libraries' versions it found it
 * on. Single runs print their report; the combined report is generated explicitly from saved measurements.
 */
import * as fs from "node:fs"
import * as path from "node:path"
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
    `*Written by \`pnpm scenarios\` on ${m.date}: ${m.browser}, the integration environment's, driven headless by Strider at \`${m.striderCommit}\` and by Playwright ${m.playwright} through \`playwright-core\`; Node ${m.node}; ${m.machine}. Timings are each scenario's wall time over ${m.runs} scheduled runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Regenerate from saved measurements with \`pnpm scenarios:report\`.*`
  )
  out.push("")
  if (m.metadata !== undefined) out.push("```json", JSON.stringify(m.metadata, null, 2), "```", "")
  for (const reason of m.unsupported ?? []) out.push(`- Unsupported comparison: ${reason}`)
  out.push("")
  out.push("## Scenarios")
  out.push("")
  out.push(
    "Each scenario is written once with each library, doing the same work, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed."
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

/** Observations retained with a reviewed run, separate from its timing samples. */
export interface ReportContext {
  readonly sourceCommit: string
  readonly observations: ReadonlyArray<string>
}

/** Generate a combined report using saved measurements, without launching a browser. */
export const combine = (measurements: ReadonlyArray<Measurements>, context?: ReportContext): string => {
  if (measurements.length < 2) throw new Error("A combined report needs at least two browser runs")
  const name = (m: Measurements) => String(m.metadata?.["engine"] ?? m.browser)
  if (new Set(measurements.map(name)).size !== measurements.length) throw new Error("Browser runs must be distinct")
  const source = (m: Measurements) => String(m.metadata?.["sourceCommit"] ?? m.striderCommit)
  if (context !== undefined && measurements.some((m) => source(m) !== context.sourceCommit)) {
    throw new Error("Report observations belong to a different source commit")
  }
  const out = [
    "# Fresh performance comparison: Chromium and Firefox",
    "",
    "Generated from preserved measurements with `pnpm scenarios:report`. No browsers are launched by report generation. Positive gaps mean Strider is slower.",
    "",
    "## Provenance and timing boundaries",
    ""
  ]
  for (const m of measurements) {
    out.push(
      `- ${cell(name(m))}: ${cell(m.browser)}; measured ${cell(m.date)} at source \`${cell(source(m))}\`; Playwright ${
        cell(m.playwright)
      }; Node ${cell(m.node)}; ${m.runs} scheduled repetitions after one initial verification/warmup.`,
      `  ${cell(m.metadata?.["fairness"] ?? "See the recorded browser metadata and launch settings below.")}`,
      `  Launch boundary: ${cell(m.metadata?.["launchBoundary"] ?? "See the run's scenario description.")}`
    )
  }
  out.push(
    "",
    "Launch includes shutdown in these preserved runs; its figures cannot be directly compared with the older narrower launch boundary. Default launch flags, waits, scheduling and interception remain in force. This report establishes no performance cause or production fix.",
    "",
    "## Outcomes and limitations",
    ""
  )
  for (const m of measurements) {
    const attempts = m.scenarios.reduce((n, r) => n + r.attempts.strider + r.attempts.playwright, 0)
    const failures = m.scenarios.reduce((n, r) => n + r.failures.length, 0)
    const initial = m.scenarios.flatMap((r) => [r.outcome.strider, r.outcome.playwright]).filter((o) => o !== undefined)
    out.push(
      `- ${cell(name(m))}: ${attempts - failures}/${attempts} timed attempts passed; ${
        initial.filter((o) => o._tag === "Read").length
      }/${initial.length} initial checks passed.`
    )
    for (const r of m.scenarios) {
      for (const library of ["strider", "playwright"] as const) {
        const outcome = r.outcome[library]
        if (outcome?._tag === "Failed") {
          out.push(`  Initial failure, ${cell(r.scenario.title)}, ${library}: ${cell(outcome.error)}`)
        }
      }
      if (r.failures.length > 0) {
        out.push(
          `  ${
            cell(r.scenario.title)
          }: ${r.failures.length} timed failures; no valid timing gap. Individual errors and failed durations remain in the preserved data and detailed report.`
        )
      }
    }
  }
  out.push(
    "",
    "A required-page recording preflight checks GET page coverage, not complete interaction replay. A failed comparison does not establish that a browser feature is generally unsupported. Failures in one scenario do not invalidate other complete pairs.",
    "",
    "Times are milliseconds; each cell is **p50 / p90**. Gaps use `(Strider / Playwright - 1) × 100`. For each library and workflow, n is the number of successful timed samples, which can be smaller than the scheduled repetition count after failures. The estimator selects zero-based sorted index `min(n - 1, floor(q × n))`. The table below gives one-based positions for the successful sample counts present in these workflow rows; n = 0 has no statistic. When p90 selects the maximum, a p90-only gap depends on one tail sample and requires confirmation before calling it a sustained regression. Larger sample counts can select a value below the maximum. Desktop background activity and browser build differences limit attribution. Failed durations are excluded from statistics; gaps are withheld if either library failed any initial or timed attempt.",
    ""
  )
  const counts = [
    ...new Set(
      measurements.flatMap((m) =>
        m.scenarios.flatMap((r) =>
          r.outcome.playwright === undefined ? [r.times.strider.runs] : [r.times.strider.runs, r.times.playwright.runs]
        )
      )
    )
  ].sort((a, b) => a - b)
  out.push("| Successful samples (n) | p50 position | p90 position |", "|---:|---:|---:|")
  for (const n of counts) {
    const position = (q: number) => n === 0 ? "–" : String(Math.min(n - 1, Math.floor(q * n)) + 1)
    const maximum = n > 0 && Math.floor(0.9 * n) >= n - 1 ? " (maximum)" : ""
    out.push(`| ${n} | ${position(0.5)} | ${position(0.9)}${maximum} |`)
  }
  out.push("")
  if (context !== undefined) {
    out.push(
      "## Retained correctness observations",
      "",
      ...context.observations.map((observation) => `- ${observation}`),
      ""
    )
  }
  out.push(
    "## Paired workflow results",
    "",
    "| Browser | Scenario | Strider p50 / p90 | Playwright p50 / p90 | p50 gap | p90 gap |",
    "|---|---|---:|---:|---:|---:|"
  )
  const precise = (s: Stats) => s.runs === 0 ? "–" : `${s.median.toFixed(3)} / ${s.p90.toFixed(3)}`
  for (const m of measurements) {
    for (const r of m.scenarios) {
      if (r.outcome.playwright === undefined) continue
      const complete = r.failures.length === 0 && r.outcome.strider._tag === "Read" &&
        r.outcome.playwright._tag === "Read"
      out.push(
        `| ${cell(name(m))} | ${cell(r.scenario.title)} | ${precise(r.times.strider)} | ${
          precise(r.times.playwright)
        } | ${complete ? gap(r.times.strider.median, r.times.playwright.median) : "incomplete"} | ${
          complete ? gap(r.times.strider.p90, r.times.playwright.p90) : "incomplete"
        } |`
      )
    }
  }
  out.push(
    "",
    "Video demonstrations without Playwright twins have no comparison gap. Unsupported comparisons and Chromium-only diagnostics are labeled in each run's detailed report.",
    "",
    "## Reproduction and evidence",
    "",
    "See [the scenario instructions](README.md) for the executable regeneration command, workload sizes and pinned browser provisioning. Inputs are the preserved measurements.json files; an optional source-bound context file retains reviewed correctness observations. Raw ordered attempts, recording validation, source snapshots/hashes, exact browser versions, executable hashes and launch settings remain in the external evidence directories. Detailed reports below are generated from those same measurements, including their original metadata and source.",
    ""
  )
  for (const m of measurements) {
    out.push(
      report(m).replace(/^(#{1,5}) /gm, "#$1 ").replace(
        "## Strider and Playwright, side by side",
        `## ${name(m)} detailed report`
      ),
      ""
    )
  }
  return `${out.join("\n").trimEnd()}\n`
}

/** Print a single run, saving artifacts only in an explicitly selected directory. */
export const writeRunReport = (
  measurements: Measurements,
  directory?: string,
  print: (text: string) => void = (text) => {
    process.stdout.write(text)
  }
): void => {
  const written = report(measurements)
  if (directory !== undefined) {
    fs.writeFileSync(path.join(directory, "measurements.json"), JSON.stringify(measurements, null, 2))
    fs.writeFileSync(path.join(directory, "RESULTS.md"), written)
  }
  print(written)
}
