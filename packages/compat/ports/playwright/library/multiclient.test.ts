/**
 * Playwright's `tests/library/multiclient.spec.ts`: two clients attached to one running Chromium, and what each sees
 * of the browser's pages, routes, init scripts, and recordings.
 *
 * What the port changes:
 * - Playwright's `remoteServer` is a browser server the clients connect to by WebSocket. Strider has no server of its
 *   own: the host is a Chromium the harness launches with `--remote-debugging-port` (`host`), and each client is a
 *   `Chromium.layerConnect` to its endpoint (`connect`). A client's scope is its connection: closing it is the
 *   original's `browser.close()`, and it's `disconnect`.
 * - The original's `twoPages` fixture makes pageA in its client's context, and pageB is the same page as the second
 *   client sees it, the first page of the shared context. Strider reports every page to every connection as an observed
 *   page, so `pageB` is that page's `control`. A page's id belongs to its connection, so `twoPages` finds the page by
 *   its URL: pageA first navigates to `about:blank#client-a`, which the host's first tab doesn't show.
 * - A page or context a connection creates closes with that connection's scope, where Playwright's survive their
 *   client's disconnect. The ports that disconnect a client keep the test's steps, which check what the other client
 *   sees once it's gone.
 * - `disconnect` waits a second for the browser to clean up, as the original does; the port keeps that wait.
 * - Each client's scoped calls (`newContext`, `newPage`, `emulate`, `addInitScript`, `route`, `control`) run under that
 *   client's scope, so they end with it. Playwright's `page.setDefaultTimeout` is a default budget for a call, which is
 *   `defaultTimeout` (MC-003).
 * - `page.goto` resolves at commit; the original's `goto` waits for `load`, so the port asks for `load`.
 * - `page.evaluate` runs in the main world, so it's `page.evaluateInMainWorld`.
 * - MC-003 and MC-004 check what the original checks: the timeout's budget, and the viewport the other client reads.
 * - MC-008 has Strider's `media.type` in place of `emulateMedia({ media })`.
 * - MC-009 and MC-010 route with `page.route` and a glob, and check the request's URL in the handler, where Playwright's
 *   `**\/foo` pattern matches it. A route that stalls is one that never decides, as Playwright's does by returning without
 *   a route call. MC-010 is an `it.fixme`, ported as the others: the fallback that changes the URL is
 *   `Route.continueWith` with the request's URL set.
 * - MC-013 registers its init scripts under each client's scope; a client's scripts end when its scope does. A context's
 *   script on an attached Chromium can't be guaranteed to run before the page's own scripts, so the port asks for
 *   `timing: "bestEffort"`; the test reads the values after a navigation and doesn't depend on that order.
 * - MC-016 waits as `Expect.that` over `evaluateInMainWorld` with a condition that never holds, checked every
 *   millisecond (`Expect.withCheckInterval`) under the original's 10 second timeout, where Playwright's
 *   `waitForFunction` polls in the browser. The original's console counter is a `ConsoleMessage.stream` on the other
 *   client's page.
 * - MC-018 starts a recording, `Trace.record`, where the original starts context tracing. Strider's recordings are
 *   independent, so a second recording on the same context is not refused, and the assertion that it is fails.
 * - MC-014 registers a locator handler on the first client's page under that client's scope, which ends with it: the
 *   second client's click is covered by the interstitial and nothing in its timeout names a handler.
 * - MC-020 creates the first client's context and page in the test's own scope, not the client's, since a page closes with
 *   the scope it was created in and the test needs the page to outlive the first client's connection; the reconnecting
 *   client finds it by its address, as `twoPages` does. The first client's locator handler stays in its own scope.
 * - MC-015 and MC-019 aren't ported (see the ledger): MC-015 is Playwright's server protocol, and MC-019 uses the
 *   internal `_startRecording` hook.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, Condition, ConsoleMessage, Deadline, Expect, Page, Route, Target, Trace } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { HttpClientRequest, HttpServerResponse } from "effect/http"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { backend } from "../../harness/browsers.ts"
import { defaultTimeout, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The debugging port the host Chromium listens on. Each host stops before the next one starts. */
const debuggingPort = 9340

/** The host's endpoint, which each client connects to. */
const endpoint = `http://127.0.0.1:${debuggingPort}/`

/** A client: its browser, and the scope its connection lives in. */
interface Client {
  readonly browser: Browser.Browser
  readonly scope: Scope.Closeable
}

/** Runs `body` on a host Chromium the original launches with `--remote-debugging-port`, stopped when `body` ends. */
const host = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.scoped(body).pipe(
    Effect.provide(backend("chromium", {
      chromium: { args: [`--remote-debugging-port=${debuggingPort}`] }
    }))
  )

/** A client's connection to the host, in a scope of its own. The test's scope closes it if it's still open at the end. */
const connect = Effect.fnUntraced(function*() {
  const scope = yield* Scope.make()
  const services = yield* Layer.buildWithScope(
    Chromium.layerConnect(endpoint).pipe(
      Layer.provide(Layer.mergeAll(NodeSocket.layerWebSocketConstructor, NodeServices.layer))
    ),
    scope
  )
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  return { browser: Context.get(services, Browser.Browser), scope } satisfies Client
})

/** The original's `browser.close()`, which disconnects the client and waits a second for its cleanup. */
const disconnect = (client: Client) =>
  Scope.close(client.scope, Exit.void).pipe(
    // Playwright gives the disconnect some time to clean up, and the port keeps that wait.
    Effect.andThen(Effect.sleep("1 second"))
  )

/** Where the first client's page sits, so the second client can tell it from the host's first tab. */
const marker = "about:blank#client-a"

/** The page `client` shares with the other client: the first context's page, which `pageA` is. */
const twoPages = Effect.fnUntraced(function*() {
  const clientA = yield* connect()
  const contextA = yield* clientA.browser.newContext().pipe(Scope.provide(clientA.scope))
  const pageA = yield* contextA.newPage.pipe(Scope.provide(clientA.scope))

  // A page's id is its connection's own handle, so the second client finds the page by what it shows. The host's first
  // tab is about:blank as well, and the first client's page is the one at this address.
  yield* pageA.goto(marker, { waitUntil: "load" })

  const clientB = yield* connect()
  let observed: Page.ObservedPage | undefined
  for (const page of yield* clientB.browser.pages) {
    if ((yield* page.url) === marker) observed = page
  }
  assert.isDefined(observed, "the second client doesn't see the first client's page")
  const pageB = yield* observed!.control.pipe(Scope.provide(clientB.scope))
  return { clientA, clientB, pageA, pageB, contextA }
})

/** A click that the original expects to time out: its `Deadline.Timeout` names the budget it ran under. */
const timedOut = (error: unknown, budget: number) => {
  assert(Deadline.isTimeout(error), String(error))
  assert.strictEqual(error.operation, "Locator.click")
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
}

/** The page's viewport as Strider reports it, or undefined when it's not set. */
const viewportOf = (page: Page.ReadonlyPage) => page.viewportSize.pipe(Effect.map(Option.getOrUndefined))

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("MC-003", { page: false }, () =>
    host(Effect.gen(function*() {
      const { pageA, pageB } = yield* twoPages()
      // setDefaultTimeout(500) on pageA and setDefaultTimeout(600) on pageB: each click runs under its own budget
      const [errorA, errorB] = yield* Effect.all([
        failureOf(pageA.locator("div").click().pipe(defaultTimeout(500)), "pageA's click"),
        failureOf(pageB.locator("div").click().pipe(defaultTimeout(600)), "pageB's click")
      ], { concurrency: "unbounded" })
      timedOut(errorA, 500)
      timedOut(errorB, 600)
    })))

  test("MC-004", { page: false }, () =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageA, pageB } = yield* twoPages()

      yield* pageA.emulate({ viewport: { width: 567, height: 456 } }).pipe(Scope.provide(clientA.scope))
      assert.deepStrictEqual(yield* viewportOf(pageA), { width: 567, height: 456 })
      yield* Expect.that(
        pageB.viewportSize,
        Condition.make(
          "the viewport is 567 by 456",
          (size: Option.Option<{ readonly width: number; readonly height: number }>) =>
            Option.isSome(size) && size.value.width === 567 && size.value.height === 456
        )
      )

      yield* pageB.emulate({ viewport: { width: 456, height: 567 } }).pipe(Scope.provide(clientB.scope))
      assert.deepStrictEqual(yield* viewportOf(pageB), { width: 456, height: 567 })
      yield* Expect.that(
        pageA.viewportSize,
        Condition.make(
          "the viewport is 456 by 567",
          (size: Option.Option<{ readonly width: number; readonly height: number }>) =>
            Option.isSome(size) && size.value.width === 456 && size.value.height === 567
        )
      )
    })))

  test("MC-008", { page: false }, () =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageA, pageB } = yield* twoPages()
      yield* pageA.emulate({ media: { type: "print" } }).pipe(Scope.provide(clientA.scope))
      assert.strictEqual(yield* pageB.evaluateInMainWorld(() => window.matchMedia("screen").matches), false)
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => window.matchMedia("print").matches), true)
      yield* pageB.emulate({ media: { type: "screen" } }).pipe(Scope.provide(clientB.scope))
      assert.strictEqual(yield* pageB.evaluateInMainWorld(() => window.matchMedia("screen").matches), true)
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => window.matchMedia("print").matches), false)
    })))

  test("MC-009", { page: false }, ({ server }) =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageA, pageB } = yield* twoPages()

      server.setRoute("/foo", (_req, res) =>
        res.writeHead(200, { "Content-Type": "text/html" }).end("<div>server-foo</div>"))
      server.setRoute("/bar", (_req, res) =>
        res.writeHead(200, { "Content-Type": "text/html" }).end("<div>server-bar</div>"))
      server.setRoute("/qux", (_req, res) =>
        res.writeHead(200, { "Content-Type": "text/html" }).end("<div>server-qux</div>"))

      // Playwright's `stall` flag: once set, the first route for `/foo` reports that it stalled and never answers.
      let stall = false
      const stalled = yield* Deferred.make<void>()
      const html = (body: string) =>
        Route.fulfill(HttpServerResponse.html(body))
      yield* pageA.route("**/foo", () =>
        stall
          ? Deferred.succeed(stalled, undefined).pipe(Effect.andThen(Effect.never))
          : Route.fallthrough).pipe(Scope.provide(clientA.scope))
      yield* pageA.route("**/bar", () =>
        html("<div>intercepted-bar</div>")).pipe(Scope.provide(clientA.scope))

      yield* pageB.route("**/foo", () =>
        html("<div>intercepted2-foo</div>")).pipe(Scope.provide(clientB.scope))
      yield* pageB.route("**/bar", () =>
        html("<div>intercepted2-bar</div>")).pipe(Scope.provide(clientB.scope))
      yield* pageB.route("**/qux", () =>
        html("<div>intercepted2-qux</div>")).pipe(Scope.provide(clientB.scope))

      yield* pageA.goto(server.PREFIX + "/foo", { waitUntil: "load" })
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted2-foo")

      yield* pageA.goto(server.PREFIX + "/bar", { waitUntil: "load" })
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted-bar")

      yield* pageA.goto(server.PREFIX + "/qux", { waitUntil: "load" })
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted2-qux")

      stall = true
      const goto = yield* startWaiting(pageB.goto(server.PREFIX + "/foo", { waitUntil: "load" }))
      yield* Deferred.await(stalled)
      yield* disconnect(clientA)

      yield* Fiber.join(goto.fiber)
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted2-foo")

      yield* pageB.goto(server.PREFIX + "/bar", { waitUntil: "load" })
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted2-bar")
    })))

  // An it.fixme in the original: its fallback changes the request's URL, and the port keeps that check.
  test("MC-010", { page: false }, ({ server }) =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageA, pageB } = yield* twoPages()

      server.setRoute("/foo", (_req, res) =>
        res.writeHead(200, { "Content-Type": "text/html" }).end("<div>server-foo</div>"))
      server.setRoute("/baz", (_req, res) =>
        res.writeHead(200, { "Content-Type": "text/html" }).end("<div>server-baz</div>"))

      // route.fallback({ url }) is `Route.continueWith` with the request's URL changed to the one the original names
      yield* pageA.route("**/foo", () =>
        Route.continueWith((request) =>
          HttpClientRequest.setUrl(request, server.PREFIX + "/baz")
        )).pipe(
          Scope.provide(clientA.scope)
        )
      yield* pageB.route("**/baz", () =>
        Route.fulfill(HttpServerResponse.html("<div>intercepted2-baz</div>"))).pipe(
          Scope.provide(clientB.scope)
        )

      yield* pageA.goto(server.PREFIX + "/foo", { waitUntil: "load" })
      yield* Expect.toHaveText(pageB.locator("div"), "intercepted2-baz")
    })))

  test("MC-013", { page: false }, ({ server }) =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageA, pageB, contextA } = yield* twoPages()

      yield* pageA.addInitScript({ source: "window.pageValueA = 'pageValueA'" }).pipe(Scope.provide(clientA.scope))
      yield* contextA.addInitScript({ source: "window.contextValueA = 'contextValueA'" }, { timing: "bestEffort" })
        .pipe(
          Scope.provide(clientA.scope)
        )
      yield* pageB.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* pageB.evaluateInMainWorld(() => (window as any).pageValueA), "pageValueA")
      assert.strictEqual(yield* pageB.evaluateInMainWorld(() => (window as any).contextValueA), "contextValueA")

      const pageContextB = yield* pageB.context.control.pipe(Scope.provide(clientB.scope))
      yield* pageB.addInitScript({ source: "window.pageValueB = 'pageValueB'" }).pipe(Scope.provide(clientB.scope))
      yield* pageContextB.addInitScript({ source: "window.contextValueB = 'contextValueB'" }, { timing: "bestEffort" })
        .pipe(
          Scope.provide(clientB.scope)
        )
      yield* pageA.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).pageValueB), "pageValueB")
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).contextValueB), "contextValueB")

      yield* disconnect(clientB)

      yield* pageA.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).pageValueB), undefined)
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).contextValueB), undefined)
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).pageValueA), "pageValueA")
      assert.strictEqual(yield* pageA.evaluateInMainWorld(() => (window as any).contextValueA), "contextValueA")
    })))

  test("MC-014", { page: false }, ({ server }) =>
    host(Effect.gen(function*() {
      const { clientA, pageA, pageB } = yield* twoPages()

      yield* pageA.goto(server.PREFIX + "/input/handle-locator.html", { waitUntil: "load" })

      let count = 0
      yield* pageA.addLocatorHandler(pageA.getByText("This interstitial covers the button"), () =>
        Effect.gen(function*() {
          ++count
          yield* pageA.locator("#close").click()
        })).pipe(Scope.provide(clientA.scope))

      yield* pageA.locator("#aside").hover()
      yield* pageA.evaluateInMainWorld(() => {
        ;(window as any).clicked = 0
        ;(window as any).setupAnnoyingInterstitial("mouseover", 1)
      })
      yield* pageA.locator("#target").click()
      assert.strictEqual(count, 1)
      assert.strictEqual(
        yield* pageB.evaluateInMainWorld(() =>
          (window as any).clicked
        ),
        1
      )
      yield* Expect.toBeHidden(pageB.locator("#interstitial"))

      yield* pageA.locator("#aside").hover()
      yield* pageA.evaluateInMainWorld(() => {
        ;(window as any).clicked = 0
        ;(window as any).setupAnnoyingInterstitial("mouseover", 1)
      })

      yield* disconnect(clientA)

      const error = yield* failureOf(
        pageB.locator("#target").click().pipe(Deadline.within("3 seconds")),
        "pageB's click"
      )
      timedOut(error, 3000)
      // "intercepts pointer events", and nothing of a locator handler: the first client's handler is gone with it
      assert(Deadline.isTimeout(error))
      const reason = Option.getOrUndefined(Option.map(error.last, (observed) => observed.value as { _tag: string }))
      assert.strictEqual(reason?._tag, "Covered")
      assert.notInclude(error.message, "locator handler")
      assert.notInclude(Option.getOrElse(error.hint, () => ""), "locator handler")
    })))

  test("MC-016", { page: false }, () =>
    host(Effect.gen(function*() {
      const { clientA, pageA, pageB } = yield* twoPages()

      // `pageB.on('console', …)`: a count of the messages B's client receives, from before A's loop starts
      let counter = 0
      const messages = yield* ConsoleMessage.stream(pageB)
      yield* Effect.forkScoped(Stream.runForEach(messages, () => Effect.sync(() => ++counter)))

      // pageA.waitForFunction(…, { polling: 1, timeout: 10000 }): the check runs every millisecond until the client is gone
      const never = Condition.make("never", (_value: unknown) => false)
      const polling = yield* Effect.forkChild(
        Expect.that(
          pageA.evaluateInMainWorld(() => {
            ;(window as any).counter = ((window as any).counter || 0) + 1
            console.log((window as any).counter)
            return false
          }),
          never
        ).pipe(Expect.withCheckInterval("1 millis"), Deadline.within("10 seconds")),
        { startImmediately: true }
      )

      yield* disconnect(clientA)
      const error = yield* Fiber.join(polling).pipe(Effect.flip)
      const savedCounter = counter

      // Give it some time to produce more logs.
      yield* Effect.sleep("2 seconds")

      assert(Target.isTargetGone(error), `the wait ended for another reason: ${String(error)}`)
      assert.strictEqual(counter, savedCounter)
    })))

  test("MC-020", { page: false }, ({ server }) =>
    host(Effect.gen(function*() {
      const clientA = yield* connect()
      // The original's `browser.newPage()` is a page that outlives its client. Strider closes a page with the scope it
      // was created in, so the port creates it in the test's own scope, which outlives the first client's connection, and
      // the reconnecting client finds it again by its address.
      const context = yield* clientA.browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/handle-locator.html", { waitUntil: "load" })

      let called = 0
      yield* page.addLocatorHandler(page.getByText("This interstitial covers the button"), () =>
        Effect.gen(function*() {
          ++called
          return yield* Effect.never
        })).pipe(Scope.provide(clientA.scope))
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).setupAnnoyingInterstitial("none", 1)
      })
      const error = yield* failureOf(
        page.locator("#target").click().pipe(Deadline.within("1 second")),
        "the first client's click"
      )
      timedOut(error, 1000)
      assert.strictEqual(called, 1)

      yield* disconnect(clientA)

      const clientB = yield* connect()
      let observed: Page.ObservedPage | undefined
      for (const candidate of yield* clientB.browser.pages) {
        if ((yield* candidate.url).endsWith("/input/handle-locator.html")) observed = candidate
      }
      assert.isDefined(observed, "the reconnected client doesn't see the first client's page")
      const reconnected = yield* observed!.control.pipe(Scope.provide(clientB.scope))
      yield* reconnected.addLocatorHandler(reconnected.getByText("This interstitial covers the button"), () =>
        reconnected.locator("#close").click()).pipe(Scope.provide(clientB.scope))
      yield* reconnected.locator("#target").click().pipe(Deadline.within("3 seconds"))
      assert.strictEqual(
        yield* reconnected.evaluateInMainWorld(() =>
          (window as any).clicked
        ),
        1
      )
    })))

  test("MC-018", { page: false }, () =>
    host(Effect.gen(function*() {
      const { clientA, clientB, pageB, contextA } = yield* twoPages()

      // context.tracing.start() on A's context, which A's connection owns
      yield* Trace.record(contextA).pipe(Scope.provide(clientA.scope))
      // B's second start on the same context: Playwright refuses it, "Tracing has been already started"
      const recordingB = yield* Trace.record(pageB.context).pipe(Scope.provide(clientB.scope), Effect.result)
      assert(Result.isFailure(recordingB), "the second client's recording started, where Playwright refuses it")
      assert.include(String(recordingB.failure), "already")

      yield* disconnect(clientA)

      yield* Trace.record(pageB.context).pipe(Scope.provide(clientB.scope))
    })))
})
