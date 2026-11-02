import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import type { Reporter, TestCase, Vitest } from "vitest/node"
import { type Report, type Result, type Run, summarize } from "../../benchmark/report.ts"
import type {} from "./timing.ts"

export default class UpstreamReporter implements Reporter {
  private results: Array<Result> = []
  private sequential = false

  onInit(vitest: Vitest) {
    this.sequential = vitest.config.maxWorkers === 1
  }

  onTestCaseResult(test: TestCase) {
    if (test.parent.type !== "suite") return
    const match = /^(.*?) \/ (playwright|strider) \/ sample (\d+)$/.exec(test.parent.name)
    if (match === null) return
    const result = test.result()
    this.results.push({
      suite: match[1]!,
      name: test.name,
      library: match[2]!,
      sample: Number(match[3]),
      state: result.state,
      browserMs: test.meta().upstreamBrowserMs,
      totalMs: test.diagnostic()?.duration,
      errors: result.errors?.map((error) => error.message) ?? []
    })
  }

  onTestRunEnd(_modules: unknown, errors: ReadonlyArray<unknown>, reason: string) {
    if (this.results.length === 0) return
    const directory = path.resolve(import.meta.dirname, "../../../../.data/upstream")
    fs.mkdirSync(directory, { recursive: true })
    const require = createRequire(import.meta.url)
    const version = (name: string) => (require(`${name}/package.json`) as { version: string }).version
    const archive = process.env["STRIDER_UPSTREAM_RUN"]
    const report: Report = {
      schemaVersion: 1,
      run: archive === undefined
        ? undefined
        : JSON.parse(fs.readFileSync(path.join(archive, "run.json"), "utf8")) as Run,
      date: new Date().toISOString(),
      reason,
      unhandledErrors: errors.map(String),
      sequential: this.sequential,
      samples: Number(process.env["STRIDER_UPSTREAM_SAMPLES"] ?? "1"),
      viewport: { width: 1280, height: 720 },
      timing:
        "Browser workflow only: navigation, actions and assertions; excludes browser/page creation, fixture/server setup and teardown. Sample 0 is discarded warmup. Failed durations are not successful timings.",
      machine: {
        cpu: os.cpus()[0]?.model,
        cpus: os.cpus().length,
        load: os.loadavg(),
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        kernel: os.release()
      },
      versions: { playwright: version("playwright-core"), vite: version("vite"), astro: version("astro") },
      browsers: JSON.parse(
        fs.readFileSync(path.resolve(import.meta.dirname, "../../../browser/test/integration/browsers.json"), "utf8")
      ),
      results: this.results
    }
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(report, null, 2) + "\n")
    const keys = [...new Set(this.results.map((result) => `${result.suite}\n${result.name}`))].sort()
    const summary = (suite: string, name: string, library: string) => {
      const all = this.results.filter((result) =>
        result.suite === suite && result.name === name && result.library === library
      )
      return summarize(all, report.samples)
    }
    const lines = [
      "# Upstream browser timings",
      "",
      ...(report.run === undefined ? [] : [
        `Run: ${report.run.name}; revision: ${report.run.git.commit}${
          report.run.git.status ? " (dirty worktree)" : ""
        }.`,
        ""
      ]),
      `${report.date}; ${report.samples} measured sample(s) per library; ${
        this.sequential ? "sequential" : "parallel files — use pnpm benchmark:upstream for comparison"
      }.`,
      "",
      report.timing,
      "",
      "Milliseconds: median (min–max). Ratio is Strider / Playwright; below 1 means Strider took less time.",
      "",
      "| Suite / case | Playwright ms | Strider ms | Ratio |",
      "| --- | ---: | ---: | ---: |"
    ]
    for (const key of keys) {
      const [suite, name] = key.split("\n") as [string, string]
      const playwright = summary(suite, name, "playwright")
      const strider = summary(suite, name, "strider")
      const ratio = playwright.median !== undefined && strider.median !== undefined
        ? (strider.median / playwright.median).toFixed(2) + "×"
        : "—"
      lines.push(`| ${`${suite} / ${name}`.replaceAll("|", "\\|")} | ${playwright.text} | ${strider.text} | ${ratio} |`)
    }
    fs.writeFileSync(path.join(directory, "results.md"), lines.join("\n") + "\n")
    if (archive !== undefined) {
      fs.writeFileSync(path.join(archive, "results.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" })
      fs.writeFileSync(path.join(archive, "results.md"), lines.join("\n") + "\n", { flag: "wx" })
    }
    process.stdout.write(
      `\n${
        lines.join("\n")
      }\n\nRaw samples and errors: .data/upstream/results.json\nReport: .data/upstream/results.md\n`
    )
  }
}
