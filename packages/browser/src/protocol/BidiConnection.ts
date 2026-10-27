/**
 * A raw WebDriver BiDi connection, for working with the protocol directly: one session over one `Transport`.
 *
 * A BiDi endpoint serves one session per connection. Connected to a browser's `/session` endpoint, start the session
 * with `Session.new_` before anything else; a connection made for an existing session needs no `Session.new_`.
 * Events arrive for the session only after `Session.subscribe` names them.
 *
 * **Gotchas**
 *
 * - This is the raw protocol. Nothing here subscribes to events, tracks contexts or waits for anything to be
 *   ready; `@usestrider/browser/firefox` and `@usestrider/browser/bidi` do that.
 * - Every event belongs to the session: the wire carries no context to route by.
 * - Error replies are classified by a table of the spec's error codes. A code it doesn't know is `Rejected`
 *   with reason `Unrecognized`, carrying the browser's code and message.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as BidiWire from "../internal/bidiWire.ts"
import * as ProtocolClient from "../internal/protocolClient.ts"
import type * as Protocol from "./Protocol.ts"
import type * as Transport from "./Transport.ts"

/**
 * A BiDi connection: its one session.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface BidiConnection {
  /**
   * The session every command and event belongs to.
   */
  readonly session: Protocol.ProtocolSession
  /**
   * Waits as long as the connection lives, then gives the reason it was lost.
   *
   * **Example** (Logging a lost connection)
   *
   * ```ts import.meta.vitest
   * import type { BidiConnection } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const watch = Effect.fn("watch")(function*(bidi: BidiConnection.BidiConnection) {
   *   const lost = yield* bidi.closed
   *   yield* Effect.logError(`Firefox's connection was lost: ${lost.description}`)
   * })
   * ```
   */
  readonly closed: Effect.Effect<Transport.ConnectionLost>
}

/**
 * Starts a BiDi connection over a transport.
 *
 * **Details**
 *
 * One reader, running in the scope, routes replies to their commands and queues events, which one worker
 * publishes to subscriptions in the order they arrived, with the same limits as `CdpConnection.make`. Closing
 * the scope, or losing the transport, ends the session: pending commands fail at once, and subscriptions end
 * with `SessionEnded` after the events received before.
 *
 * **Example** (Starting a session and opening a tab)
 *
 * ```ts import.meta.vitest
 * import { BrowsingContext, Session } from "@usestrider/browser/bidi-protocol"
 * import { BidiConnection, Protocol, Transport } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const openTab = Effect.fn("openTab")(
 *   function*(transport: Transport.Transport, url: string) {
 *     const bidi = yield* BidiConnection.make(transport)
 *     yield* Session.new_({ capabilities: {} }).pipe(Protocol.on(bidi.session))
 *     const { context } = yield* BrowsingContext.create({ type: "tab" }).pipe(
 *       Protocol.on(bidi.session)
 *     )
 *     yield* BrowsingContext.navigate({ context, url, wait: "complete" }).pipe(
 *       Protocol.on(bidi.session)
 *     )
 *   }
 * )
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const make: (transport: Transport.Transport) => Effect.Effect<BidiConnection, never, Scope.Scope> = Effect
  .fnUntraced(function*(transport: Transport.Transport) {
    const client = yield* ProtocolClient.make(transport, BidiWire.wire)
    return { session: client.root, closed: client.closed }
  })
