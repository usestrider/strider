/*
 * Bounded diagnostic history; independent of the optional drift fixture sampler.
 *
 * Integration failures name their bounded protocol traces in `.data/integration-failures/`; CI keeps them with
 * `integration.log`. Each NDJSON file records both directions, connection IDs, sequence numbers and timestamps,
 * with explicit payload truncation and history overflow. Shared setup/teardown context has its own file. Passing
 * tests discard their buffers. Each active test and the shared context keep at most 2 MiB of serialized UTF-16
 * history; individual payloads keep 32 Ki characters, and late failed-test cleanup has a separate 256 KiB budget.
 * The optional `STRIDER_RECORD` drift sampler is separate and unchanged.
 *
 * Native trace video failures also record the page, acquisition/stop/file-read stage and underlying cause,
 * rendered with strict URL redaction, even if the test never exports its trace archive. An export made while
 * acquisition is pending records that observation too; later records can show its eventual failure.
 *
 * Capture covers Strider pipe and WebSocket transports and decoded stock WebKit inspector messages in Vitest,
 * including public-layer slices and the Strider upstream cases selected by the integration configuration.
 * Owned Chromium child-process pipes also cover the selected upstream Playwright baselines; their `pipe-send` and
 * `pipe-receive` records are below Strider's transport records and may duplicate those messages. Shared connections
 * may deliver background events during a test; the trace records observation, not causation. Concurrent shared traffic
 * stays in the shared context with the active test IDs. Separately executed CLI/daemon processes do not run in
 * Vitest's module graph, so their internal protocol is not captured. Owned Node child process stderr is observed
 * where an existing consumer drains it; ignored or inherited stderr is marked unavailable. No extra reader is added.
 *
 * Buffers are saved when Vitest reports a failed test or suite. An unhandled error without a failed test or suite,
 * or a worker that dies before those callbacks run, leaves no trace because its buffers remain in memory.
 * Connections and processes acquired during setup hooks are shared, including anonymous Effect layers that acquire
 * in the first test's `beforeEach`. Shared traffic observed during a single running test belongs to that test;
 * setup and suite cleanup stay in the linked shared artifact. Concurrent shared observations stay shared with the
 * active test IDs. Connections created in a test body remain owned by that creator, so late messages from a passing
 * test do not enter another test's trace. Reusing a body-created connection in another test keeps that creator
 * attribution; shared resources should be acquired by setup hooks.
 *
 * Low-level `closed` records contain an initiator and description, not the original Effect Cause or a malformed
 * WebKit frame. They precede the link's first-loss filtering: the first closure is effective, and later closure or
 * receive observations may be ignored by the link. Apart from native trace video failures, failures above the
 * inspector socket are not generally instrumented. Test-local request-body recording stages and integration-only
 * HAR collector wait markers record bounded active-phase snapshots and exit flags, without body/header/path/error
 * values. Abort snapshots cover test stages separately from recorder-local snapshots; there is no global registry.
 * A completed HAR finalizer does not prove later scope cleanup completed; page/context release is not instrumented;
 * interruption can read as ordinary scope closure. Inspector connection/process pairing is inferred from ordering,
 * pids and process arguments, rather than an explicit connection-to-process identifier. Launch and page-creation
 * preludes can be evicted from bounded histories; no protected head is kept. Shared-artifact links identify context
 * files but do not guarantee their prelude survives eviction. No real abnormal-loss probe has validated browser kill
 * or malformed-frame capture end to end. Traces assist investigation without guaranteeing a complete loss cause.
 */
import { Buffer } from "node:buffer"
export interface Entry {
  readonly sequence: number
  readonly timestamp: string
  readonly connection: string
  readonly kind: string
  readonly payload: string
  readonly truncated?: boolean
  readonly originalLength?: number
}

export class TraceBuffer {
  private history: Array<{ entry: Entry; size: number }> = []
  private sequence = 0
  private dropped = 0
  bytes = 0
  constructor(readonly limit = 2 * 1024 * 1024, readonly messageLimit = 32 * 1024) {}
  record(connection: string, kind: string, payload: string) {
    const entry: Entry = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      connection,
      kind,
      // V8 sliced strings can retain the entire screenshot/body behind a small substring.
      payload: Buffer.from(payload.slice(0, this.messageLimit), "utf16le").toString("utf16le"),
      ...(payload.length > this.messageLimit ? { truncated: true, originalLength: payload.length } : {})
    }
    const size = JSON.stringify(entry).length * 2
    if (size > this.limit) {
      this.dropped++
      return
    }
    while (this.bytes + size > this.limit) {
      this.bytes -= this.history.shift()!.size
      this.dropped++
    }
    this.history.push({ entry, size })
    this.bytes += size
  }
  entries(): Array<Entry> {
    const entries = this.history.map(({ entry }) => entry)
    return this.dropped === 0 ? entries : [{
      sequence: 0,
      timestamp: entries[0]?.timestamp ?? new Date().toISOString(),
      connection: "recorder",
      kind: "overflow",
      payload: `${this.dropped} earlier entries omitted`
    }, ...entries]
  }
  clear() {
    this.history = []
    this.bytes = 0
    this.dropped = 0
  }
}

interface Sink {
  connection(label: string): (kind: string, payload: unknown) => void
}
const key = Symbol.for("strider.integration.failureTrace")
export const install = (sink: Sink) => {
  Object.assign(globalThis, { [key]: sink })
}
/** Used only by the integration configuration's source instrumentation. */
export const connection = (label: string): (kind: string, payload: unknown) => void =>
  (globalThis as typeof globalThis & { [key]?: Sink })[key]?.connection(label) ?? (() => {})
