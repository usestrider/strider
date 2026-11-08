/** Default failure-only diagnostics for both integration projects. */
import * as fs from "node:fs"
import * as path from "node:path"
import { TestRunner } from "vitest"
import type { RunnerTask, RunnerTestCase, RunnerTestFile, RunnerTestSuite } from "vitest"
import "./traceProcesses.ts"
import type { Origin } from "./failureTrace.ts"
import { connection } from "./failureTrace.ts"
import { install, TraceBuffer } from "./failureTrace.ts"
import { installTransfer, TransferScope } from "./traceTransfer.ts"

const directory = path.resolve(import.meta.dirname, "../../../../.data/integration-failures")
const retainPasses = process.env.STRIDER_TRACE_RETAIN_PASSES === "1"
// Per file, across all passing tests and shared context; failed scopes retain their ordinary budgets.
let passScopesOmitted = 0
let passBytes = 16 * 1024 * 1024
const shared = new TraceBuffer()
let sharedTransfer = new TransferScope(() => connection("child-transfer"))
const transfers = new Map<string, TransferScope>()
installTransfer(() => {
  const id = TestRunner.getCurrentTest<RunnerTestCase | undefined>()?.id
  return id !== undefined && active.size === 1 && active.get(id)?.inBody === true
    ? transfers.get(id) ?? sharedTransfer
    : sharedTransfer
})
const active = new Map<string, { trace: TraceBuffer; inBody: boolean }>()
let sharedFile = ""
const completed = new Map<string, { file?: string | undefined; sequence: number; bytes: number; overflow: boolean }>()
let nextConnection = 0
const serialize = (value: unknown): string =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_, v) => typeof v === "bigint" ? `${v}n` : v) ?? String(value)
const filename = (task: RunnerTask, suffix: string) =>
  path.join(directory, `${path.basename(task.file.filepath)}-${task.id}-${process.pid}-${suffix}.ndjson`)
const save = (file: string, trace: TraceBuffer, scope: string, passing = false) => {
  if (passing) passBytes -= 32768
  fs.mkdirSync(directory, { recursive: true })
  const fd = fs.openSync(file, "w")
  try {
    fs.writeSync(
      fd,
      JSON.stringify({
        kind: "context",
        scope: scope.slice(0, 4096),
        ...(retainPasses
          ? { passingScopeOmissions: passScopesOmitted, passingRetentionRemainingBytes: passBytes }
          : {}),
        ...(file === sharedFile ? {} : { sharedArtifact: path.basename(sharedFile) }),
        note:
          "Independent parent/child tails; child selection uses origin timestamps, output sequence orders collection."
      }) + "\n"
    )
    // Serialize one line at a time instead of constructing a second artifact-sized string.
    for (const entry of trace.entries()) {
      if (passing && !/^(engine-round-|host-|overflow$|attribution$)/.test(entry.kind)) continue
      const line = JSON.stringify(entry) + "\n"
      if (passing) {
        const bytes = Buffer.byteLength(line)
        if (bytes > Math.max(0, passBytes - 32768)) {
          fs.writeSync(
            fd,
            JSON.stringify({
              kind: "overflow",
              payload: "Passing diagnostic retention budget exhausted for this file"
            }) + "\n"
          )
          console.error("Passing diagnostic retention budget exhausted for this file")
          break
        }
        passBytes -= bytes
      }
      fs.writeSync(fd, line)
    }
  } finally {
    fs.closeSync(fd)
  }
  console.error(`Integration failure trace: ${file}`)
}
install({
  connection(label) {
    const id = `${++nextConnection}:${label}`
    // Vitest exposes one global current test, so it cannot identify a concurrent creator safely.
    const ambiguous = active.size > 1
    const current = TestRunner.getCurrentTest<RunnerTestCase | undefined>()?.id
    // Anonymous Effect layers acquire once in beforeEach, then keep their resources until afterAll.
    // Setup acquisitions follow the observing test rather than becoming owned by the first test.
    const owner = !ambiguous && current !== undefined && active.get(current)?.inBody === true ? current : undefined
    const record = (kind: string, value: unknown, origin?: Origin) => {
      const payload = serialize(value)
      // A connection created by a test remains that test's, even after its completion.
      if (owner !== undefined) {
        const running = active.get(owner)
        if (running !== undefined) running.trace.record(id, kind, payload, origin)
        else {
          const done = completed.get(owner)
          if (done?.file !== undefined && !done.overflow) {
            const tail = new TraceBuffer()
            tail.record(id, kind, payload, origin)
            const entry = tail.entries()[0]
            const line = JSON.stringify({ ...entry, sequence: ++done.sequence }) + "\n"
            // Keep late cleanup events too, without allowing a failed shared scope to fill the disk.
            if (done.bytes + line.length * 2 <= 256 * 1024) {
              fs.appendFileSync(done.file, line)
              done.bytes += line.length * 2
            } else {
              fs.appendFileSync(
                done.file,
                JSON.stringify({
                  timestamp: new Date().toISOString(),
                  connection: "recorder",
                  kind: "overflow",
                  payload: "Late cleanup budget exhausted; subsequent entries omitted",
                  sequence: done.sequence
                }) + "\n"
              )
              done.overflow = true
            }
          }
        }
        return
      }
      if (active.size === 1 && !ambiguous && active.values().next().value!.inBody) {
        active.values().next().value!.trace.record(id, kind, payload, origin)
      } else {
        shared.record(id, kind, payload, origin)
        if (active.size > 1) {
          shared.record(id, "attribution", `Shared connection; concurrent tests: ${[...active.keys()].join(", ")}`)
        }
      }
    }
    record("connection", { label, owner: owner ?? "shared suite context", ambiguousCreator: ambiguous })
    return record
  }
})

export default class FailureTraceRunner extends TestRunner {
  override onCollectStart(file: RunnerTestFile) {
    super.onCollectStart(file)
    sharedFile = filename(file, "shared")
    sharedTransfer = new TransferScope(() => connection("child-transfer"))
    shared.clear()
    passScopesOmitted = 0
    passBytes = 16 * 1024 * 1024
    active.clear()
    completed.clear()
  }
  override async onBeforeRunTask(task: RunnerTask) {
    await super.onBeforeRunTask(task)
    // Vitest returns early for skipped/todo tasks without calling onAfterRunTask.
    if (task.type === "test" && (task.mode === "run" || task.mode === "queued")) {
      active.set(task.id, { trace: new TraceBuffer(), inBody: false })
      transfers.set(task.id, new TransferScope(() => connection("child-transfer")))
    }
  }
  async runTask(task: RunnerTestCase) {
    const running = active.get(task.id)
    if (running !== undefined) running.inBody = true
    // Invoke the same collected callback as Vitest's default runner, inside its existing hook/deadline handling.
    try {
      await TestRunner.getTestFn(task)()
    } finally {
      // Anonymous Effect layers release in onTestFinished, before onAfterRunTask.
      if (running !== undefined) running.inBody = false
    }
  }
  onAfterRetryTask(task: RunnerTestCase) {
    // Runtime skip returns before onAfterRunTask; this hook still runs after per-test cleanup.
    if ((task.result && "pending" in task.result && task.result.pending) || task.result?.state === "skip") {
      transfers.get(task.id)?.close()
      transfers.delete(task.id)
      active.get(task.id)?.trace.clear()
      active.delete(task.id)
    }
  }
  override onAfterRunTask(task: RunnerTask) {
    super.onAfterRunTask(task)
    const running = active.get(task.id)
    if (running === undefined) return
    transfers.get(task.id)?.close()
    transfers.delete(task.id)
    active.delete(task.id)
    const failed = task.result?.state === "fail"
    const file = failed || (retainPasses && passBytes > 65536) ? filename(task, "test") : undefined
    if (retainPasses && !failed && file === undefined) passScopesOmitted++
    const sequence = running.trace.entries().at(-1)?.sequence ?? 0
    if (file !== undefined) save(file, running.trace, task.name, !failed)
    if (file !== undefined && failed) completed.set(task.id, { file, sequence, bytes: 0, overflow: false })
    running.trace.clear()
  }
  override async onAfterRunSuite(suite: RunnerTestSuite) {
    await super.onAfterRunSuite(suite)
    if (suite.file !== suite) return
    sharedTransfer.close()
    if (suite.result?.state === "fail" || (retainPasses && passBytes >= 32768)) {
      save(
        filename(suite, "shared"),
        shared,
        "Shared setup/teardown and unattributed concurrent traffic; not assigned to an individual test",
        suite.result?.state !== "fail"
      )
    }
    shared.clear()
  }
}
