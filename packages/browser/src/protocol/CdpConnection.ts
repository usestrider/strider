/**
 * A raw Chrome DevTools Protocol connection, for working with the protocol directly: the browser's own session,
 * and each target session the browser announces, over one `Transport`.
 *
 * Sessions are flat: every session shares the connection, and messages carry their `sessionId`. Attach with
 * `Target.attachToTarget({ targetId, flatten: true })` or `Target.setAutoAttach({ …, flatten: true })`; the
 * browser announces each new session with `Target.attachedToTarget`, and `session` returns it from then on.
 *
 * **Gotchas**
 *
 * - This is the raw protocol. Nothing here enables domains, tracks targets, or waits for anything to be ready;
 *   `@usestrider/browser/chromium` does that.
 * - Attaching with `flatten: false` isn't supported: that session's messages arrive wrapped in
 *   `Target.receivedMessageFromTarget` events, and its commands fail.
 * - Error replies are classified by a table recorded against Chromium 155. A reply it doesn't know is
 *   `Rejected` with reason `Unrecognized`, carrying the browser's code and message.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Target from "../cdp/Target.ts"
import * as CdpWire from "../internal/cdpWire.ts"
import * as ProtocolClient from "../internal/protocolClient.ts"
import * as Protocol from "./Protocol.ts"
import type * as Transport from "./Transport.ts"

/**
 * A CDP connection: the browser's session, and the target sessions attached on it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface CdpConnection {
  /**
   * The browser's own session, for `Browser`, `Target`, `SystemInfo`, and `Storage` commands.
   */
  readonly browser: Protocol.ProtocolSession
  /**
   * The session for a `sessionId` the browser announced with `Target.attachedToTarget`. Fails with
   * `SessionEnded` if it isn't attached, or no longer is.
   *
   * **Example** (Following every target the browser attaches)
   *
   * ```ts import.meta.vitest
   * import { Target } from "@usestrider/browser/cdp"
   * import { type CdpConnection, Protocol } from "@usestrider/browser/protocol"
   * import { Effect, Stream } from "effect"
   *
   * const targets = Effect.fn("targets")(function*(cdp: CdpConnection.CdpConnection) {
   *   const attached = yield* cdp.browser.subscribe(Target.attachedToTarget)
   *   yield* Target.setAutoAttach({
   *     autoAttach: true,
   *     waitForDebuggerOnStart: false,
   *     flatten: true
   *   }).pipe(
   *     Protocol.on(cdp.browser)
   *   )
   *   return attached.pipe(Stream.mapEffect((event) => cdp.session(event.sessionId)))
   * })
   * ```
   */
  readonly session: (sessionId: Target.SessionID) => Effect.Effect<Protocol.ProtocolSession, Protocol.ProtocolError>
  /**
   * Waits as long as the connection lives, then gives the reason it was lost.
   *
   * **Example** (Logging a lost connection)
   *
   * ```ts import.meta.vitest
   * import type { CdpConnection } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const watch = Effect.fn("watch")(function*(cdp: CdpConnection.CdpConnection) {
   *   const lost = yield* cdp.closed
   *   yield* Effect.logError(`Chrome's connection was lost: ${lost.description}`)
   * })
   * ```
   */
  readonly closed: Effect.Effect<Transport.ConnectionLost>
}

/**
 * Starts a CDP connection over a transport.
 *
 * **Details**
 *
 * One reader, running in the scope, routes replies to their commands and queues events, which one worker
 * publishes to each session's subscriptions in the order they arrived. A session may have 10,000 events or
 * 256 MiB queued for the worker; past that, its queued events are dropped, and its subscriptions fail with
 * `EventOverflow` or, if sliding, get a `Gap`. Closing the scope, or losing the transport, ends every session:
 * pending commands fail at once, and subscriptions end with `SessionEnded` after the events received before.
 *
 * **Example** (Navigating a new tab)
 *
 * ```ts import.meta.vitest
 * import { Page, Target } from "@usestrider/browser/cdp"
 * import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
 * import { Effect, Stream } from "effect"
 *
 * const visit = Effect.fn("visit")(
 *   function*(transport: Transport.Transport, url: string) {
 *     const cdp = yield* CdpConnection.make(transport)
 *     const { targetId } = yield* Target.createTarget({ url: "about:blank" }).pipe(
 *       Protocol.on(cdp.browser)
 *     )
 *     const { sessionId } = yield* Target.attachToTarget({ targetId, flatten: true })
 *       .pipe(Protocol.on(cdp.browser))
 *     const page = yield* cdp.session(sessionId)
 *     const loaded = yield* page.subscribe(Page.loadEventFired)
 *     yield* Page.enable().pipe(Protocol.on(page))
 *     yield* Page.navigate({ url }).pipe(Protocol.on(page))
 *     yield* Stream.runHead(loaded)
 *   }
 * )
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const make: (transport: Transport.Transport) => Effect.Effect<CdpConnection, never, Scope.Scope> = Effect
  .fnUntraced(function*(transport: Transport.Transport) {
    const client = yield* ProtocolClient.make(transport, CdpWire.wire)
    return {
      browser: client.root,
      session: (sessionId: Target.SessionID) =>
        Effect.suspend(() => {
          const session = client.session(sessionId as string as Protocol.SessionKey)
          return session === undefined
            ? Effect.fail(new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "detached" }) }))
            : Effect.succeed(session)
        }),
      closed: client.closed
    }
  })
