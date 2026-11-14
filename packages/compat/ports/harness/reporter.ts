/**
 * Writes a run to `.data/compat/runs/<run>/` (or `STRIDER_COMPAT_OUTPUT`): `run.json`, every port's outcome on every
 * browser with each file's time, and `report.md`, the run against the ledger. A run named again adds to it: its
 * results replace only the same tests' on the same browsers. The reporter prints the counts and every unexpected
 * outcome, which are the findings: a failure the ledger doesn't expect is a bug to trace, and a pass it doesn't
 * expect is a fix to record.
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import type { Reporter, TestCase, TestModule } from "vitest/node"
import {
  type BrowserName,
  browserNames,
  compare,
  outputDirectory,
  report,
  type Result,
  type Run
} from "../../src/ledger.ts"
import { root } from "../../src/upstream.ts"

export default class CompatReporter implements Reporter {
  private results: Array<Result> = []
  private files: Array<Run["files"][number]> = []

  onTestCaseResult(test: TestCase) {
    const meta = test.meta().compat
    if (meta === undefined) return
    const result = test.result()
    this.results.push({
      ...meta,
      portFile: path.relative(root, test.module.moduleId),
      state: result.state,
      ...(test.diagnostic()?.duration === undefined ? {} : { durationMs: test.diagnostic()!.duration }),
      errors: result.errors?.map((error) => error.message) ?? []
    })
  }

  onTestModuleEnd(module: TestModule) {
    const portFile = path.relative(root, module.moduleId)
    const total = (module.diagnostic().duration ?? 0) / 1000
    const cases = this.results.filter((result) => result.portFile === portFile)
    const ran = browserNames.filter((browser) => cases.some((result) => result.browser === browser))
    const caseSeconds = (browser: BrowserName) =>
      cases.filter((result) => result.browser === browser).reduce((sum, result) => sum + (result.durationMs ?? 0), 0) /
      1000
    // What the cases don't account for (launch, layers, and collection) is shared evenly between the browsers
    const overhead = Math.max(0, total - ran.reduce((sum, browser) => sum + caseSeconds(browser), 0)) /
      Math.max(1, ran.length)
    for (const browser of ran) this.files.push({ portFile, browser, seconds: caseSeconds(browser) + overhead })
  }

  onTestRunEnd() {
    const name = process.env["STRIDER_COMPAT_RUN"] ?? "latest"
    let revision: string | undefined
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
    } catch {
      revision = undefined
    }
    // The browsers that ran: a run of Chromium-only ports says nothing of the others
    const ran = browserNames.filter((browser) => this.results.some((result) => result.browser === browser))
    const directory = path.join(outputDirectory(), "runs", name)
    fs.mkdirSync(directory, { recursive: true })
    const earlier: Run | undefined = fs.existsSync(path.join(directory, "run.json"))
      ? JSON.parse(fs.readFileSync(path.join(directory, "run.json"), "utf8"))
      : undefined
    // A run named again replaces only what it ran: a rerun of one test keeps every other result of that browser
    const id = (result: Result) => `${result.browser}\0${result.source}\0${result.key}\0${result.variant ?? ""}`
    const rerun = new Set(this.results.map(id))
    const keptResults = (earlier?.results ?? []).filter((result) => !rerun.has(id(result)))
    const timed = new Set(this.files.map((file) => `${file.browser}\0${file.portFile}`))
    const keptFiles = (earlier?.files ?? []).filter((file) => !timed.has(`${file.browser}\0${file.portFile}`))
    const run: Run = {
      name,
      date: new Date().toISOString(),
      ...(revision === undefined ? {} : { revision }),
      browsers: browserNames.filter((browser) => ran.includes(browser) || (earlier?.browsers ?? []).includes(browser)),
      results: [...keptResults, ...this.results],
      files: [...keptFiles, ...this.files]
    }
    fs.writeFileSync(path.join(directory, "run.json"), JSON.stringify(run, null, 2) + "\n")
    const findings = compare(run)
    const markdown = report(run, findings)
    fs.writeFileSync(path.join(directory, "report.md"), markdown)
    const unexpected =
      findings.filter((finding) => finding.outcome === "failedUnexpectedly" || finding.outcome === "passedUnexpectedly")
        .length
    process.stdout.write(
      `\nCompat run ${name}: ${this.results.length} results, ${unexpected} unexpected. ${
        path.join(directory, "report.md")
      }\n`
    )
  }
}
