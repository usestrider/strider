/** Test-only, file-backed capture. Native stream traffic never enters the immutable gesture file. */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as path from "node:path"
import * as BrowserClock from "../../src/internal/browserClock.ts"
import type * as Transport from "../../src/protocol/Transport.ts"

export const categories = [
  "input",
  "latencyInfo",
  "viz.hit_testing_flow",
  "disabled-by-default-viz.hit_testing_flow",
  // The pinned targeter uses the "viz,benchmark" group; DevToolsSession records call IDs under "devtools".
  "viz",
  "devtools"
] as const
export { flags } from "./nativeInputProcess.ts"
import { flags } from "./nativeInputProcess.ts"
export const startParams = {
  transferMode: "ReturnAsStream",
  streamFormat: "json",
  streamCompression: "none",
  traceConfig: {
    recordMode: "recordUntilFull",
    enableArgumentFilter: false,
    traceBufferSizeInKb: 65536,
    includedCategories: categories
  }
}
const firstId = 1_800_000_000 // Separate from adapter IDs and the recorder's 2^30 pointer-capture IDs.
const write = (fd: number, data: string | Uint8Array) => {
  const buffer = typeof data === "string" ? Buffer.from(data) : data
  let offset = 0
  while (offset < buffer.byteLength) {
    const count = fs.writeSync(fd, buffer, offset, buffer.byteLength - offset)
    if (count === 0) throw new CaptureError("Diagnostic file write made no progress")
    offset += count
  }
}
class CaptureError extends Error {
  readonly _tag = "NativeInputCaptureError"
}
type Packet = { id?: number; method?: string; params?: any; result?: any; error?: unknown }

export class NativeInputCapture {
  readonly metadata: Record<string, unknown> = { categories, flags, startParams, created: new Date().toISOString() }
  private errors: Array<string> = []
  private nextId = firstId
  private pending = new Map<number, Deferred.Deferred<any, CaptureError>>()
  private complete = Deferred.makeUnsafe<any>()
  private transport: Transport.Transport | undefined
  private protocol: number
  private control: number
  private native: number
  private stderr: number
  private checkpointed = false
  private stderrClosed = false
  private disposed = false
  private own = new Set<number>()
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true })
    const opened: Array<number> = []
    const open = (name: string) => {
      const fd = fs.openSync(path.join(directory, name), "wx")
      opened.push(fd)
      return fd
    }
    try {
      this.protocol = open("protocol.ndjson")
      this.control = open("capture-protocol.ndjson")
      this.native = open("trace.json")
      this.stderr = open("browser.stderr.log")
    } catch (error) {
      for (const fd of opened) fs.closeSync(fd)
      throw error
    }
    this.saveMetadata()
  }
  error(error: unknown) {
    const text = String(error)
    if (!this.errors.includes(text) && this.errors.length < 16) this.errors.push(text)
    this.saveMetadata()
  }
  private attempt(f: () => void) {
    try {
      f()
    } catch (error) {
      this.error(error)
    }
  }
  saveMetadata() {
    try {
      fs.writeFileSync(
        path.join(this.directory, "metadata.json"),
        JSON.stringify({ ...this.metadata, errors: this.errors }, null, 2)
      )
    } catch (error) {
      // Disk failure is diagnostic failure, never a replacement for the original assertion/Cause.
      console.error("Native input metadata write failed", String(error))
    }
  }
  private log(fd: number, direction: string, packet: unknown) {
    this.attempt(() => write(fd, JSON.stringify({ time: new Date().toISOString(), direction, packet }) + "\n"))
  }
  sent(message: string) {
    let packet: Packet
    try {
      packet = JSON.parse(message)
    } catch {
      this.log(this.protocol, "send", message)
      return
    }
    if (packet.id !== undefined && packet.id >= firstId) {
      this.error("Original command entered the native capture ID range")
    }
    this.log(this.protocol, "send", packet)
  }
  /** True means this is a private diagnostic message, not an adapter reply/event. */
  receive(message: string): boolean {
    let packet: Packet
    try {
      packet = JSON.parse(message)
    } catch {
      this.log(this.protocol, "receive", message)
      return false
    }
    if (packet.id !== undefined && this.own.has(packet.id)) {
      const result = packet.result
      this.log(this.control, "receive", {
        ...packet,
        ...(typeof result?.data === "string"
          ? { result: { ...result, data: { omittedStreamCharacters: result.data.length } } }
          : {})
      })
      const pending = this.pending.get(packet.id)
      if (pending !== undefined) {
        this.pending.delete(packet.id)
        Deferred.doneUnsafe(
          pending,
          packet.error === undefined
            ? Effect.succeed(result)
            : Effect.fail(new CaptureError(JSON.stringify(packet.error)))
        )
      }
      return true
    }
    if (packet.method?.startsWith("Tracing.")) {
      this.log(this.control, "receive", packet)
      if (packet.method === "Tracing.tracingComplete") {
        this.metadata.tracingComplete = packet.params
        if (packet.params?.dataLossOccurred === true) this.error("Chromium reported native trace data loss")
        Deferred.doneUnsafe(this.complete, Effect.succeed(packet.params))
        this.saveMetadata()
      }
      return true
    }
    this.log(this.protocol, "receive", packet)
    return false
  }
  wrap(transport: Transport.Transport): Transport.Transport {
    this.transport = transport
    return {
      send: (message) => Effect.andThen(Effect.sync(() => this.sent(message)), transport.send(message)),
      messages: transport.messages.pipe(Stream.filter((message) => !this.receive(message))),
      closed: transport.closed
    }
  }
  private call = Effect.fnUntraced(function*(this: NativeInputCapture, method: string, params: unknown = {}) {
    if (this.transport === undefined) return yield* Effect.fail(new CaptureError("Missing capture transport"))
    const id = this.nextId++
    const reply = yield* Deferred.make<any, CaptureError>()
    this.pending.set(id, reply)
    this.own.add(id)
    const packet = { id, method, params }
    this.log(this.control, "send", packet)
    return yield* Effect.andThen(this.transport.send(JSON.stringify(packet)), Deferred.await(reply)).pipe(
      Effect.ensuring(Effect.sync(() => this.pending.delete(id)))
    )
  })
  start = Effect.fnUntraced(function*(this: NativeInputCapture) {
    yield* this.call("Tracing.start", startParams)
    this.metadata.started = new Date().toISOString()
    this.saveMetadata()
  })
  checkpoint(outcome: unknown, recorderCheckpoint?: string) {
    if (this.checkpointed) return
    this.attempt(() => {
      fs.fsyncSync(this.protocol)
      this.metadata.protocolBytesBeforeDrain = fs.fstatSync(this.protocol).size
      fs.closeSync(this.protocol)
      this.protocol = fs.openSync(path.join(this.directory, "cleanup-protocol.ndjson"), "wx")
      this.checkpointed = true
      this.metadata.outcome = outcome
      this.metadata.recorderCheckpoint = recorderCheckpoint
      this.metadata.beforeDrain = new Date().toISOString()
      if (!this.stderrClosed) fs.fsyncSync(this.stderr)
      this.metadata.stderrBytesBeforeDrain = this.stderrClosed
        ? this.metadata.stderrBytes
        : fs.fstatSync(this.stderr).size
      this.saveMetadata()
    })
  }
  finish = Effect.fnUntraced(function*(this: NativeInputCapture) {
    if (this.metadata.started === undefined) return
    yield* this.call("Tracing.end")
    const complete = yield* Deferred.await(this.complete)
    if (typeof complete.stream !== "string") {
      return yield* Effect.fail(new CaptureError("Tracing completion omitted its stream"))
    }
    const handle = complete.stream
    const drain = Effect.gen({ self: this }, function*() {
      while (true) {
        const chunk = yield* this.call("IO.read", { handle, size: 64 * 1024 })
        if (typeof chunk.data !== "string") return yield* Effect.fail(new CaptureError("IO.read omitted data"))
        const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8")
        yield* Effect.sync(() => write(this.native, bytes))
        if (chunk.eof) break
      }
      yield* Effect.sync(() => {
        fs.fsyncSync(this.native)
        this.metadata.traceEOF = true
        this.metadata.traceBytes = fs.fstatSync(this.native).size
      })
    })
    yield* drain.pipe(Effect.ensuring(
      this.call("IO.close", { handle }).pipe(
        Effect.interruptible,
        BrowserClock.timeoutOn(BrowserClock.live, 2000),
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag === "None") this.error("Native stream close exceeded 2000ms")
          })
        ),
        Effect.filterOrFail((result) => result._tag === "Some", () => new CaptureError("Native stream was not closed")),
        Effect.tap(() =>
          Effect.sync(() => {
            this.metadata.streamClosed = true
          })
        ),
        Effect.catchCause((cause) => Effect.sync(() => this.error(cause)))
      )
    ))
    this.metadata.finished = new Date().toISOString()
    this.saveMetadata()
  })
  processStarted(pid: number | undefined, args: unknown) {
    this.metadata.process = { pid, args }
    this.saveMetadata()
  }
  stderrChunk(chunk: unknown) {
    if (this.stderrClosed) return this.error("Stderr data arrived after stderr capture closed")
    this.attempt(() => write(this.stderr, chunk instanceof Uint8Array ? chunk : String(chunk)))
  }
  stderrEnd(eof: boolean) {
    if (this.stderrClosed) return
    this.attempt(() => {
      fs.fsyncSync(this.stderr)
      this.metadata.stderrBytes = fs.fstatSync(this.stderr).size
      this.metadata.stderrEOF = eof
      fs.closeSync(this.stderr)
      this.stderrClosed = true
      this.saveMetadata()
    })
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const fd of [this.protocol, this.control, this.native]) this.attempt(() => fs.closeSync(fd))
    // Once attached, stderr belongs to the child until its existing reader emits EOF/close.
    if (this.metadata.process === undefined) this.stderrEnd(false)
    this.saveMetadata()
  }
}
