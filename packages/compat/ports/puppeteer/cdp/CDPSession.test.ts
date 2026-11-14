/**
 * Puppeteer's `test/src/cdp/CDPSession.test.ts`: CDP sessions on a page's target, with their commands, events, detach,
 * errors and timeouts. Chromium only, as the original's sessions are CDP's.
 *
 * What the port changes:
 * - Puppeteer's `page.createCDPSession()` is a connection of the port's own to the browser's debugging port
 *   (`CdpConnection.make` over `Transport.webSocket`, the endpoint `/json/version` names), with a session attached to the
 *   page's target (`Target.attachToTarget` with `flatten`), as `chromium/session.test.ts` does. The browser launches with
 *   `--remote-debugging-port` and Puppeteer's runner arguments. The page is found by the URL it shows.
 * - `client.send(method, params)` is the generated command sent `on` the session, and `client.on(event)` is
 *   `session.subscribe(event)`, subscribed before the action that makes the event.
 * - `client.detach()` is `Target.detachFromTarget` on the browser session, and a command on the ended session fails with
 *   `SessionEnded` whose `why` is `detached`, where Puppeteer's message says "Session closed.". The port asserts Strider's
 *   typed reason.
 * - "should throw nice errors" checks the command's name in the error message. Puppeteer's check that the error's JS stack
 *   names the calling function is Puppeteer's own wrapping for JavaScript callers, which Strider's typed error doesn't carry.
 * - "should respect custom timeout" passes `timeout: 50` as `Protocol.withCommandTimeout("50 millis")`. The port asserts the
 *   typed `NoReply` naming the method and budget, where Puppeteer matches its `protocolTimeout` hint.
 * - Puppeteer's `page.evaluate` runs in the main world; the port reads `window.foo` with `page.evaluateInMainWorld`.
 * - "should be able to detach session" also keeps Puppeteer's first evaluation, which returns 3 before the detach.
 * - The tests that need features Strider lacks are not ported; the ledger says why each is.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, type Page } from "@usestrider/browser"
import { Network, Runtime, Target } from "@usestrider/browser/cdp"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { failureOf } from "../../harness/playwright.ts"
import { runnerChromiumArgs } from "../../harness/puppeteer.ts"
import { upstream } from "../../harness/upstream.ts"

/** The debugging port the browser listens on. */
const debuggingPort = 9451

/** The browser's arguments: Puppeteer's runner arguments, and the debugging port. */
const chromiumArgs = [...runnerChromiumArgs, `--remote-debugging-port=${debuggingPort}`]

/** Runs `body` on a raw CDP connection to the browser's debugging port, closed when the body ends. */
const withBrowserConnection = <A, E, R>(body: (cdp: CdpConnection.CdpConnection) => Effect.Effect<A, E, R>) =>
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
  })).pipe(Effect.provide(NodeSocket.layerWebSocketConstructor))

/** A page in the default context, at `url`, once it has loaded. */
const pageAt = Effect.fnUntraced(function*(url: string) {
  const browser = yield* Browser.Browser
  const page = yield* browser.defaultContext.control.pipe(Effect.flatMap((context) => context.newPage))
  yield* page.goto(url, { waitUntil: "load" })
  return page
})

/** The session the original's `page.createCDPSession()` gives: a session on the target of the page that shows `url`. */
const sessionFor = Effect.fnUntraced(function*(cdp: CdpConnection.CdpConnection, url: string) {
  const { targetInfos } = yield* Target.getTargets().pipe(Protocol.on(cdp.browser))
  const target = targetInfos.find((info) => info.type === "page" && info.url === url)
  assert.isDefined(target, `no page target shows ${url}`)
  const { sessionId } = yield* Target.attachToTarget({ targetId: target!.targetId, flatten: true }).pipe(
    Protocol.on(cdp.browser)
  )
  return { session: yield* cdp.session(sessionId), sessionId }
})

/** Puppeteer's `page.evaluate(() => globalThis.foo)`, in the page's main world. */
const readFoo = (page: Page.Page) => page.evaluateInMainWorld(() => (globalThis as unknown as { foo: unknown }).foo)

/** A command no domain defines, as the original's `client.send('ThisCommand.DoesNotExist')`. */
const doesNotExist = Protocol.command("ThisCommand.DoesNotExist", undefined, undefined, { status: "experimental" })

const hang = Runtime.evaluate({ expression: "new Promise(() => {})", awaitPromise: true })

/** The reason a protocol call failed, which the call must have failed with. */
const reasonOf = (failure: unknown) => {
  assert.isTrue(Protocol.isProtocolError(failure), String(failure))
  return (failure as Protocol.ProtocolError).reason
}

upstream(import.meta.filename, { browsers: ["chromium"], launch: { chromium: { args: chromiumArgs } } }, (test) => {
  test(
    "Target.createCDPSession should work",
    { page: false },
    ({ server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          const page = yield* pageAt(server.EMPTY_PAGE)
          const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
          yield* Effect.all([
            Runtime.enable().pipe(Protocol.on(session)),
            Runtime.evaluate({ expression: "window.foo = \"bar\"" }).pipe(Protocol.on(session))
          ], { concurrency: "unbounded" })
          assert.strictEqual(yield* readFoo(page), "bar")
        })
      )
  )

  test(
    "Target.createCDPSession should send events",
    { page: false },
    ({ server }) =>
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
      )
  )

  test(
    "Target.createCDPSession should be able to detach session",
    { page: false },
    ({ server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          yield* pageAt(server.EMPTY_PAGE)
          const { session, sessionId } = yield* sessionFor(cdp, server.EMPTY_PAGE)
          yield* Runtime.enable().pipe(Protocol.on(session))
          const evaluated = yield* Runtime.evaluate({ expression: "1 + 2", returnByValue: true }).pipe(
            Protocol.on(session)
          )
          assert.strictEqual(evaluated.result.value, 3)
          // The original's `client.detach()`
          yield* Target.detachFromTarget({ sessionId }).pipe(Protocol.on(cdp.browser))
          const failure = yield* failureOf(
            Runtime.evaluate({ expression: "3 + 1", returnByValue: true }).pipe(Protocol.on(session)),
            "the evaluation on a detached session"
          )
          const reason = reasonOf(failure)
          if (reason._tag !== "SessionEnded") assert.fail(reason.message)
          assert.strictEqual(reason.why, "detached")
        })
      )
  )

  test(
    "Target.createCDPSession should throw nice errors",
    { page: false },
    ({ server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          yield* pageAt(server.EMPTY_PAGE)
          const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
          const failure = yield* failureOf(doesNotExist().pipe(Protocol.on(session)), "the command no domain defines")
          const reason = reasonOf(failure)
          assert.include(reason.message, "ThisCommand.DoesNotExist")
        })
      )
  )

  test(
    "Target.createCDPSession should respect custom timeout",
    { page: false },
    ({ server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          yield* pageAt(server.EMPTY_PAGE)
          const { session } = yield* sessionFor(cdp, server.EMPTY_PAGE)
          const failure = yield* failureOf(
            hang.pipe(Protocol.on(session), Protocol.withCommandTimeout("50 millis")),
            "the evaluation of a promise that never settles"
          )
          const reason = reasonOf(failure)
          assert.strictEqual(reason._tag, "NoReply")
          assert.include(reason.message, "Runtime.evaluate got no reply within 50ms")
        })
      )
  )
})
