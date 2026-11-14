/**
 * The ledger: every upstream test (`ledger/<source>.json`, generated), what Strider expects of the ones that don't
 * simply pass (`ledger/expectations/`, written by hand), and which are ported (the port files, read as text).
 * A test with no expectation is expected to pass on every browser its port runs on, as in Puppeteer's ledger.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { readIndex, readSources, root, type UpstreamTest } from "./upstream.ts"

export const browserNames = ["chromium", "firefox", "webkit"] as const
export type BrowserName = typeof browserNames[number]

/** What a run writes, and where traces go: `STRIDER_COMPAT_OUTPUT`, or `.data/compat` in the checkout. */
export const outputDirectory = () => process.env["STRIDER_COMPAT_OUTPUT"] ?? path.resolve(root, "../../.data/compat")

const layouts = {
  playwright: { ports: "ports/playwright/", upstream: "tests/", from: ".test.ts", to: ".spec.ts" },
  puppeteer: { ports: "ports/puppeteer/", upstream: "test/src/", from: ".test.ts", to: ".test.ts" }
} as const

/** The upstream file a port file ports, from its path. */
export const upstreamFileOf = (portFile: string): { source: keyof typeof layouts; file: string } => {
  const relative = path.relative(root, portFile).split(path.sep).join("/")
  for (const [source, layout] of Object.entries(layouts) as Array<[keyof typeof layouts, typeof layouts.playwright]>) {
    if (relative.startsWith(layout.ports) && relative.endsWith(layout.from)) {
      const middle = relative.slice(layout.ports.length, -layout.from.length)
      return { source, file: layout.upstream + middle + layout.to }
    }
  }
  throw new Error(`${relative} isn't a port file: put it under ports/playwright/ or ports/puppeteer/`)
}

export const statuses = ["fails", "needsFeature", "differentByDesign", "notApplicable"] as const
export type Status = typeof statuses[number]

/**
 * One expectation. `tests` are keys, with `*` matching anything (`"OO-0*"`, `"[oopif.test] OOPIF *"`); `files` are
 * globs over upstream paths. An entry needs one or the other.
 *
 * Each port file's tests have theirs in `ledger/expectations/<source>/<the port's path>.json`, an array of entries
 * without `source` or `files`: `ledger/expectations/playwright/page/page-dialog.json` is
 * `ports/playwright/page/page-dialog.test.ts`'s, and covers only `tests/page/page-dialog.spec.ts`. Entries over whole
 * files, such as Playwright's inspector, are in `ledger/expectations/general.json`, with `source` and `files`. A
 * file's own entries come before the general ones.
 */
export interface Expectation {
  readonly source: string
  /** Where the entry is written, relative to the package. */
  readonly origin: string
  /** The upstream file an entry in a port's own file is confined to. */
  readonly file?: string
  readonly tests?: ReadonlyArray<string>
  readonly files?: ReadonlyArray<string>
  /** @default every browser */
  readonly browsers?: ReadonlyArray<BrowserName>
  /**
   * `fails`: ported, and fails for a bug in Strider (`issue` names it). `needsFeature`: can't be ported until Strider
   * has an API (`issue`, or `matrix`, the Playwright matrix row). `differentByDesign`: Strider decided otherwise
   * (`decision`, a heading of docs/decisions.md). `notApplicable`: tests something Strider doesn't have or
   * shouldn't, such as Playwright's inspector (`reason`).
   */
  readonly status: Status
  readonly issue?: string
  readonly matrix?: string
  readonly decision?: string
  readonly reason: string
}

const expectationsDirectory = path.join(root, "ledger/expectations")

/** The upstream file a port's expectations file covers, from its path. */
export const expectationsFileOf = (relative: string) =>
  upstreamFileOf(
    path.join(root, "ports", relative.replace(/^ledger\/expectations\//, "").replace(/\.json$/, ".test.ts"))
  )

export const readExpectations = (): ReadonlyArray<Expectation> => {
  const files = fs.globSync("**/*.json", { cwd: expectationsDirectory }).sort()
  const own = files.filter((file) => file !== "general.json").flatMap((file) => {
    const origin = `ledger/expectations/${file}`
    const { source, file: upstream } = expectationsFileOf(origin)
    const entries = JSON.parse(fs.readFileSync(path.join(expectationsDirectory, file), "utf8")) as Array<
      Omit<Expectation, "source" | "origin" | "file">
    >
    return entries.map((entry) => ({ ...entry, source, origin, file: upstream }))
  })
  const general = (JSON.parse(fs.readFileSync(path.join(expectationsDirectory, "general.json"), "utf8")) as Array<
    Omit<Expectation, "origin">
  >).map((entry) => ({ ...entry, origin: "ledger/expectations/general.json" }))
  return [...own, ...general]
}

const wildcard = (pattern: string) =>
  new RegExp("^" + pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$")

export const covers = (expectation: Expectation, test: UpstreamTest, browser?: BrowserName) =>
  (expectation.file === undefined || expectation.file === test.file) &&
  (browser === undefined || expectation.browsers === undefined || expectation.browsers.includes(browser)) &&
  ((expectation.tests ?? []).some((pattern) => wildcard(pattern).test(test.key)) ||
    (expectation.files ?? []).some((glob) => path.matchesGlob(test.file, glob)))

/** The first expectation that covers a test on a browser, as Puppeteer's runner reads its ledger. */
export const expectationFor = (
  expectations: ReadonlyArray<Expectation>,
  source: string,
  test: UpstreamTest,
  browser: BrowserName
) => expectations.find((expectation) => expectation.source === source && covers(expectation, test, browser))

export interface PortFile {
  readonly path: string
  readonly source: string
  readonly file: string
  readonly keys: ReadonlyArray<string>
  /** The browsers its `upstream(…, { browsers })` names, or every browser. */
  readonly browsers: ReadonlyArray<BrowserName>
}

/** `test("KEY"` at the start of a call, not a method's `.test(`. */
const portedKey = /(?<![\w.])test\(\s*"((?:[^"\\]|\\.)*)"/g

/** Every port file, and the keys it ports, read as text. */
export const scanPorts = (): ReadonlyArray<PortFile> =>
  fs.globSync("ports/{playwright,puppeteer}/**/*.test.ts", { cwd: root }).sort().map((relative) => {
    const absolute = path.join(root, relative)
    const { source, file } = upstreamFileOf(absolute)
    const text = fs.readFileSync(absolute, "utf8")
    const prefix = source === "puppeteer" ? `[${path.basename(file).replace(/\.ts$/, "")}] ` : ""
    const keys = [...new Set([...text.matchAll(portedKey)].map((match) => prefix + JSON.parse(`"${match[1]}"`)))]
    // The file's own browsers are in `upstream(…)`'s options, before its tests: a test's `browsers` narrows only itself
    const start = text.indexOf("upstream(import.meta.filename")
    const options = start === -1 ? "" : text.slice(start, text.indexOf("(test)", start))
    const named = /\bbrowsers:\s*\[([^\]]*)\]/.exec(options)?.[1]
    const browsers = named === undefined
      ? browserNames
      : browserNames.filter((browser) => named.includes(`"${browser}"`))
    return { path: relative, source, file, keys, browsers }
  })

const indexedSources = () => readSources().filter((source) => source.status === "indexed").map((each) => each.name)

/**
 * The decisions of docs/decisions.md, which a deliberate difference cites: its headings, and the bold sentences that
 * open a decision's paragraph (`**Outcomes come from evidence, never from a guess or a timer.**`), without the period.
 */
const decisionHeadings = () => {
  const lines = fs.readFileSync(path.resolve(root, "../../docs/decisions.md"), "utf8").split("\n")
  const headings = lines.filter((line) => /^#{2,4} /.test(line)).map((line) => line.replace(/^#{2,4} /, "").trim())
  const leads = lines.flatMap((line) => {
    const lead = /^\*\*([^*]+?)\.?\*\*/.exec(line)
    return lead === null ? [] : [lead[1]!.trim()]
  })
  return new Set([...headings, ...leads])
}

/** Everything wrong with the ledger: an empty list when it holds together. */
export const check = (): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const indexes = new Map(indexedSources().map((name) => [name, readIndex(name)]))
  const expectations = readExpectations()
  for (const expectation of expectations) {
    const label = `${expectation.origin} (${[...(expectation.tests ?? []), ...(expectation.files ?? [])].join(", ")})`
    const index = indexes.get(expectation.source)
    if (index === undefined) {
      problems.push(`${label}: no indexed source ${expectation.source}`)
      continue
    }
    if ((expectation.tests ?? []).length === 0 && (expectation.files ?? []).length === 0) {
      problems.push(`${label}: names no tests and no files`)
    }
    if (expectation.file !== undefined && (expectation.files ?? []).length > 0) {
      problems.push(`${label}: a port's own entries name tests, not files`)
    }
    for (const pattern of expectation.tests ?? []) {
      const inScope = index.tests.filter((test) => expectation.file === undefined || test.file === expectation.file)
      if (!inScope.some((test) => wildcard(pattern).test(test.key))) {
        problems.push(
          `${label}: ${pattern} matches no test${expectation.file === undefined ? "" : ` of ${expectation.file}`}`
        )
      }
    }
    for (const glob of expectation.files ?? []) {
      if (!index.tests.some((test) => path.matchesGlob(test.file, glob))) {
        problems.push(`${label}: ${glob} matches no file`)
      }
    }
    if (!statuses.includes(expectation.status)) problems.push(`${label}: unknown status ${expectation.status}`)
    if (expectation.reason === undefined || expectation.reason.trim() === "") problems.push(`${label}: no reason`)
    if (expectation.status === "fails" && expectation.issue === undefined) {
      problems.push(`${label}: a failure names its issue`)
    }
    if (expectation.status === "needsFeature" && expectation.issue === undefined && expectation.matrix === undefined) {
      problems.push(`${label}: a missing feature names its issue or matrix row`)
    }
    if (
      expectation.matrix !== undefined &&
      !fs.existsSync(path.resolve(root, "../../scripts/playwright-matrix/rows", `${expectation.matrix}.json`))
    ) {
      problems.push(`${label}: no matrix row ${expectation.matrix}`)
    }
    if (expectation.status === "differentByDesign" && expectation.decision === undefined) {
      problems.push(`${label}: a deliberate difference names its decision`)
    }
    if (expectation.decision !== undefined && !decisionHeadings().has(expectation.decision.trim())) {
      problems.push(
        `${label}: "${expectation.decision}" isn't a decision in docs/decisions.md (a heading or a bold opening sentence)`
      )
    }
    for (const browser of expectation.browsers ?? []) {
      if (!browserNames.includes(browser)) problems.push(`${label}: unknown browser ${browser}`)
    }
  }
  for (const port of scanPorts()) {
    const index = indexes.get(port.source)!
    const inFile = new Map(index.tests.filter((test) => test.file === port.file).map((test) => [test.key, test]))
    if (inFile.size === 0) problems.push(`${port.path}: ${port.file} isn't in ${port.source}'s index`)
    for (const key of port.keys) {
      const test = inFile.get(key)
      if (test === undefined) {
        problems.push(`${port.path}: ${key} isn't a test of ${port.file}`)
        continue
      }
      const unported = expectations.find((expectation) =>
        expectation.source === port.source && expectation.status !== "fails" &&
        expectation.browsers === undefined && covers(expectation, test)
      )
      if (unported !== undefined) problems.push(`${port.path}: ${key} is ported but marked ${unported.status}`)
    }
  }
  return problems
}

/** A test's outcome on one browser in a run, as the reporter writes it. */
export interface Result {
  readonly source: string
  readonly key: string
  readonly variant?: string
  readonly browser: BrowserName
  readonly file: string
  readonly portFile: string
  readonly state: "passed" | "failed" | "skipped" | "pending"
  readonly durationMs?: number
  readonly errors: ReadonlyArray<string>
}

export interface Run {
  readonly name: string
  readonly date: string
  readonly revision?: string
  readonly browsers: ReadonlyArray<BrowserName>
  readonly results: ReadonlyArray<Result>
  /** Each port file's time on each browser, launch included, for planning shards. */
  readonly files: ReadonlyArray<{ readonly portFile: string; readonly browser: BrowserName; readonly seconds: number }>
}

export type Outcome =
  | "passed"
  | "failedUnexpectedly"
  | "failedAsExpected"
  | "passedUnexpectedly"
  | "skipped"
  | "notRun"
  | "notPorted"
  | Exclude<Status, "fails">

export const outcomes: ReadonlyArray<Outcome> = [
  "passed",
  "failedUnexpectedly",
  "failedAsExpected",
  "passedUnexpectedly",
  "skipped",
  "notRun",
  "notPorted",
  "needsFeature",
  "differentByDesign",
  "notApplicable"
]

export interface Finding {
  readonly source: string
  readonly key: string
  readonly browser: BrowserName
  readonly outcome: Outcome
  readonly variants: ReadonlyArray<Result>
  readonly expectation?: Expectation
}

/** Every upstream test on every browser of the run, compared with the ledger. */
export const compare = (run: Run): ReadonlyArray<Finding> => {
  const expectations = readExpectations()
  // Each ported test's browsers: a port that leaves a browser out says nothing about that browser
  const ported = new Map(
    scanPorts().flatMap((port) => port.keys.map((key) => [`${port.source}\0${key}`, port.browsers] as const))
  )
  const results = new Map<string, Array<Result>>()
  for (const result of run.results) {
    const id = `${result.source}\0${result.key}\0${result.browser}`
    results.set(id, [...(results.get(id) ?? []), result])
  }
  const findings: Array<Finding> = []
  for (const name of indexedSources()) {
    for (const test of readIndex(name).tests) {
      for (const browser of run.browsers) {
        const portedOn = ported.get(`${name}\0${test.key}`)
        if (portedOn !== undefined && !portedOn.includes(browser)) continue
        const expectation = expectationFor(expectations, name, test, browser)
        const variants = results.get(`${name}\0${test.key}\0${browser}`) ?? []
        const ran = variants.filter((result) => result.state === "passed" || result.state === "failed")
        let outcome: Outcome
        if (ran.length > 0) {
          const failed = ran.some((result) => result.state === "failed")
          // Any expectation that isn't a pass explains a failure, a port kept running on a browser it marks as
          // different by design included; a pass against one is news either way
          outcome = expectation !== undefined
            ? failed ? "failedAsExpected" : "passedUnexpectedly"
            : failed
            ? "failedUnexpectedly"
            : "passed"
        } else if (variants.length > 0) {
          outcome = "skipped"
        } else if (expectation !== undefined && expectation.status !== "fails") {
          outcome = expectation.status
        } else {
          outcome = ported.has(`${name}\0${test.key}`) ? "notRun" : "notPorted"
        }
        findings.push({
          source: name,
          key: test.key,
          browser,
          outcome,
          variants,
          ...(expectation === undefined ? {} : { expectation })
        })
      }
    }
  }
  return findings
}

const plain: Record<Outcome, string> = {
  passed: "passed",
  failedUnexpectedly: "failed unexpectedly",
  failedAsExpected: "failed as expected",
  passedUnexpectedly: "passed unexpectedly",
  skipped: "skipped",
  notRun: "ported, not run",
  notPorted: "not ported",
  needsFeature: "needs a feature",
  differentByDesign: "different by design",
  notApplicable: "not applicable"
}

/** The run's report in Markdown: counts per source and browser, then every unexpected outcome. */
export const report = (run: Run, findings: ReadonlyArray<Finding>): string => {
  const lines = [
    `# Compat run ${run.name}`,
    "",
    `${run.date}${run.revision === undefined ? "" : `, ${run.revision}`}`,
    ""
  ]
  lines.push(`| Source | Browser | ${outcomes.map((outcome) => plain[outcome]).join(" | ")} |`)
  lines.push(`| --- | --- | ${outcomes.map(() => "---:").join(" | ")} |`)
  for (const name of indexedSources()) {
    for (const browser of run.browsers) {
      const counts = outcomes.map((outcome) =>
        findings.filter((finding) =>
          finding.source === name && finding.browser === browser && finding.outcome === outcome
        ).length
      )
      lines.push(`| ${name} | ${browser} | ${counts.join(" | ")} |`)
    }
  }
  for (const outcome of ["failedUnexpectedly", "passedUnexpectedly"] as const) {
    const listed = findings.filter((finding) => finding.outcome === outcome)
    if (listed.length === 0) continue
    lines.push("", `## ${plain[outcome][0]!.toUpperCase()}${plain[outcome].slice(1)} (${listed.length})`, "")
    for (const finding of listed) {
      const failed = finding.variants.find((result) => result.state === "failed")
      const error = failed?.errors[0]?.split("\n")[0]
      lines.push(
        `- ${finding.browser} ${finding.source} \`${finding.key}\`` +
          (finding.expectation?.issue === undefined ? "" : ` (${finding.expectation.issue})`) +
          (error === undefined ? "" : `: ${error}`)
      )
    }
  }
  return lines.join("\n") + "\n"
}
