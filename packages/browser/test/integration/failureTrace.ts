/*
 * `slice/recycledBrowser.ts` (Firefox suites) writes `.data/integration-failures/recycler-held.ndjson` only with
 * `STRIDER_TRACE_RETAIN_PASSES=1`: when a restart is refused at the page limit, a line names the handles and owned page
 * ids that held it. A line is written only when that set changes, at most 200 lines, then one `limit` line; a failed
 * write stops further lines and never changes the restart's result.
 *
 * Bounded diagnostic history; independent of the optional drift fixture sampler.
 *
 * Integration failures name their bounded protocol traces in `.data/integration-failures/`; CI keeps them with
 * `integration.log`. Each NDJSON file records both directions, connection IDs, sequence numbers and timestamps,
 * with explicit payload truncation and history overflow. Shared setup/teardown context has its own file. Passing
 * tests discard their buffers, except the two macOS-job scopes below. Each active test and the shared context independently retain 2 MiB of serialized
 * UTF-16 parent history and 2 MiB of child history: 4 MiB per scope, including entry metadata. Child replay never
 * consumes the parent budget. Parent eviction follows observation order; child eviction follows origin timestamps,
 * with PID then process-local sequence as deterministic equal-timestamp tie breakers, regardless of slot replay order.
 * Startup records replayed from protected spool prefixes reserve up to 512 KiB of the child budget, in slot order.
 * The remaining capacity (at least 1536 KiB) retains recent child observations, independent of slot replay order.
 * Prefixes beyond the aggregate reservation compete for tail capacity; startup is bounded, not guaranteed for every
 * process. Large startup traffic can exhaust a process prefix before its launch handshake. No semantic filtering
 * chooses commands: the prefix preserves the first records, including identity and ordinary launch handshakes.
 * Output retains collection sequence and each process's local order. Clock adjustments can affect recency selection;
 * timestamps do not establish causation across processes. Individual parent payloads keep 32 Ki characters, child
 * payloads 8 Ki characters, and late failed-test cleanup has a separate 256 KiB serialized UTF-16 budget.
 * The optional `STRIDER_RECORD` drift sampler is separate and unchanged.
 *
 * Recorder-only interception also covers engine action rendering waits and host operation deadlines. Runtime
 * round IDs are process-local; operation/document/realm IDs correlate each round with its response, not with
 * unrelated traffic. At most 32 rendering races per round are returned, with an omitted count. Each reports its
 * requested cap, callback/timer winner, page performance-clock milliseconds and document visibility at start/end.
 * Null callback/timer means unobserved when serialized, never proof it did not run later. Callbacks after response
 * serialization are unavailable; no extra wait or evaluation collects them. A host-interrupted/lost evaluation may
 * have a start and no reply: its page observations are unavailable. Direct adapter engine calls have page evidence
 * in protocol replies but no runtime round ID. Non-action requests currently have no rendering observations.
 * Host deadline/timeout entries name the operation, chosen deadline and budget, source (enclosing/default where
 * known), phase, last refusal and hint. Host monotonic nanoseconds and page performance milliseconds have distinct
 * origins; neither may be subtracted from the other or from NDJSON UTC timestamps. A custom browser clock is
 * labelled separately from the host live clock; last-refusal timestamps remain on the adapter host-live clock. visibilityState does not measure OS occlusion or compositor work.
 * Clock reads, serialization and recorder writes add observation overhead; timings describe the instrumented run.
 * The existing Node preload applies the same interception in supported children, with origin PID/local sequence;
 * the child/runtime capture exclusions below still apply. No production source or ordinary execution is instrumented.
 *
 * In macOS jobs the Chromium worker test and the deliberate-crash identity test (`ChromiumIdentity.test.ts`, crash
 * with direct page attachment), plus their files' shared scopes, keep their full ordinary bounded history, raw traffic
 * and late cleanup on a pass, independent of the 16 MiB passing quota below; `scripts/integration-macos.md` says when
 * this applies.
 *
 * STRIDER_TRACE_RETAIN_PASSES=1 additionally saves host/engine diagnostic entries (plus overflow/attribution)
 * from passing scopes for an investigation; passing raw protocol traffic is discarded, except for those scopes. Existing per-scope memory,
 * child spool and payload bounds remain in force. Passing artifacts together consume at most 16 MiB UTF-8 per test
 * file, charging the actual serialized UTF-8 bytes of headers, entries and omission markers. Empty and
 * connection-only passing scopes produce no artifact and cost nothing. Ownership entries accompany retained
 * diagnostics only; ownership replayed from shared context has sequence 0 and ownershipSource with its original
 * shared artifact/sequence (a metadata-only source context may have no artifact). Child diagnostics keep both
 * process-local connection metadata and the parent transfer's ownership. A marker's exact bytes are reserved
 * until exhaustion; a partially retained scope and
 * subsequent omitted evidence scopes are counted as omissions. Exhaustion is marked in the last passing artifact
 * and logged. Failed scopes retain their ordinary independent budgets. Passing late cleanup is not retained, except for those scopes. This is a per-file disk bound, so
 * total retained data also depends on the finite selected suite; CI expires artifacts after 14 days.
 *
 * Chromium's recorder-only `viewportProbe.ts` also records `viewport-*` entries at page attachment, before/after
 * debugger resume and before/after each metrics clear. Each sample correlates target/session, the native window
 * ID and outer bounds (Browser.getWindowForTarget) and the CSS layout viewport (Page.getLayoutMetrics); the outer
 * size minus the layout size shows browser UI taking page area. The probe sends only these two browser-side
 * commands: it runs no page code and creates no execution world, so no realm or context event follows from it.
 * Setup baseline requests/replies are identified separately. Queries are asynchronous and do not gate adapter
 * operations. A request with no reply remains pending, not a measurement; protocol errors and detach are marked
 * unavailable. At most 512 queries are pending at once; once full, further measurements are recorded as
 * unavailable until replies arrive or the connection ends. Measurements within a sample are separate browser
 * commands, not an atomic snapshot. Native outer bounds are not content dimensions. Extra queries can perturb
 * timing; a passing probe cannot establish the cause of an earlier failure.
 * Passing retention includes these records with STRIDER_TRACE_RETAIN_PASSES=1 and the same bounds described above.
 * No shipped source changes; the recorder's Transport tap alone issues these diagnostic queries.
 *
 * On Chromium, `pointerRecipients.ts` also records which document receives each trusted pointer event
 * (`pointer-*` entries, kept from passing scopes with STRIDER_TRACE_RETAIN_PASSES=1). When a page or frame target
 * attaches, the Transport instrumentation sends extra commands on its session: a binding and a capture-phase,
 * passive `window` listener in an isolated world, which never touch the document's own listeners or their order.
 * `pointer-dispatch` is each `Input.dispatchMouseEvent` sent; `pointer-recipient` is each trusted
 * `pointer*`/`mouse*`/`click` event a document received, with its URL, session and target (page, or out-of-process
 * frame), event type, client coordinates, target element, and the page's `performance.now()` plus time origin
 * (add them for epoch milliseconds; the entry timestamps are the host's). `pointer-recipient-summary` lists, for each
 * dispatched press, the documents that received a `mousedown`, or says none did. It shows where the browser
 * delivered a gesture, such as the middle frame instead of the leaf. It cannot show why, and it doesn't know which
 * document should have received it. Frames in the same process as their parent share a session, so tell them apart
 * by URL. Only documents with the capture installed are seen, a target attached before the recorder connected
 * isn't, and each document keeps 256 events. The added commands are not free: they can change the timing of a
 * frame's attach, and a race can come out differently. STRIDER_POINTER_CAPTURE=0 leaves the capture out and keeps
 * `pointer-dispatch`. Firefox and WebKit have no capture.
 *
 * The shared-context suites (`slice/sharedContext.ts`) read the context's storage from each page as it closes, with a
 * 5 second deadline. Typed Deadline.Timeout errors and the older wrapped export timeout
 * (Rejected with the exact hint `UserContext.exportStorageState timed out while resolving`) trigger the probes;
 * unrelated rejections do not. This includes cookie reads as well as page evaluation, and does not establish
 * which browser subsystem stalled. When the read isn't answered in time, on any backend, the entries record,
 * on the `shared-context` connection, up to three further steps. Each has a budget of 2 seconds of its own, whatever
 * deadline encloses the read, and is also raced against that long on the browser clock: (1) whether the same page
 * still answers `1 + 1`; (2) whether a new page in the same context, on the stalled page's origin, opens, navigates
 * there and answers `indexedDB.databases()`; (3) how long closing that new page took. Each entry holds `probe`,
 * `outcome` (`answered`, `timed out`, `failed: ...`, or `skipped: no origin`) and, except when skipped, `millis`,
 * measured on the host clock. The probes run before the case's failure is reported and never change it or its
 * message; a read that answers, or a page that is gone, runs none. The entries are in the trace of the failing case
 * only.
 *
 * What they can show: whether the original page still ran a script, and whether the fresh page's whole sequence
 * (open, navigate, call) completed in 2 seconds. What they can't: step 2 is one outcome, so a timeout or failure
 * there doesn't tell opening or navigating from `indexedDB.databases()` itself, and a responsive first page with a
 * fresh page that opened doesn't show that the call was ever made, so none of it attributes a stall to IndexedDB by
 * itself. The close of the new page is waited for 2 seconds; if it runs longer it continues on a fiber of the
 * suite's scope, and a close still running when that scope closes is interrupted with it. Such a close, like a close
 * that failed, leaves no entry beyond `timed out` or `failed: ...`.
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
 * stays in the shared context with the active test IDs. Node children launched with `process.execPath` receive a
 * test-only preload; the CLI forwards it through execArgv into its detached daemon. The same transport interception
 * captures daemon-owned pipe, WebSocket and stock WebKit inspector traffic, plus process lifecycle and the daemon's
 * own stderr writes. Child entries carry `origin` (pid, process-local sequence, connection, timestamp and any original
 * truncation); pid 0 denotes recorder-generated child-transfer metadata, with its own marker counter.
 * The outer sequence orders collection, not events across processes. Owned Node child process stderr is observed
 * where an existing consumer drains it; ignored or inherited stderr is marked unavailable. No extra reader is added.
 *
 * Child transfer uses a private temporary spool per test/shared context, with 128 lifetime process slots, each
 * retaining a fixed 64 KiB startup prefix and two rotating 96 KiB tail segments (at most 32 MiB per scope,
 * plus 128 empty claim tokens and a fixed overflow marker). All 384 segments and the overflow marker exist before
 * children get the path. Prefix capacity is taken from the former tail allocation, not added to it. Children claim a
 * slot by unlinking a token, then only open existing files without O_CREAT. Completion atomically renames the spool
 * to a path children do not know before collection/removal, preventing new opens; in-flight descriptors can finish
 * writes to existing files but cannot add directory entries during removal. Passing and failing spools are removed,
 * without retries, delays or waiting for child exit. Later writes fail and cannot enter another test's spool.
 *
 * There is no transfer queue. Each child write retains one record (at most 64 KiB serialized UTF-16 before its
 * process metadata); collection reads at most one 64 KiB prefix and two 96 KiB segments for one process
 * at a time, plus bounded parsed entries. Vitest-side retention totals 4 MiB per active scope: N active tests and W shared worker contexts retain
 * at most 4*(N+W) MiB of serialized history and 32*(N+W) MiB of named spool data across their children.
 * Unlinked data can remain allocated until an in-flight descriptor closes; removal does not wait for it.
 * These are payload/metadata budgets, not exact JS heap measurements: arrays, parsed objects, source protocol values,
 * serialization temporaries and the runtime add overhead. Record counts are bounded by serialized entry sizes.
 * Saving writes one JSON line at a time, rather than constructing an artifact-sized string. Each retained artifact
 * is below 7 MiB UTF-8 including context/overflow lines and late cleanup (UTF-8 can exceed serialized UTF-16 size).
 * There is one test artifact per failed test and one shared artifact per failed file; retained disk across runs is
 * proportional to failures/runs, with CI's existing 14-day retention, not a global recorder quota.
 *
 * Slot exhaustion and gaps between retained process-local sequences are marked as overflow. Aggregate eviction
 * has a separate omitted-entry count; protected prefixes can leave intermediate gaps before the retained tail.
 * A write already in flight at retirement can leave an incomplete final line; that observation can be missing. Child ordering is local to each process, with no claimed
 * total order between parent and daemon. A worker killed before cleanup can leave its bounded temporary spool,
 * as well as lose its in-memory artifact.
 *
 * Only Node launches observed by the runner, using its exact process.execPath, are automatically preloaded. Descendants
 * must retain both the preload in execArgv and the spool environment variable (the CLI's shell exec does). Other
 * runtimes, alternate Node executables, synchronous spawn/execFile, env-scrubbing launches, external daemons and worker threads
 * are unsupported. Fatal signals and failures before the preload runs cannot produce a node-exit record. Ignored
 * browser stderr remains unavailable; native writes bypassing process.stderr.write are not intercepted.
 *
 * The manual rendering probe uses `test/fixtures/renderingFailureTrace/vitest.config.ts` with
 * `-t 'fills an unknown input type as text'` in the same pinned shell as the CLI probe below. It deliberately
 * fails after a different ordinary fill test so its shared runtime/engine evidence can be inspected.
 *
 * The manual `test/fixtures/cliFailureTrace/vitest.config.ts` probe deliberately fails real CLI cases after their
 * cleanup. In the pinned Linux shell it has verified launched Chromium, Firefox and stock WebKit and attachment to
 * all three: daemon-owned send/receive, closure and node-exit, plus owned-browser exits for launches. The ordinary
 * CLI suite passes without artifacts. FailureTrace.test.ts verifies detached attribution, process-local order,
 * daemon text/byte-array stderr, bounded flooding/slot exhaustion, separate parent/child budgets, chronological
 * retention of early-slot daemon evidence, spool retirement before live-child collection/removal, disposal and
 * passing-child late-event isolation.
 * Run the manual probe with `nix develop .#integration --ignore-environment --keep TERM
 * --command pnpm exec vitest --run --config packages/browser/test/fixtures/cliFailureTrace/vitest.config.ts -t
 * 'preserves startup and repeated page viewports|attaches to .*by an HTTP endpoint|attaches to Firefox'`.
 * It intentionally exits 1. macOS, Windows and abnormal daemon loss have not been probed.
 *
 * Buffers are saved when Vitest reports a failed test or suite. An unhandled error without a failed test or suite,
 * or a worker that dies before those callbacks run, leaves no trace because its buffers remain in memory.
 * Connections and processes acquired during setup hooks are shared, including anonymous Effect layers that acquire
 * in the first test's `beforeEach`. In-process shared traffic observed during a single running test belongs to that test;
 * setup and suite cleanup stay in the linked shared artifact. Child launches in hooks or concurrent tests use the
 * shared spool and stay shared when collected at suite completion. Concurrent in-process observations stay shared with the
 * active test IDs. Connections created in a test body remain owned by that creator, so late messages from a passing
 * test do not enter another test's trace. Reusing a body-created connection in another test keeps that creator
 * attribution; shared resources should be acquired by setup hooks.
 *
 * Low-level `closed` records contain an initiator and description, not the original Effect Cause or a malformed
 * WebKit frame. They precede the link's first-loss filtering: the first closure is effective, and later closure or
 * receive observations may be ignored by the link. Apart from native trace video failures, failures above the
 * inspector socket, apart from rendering rounds and host operation deadlines, are not instrumented;
 * interruption can read as ordinary scope closure. Inspector connection/process pairing is inferred from ordering,
 * pids and process arguments, rather than an explicit connection-to-process identifier. Only child startup prefixes
 * are protected; parent and later page-creation preludes can be evicted. Shared-artifact links identify context
 * files but do not guarantee their complete prelude survives eviction. No real abnormal-loss probe has validated
 * browser kill or malformed-frame capture end to end. Traces assist investigation without guaranteeing a complete loss cause.
 *
 * Chromium iframe native capture (`iframeNativeProbe.ts`, `nativeInputCapture.ts`): only two Chromium adapter cases,
 * "names an iframe's frame, passes a node across worlds, and sends input into a frame" and "sends input into a
 * cross-site frame that has not drawn its first frame yet", record Chromium's own trace of where it routed their
 * input. It exists because the first case failed in some macOS nightlies with the press reaching the parent `iframe`
 * element, and the protocol and the pointer recipients cannot say whether the child's hit-test region was published
 * before the press. Every run of either case, passing or failing, writes
 * `.data/integration-failures/iframe-native-<pid>-<uuid>/`, which CI uploads with the other failure traces
 * (Linux: every job, always; macOS: every run, passing ones included, as the upload step runs `if: always()`):
 * `trace.json` (a CDP `Tracing` JSON trace, categories `input`, `latencyInfo`, `viz.hit_testing_flow`,
 * `disabled-by-default-viz.hit_testing_flow`, `viz` and `devtools`, no argument filtering), `browser.stderr.log`
 * (the browser's complete stderr, from `--enable-logging=stderr`, the only extra launch flag), `metadata.json`
 * (outcome, `dataLossOccurred`, trace and stderr EOF, byte counts and any capture errors), `protocol.ndjson` (every
 * adapter packet, written to disk from before bootstrap and frozen before the trace is drained),
 * `cleanup-protocol.ndjson`, `capture-protocol.ndjson` and a `*-before-native-drain.ndjson` recorder checkpoint with
 * the pointer recipients. Bounds: the trace buffer is 64 MiB in `recordUntilFull` mode (the start is kept, and Chromium
 * reports data loss in the metadata); the start, drain and stream-close waits have 5, 10 and 2 second budgets, and
 * their failures are recorded in the metadata, never replacing the case's own outcome; the test's deadlines are
 * unchanged. Limits: the routing and hit-test events carry no frame-sink, widget or command IDs, so they join to the
 * protocol by time and coordinates only, on separate clocks, and show order, not identity. The `devtools` category does
 * record each DevTools command's call ID and method. Chromium's routing and hit-test sources have no
 * verbose logging, so `--v` and `--vmodule` add nothing. Cost: about 5 seconds more for the case (draining the trace
 * after the gesture) and about 0.6 MB of artifact per run; the tracing itself runs inside the browser and may change
 * timing, which the protocol timestamps cannot show. The capture attaches before the test creates its page.
 */
import { Buffer } from "node:buffer"
export interface Origin {
  readonly startup?: boolean
  readonly pid: number
  readonly sequence: number
  readonly timestamp: string
  readonly connection: string
  readonly truncated?: boolean
  readonly originalLength?: number
}
export type Record = (kind: string, payload: unknown, origin?: Origin) => void
export interface Entry {
  readonly sequence: number
  readonly timestamp: string
  readonly connection: string
  readonly kind: string
  readonly payload: string
  readonly truncated?: boolean
  readonly originalLength?: number
  readonly origin?: Origin
}

export class TraceBuffer {
  private history: Array<{ entry: Entry; size: number }> = []
  private startupHistory: Array<{ entry: Entry; size: number }> = []
  private startupBytes = 0
  private childHistory: Array<{ entry: Entry; size: number }> = []
  private sequence = 0
  private dropped = 0
  private childDropped = 0
  private parentBytes = 0
  private childBytes = 0
  readonly childLimit = 2 * 1024 * 1024
  get bytes() {
    return this.parentBytes + this.childBytes
  }
  readonly limit: number
  readonly messageLimit: number
  constructor(limit = 2 * 1024 * 1024, messageLimit = 32 * 1024) {
    this.limit = limit
    this.messageLimit = messageLimit
  }
  record(connection: string, kind: string, payload: string, origin?: Origin) {
    const entry: Entry = {
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      connection,
      kind,
      ...(origin === undefined ? {} : { origin }),
      // V8 sliced strings can retain the entire screenshot/body behind a small substring.
      payload: Buffer.from(payload.slice(0, this.messageLimit), "utf16le").toString("utf16le"),
      ...(payload.length > this.messageLimit ? { truncated: true, originalLength: payload.length } : {})
    }
    const size = JSON.stringify(entry).length * 2
    if (origin === undefined) {
      if (size > this.limit) {
        this.dropped++
        return
      }
      while (this.parentBytes + size > this.limit) {
        this.parentBytes -= this.history.shift()!.size
        this.dropped++
      }
      this.history.push({ entry, size })
      this.parentBytes += size
    } else {
      if (origin.startup && this.startupBytes + size <= 512 * 1024) {
        this.startupHistory.push({ entry, size })
        this.startupBytes += size
        this.childBytes += size
        while (this.childBytes > this.childLimit) {
          this.childBytes -= this.childHistory.shift()!.size
          this.childDropped++
        }
        return
      }
      if (size > this.childLimit - this.startupBytes) {
        this.childDropped++
        return
      }
      // Retain the newest child observations, regardless of process-slot collection order.
      // PIDs and process-local sequence numbers break equal-timestamp ties deterministically.
      const compare = (other: Entry) =>
        origin.timestamp.localeCompare(other.origin!.timestamp) ||
        origin.pid - other.origin!.pid || origin.sequence - other.origin!.sequence
      let low = 0
      let high = this.childHistory.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (compare(this.childHistory[middle]!.entry) < 0) high = middle
        else low = middle + 1
      }
      this.childHistory.splice(low, 0, { entry, size })
      this.childBytes += size
      while (this.childBytes > this.childLimit) {
        this.childBytes -= this.childHistory.shift()!.size
        this.childDropped++
      }
    }
  }
  entries(): Array<Entry> {
    const entries = [...this.history, ...this.startupHistory, ...this.childHistory].map(({ entry }) => entry)
      .sort((a, b) => a.sequence - b.sequence)
    const overflow = (dropped: number, connection: string): Array<Entry> =>
      dropped === 0 ? [] : [{
        sequence: 0,
        timestamp: entries[0]?.timestamp ?? new Date().toISOString(),
        connection,
        kind: "overflow",
        payload: `${dropped} entries omitted from history`
      }]
    return [...overflow(this.dropped, "recorder"), ...overflow(this.childDropped, "recorder:children"), ...entries]
  }
  clear() {
    this.history = []
    this.childHistory = []
    this.startupHistory = []
    this.startupBytes = 0
    this.parentBytes = 0
    this.childBytes = 0
    this.dropped = 0
    this.childDropped = 0
  }
}

interface Sink {
  checkpoint?(label: string): string | undefined
  connection(label: string): Record
}
const key = Symbol.for("strider.integration.failureTrace")
export const install = (sink: Sink) => {
  Object.assign(globalThis, { [key]: sink })
}
/** Used only by the integration configuration's source instrumentation. */
export const connection = (label: string): Record =>
  (globalThis as typeof globalThis & { [key]?: Sink })[key]?.connection(label) ?? (() => {})

/** Saves an independent recorder checkpoint before a diagnostic stream can displace its bounded tail. */
export const checkpoint = (label: string): string | undefined =>
  (globalThis as typeof globalThis & { [key]?: Sink })[key]?.checkpoint?.(label)
