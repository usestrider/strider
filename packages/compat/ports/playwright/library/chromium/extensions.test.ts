/**
 * Playwright's `tests/library/chromium/extensions.spec.ts`: Chromium extensions loaded with `--load-extension`, their
 * service workers, and what those workers' requests and console messages show. Chromium only.
 *
 * What the port changes:
 * - `launchPersistentContext(extension, options)` is a Chromium launched with the extension's `--load-extension` and
 *   `--disable-extensions-except` arguments (`launch.args`), on a profile Strider makes and removes, whose default
 *   context is the one the original's persistent context is. The browser closes when the test's body ends. Each test
 *   launches its own browser, as the original's persistent context is its own.
 * - The extension's service worker is the context's worker of kind `service`: the one it has, else the next one, as
 *   `context.serviceWorkers()[0]` or `waitForEvent('serviceworker')` gives. Its script runs with `BrowserWorker.evaluate`,
 *   which is Strider's evaluation in a worker (`globalThis` is the worker's global).
 * - `context.waitForEvent('request' | 'response')` is `NetworkRequest.next` and `NetworkResponse.next` on the context,
 *   subscribed before the worker's fetch, with the body decoder that `postData()` and `text()` read through.
 *   `response.request()` is the same request: Strider's response names its request's hop, so the port compares hops.
 * - `request.allHeaders()` is the headers the browser sent (`NetworkRequest.headersSent`).
 * - The service worker's `fetch` is a statement in an async function, so the call returns nothing: a `Response` doesn't
 *   cross as a value, and Playwright's `evaluate` serializes it to nothing the test reads.
 * - `context.newPage()` on the controlled default context is `context.newPage`, and the page's console is
 *   `ConsoleMessage.next(page)`, subscribed before `goto`.
 * - `launchPersistentContext(..., { userAgent })` is `context.emulate({ userAgent })`, declared on the controlled context
 *   after its profile's first tab exists, rather than at launch. The tab does not carry the declaration into the worker
 *   unless the browser applies it there.
 * - `page.goto` waits for `load` in Playwright and returns at commit in Strider, so the navigations name `waitUntil: "load"`.
 * - CR-036's `context.newCDPSession(page)` is a connection of the port's own to the browser's debugging port
 *   (`CdpConnection.make` over `Transport.webSocket`) with a session attached to the page's target, as in
 *   `chromium/session.test.ts`; `cdp.on(event)` is `session.subscribe(event)`, subscribed before the command that makes the
 *   event. Where it checks `context.serviceWorkers()` is still `[sw1]`, the port checks the context's service-worker history
 *   is still that one worker (the same realm).
 * - CR-037 is ported without its last line, `backgroundPages()`, which Strider's UserContext doesn't have
 *   (`method-browsercontext-backgroundpages`); a ported test has no ledger entry. CR-038 (`recordVideo` on a persistent
 *   context) needs a feature Strider doesn't have, so it's in the ledger.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import {
  Browser,
  BrowserWorker,
  Condition,
  ConsoleMessage,
  Expect,
  NetworkRequest,
  NetworkResponse,
  type UserContext
} from "@usestrider/browser"
import { ServiceWorker, Target } from "@usestrider/browser/cdp"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { backend } from "../../../harness/browsers.ts"
import { assetPath } from "../../../harness/playwright.ts"
import { upstream } from "../../../harness/upstream.ts"

/**
 * Runs `body` in a Chromium that loads one extension, with the browser's default context controlled for the body. The
 * browser closes when the body ends.
 */
const withExtension = <A, E, R>(
  extension: string,
  body: (context: UserContext.UserContext) => Effect.Effect<A, E, R>,
  debuggingPort?: number
) => {
  const directory = assetPath("playwright", extension)
  const run = Effect.fnUntraced(function*() {
    const browser = yield* Browser.Browser
    return yield* Effect.scoped(browser.defaultContext.control.pipe(Effect.flatMap(body)))
  })
  return run().pipe(
    Effect.provide(Layer.mergeAll(
      NodeSocket.layerWebSocketConstructor,
      backend("chromium", {
        chromium: {
          args: [
            `--disable-extensions-except=${directory}`,
            `--load-extension=${directory}`,
            ...(debuggingPort === undefined ? [] : [`--remote-debugging-port=${debuggingPort}`])
          ]
        }
      })
    ))
  )
}

/**
 * The extension's service worker: the context's, if it has one already, else the next one that starts. Playwright reads
 * `serviceWorkers()[0]` or waits for `serviceworker`, which this does in the same order.
 */
const serviceWorkerOf = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const existing = (yield* BrowserWorker.history(context, { kind: "service" })).entries
  if (existing.length > 0) return existing[0]!
  const started = yield* BrowserWorker.next(context, { kind: "service" })
  return yield* started
})

/** The debugging port CR-036's browser listens on. */
const debuggingPort = 9442

/** The first event of `events` whose params satisfy `predicate`, among those the session received after subscribing. */
const firstWhere = <A, E, R>(events: Stream.Stream<A, E, R>, predicate: (params: A) => boolean) =>
  events.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap(Option.match({
      onNone: () => Effect.die("the session ended before the event"),
      onSome: Effect.succeed
    }))
  )

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test(
    "CR-036",
    { page: false },
    () =>
      withExtension("extension-mv3-sw-lifecycle", (context) =>
        Effect.gen(function*() {
          const sw1 = yield* serviceWorkerOf(context)
          const startTime1 = yield* sw1.evaluate(() => (globalThis as unknown as { startTime: number }).startTime)

          // `context.newCDPSession(page)`: a connection to the browser, with a session on the page's target
          const page = yield* context.newPage
          yield* page.goto("about:blank", { waitUntil: "load" })
          const json = yield* Effect.promise(() =>
            fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) =>
              response.json() as Promise<unknown>
            )
          )
          const { webSocketDebuggerUrl } = Schema.decodeUnknownSync(
            Schema.Struct({ webSocketDebuggerUrl: Schema.String })
          )(json)
          const transport = yield* Transport.webSocket(webSocketDebuggerUrl)
          const cdp = yield* CdpConnection.make(transport)
          const { targetInfos } = yield* Target.getTargets().pipe(Protocol.on(cdp.browser))
          const target = targetInfos.find((info) => info.type === "page" && info.url === "about:blank")
          assert.isDefined(target, "no page target shows about:blank")
          const { sessionId } = yield* Target.attachToTarget({ targetId: target!.targetId, flatten: true }).pipe(
            Protocol.on(cdp.browser)
          )
          const session = yield* cdp.session(sessionId)

          // The listeners exist before the command that makes the event, as the original's `waitForCdpEvent` ones do
          const firstVersion = yield* session.subscribe(ServiceWorker.workerVersionUpdated)
          const firstRegistration = yield* session.subscribe(ServiceWorker.workerRegistrationUpdated)
          yield* ServiceWorker.enable().pipe(Protocol.on(session))
          const version = yield* firstWhere(firstVersion, ({ versions }) => versions[0]?.versionId !== undefined)
          const registration = yield* firstWhere(
            firstRegistration,
            ({ registrations }) => registrations[0]?.scopeURL !== undefined
          )
          const versionId = version.versions[0]!.versionId
          const scopeURL = registration.registrations[0]!.scopeURL

          // `stopWorker` keeps the same CDP target alive, matching Chrome's natural idle suspension behavior
          const stopped = yield* session.subscribe(ServiceWorker.workerVersionUpdated)
          yield* ServiceWorker.stopWorker({ versionId }).pipe(Protocol.on(session))
          yield* firstWhere(stopped, ({ versions }) => versions[0]?.runningStatus === "stopped")

          const running = yield* session.subscribe(ServiceWorker.workerVersionUpdated)
          yield* ServiceWorker.startWorker({ scopeURL }).pipe(Protocol.on(session))
          yield* firstWhere(running, ({ versions }) => versions[0]?.runningStatus === "running")

          const startTime2 = yield* sw1.evaluate(() => (globalThis as unknown as { startTime: number }).startTime)
          assert.isAbove(startTime2, startTime1)
          // `context.serviceWorkers()` is still `[sw1]`: the same worker, and no new one
          const workers = (yield* BrowserWorker.history(context, { kind: "service" })).entries
          assert.strictEqual(workers.length, 1)
          assert.strictEqual(workers[0]!.realm, sw1.realm)
        }), debuggingPort)
  )

  test(
    "CR-037",
    { page: false },
    () =>
      withExtension("extension-mv3-simple", (context) =>
        Effect.gen(function*() {
          const serviceWorker = yield* serviceWorkerOf(context)
          const workers = (yield* BrowserWorker.history(context, { kind: "service" })).entries
          assert.isTrue(workers.some((worker) => worker.realm === serviceWorker.realm))
          // `expect.poll(() => serviceWorker.evaluate(() => globalThis.MAGIC)).toBe(42)`
          yield* Expect.that(
            serviceWorker.evaluate(() => (globalThis as unknown as { MAGIC: number }).MAGIC),
            Condition.make("the worker's MAGIC is 42", (magic) => magic === 42)
          )
        }))
  )

  test(
    "CR-039",
    { page: false },
    ({ server }) =>
      withExtension("extension-mv3-simple", (context) =>
        Effect.gen(function*() {
          server.setRoute("/empty.html", (_request, response) => {
            response.writeHead(200, { "Content-Type": "text/html", "x-response-foobar": "BarFoo" })
            response.end("<span>hello world!</span>")
          })
          const serviceWorker = yield* serviceWorkerOf(context)
          assert.match(String(serviceWorker.url), /chrome-extension:\/\/.*/)
          // `Promise.all([waitForEvent('request'), waitForEvent('response'), serviceWorker.evaluate(fetch)])`: all subscribed first
          const requested = yield* NetworkRequest.next(context, {
            url: server.EMPTY_PAGE,
            body: (message) => message.text
          })
          const responded = yield* NetworkResponse.next(context, {
            url: server.EMPTY_PAGE,
            body: (message) => message.text
          })
          yield* serviceWorker.evaluate(async (url) => {
            await fetch(url, { method: "POST", body: "foobar", headers: { "X-FOOBAR": "KEKBAR" } })
          }, server.EMPTY_PAGE)
          const request = yield* requested
          const response = yield* responded

          assert.strictEqual(String(request.url), server.EMPTY_PAGE)
          assert.strictEqual(request.method, "POST")
          // `request.allHeaders()`: the headers the browser sent, lowercased as the original's are
          const sent = yield* NetworkRequest.headersSent(context, request)
          assert.strictEqual(sent["x-foobar"], "KEKBAR")
          assert.strictEqual(Option.getOrUndefined(request.body), "foobar")

          assert.strictEqual(response.status, 200)
          assert.strictEqual(String(response.url), server.EMPTY_PAGE)
          // `response.request()` is the request: its hop is the request's
          assert.strictEqual(response.hop, request.hop)
          assert.strictEqual(response.body, "<span>hello world!</span>")
          assert.strictEqual(response.headers["x-response-foobar"], "BarFoo")
        }))
  )

  test(
    "CR-040",
    { page: false },
    ({ server }) =>
      withExtension("extension-mv3-with-logging", (context) =>
        Effect.scoped(Effect.gen(function*() {
          const page = yield* context.newPage
          // The console wait is subscribed before the navigation, as `page.waitForEvent('console', predicate)` is
          const logged = yield* ConsoleMessage.next(page, {
            text: /Test console log from a third-party execution context/
          })
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const message = yield* logged
          assert.include(message.text, "Test console log from a third-party execution context")
        })))
  )

  test(
    "CR-041",
    { page: false },
    ({ server }) =>
      withExtension("extension-mv3-simple", (context) =>
        Effect.gen(function*() {
          server.setRoute("/ua-echo", (request, response) => {
            response.writeHead(200, { "Content-Type": "text/plain" })
            response.end(request.headers["user-agent"])
          })
          // Playwright's `userAgent` option, declared on the controlled context before the worker fetches
          yield* context.emulate({ userAgent: "MyTestAgent/1.0" })
          const serviceWorker = yield* serviceWorkerOf(context)
          const userAgent = yield* serviceWorker.evaluate(async (url) => {
            const response = await fetch(url)
            return response.text()
          }, server.PREFIX + "/ua-echo")
          assert.strictEqual(userAgent, "MyTestAgent/1.0")
        }))
  )
})
