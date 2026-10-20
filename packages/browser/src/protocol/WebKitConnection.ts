/**
 * A raw connection to Playwright's WebKit build (L0): the browser's own session, a session per page proxy, and
 * one per inspector target and worker inside it, over one `Transport`.
 *
 * Playwright's WebKit splits a page in two. Its page proxy lives in the UI process and outlives navigations:
 * `Dialog`, `Emulation`, `Input`, `Screencast` and `Target` are sent there. Its inspector target is the page in
 * a web process, where `Page`, `Runtime`, `DOM`, `Network` and the rest are sent; a cross-site navigation
 * replaces it with a new target. The `Playwright` domain, on the browser's session, creates contexts and pages.
 * Each session here is announced by an event before anything arrives on it, so `pageProxy`, `target` and
 * `worker` return a session from then on.
 *
 * **Gotchas**
 *
 * - This is the raw protocol. Nothing here enables domains, resumes targets, or tracks navigations;
 *   `@usestrider/browser/webkit` does that.
 * - Every target starts paused (`isPaused` in `Target.targetCreated`), and runs nothing until
 *   `Target.resume`. A page's first target is announced before `Playwright.createPage` replies.
 * - A cross-site navigation starts a provisional target, which `Target.didCommitProvisionalTarget` swaps in.
 *   The old target's session then ends with `SessionEnded` `swapped`, and its pending commands fail with it.
 * - Two commands abort the browser instead of failing: `Playwright.navigate` with a `frameId` the page doesn't
 *   have, and `Dialog.handleJavaScriptDialog` with no dialog open (Playwright WebKit 2359).
 * - Error replies are classified by a table recorded against Playwright's WebKit 2359. A reply it doesn't know
 *   is `Rejected` with reason `Unrecognized`, carrying the browser's code and message.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as ProtocolClient from "../internal/protocolClient.ts"
import * as WebKitWire from "../internal/webkitWire.ts"
import type * as Playwright from "../webkit-protocol/Playwright.ts"
import * as Protocol from "./Protocol.ts"
import type * as Transport from "./Transport.ts"

/**
 * A WebKit connection: the browser's session, and the page proxy, target and worker sessions announced on it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WebKitConnection {
  /**
   * The browser's own session, for the `Playwright` domain.
   */
  readonly browser: Protocol.ProtocolSession
  /**
   * The session of a page proxy `Playwright.pageProxyCreated` announced. Fails with `SessionEnded` if there is
   * none, or no longer is.
   */
  readonly pageProxy: (
    pageProxyId: Playwright.PageProxyID
  ) => Effect.Effect<Protocol.ProtocolSession, Protocol.ProtocolError>
  /**
   * The ids of a page proxy's targets, oldest first: its current target, and a provisional one while a
   * cross-site navigation is pending. Empty if the page proxy is gone.
   */
  readonly targets: (pageProxyId: Playwright.PageProxyID) => Effect.Effect<ReadonlyArray<string>>
  /**
   * The session of a target `Target.targetCreated` announced on a page proxy. Fails with `SessionEnded` if
   * there is none, or no longer is.
   */
  readonly target: (
    pageProxyId: Playwright.PageProxyID,
    targetId: string
  ) => Effect.Effect<Protocol.ProtocolSession, Protocol.ProtocolError>
  /**
   * The session of a worker `Worker.workerCreated` announced on a target. Fails with `SessionEnded` if there is
   * none, or no longer is.
   */
  readonly worker: (
    pageProxyId: Playwright.PageProxyID,
    targetId: string,
    workerId: string
  ) => Effect.Effect<Protocol.ProtocolSession, Protocol.ProtocolError>
  /**
   * Waits as long as the connection lives, then gives the reason it was lost.
   */
  readonly closed: Effect.Effect<Transport.ConnectionLost>
}

/**
 * Starts a WebKit connection over a transport.
 *
 * **Details**
 *
 * One reader, running in the scope, unwraps each message to the session it belongs to, routes replies to
 * their commands and queues events, which one worker publishes to each session's subscriptions in the order
 * they arrived; the limits are `CdpConnection`'s. A command to a target or worker is wrapped in
 * `Target.sendMessageToTarget` (and `Worker.sendMessageToWorker`) for it, and fails with the wrapper's error if
 * the wrapper does. Closing the scope, or losing the transport, ends every session: pending commands fail at
 * once, and subscriptions end with `SessionEnded` after the events received before.
 *
 * **Example** (Reading a new page's user agent)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Playwright, Runtime, Target } from "@usestrider/browser/webkit-protocol"
 * import { Protocol, Transport, WebKitConnection } from "@usestrider/browser/protocol"
 *
 * const userAgent = Effect.fn("userAgent")(function*(transport: Transport.Transport) {
 *   const webkit = yield* WebKitConnection.make(transport)
 *   yield* Playwright.enable().pipe(Protocol.on(webkit.browser))
 *   const { browserContextId } = yield* Playwright.createContext({}).pipe(Protocol.on(webkit.browser))
 *   const { pageProxyId } = yield* Playwright.createPage({ browserContextId }).pipe(Protocol.on(webkit.browser))
 *   // The page's first target was announced before createPage replied, and waits to be resumed
 *   const [targetId] = yield* webkit.targets(pageProxyId)
 *   const page = yield* webkit.pageProxy(pageProxyId)
 *   const target = yield* webkit.target(pageProxyId, targetId!)
 *   yield* Target.resume({ targetId: targetId! }).pipe(Protocol.on(page))
 *   const { result } = yield* Runtime.evaluate({ expression: "navigator.userAgent", returnByValue: true }).pipe(
 *     Protocol.on(target)
 *   )
 *   return result.value
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const make: (transport: Transport.Transport) => Effect.Effect<WebKitConnection, never, Scope.Scope> = Effect
  .fnUntraced(function*(transport: Transport.Transport) {
    const client = yield* ProtocolClient.make(transport, WebKitWire.wire)
    const find = (key: Protocol.SessionKey) =>
      Effect.suspend(() => {
        const session = client.session(key)
        return session === undefined
          ? Effect.fail(new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "detached" }) }))
          : Effect.succeed(session)
      })
    return {
      browser: client.root,
      pageProxy: (pageProxyId) => find(WebKitWire.pageProxyKey(pageProxyId)),
      targets: (pageProxyId) =>
        Effect.sync(() => {
          const page = client.session(WebKitWire.pageProxyKey(pageProxyId))
          if (page === undefined) return []
          return client.children(page).flatMap((child) => {
            const route = WebKitWire.route(child.key!)
            return route._tag === "Target" ? [route.targetId] : []
          })
        }),
      target: (pageProxyId, targetId) => find(WebKitWire.targetKey(pageProxyId, targetId)),
      worker: (pageProxyId, targetId, workerId) => find(WebKitWire.workerKey(pageProxyId, targetId, workerId)),
      closed: client.closed
    } satisfies WebKitConnection
  })
