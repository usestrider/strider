/** Diagnostics limited to the iframe conformance case. Raw CDP envelopes retain session routing and reply IDs. */
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type * as Transport from "../../../src/protocol/Transport.ts"

let active = false
export const note = (stage: string, data: unknown) => {
  if (active) console.log("iframe diagnostic", JSON.stringify({ time: Date.now(), stage, data }))
}
export const start = Effect.acquireRelease(
  Effect.sync(() => {
    active = true
    note("start", {})
  }),
  () =>
    Effect.sync(() => {
      note("end", {})
      active = false
    })
)
export const trace = (transport: Transport.Transport): Transport.Transport => ({
  send: (message) => Effect.andThen(Effect.sync(() => note("send", JSON.parse(message))), transport.send(message)),
  messages: transport.messages.pipe(Stream.tap((message) => Effect.sync(() => note("receive", JSON.parse(message))))),
  closed: transport.closed
})
