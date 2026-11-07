/** Linux integration timings. Events survive a stopped run; snapshots are replaced atomically at file/run end. */
import * as fs from "node:fs"
import * as path from "node:path"
import type { Reporter, TestCase, TestModule, TestSpecification } from "vitest/node"

type Outcome = ReturnType<TestCase["result"]>["state"]
interface CaseTiming {
  readonly id: string
  readonly name: string
  readonly outcome: Outcome
  readonly durationMs: number | null
  readonly retryCount: number | null
  readonly repeatCount: number | null
}
interface FileTiming {
  readonly id: string
  readonly file: string
  readonly project: string
  readonly outcome: string
  readonly executionMs: number | null
  readonly collected: boolean
  readonly tests: ReadonlyArray<CaseTiming>
}
const caseTiming = (test: TestCase): CaseTiming => {
  const diagnostic = test.diagnostic()
  return {
    id: test.id,
    name: test.fullName,
    outcome: test.result().state,
    durationMs: diagnostic?.duration ?? null,
    retryCount: diagnostic?.retryCount ?? null,
    repeatCount: diagnostic?.repeatCount ?? null
  }
}

export default class TimingReporter implements Reporter {
  private readonly files = new Map<string, FileTiming>()
  private readonly completed = new Set<string>()
  private started = 0
  private startedAt = ""
  private readonly directory: string

  constructor(options: { readonly directory?: string } = {}) {
    this.directory = options.directory ?? ".data/integration-timings"
  }

  private event(value: object) {
    fs.appendFileSync(path.join(this.directory, "events.ndjson"), `${JSON.stringify(value)}\n`)
  }

  private snapshot(reason: "running" | "passed" | "failed" | "interrupted", unhandledErrors = 0) {
    const files = Array.from(this.files.values())
    const counts = { passed: 0, failed: 0, skipped: 0, pending: 0 }
    for (const file of files) for (const test of file.tests) counts[test.outcome]++
    const report = {
      schemaVersion: 1,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      reason,
      // This is Vitest reporter run time, excluding pnpm/Nix/install and browser-lock queue time.
      wallMs: performance.now() - this.started,
      summedFileExecutionMs: files.reduce((sum, file) => sum + (file.executionMs ?? 0), 0),
      plannedFiles: files.length,
      collectedFiles: files.filter((file) => file.collected).length,
      completedFiles: files.filter((file) => file.executionMs !== null).length,
      knownCases: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
      unhandledErrors,
      files
    }
    const temporary = path.join(this.directory, "timings.json.tmp")
    fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`)
    fs.renameSync(temporary, path.join(this.directory, "timings.json"))
    return report
  }

  onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
    this.started = performance.now()
    this.startedAt = new Date().toISOString()
    this.files.clear()
    this.completed.clear()
    fs.mkdirSync(this.directory, { recursive: true })
    fs.writeFileSync(path.join(this.directory, "events.ndjson"), "")
    for (const specification of specifications) {
      this.files.set(specification.taskId, {
        id: specification.taskId,
        file: path.relative(process.cwd(), specification.moduleId),
        project: specification.project.name,
        outcome: "not-collected",
        executionMs: null,
        collected: false,
        tests: []
      })
    }
    this.event({ event: "start", ...this.snapshot("running") })
  }

  private fileTiming(module: TestModule, ended: boolean): FileTiming {
    return {
      id: module.id,
      file: path.relative(process.cwd(), module.moduleId),
      project: module.project.name,
      outcome: module.state(),
      executionMs: ended ? module.diagnostic().duration : null,
      collected: true,
      tests: Array.from(module.children.allTests(), caseTiming)
    }
  }

  onTestModuleCollected(module: TestModule) {
    const file = this.fileTiming(module, false)
    this.files.set(module.id, file)
    this.event({ event: "collected", file })
  }

  onTestCaseResult(test: TestCase) {
    // Append only: avoid rewriting all earlier case results after every case.
    this.event({ event: "case", fileId: test.module.id, test: caseTiming(test) })
  }

  onTestModuleEnd(module: TestModule) {
    const file = this.fileTiming(module, true)
    this.files.set(module.id, file)
    this.completed.add(module.id)
    this.event({ event: "file", file })
    this.snapshot("running")
  }

  onTestRunEnd(
    modules: ReadonlyArray<TestModule>,
    errors: ReadonlyArray<unknown>,
    reason: "passed" | "failed" | "interrupted"
  ) {
    // Refresh pending cases on graceful interruption without inventing completed file durations.
    for (const module of modules) {
      this.files.set(module.id, this.fileTiming(module, this.completed.has(module.id)))
    }
    const report = this.snapshot(reason, errors.length)
    this.event({ event: "end", ...report })
    const seconds = (ms: number) => `${(ms / 1000).toFixed(3)} s`
    console.log(
      `\nIntegration timings (${reason}): ${seconds(report.wallMs)} reporter wall; ${
        seconds(report.summedFileExecutionMs)
      } summed file execution`
    )
    console.log(
      `Cases known: ${report.knownCases}; ${
        JSON.stringify(report.counts)
      }; files completed: ${report.completedFiles}/${report.plannedFiles}; unhandled errors: ${errors.length}`
    )
    console.log("Slowest files (execution includes tests and hooks):")
    for (
      const file of report.files.filter((file) => file.executionMs !== null)
        .sort((a, b) => b.executionMs! - a.executionMs!).slice(0, 10)
    ) {
      console.log(`  ${seconds(file.executionMs!)}  [${file.outcome}] ${file.file}`)
    }
    console.log("Slowest cases:")
    const tests = report.files.flatMap((file) => file.tests.map((test) => ({ file: file.file, ...test })))
    for (
      const test of tests.filter((test) => test.durationMs !== null)
        .sort((a, b) => b.durationMs! - a.durationMs!).slice(0, 20)
    ) {
      console.log(`  ${seconds(test.durationMs!)}  [${test.outcome}] ${test.file} > ${test.name}`)
    }
    console.log(
      `Complete timings: ${this.directory}/timings.json; incremental results: ${this.directory}/events.ndjson`
    )
  }
}
