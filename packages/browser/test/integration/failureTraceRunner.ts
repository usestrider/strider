/** Default failure-only diagnostics for both integration projects. */
import * as fs from "node:fs"
import * as path from "node:path"
import { TestRunner } from "vitest"
import type { RunnerTask, RunnerTestCase, RunnerTestFile, RunnerTestSuite } from "vitest"
import "./traceProcesses.ts"
import type { Entry, Origin } from "./failureTrace.ts"
import { connection } from "./failureTrace.ts"
import { install, TraceBuffer } from "./failureTrace.ts"
import { summarize } from "./pointerRecipients.ts"
import { installTransfer, TransferScope } from "./traceTransfer.ts"

const directory = path.resolve(import.meta.dirname, "../../../../.data/integration-failures")
const workerDiagnostics = process.env.STRIDER_MACOS_WORKER_DIAGNOSTICS === "1"
const diagnosticFile = (task: RunnerTask) => workerDiagnostics && path.basename(task.file.filepath) === "Chromium.slice.test.ts"
const diagnosticTest = (task: RunnerTask) => diagnosticFile(task) && task.name === "hands out a page's worker, evaluates in it where the backend can, and sees it end"
const retainPasses = process.env.STRIDER_TRACE_RETAIN_PASSES === "1"
// Per file, across all passing tests and shared context; failed scopes retain their ordinary budgets.
let passScopesOmitted = 0
let passBytes = 16 * 1024 * 1024
let passExhausted = false
let lastPassingFile: string | undefined
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
const omissionLine = JSON.stringify({
  kind: "overflow",
  payload: "Passing diagnostic retention budget exhausted for this file; later passing evidence omitted"
}) + "\n"
const omissionBytes = Buffer.byteLength(omissionLine)
const connectionKey = (entry: Entry) =>
  entry.origin === undefined
    ? `parent:${entry.connection}`
    : `child:${entry.origin.pid}:${entry.origin.connection}`
const ownershipKeys = (entry: Entry) =>
  entry.origin === undefined
    ? [connectionKey(entry)]
    : [`parent:${entry.connection}`, connectionKey(entry)]
const exhausted = () => {
  passScopesOmitted++
  if (passExhausted) return
  passExhausted = true
  // Every passing write leaves exactly enough room for this once-per-file marker.
  if (lastPassingFile !== undefined) {
    fs.appendFileSync(lastPassingFile, omissionLine)
    passBytes -= omissionBytes
  }
  console.error("Passing diagnostic retention budget exhausted for this file")
}
const save = (file: string, trace: TraceBuffer, scope: string, passing = false): string | undefined => {
  const entries = trace.entries()
  const presses = summarize(entries)
  if (presses.length > 0) {
    entries.push({
      sequence: 0,
      timestamp: new Date().toISOString(),
      connection: "recorder",
      kind: "pointer-recipient-summary",
      payload: JSON.stringify(presses)
    })
  }
  if (passing && file !== sharedFile) {
    const needed = new Set(
      entries.filter((entry) => /^(engine-round-|host-|pointer-)/.test(entry.kind)).flatMap(ownershipKeys)
    )
    const local = new Set(entries.filter((entry) => entry.kind === "connection").map(connectionKey))
    const replay = shared.entries().filter((entry) =>
      entry.kind === "connection" && needed.has(connectionKey(entry)) && !local.has(connectionKey(entry))
    ).map((entry) => ({
      ...entry,
      sequence: 0,
      ownershipSource: { sharedArtifact: path.basename(sharedFile), sequence: entry.sequence }
    }))
    entries.unshift(...replay)
  }
  const diagnostics = passing
    ? entries.filter((entry) => /^(engine-round-|host-|pointer-|overflow$|attribution$)/.test(entry.kind))
    : entries
  // Connection creation alone is not evidence and must not consume the passing budget.
  if (passing && diagnostics.length === 0) return undefined
  if (passing && passExhausted) {
    exhausted()
    return undefined
  }
  const header = JSON.stringify({
    kind: "context",
    scope: scope.slice(0, 4096),
    ...(retainPasses
      ? { passingScopeOmissions: passScopesOmitted, passingRetentionRemainingBytes: passBytes }
      : {}),
    ...(file === sharedFile ? {} : { sharedArtifact: path.basename(sharedFile) }),
    note: "Independent parent/child tails; child selection uses origin timestamps, output sequence orders collection."
  }) + "\n"
  let selected: Set<Entry> | undefined
  let omitted = false
  if (passing) {
    const kept = new Set<Entry>()
    selected = kept
    const ownership = new Map(
      entries.filter((entry) => entry.kind === "connection").map((entry) => [connectionKey(entry), entry])
    )
    let available = passBytes - Buffer.byteLength(header) - omissionBytes
    for (const diagnostic of diagnostics) {
      const owners = ownershipKeys(diagnostic).flatMap((key) => {
        const owner = ownership.get(key)
        return owner === undefined || kept.has(owner) ? [] : [owner]
      })
      const group = [...owners, diagnostic]
      const bytes = group.reduce((total, entry) => total + Buffer.byteLength(JSON.stringify(entry) + "\n"), 0)
      if (bytes > available) {
        omitted = true
        break
      }
      for (const entry of group) kept.add(entry)
      available -= bytes
    }
    if (kept.size === 0) {
      exhausted()
      return undefined
    }
  }
  fs.mkdirSync(directory, { recursive: true })
  const fd = fs.openSync(file, "w")
  const write = (line: string) => {
    fs.writeSync(fd, line)
    if (passing) passBytes -= Buffer.byteLength(line)
  }
  try {
    write(header)
    // Preserve collection order and serialize one line at a time, including ownership only for kept evidence.
    for (const entry of entries) if (selected === undefined || selected.has(entry)) write(JSON.stringify(entry) + "\n")
  } finally {
    fs.closeSync(fd)
  }
  if (passing) lastPassingFile = file
  if (omitted) exhausted()
  console.error(`Integration failure trace: ${file}`)
  return file
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
    passExhausted = false
    lastPassingFile = undefined
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
    const file = failed || retainPasses || diagnosticTest(task) ? save(filename(task, "test"), running.trace, task.name, !failed) : undefined
    const sequence = running.trace.entries().at(-1)?.sequence ?? 0
    if (file !== undefined && failed) completed.set(task.id, { file, sequence, bytes: 0, overflow: false })
    running.trace.clear()
  }
  override async onAfterRunSuite(suite: RunnerTestSuite) {
    await super.onAfterRunSuite(suite)
    if (suite.file !== suite) return
    sharedTransfer.close()
    if (suite.result?.state === "fail" || retainPasses || diagnosticFile(suite)) {
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
