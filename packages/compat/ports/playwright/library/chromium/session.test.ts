/**
 * Playwright's `tests/library/chromium/session.spec.ts`: a CDP session on a page, and on the browser. Chromium only, as
 * the original is.
 *
 * What the port changes:
 * - Strider has no per-page session object: `context.newCDPSession(page)` is a connection of the port's own to the
 *   browser's debugging port (`CdpConnection.make` over `Transport.webSocket`, the endpoint `/json/version` names), with a
 *   session attached to the page's target (`Target.attachToTarget` with `flatten`). Each test launches its browser with
 *   `--remote-debugging-port`, as connect-over-cdp does, and finds the page's target by the URL the page shows.
 *   `browser.newBrowserCDPSession()` is the connection's `browser` session.
 * - `client.send(method, params)` is the generated command sent `on` the session (`Runtime.evaluate({ … })`), and
 *   `client.on(event)` is `session.subscribe(event)`, subscribed before the action as the original's listener is.
 * - CD-038's `timeout` is `Protocol.withCommandTimeout`, and the failure is a `NoReply` naming the method and the budget.
 *   Its `signal` is interruption: Effect's interrupt carries no reason, so the port asserts the call ends interrupted,
 *   not Playwright's `AbortError` with its `cause`.
 * - CD-042, CD-047, CD-048, CD-050, and CD-051 end a session: `Target.detachFromTarget` on the browser session, or closing the
 *   page. A command on an ended session fails with `SessionEnded`, whose `why` is `detached` (Chromium detaches a closing page's sessions), where
 *   Playwright's message says "Target page, context or browser has been closed". The `close` event is `session.ended`.
 * - CD-043 sends a command no domain defines, declared with `Protocol.command`. The browser's rejection names the method;
 *   Playwright's error also has the caller's name in its stack, which is Playwright's own.
 * - CD-049's `event` listener hears every event the session gets. Strider's subscriptions are per event, so the port
 *   subscribes to `Network.requestWillBeSent`, the event the original looks for, and checks its URL.
 * - CD-039 counts the events seen once the navigation ends and everything the session received has been published
 *   (`drainObserved`).
 * - The original's `page.evaluate` is `evaluateInMainWorld`, and `context.newCDPSession(page.mainFrame())` (CD-044),
 *   `newCDPSession(page.context())` (CD-040), and the frame that has no session of its own (CD-045) are Playwright's
 *   argument checks, which the ledger marks. CD-041 needs the JS coverage the ledger names.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, type Page } from "@usestrider/browser"
import { Browser as CdpBrowser, Network, Runtime, Target } from "@usestrider/browser/cdp"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { backend } from "../../../harness/browsers.ts"
import { failureOf } from "../../../harness/playwright.ts"
import { upstream } from "../../../harness/upstream.ts"

/** The debugging port the browser listens on. Each test's browser stops before the next one starts. */
const debuggingPort = 9441

/**
 * Runs `body` on a browser launched with a debugging port, and a connection of its own to it, closed when the body ends.
 */
const withBrowserConnection = <A, E, R>(
  body: (cdp: CdpConnection.CdpConnection) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(Effect.gen(function*() {
    const json = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json() as Promise<unknown>)
    )
    const { webSocketDebuggerUrl } = Schema.decodeUnknownSync(Schema.Struct({ webSocketDebuggerUrl: Schema.String }))(
      json
    )
    const transport = yield* Transport.webSocket(webSocketDebuggerUrl)
    const cdp = yield* CdpConnection.make(transport)
    return yield* body(cdp)
  })).pipe(
    Effect.provide(Layer.mergeAll(
      NodeSocket.layerWebSocketConstructor,
      backend("chromium", { chromium: { args: [`--remote-debugging-port=${debuggingPort}`] } })
    ))
  )

/** The original's `context.newCDPSession(page)`: a session on the target of the page that shows `url`. */
const sessionFor = Effect.fnUntraced(function*(cdp: CdpConnection.CdpConnection, url: string) {
  const { targetInfos } = yield* Target.getTargets().pipe(Protocol.on(cdp.browser))
  const target = targetInfos.find((info) => info.type === "page" && info.url === url)
  assert.isDefined(target, `no page target shows ${url}`)
  const { sessionId } = yield* Target.attachToTarget({ targetId: target!.targetId, flatten: true }).pipe(
    Protocol.on(cdp.browser)
  )
  return { session: yield* cdp.session(sessionId), sessionId }
})

/** A page in a context of its own, at `url`: the original's `browser.newContext()` and `newPage()`. */
const pageAt = Effect.fnUntraced(function*(url: string) {
  const context = yield* Browser.newContext()
  const page = yield* context.newPage
  yield* page.goto(url, { waitUntil: "load" })
  return page
})

const closePage = Effect.fnUntraced(function*(page: Page.Page) {
  yield* (yield* page.control).close()
})

/** A command no domain defines, as the original's `client.send('ThisCommand.DoesNotExist')`. */
const doesNotExist = Protocol.command("ThisCommand.DoesNotExist", undefined, undefined, { status: "experimental" })

const hang = Runtime.evaluate({ expression: "new Promise(() => {})", awaitPromise: true })

/** The reason a protocol call failed, which the call must have failed with. */
const reasonOf = (failure: unknown) => {
  assert.isTrue(Protocol.isProtocolError(failure), String(failure))
  return (failure as Protocol.ProtocolError).reason
}

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("CD-037", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Effect.all([
          Runtime.enable().pipe(Protocol.on(session)),
          Runtime.evaluate({ expression: "window.foo = \"bar\"" }).pipe(Protocol.on(session))
        ], { concurrency: "unbounded" })
        const foo = yield* page.evaluateInMainWorld(() => (window as unknown as { foo: string }).foo)
        assert.strictEqual(foo, "bar")
      })
    ))

  test("CD-038", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        const evaluated = yield* Runtime.evaluate({ expression: "1 + 2", returnByValue: true }).pipe(
          Protocol.on(session),
          Protocol.withCommandTimeout("5 seconds")
        )
        assert.strictEqual(evaluated.result.value, 3)
        const failure = yield* failureOf(
          hang.pipe(Protocol.on(session), Protocol.withCommandTimeout("500 millis")),
          "the evaluation of a promise that never settles"
        )
        const reason = reasonOf(failure)
        assert.strictEqual(reason._tag, "NoReply")
        assert.include(reason.message, "Runtime.evaluate got no reply within 500ms")

        // The original's `signal`: the call is interrupted while it waits
        const fiber = yield* Effect.forkChild(hang.pipe(Protocol.on(session)))
        yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), "the evaluation was interrupted")
      })
    ))

  test("CD-039", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Network.enable().pipe(Protocol.on(session))
        const requests = yield* session.subscribe(Network.requestWillBeSent)
        const events: Array<unknown> = []
        yield* requests.pipe(Stream.runForEach((event) => Effect.sync(() => events.push(event))), Effect.forkScoped)
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* session.drainObserved
        yield* Effect.yieldNow
        assert.strictEqual(events.length, 1)
      })
    ))

  test("CD-042", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        yield* pageAt(server.EMPTY_PAGE)
        const { session, sessionId } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Runtime.enable().pipe(Protocol.on(session))
        const evaluated = yield* Runtime.evaluate({ expression: "1 + 2", returnByValue: true }).pipe(
          Protocol.on(session)
        )
        assert.strictEqual(evaluated.result.value, 3)
        yield* Target.detachFromTarget({ sessionId }).pipe(Protocol.on(cdp.browser))
        const failure = yield* failureOf(
          Runtime.evaluate({ expression: "3 + 1", returnByValue: true }).pipe(Protocol.on(session)),
          "the evaluation on a detached session"
        )
        const reason = reasonOf(failure)
        if (reason._tag !== "SessionEnded") assert.fail(reason.message)
        assert.strictEqual(reason.why, "detached")
      })
    ))

  test("CD-043", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        const failure = yield* failureOf(doesNotExist().pipe(Protocol.on(session)), "the command no domain defines")
        const reason = reasonOf(failure)
        assert.include(reason.message, "ThisCommand.DoesNotExist")
      })
    ))

  test("CD-046", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { sessionId } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Target.detachFromTarget({ sessionId }).pipe(Protocol.on(cdp.browser))
        yield* closePage(page)
      })
    ))

  test("CD-047", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { sessionId } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* closePage(page)
        yield* failureOf(
          Target.detachFromTarget({ sessionId }).pipe(Protocol.on(cdp.browser)),
          "the detach of a session whose page closed"
        )
      })
    ))

  test("CD-048", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        const pending = yield* Effect.forkChild(Effect.result(hang.pipe(Protocol.on(session))))
        // The evaluation must be on its way before the page closes
        yield* Effect.yieldNow
        yield* closePage(page)
        const first = yield* Fiber.join(pending)
        assert.isTrue(first._tag === "Failure", "the pending evaluation failed when the page closed")
        if (first._tag === "Failure") {
          const reason = reasonOf(first.failure)
          if (reason._tag !== "SessionEnded") assert.fail(reason.message)
          assert.strictEqual(reason.why, "detached")
        }
        const failure = yield* failureOf(hang.pipe(Protocol.on(session)), "the evaluation after the page closed")
        assert.strictEqual(reasonOf(failure)._tag, "SessionEnded")
      })
    ))

  test("CD-049", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Network.enable().pipe(Protocol.on(session))
        const requests = yield* session.subscribe(Network.requestWillBeSent, {
          prefilter: { request: { url: server.EMPTY_PAGE } }
        })
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const request = yield* Stream.runHead(requests)
        assert.strictEqual(request._tag, "Some")
      })
    ))

  test("CD-050", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        yield* pageAt(server.EMPTY_PAGE)
        const { session, sessionId } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* Target.detachFromTarget({ sessionId }).pipe(Protocol.on(cdp.browser))
        const ended = yield* session.ended
        assert.strictEqual(ended.why, "detached")
      })
    ))

  test("CD-051", { page: false }, ({ server }) =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
        yield* closePage(page)
        const ended = yield* session.ended
        assert.strictEqual(ended.why, "detached")
      })
    ))

  test("CD-052", { page: false }, () =>
    withBrowserConnection((cdp) =>
      Effect.gen(function*() {
        const version = yield* CdpBrowser.getVersion().pipe(Protocol.on(cdp.browser))
        assert.isTrue(version.userAgent.length > 0)
        const created = yield* cdp.browser.subscribe(Target.targetCreated)
        yield* Target.setDiscoverTargets({ discover: true }).pipe(Protocol.on(cdp.browser))
        yield* Browser.newPage()
        const event = yield* Stream.runHead(created)
        assert.strictEqual(event._tag, "Some")
      })
    ))
})
