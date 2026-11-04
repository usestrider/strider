/** Complete per-test observations; the nightly integration.log retains them even on failure. */
import { Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"

export const diagnostic = Effect.fnUntraced(function*(name: string) {
  const construct = yield* Socket.WebSocketConstructor
  const started = process.hrtime.bigint()
  const entries: Array<unknown> = []
  const note = (source: string, value: unknown) => {
    entries.push({
      sequence: entries.length,
      utc: new Date().toISOString(),
      elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      source,
      value
    })
  }
  const transport = (source: string, wire: Transport.Transport): Transport.Transport => ({
    ...wire,
    send: (message) =>
      Effect.andThen(Effect.sync(() => note(`${source}:send start`, JSON.parse(message))), wire.send(message)).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => note(`${source}:send outcome`, { message: JSON.parse(message), exit }))
        )
      ),
    messages: wire.messages.pipe(
      Stream.tap((message) => Effect.sync(() => note(`${source}:receive`, JSON.parse(message)))),
      Stream.onExit((exit) => Effect.sync(() => note(`${source}:stream exit`, exit)))
    )
  })
  note("start", { name })
  yield* Effect.addFinalizer((exit) =>
    Effect.sync(() => {
      note("cleanup complete", exit)
      console.log(`diagnostic ${name}\n${entries.map((entry) => JSON.stringify(entry)).join("\n")}`)
    })
  )
  const socketConstructor = (source: string): typeof construct => (url, options) => {
    const ws = construct(url, options)
    for (const type of ["message", "close", "error"] as const) {
      ws.addEventListener(type, (event) =>
        note(`${source}:socket ${type}`, {
          data: typeof event.data === "string" ? event.data : undefined,
          code: event.code,
          reason: event.reason,
          readyState: ws.readyState
        }))
    }
    return ws
  }
  return { note, transport, socketConstructor }
})
