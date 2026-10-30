/**
 * Records what a browser sends, for the drift test (PROTOCOL.md, Drift test; `test/Drift.test.ts`).
 *
 * With `STRIDER_RECORD` naming a directory, `record` wraps a transport so that a few samples of each method are
 * appended to `<directory>/<fixture>.ndjson`: every event with its parameters, every reply with the command it
 * answers, and every error reply with what the backend's table made of it. Without it, the transport is
 * returned as it is. Set `STRIDER_RECORD_TRACE=1` too to retain every raw message, with its direction and UTC
 * timestamp, in a separate `<fixture>.trace.ndjson` file for investigating delivery and deadlines.
 * Public WebKit layers also record inspector socket chunks as base64 in `<fixture>.socket.trace.ndjson`;
 * concatenate decoded chunks per connection and direction before reading their frames.
 * Recording appends to the file, so run the integration tests one file at a time, with an
 * absolute directory, since the Nix environment starts elsewhere:
 *
 * ```sh
 * STRIDER_RECORD=$PWD/packages/browser/test/fixtures/traffic pnpm test:integration --no-file-parallelism
 * ```
 */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import type { Classification, Wire, WireError } from "../../src/internal/protocolClient.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import type * as SocketConnector from "../../src/protocol/SocketConnector.ts"
import type * as Transport from "../../src/protocol/Transport.ts"
import { pins } from "./pins.ts"

/** The fixture each backend's browser records into, named for the pinned browser recorded (`browsers.json`). */
export const fixtures = {
  cdp: pins.chromium.fixture,
  bidi: pins.firefox.fixture,
  webkitStock: pins.webkitgtk.fixture
} as const

/** One recorded message. */
export type Entry =
  | { readonly kind: "event"; readonly method: string; readonly params: unknown }
  | { readonly kind: "result"; readonly method: string; readonly result: unknown }
  | {
    readonly kind: "error"
    readonly method: string
    readonly error: WireError
    readonly becomes: Classification
  }

/** Distinct samples kept per kind and method. */
export const samplesPerMethod = 3

/** A message longer than this is left out: screenshots and bodies say nothing about the protocol's shape. */
export const maxLength = 32 * 1024

// The wrappers WebKit carries a command in, unwrapped to find the command itself
const wrappers = new Set(["Target.sendMessageToTarget", "Worker.sendMessageToWorker"])

/**
 * `made` names the methods the transport makes up itself rather than the browser's, which aren't recorded: stock
 * WebKit's transport presents its pages in our envelope, whose `Envelope` domain the browser hasn't got.
 */
export const record = (
  transport: Transport.Transport,
  wire: Wire,
  fixture: string,
  options?: { readonly made?: ((method: string) => boolean) | undefined }
): Transport.Transport => {
  const directory = process.env["STRIDER_RECORD"]
  if (directory === undefined || directory === "") return transport
  const file = `${directory}/${fixture}.ndjson`
  const trace = traceMessages(fixture)
  const samples = new Map<string, Set<string>>()
  const sample = (entry: Entry, text: string) => {
    const key = `${entry.kind} ${entry.method}`
    let kept = samples.get(key)
    if (kept === undefined) samples.set(key, kept = new Set())
    if (kept.size >= samplesPerMethod || kept.has(text)) return false
    kept.add(text)
    return true
  }
  fs.mkdirSync(directory, { recursive: true })
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line !== "") sample(JSON.parse(line) as Entry, line)
    }
  }
  const keep = (entry: Entry) => {
    if (options?.made?.(entry.method) === true) return
    const text = JSON.stringify(entry)
    if (text.length <= maxLength && sample(entry, text)) fs.appendFileSync(file, text + "\n")
  }
  const methods = new Map<number, string>()
  const sent = (text: string) => {
    trace?.("send", text)
    let message = JSON.parse(text) as { id?: unknown; method?: unknown; params?: { message?: unknown } }
    while (typeof message.method === "string" && wrappers.has(message.method)) {
      if (typeof message.params?.message !== "string") return
      message = JSON.parse(message.params.message)
    }
    if (typeof message.id === "number" && typeof message.method === "string") methods.set(message.id, message.method)
  }
  const received = (text: string) => {
    trace?.("receive", text)
    const incoming = wire.decode(text)
    switch (incoming._tag) {
      case "Event":
        return keep({ kind: "event", method: incoming.method, params: incoming.params })
      case "Reply": {
        const method = methods.get(incoming.id)
        return method === undefined ? undefined : keep({ kind: "result", method, result: incoming.result })
      }
      case "ErrorReply": {
        const method = methods.get(incoming.id)
        if (method === undefined) return
        const becomes = ProtocolClient.match(wire.errors, incoming.error)?.becomes ??
          { _tag: "Rejected", reason: "Unrecognized" }
        return keep({ kind: "error", method, error: incoming.error, becomes })
      }
    }
  }
  return {
    send: (message) => Effect.andThen(Effect.sync(() => sent(message)), transport.send(message)),
    messages: transport.messages.pipe(Stream.tap((text) => Effect.sync(() => received(text)))),
    closed: transport.closed
  }
}

/** Complete, opt-in wire evidence; a connection ID separates concurrent transports. */
const traceMessages = (fixture: string) => {
  const directory = process.env["STRIDER_RECORD"]
  if (!directory || process.env["STRIDER_RECORD_TRACE"] !== "1") return undefined
  fs.mkdirSync(directory, { recursive: true })
  const connection = randomUUID()
  return (direction: "send" | "receive", message: string) => {
    fs.appendFileSync(
      `${directory}/${fixture}.trace.ndjson`,
      JSON.stringify({ at: new Date().toISOString(), connection, direction, message }) + "\n"
    )
  }
}

/** Records the public WebKit layer's inspector socket as base64 chunks, preserving framing. */
export const traceInspectorSocket = (socket: SocketConnector.Connection): SocketConnector.Connection => {
  const trace = traceMessages(`${fixtures.webkitStock}.socket`)
  if (trace === undefined) return socket
  const keep = (direction: "send" | "receive", chunk: Uint8Array | string) =>
    trace(
      direction,
      Buffer.from(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk).toString("base64")
    )
  return {
    ...socket,
    pull: socket.pull.pipe(Effect.tap((chunks) =>
      Effect.sync(() => {
        for (const chunk of chunks) keep("receive", chunk)
      })
    )),
    write: (chunk) =>
      socket.write(chunk).pipe(Effect.tap(() =>
        Effect.sync(() => {
          if (typeof chunk === "string" || chunk instanceof Uint8Array) keep("send", chunk)
        })
      )),
    writeAll: (chunks) =>
      socket.writeAll(chunks).pipe(Effect.tap(() =>
        Effect.sync(() => {
          for (const chunk of chunks) keep("send", chunk)
        })
      ))
  }
}
