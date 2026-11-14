/**
 * Puppeteer's `test/src/connect.test.ts`: connecting to a running browser by its endpoint, and the failure of a connect
 * to a browser that isn't there.
 *
 * What the port changes:
 * - The host is a browser the test launches with `--remote-debugging-port`, and each client is a `Chromium.layerConnect`
 *   or `Firefox.layerConnect` to its endpoint, in a scope of its own, which is the client's `disconnect()`. The host keeps
 *   running after a client disconnects.
 * - Puppeteer's `browser.newPage()` opens its page in the browser's default context, so `defaultPage` does the same, in
 *   the connection's scope.
 * - Puppeteer's `browserURL` is Chromium's HTTP DevTools endpoint, which Puppeteer reads the WebSocket endpoint from.
 *   Chromium's connect takes that URL, with or without a trailing slash, so the first test runs on Chromium. Firefox's
 *   connect takes its WebSocket endpoint and has no `browserURL` to test.
 * - "should throw when using both browserWSEndpoint and browserURL" is not ported: Strider's connect takes one endpoint,
 *   so the combination can't be written (the ledger says so).
 * - "should throw when trying to connect to non-existing browser" connects to a port nothing listens on. A failed
 *   connect is a `BrowserError` whose reason is `ConnectionFailed`, which the port checks, where Puppeteer checks its own
 *   message. Firefox's endpoint is the WebSocket URL of the same port.
 * - Stock WebKit has no connect (`method-browsertype-connect`), so the third test runs on Chromium and Firefox, and the
 *   ledger marks WebKit.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { backend, type BrowserName, type Launch } from "../harness/browsers.ts"
import { failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** The port the host browser listens on. Each test's host stops before the next one starts. */
const hostPort = 21222

/** A browser the test launches and closes itself, in a scope of its own. */
const launchOwn = Effect.fnUntraced(function*(name: BrowserName, launch: Launch) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const services = yield* Layer.buildWithScope(backend(name, launch), scope)
  return { scope, browser: Context.get(services, Browser.Browser) }
})

/** A client's connection to a running browser, and the scope the connection lives in. */
const connectTo = Effect.fnUntraced(function*(name: "chromium" | "firefox", endpoint: string) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const connection = name === "firefox" ? Firefox.layerConnect(endpoint) : Chromium.layerConnect(endpoint)
  const services = yield* Layer.buildWithScope(
    connection.pipe(Layer.provide(Layer.mergeAll(NodeSocket.layerWebSocketConstructor, NodeServices.layer))),
    scope
  )
  return { browser: Context.get(services, Browser.Browser), scope }
})

/** Puppeteer's `browser.newPage()`, which opens its page in the browser's default context. */
const defaultPage = Effect.fnUntraced(function*(browser: Browser.Browser) {
  const context = yield* browser.defaultContext.control
  return yield* context.newPage
})

upstream(import.meta.filename, {}, (test) => {
  test("Puppeteer.connect should be able to connect using browserUrl, with and without trailing slash", {
    browsers: ["chromium"],
    page: false
  }, () =>
    Effect.gen(function*() {
      yield* launchOwn("chromium", { chromium: { args: [`--remote-debugging-port=${hostPort}`] } })
      const first = yield* connectTo("chromium", `http://127.0.0.1:${hostPort}`)
      const page1 = yield* defaultPage(first.browser).pipe(Scope.provide(first.scope))
      assert.strictEqual(yield* page1.evaluateInMainWorld(() => 7 * 8), 56)
      // `browser1.disconnect()`: the client ends, and the host keeps running
      yield* Scope.close(first.scope, Exit.void)
      const second = yield* connectTo("chromium", `http://127.0.0.1:${hostPort}/`)
      const page2 = yield* defaultPage(second.browser).pipe(Scope.provide(second.scope))
      assert.strictEqual(yield* page2.evaluateInMainWorld(() => 8 * 7), 56)
    }))

  test("Puppeteer.connect should throw when trying to connect to non-existing browser", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // The test runs on Chromium and Firefox only
      const name = browserName === "firefox" ? "firefox" : "chromium"
      const endpoint = name === "firefox" ? "ws://127.0.0.1:32333" : "http://127.0.0.1:32333"
      const failure = yield* failureOf(connectTo(name, endpoint), "the connect")
      assert.isTrue(Browser.isBrowserError(failure))
      assert.strictEqual(failure.reason._tag, "ConnectionFailed")
    }))
})
