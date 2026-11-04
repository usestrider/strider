/** Default failure-only diagnostics for both integration projects. */
import * as fs from "node:fs"
import * as path from "node:path"
import { TestRunner } from "vitest"
import type { RunnerTask, RunnerTestCase, RunnerTestFile, RunnerTestSuite } from "vitest"
import "./traceProcesses.ts"
import { install, TraceBuffer } from "./failureTrace.ts"

const directory = path.resolve(import.meta.dirname, "../../../../.data/integration-failures")
const shared = new TraceBuffer()
const active = new Map<string, { task: RunnerTestCase; trace: TraceBuffer }>()
const completed = new Map<string, { file?: string | undefined; sequence: number; bytes: number; overflow: boolean }>()
let nextConnection = 0
const serialize = (value: unknown): string =>
  typeof value === "string"
    ? value
    : JSON.stringify(value, (_, v) => typeof v === "bigint" ? `${v}n` : v) ?? String(value)
const filename = (task: RunnerTask, suffix: string) =>
  path.join(directory, `${path.basename(task.file.filepath)}-${task.id}-${process.pid}-${suffix}.ndjson`)
const save = (file: string, trace: TraceBuffer, scope: string) => {
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify({
      kind: "context",
      scope,
      note:
        "Bounded tail; send records attempted writes. Shared connections can deliver background events during a test."
    }) + "\n" + trace.entries().map((entry) => JSON.stringify(entry)).join("\n") + "\n"
  )
  console.error(`Integration failure trace: ${file}`)
}
install({
  connection(label) {
    const id = `${++nextConnection}:${label}`
    const owner = TestRunner.getCurrentTest<RunnerTestCase | undefined>()?.id
    const record = (kind: string, value: unknown) => {
      const payload = serialize(value)
      // A connection created by a test remains that test's, even after its completion.
      if (owner !== undefined) {
        const running = active.get(owner)
        if (running !== undefined) running.trace.record(id, kind, payload)
        else {
          const done = completed.get(owner)
          if (done?.file !== undefined && !done.overflow) {
            const tail = new TraceBuffer()
            tail.record(id, kind, payload)
            const entry = tail.entries()[0]
            const line = JSON.stringify({ ...entry, sequence: ++done.sequence }) + "\n"
            // Keep late cleanup events too, without allowing a failed shared scope to fill the disk.
            if (done.bytes + line.length * 2 <= 256 * 1024) {
              fs.appendFileSync(done.file, line)
              done.bytes += line.length * 2
            } else if (!done.overflow) {
              fs.appendFileSync(
                done.file,
                JSON.stringify({
                  ...entry,
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
      if (active.size === 1) {
        active.values().next().value!.trace.record(id, kind, payload)
      } else {
        shared.record(id, kind, payload)
        if (active.size > 1) {
          shared.record(id, "attribution", `Shared connection; concurrent tests: ${[...active.keys()].join(", ")}`)
        }
      }
    }
    record("connection", { label, owner: owner ?? "shared suite context" })
    return record
  }
})

export default class FailureTraceRunner extends TestRunner {
  override onCollectStart(file: RunnerTestFile) {
    super.onCollectStart(file)
    shared.clear()
    active.clear()
    completed.clear()
  }
  override async onBeforeRunTask(task: RunnerTask) {
    await super.onBeforeRunTask(task)
    if (task.type === "test") active.set(task.id, { task, trace: new TraceBuffer() })
  }
  override onAfterRunTask(task: RunnerTask) {
    super.onAfterRunTask(task)
    const running = active.get(task.id)
    if (running === undefined) return
    active.delete(task.id)
    const file = task.result?.state === "fail" ? filename(task, "test") : undefined
    const sequence = running.trace.entries().at(-1)?.sequence ?? 0
    if (file !== undefined) save(file, running.trace, task.name)
    if (file !== undefined) completed.set(task.id, { file, sequence, bytes: 0, overflow: false })
    running.trace.clear()
  }
  override async onAfterRunSuite(suite: RunnerTestSuite) {
    await super.onAfterRunSuite(suite)
    if (suite.file !== suite) return
    if (suite.result?.state === "fail") {
      save(
        filename(suite, "shared"),
        shared,
        "Shared setup/teardown and unattributed concurrent traffic; not assigned to an individual test"
      )
    }
    shared.clear()
  }
}
