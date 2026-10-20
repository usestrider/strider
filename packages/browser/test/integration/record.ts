/**
 * Records what a browser sends, for the drift test (PROTOCOL.md, Drift test; `test/Drift.test.ts`).
 *
 * With `STRIDER_RECORD` naming a directory, `record` wraps a transport so that a few samples of each method are
 * appended to `<directory>/<fixture>.ndjson`: every event with its parameters, every reply with the command it
 * answers, and every error reply with what the backend's table made of it. Without it, the transport is
 * returned as it is. Recording appends to the file, so run the integration tests one file at a time:
 *
 * ```sh
 * STRIDER_RECORD=packages/browser/test/fixtures/traffic pnpm vitest --run --no-file-parallelism \
 *   packages/browser/test/integration
 * ```
 */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import type { Classification, Wire, WireError } from "../../src/internal/protocolClient.ts"
import * as ProtocolClient from "../../src/internal/protocolClient.ts"
import type * as Transport from "../../src/protocol/Transport.ts"
import { chromium, firefox, webkit } from "./browsers.ts"

/** The fixture each backend's browser records into, named for the pinned browser recorded (`browsers.json`). */
export const fixtures = {
  cdp: chromium.fixture,
  bidi: firefox.fixture,
  webkit: webkit.fixture
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

export const record = (transport: Transport.Transport, wire: Wire, fixture: string): Transport.Transport => {
  const directory = process.env["STRIDER_RECORD"]
  if (directory === undefined || directory === "") return transport
  const file = `${directory}/${fixture}.ndjson`
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
    const text = JSON.stringify(entry)
    if (text.length <= maxLength && sample(entry, text)) fs.appendFileSync(file, text + "\n")
  }
  const methods = new Map<number, string>()
  const sent = (text: string) => {
    let message = JSON.parse(text) as { id?: unknown; method?: unknown; params?: { message?: unknown } }
    while (typeof message.method === "string" && wrappers.has(message.method)) {
      if (typeof message.params?.message !== "string") return
      message = JSON.parse(message.params.message)
    }
    if (typeof message.id === "number" && typeof message.method === "string") methods.set(message.id, message.method)
  }
  const received = (text: string) => {
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
