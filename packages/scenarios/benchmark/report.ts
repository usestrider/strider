export interface Result {
  readonly suite: string
  readonly name: string
  readonly library: string
  readonly sample: number
  readonly state: string
  readonly browserMs?: number | undefined
  readonly totalMs?: number | undefined
  readonly errors: ReadonlyArray<string>
}

export interface Run {
  readonly name: string
  readonly startedAt: string
  readonly git: {
    readonly commit: string
    readonly branch: string
    readonly status: string
    readonly diffSha256: string
  }
  readonly benchmarkSha256: string
  readonly lockfileSha256: string
  readonly nixSha256: string
  readonly filters: ReadonlyArray<string>
}

export interface Report {
  readonly schemaVersion: 1
  readonly run?: Run | undefined
  readonly date: string
  readonly reason: string
  readonly unhandledErrors: ReadonlyArray<string>
  readonly sequential: boolean
  readonly samples: number
  readonly viewport: { readonly width: number; readonly height: number }
  readonly timing: string
  readonly machine: {
    readonly cpu?: string | undefined
    readonly cpus: number
    readonly load: ReadonlyArray<number>
    readonly node: string
    readonly platform: string
    readonly arch: string
    readonly kernel: string
  }
  readonly versions: { readonly playwright: string; readonly vite: string; readonly astro: string }
  readonly browsers: { readonly chromium: { readonly version: string } }
  readonly results: ReadonlyArray<Result>
}

export const summarize = (results: ReadonlyArray<Result>, samples: number) => {
  if (results.some((result) => result.state === "failed")) return { text: "FAIL", median: undefined }
  const expected = samples > 1 ? samples + 1 : 1
  const measured = results.filter((result) => result.sample > 0)
  if (
    results.length !== expected || new Set(results.map((result) => result.sample)).size !== expected ||
    results.some((result) =>
      result.state !== "passed" || !Number.isInteger(result.sample) || result.sample < (samples > 1 ? 0 : 1) ||
      result.sample > samples || typeof result.browserMs !== "number" || !Number.isFinite(result.browserMs) ||
      result.browserMs < 0
    )
  ) return { text: results.length === 0 ? "missing" : "incomplete", median: undefined }
  const times = measured.map((result) => result.browserMs!).sort((a, b) => a - b)
  const median = (times[Math.floor((times.length - 1) / 2)]! + times[Math.floor(times.length / 2)]!) / 2
  return { text: `${median.toFixed(1)} (${times[0]!.toFixed(1)}–${times.at(-1)!.toFixed(1)})`, median }
}

const escape = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ")
const delta = (before: number, after: number) => before === 0 ? "—" : `${((after / before - 1) * 100).toFixed(1)}%`

/** Compare only complete, successful measurements; retain failures and missing cases in the table. */
export const compare = (before: Report, after: Report) => {
  for (const report of [before, after]) {
    if (report.schemaVersion !== 1) {
      throw new Error("Unsupported report schema; rerun with the current benchmark runner.")
    }
    if (!report.sequential || report.samples < 2) {
      throw new Error("Comparison requires sequential runs with at least two samples.")
    }
    if (report.unhandledErrors.length > 0 || !["passed", "failed"].includes(report.reason)) {
      throw new Error("Cannot compare an interrupted run or a run with unhandled errors.")
    }
  }
  const differences: Array<string> = []
  const check = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(label)
  }
  check("benchmark sources", before.run?.benchmarkSha256, after.run?.benchmarkSha256)
  check("dependency lockfile", before.run?.lockfileSha256, after.run?.lockfileSha256)
  check("Nix environment", before.run?.nixSha256, after.run?.nixSha256)
  check("browser version", before.browsers.chromium.version, after.browsers.chromium.version)
  check("runtime versions", before.versions, after.versions)
  check("viewport", before.viewport, after.viewport)
  check("timing method", before.timing, after.timing)
  for (const field of ["cpu", "cpus", "node", "platform", "arch", "kernel"] as const) {
    check(field, before.machine[field], after.machine[field])
  }
  const label = (report: Report) =>
    report.run === undefined ?
      report.date :
      `${report.run.name} (${report.run.git.commit.slice(0, 12)}${report.run.git.status ? ", dirty" : ""})`
  const lines = [
    "# Upstream benchmark comparison",
    "",
    `Before: ${escape(label(before))}. After: ${escape(label(after))}.`,
    "",
    "Milliseconds are medians. Change is (after / before − 1); negative means less time. Failed or incomplete cases have no delta.",
    ""
  ]
  if (differences.length > 0) {
    lines.push(`WARNING: ${differences.join(", ")} changed. These are not controlled comparisons.`, "")
  }
  if (before.run === undefined || after.run === undefined) {
    lines.push("WARNING: revision and harness metadata is missing.", "")
  }
  const keys = [...new Set([...before.results, ...after.results].map((r) => JSON.stringify([r.suite, r.name])))].sort()
  const totals = { playwright: [0, 0], strider: [0, 0] }
  let shared = 0
  const rows: Array<string> = []
  for (const key of keys) {
    const [suite, name] = JSON.parse(key) as [string, string]
    const values = (["playwright", "strider"] as const).map((library) => {
      const pair = [before, after].map((report) =>
        summarize(
          report.results.filter((r) => r.suite === suite && r.name === name && r.library === library),
          report.samples
        )
      )
      const a = pair[0]!, b = pair[1]!
      return {
        library,
        a,
        b,
        change: a.median !== undefined && b.median !== undefined ? delta(a.median, b.median) : "—"
      }
    })
    if (values.every(({ a, b }) => a.median !== undefined && b.median !== undefined)) {
      shared++
      for (const { library, a, b } of values) {
        totals[library][0]! += a.median!
        totals[library][1]! += b.median!
      }
    }
    rows.push(
      `| ${escape(`${suite} / ${name}`)} | ${
        values.map(({ a, b, change }) => `${a.text} | ${b.text} | ${change}`).join(" | ")
      } |`
    )
  }
  lines.push(`Aggregate: ${shared} cases passed by both libraries in both runs; average of per-case medians.`, "")
  if (shared > 0) {
    for (const library of ["playwright", "strider"] as const) {
      const [a, b] = totals[library] as [number, number]
      lines.push(`- ${library}: ${(a / shared).toFixed(1)} → ${(b / shared).toFixed(1)} ms (${delta(a, b)}).`)
    }
  }
  lines.push(
    "",
    "| Suite / case | PW before | PW after | Change | Strider before | Strider after | Change |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
    ""
  )
  return lines.join("\n")
}
