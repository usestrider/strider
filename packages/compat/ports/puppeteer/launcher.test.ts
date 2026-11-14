/**
 * Puppeteer's `test/src/launcher.test.ts`: launching a browser (its profile, arguments, URL, deadline, and close) and
 * connecting to a running one (reconnects, a second client's view of a page, and disconnects), on the browsers that run
 * them.
 *
 * What the port changes:
 * - Puppeteer's `launch({...})` for a test that closes its own browser is `launchOwn`: a browser in a scope of its own,
 *   built from `backend` as browsertype-launch.test.ts's BT-004 builds it. Closing the browser is that scope's end, and the
 *   test's finalizer closes it if the test fails first.
 * - Puppeteer's `puppeteer.connect` to a running browser is a host the test launches with `--remote-debugging-port`
 *   (`withHost`) and a client, `Chromium.layerConnect` or `Firefox.layerConnect`, to its endpoint (`connect`). A client's
 *   `disconnect()` is its scope's end (`disconnect`), and the host keeps running.
 * - Puppeteer's `browser.newPage()` opens its page in the browser's default context, so `defaultPage` does the same. A page
 *   a client opens there outlives the client's disconnect, as Puppeteer's does (docs/decisions.md: "default-context pages
 *   are exempt from disposal on disconnect"), provided the scope the page was opened in stays open: a page closes when its
 *   scope does (API.md, `context.newPage`), so those tests open it in `survivingScope`, not in the connection's. The host
 *   is the browser the test launched, which the test keeps running.
 * - Puppeteer's `browser.pages()` is `browser.pages` (the observed pages), `page.url()` is `url`, and `page.frames()`'s
 *   main frame is the page's frame tree, read after `inspect`. `page.evaluate` runs in the main world, so it's
 *   `evaluateInMainWorld`.
 * - Launch failures are `Browser.BrowserError`, checked by `reason`: `InvalidInput` for a path that isn't absolute, and
 *   `ExecutableNotFound` for an absolute path with no file there (the message names the path). Strider has no `pipe`
 *   option (its transport is its own), so "throws an error if executable path is not valid with pipe=true" keeps only the
 *   path check.
 * - Puppeteer's `timeout: 1` launch option is a deadline on the launch (`Deadline.within`), as the matrix's
 *   option-browsertype-launch-timeout row says; its `timeout: 0` is a launch with no deadline, which is Strider's default.
 * - Puppeteer's `page.waitForRequest` and `waitForResponse` are `NetworkRequest.next` and `NetworkResponse.next`,
 *   subscribed before the close; `page.waitForSelector` is `Expect.toBeAttached`, with its timeout as `Deadline.within`.
 * - Puppeteer's `disconnect()` of a client doesn't close the browser, so a test's "the browser closes" is the host's scope
 *   closing, not a client's.
 * - "should set the debugging port" passes `--remote-debugging-port` as a launch argument, as Strider has no option for it,
 *   and connects to that port; Strider has no `wsEndpoint` to read it from.
 * - "should have custom URL when launching browser" passes the URL as a launch argument, as the original does: each browser
 *   takes a URL argument and opens it as its first tab.
 * - Waits the port adds itself (a fixture server request, a race between the host and a client, a navigation) are bounded
 *   by `bounded`, with a message naming the wait.
 * - Stock WebKit has no connect (method-browsertype-connect), so the connect tests run on Chromium and Firefox only; the
 *   ledger marks WebKit. Its launch tests run on all three browsers.
 * - The tests that need what Strider lacks, or that test Puppeteer's own bookkeeping, are not ported; the ledger names the
 *   matrix row or the reason for each.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, Deadline, Expect, NetworkRequest, NetworkResponse, Page, Target } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend, type BrowserName, type Launch } from "../harness/browsers.ts"
import { failureOf, startWaiting } from "../harness/playwright.ts"
import { dumpFrames } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

/** The prefix of the profile directories the tests make, as Puppeteer's `TMP_FOLDER` is. */
const TMP_FOLDER = path.join(os.tmpdir(), "compat-launcher-")

/** The port a host browser listens on. Each test's host stops before the next one starts. */
const debuggingPort = 9470

/** Puppeteer's `puppeteer.connect` endpoint: Chromium's HTTP endpoint, Firefox's WebSocket one. */
const endpointOf = (name: Exclude<BrowserName, "webkit">, port: number = debuggingPort) =>
  name === "firefox" ? `ws://127.0.0.1:${port}` : `http://127.0.0.1:${port}`

/**
 * Bounds a wait of the port's own, so a wait that never ends says what it waited for rather than riding the test's
 * budget.
 */
const bounded = <A, E, R>(what: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.timeoutOrElse({
    duration: "10 seconds",
    orElse: () => Effect.die(new Error(`${what} did not happen within 10 seconds`))
  }))

/** The launch settings for one browser: the options go to the browser the test runs on. */
const launchWith = (name: BrowserName, options: Partial<Browser.LaunchOptions>): Launch =>
  name === "chromium" ? { chromium: options } : name === "firefox" ? { firefox: options } : { webkit: options }

/**
 * Puppeteer's `launch` for a test that closes its own browser: a browser in a scope of its own. The test's finalizer
 * closes it if the test ends before the body does.
 */
const launchOwn = Effect.fnUntraced(function*(name: BrowserName, launch?: Launch) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const services = yield* Layer.buildWithScope(backend(name, launch), scope)
  return { scope, browser: Context.get(services, Browser.Browser) }
})

/** The error a launch fails with, from the browser's layer built and released in a scope of its own. */
const launchFailure = (layer: Layer.Layer<Browser.Browser, unknown>) =>
  failureOf(Effect.scoped(Layer.build(layer)), "the launch")

/**
 * Puppeteer's `browser.newPage()`, which opens its page in the browser's default context. The page lives as long as the
 * scope the caller provides.
 */
const defaultPage = Effect.fnUntraced(function*(browser: Browser.Browser) {
  const context = yield* browser.defaultContext.control
  return yield* context.newPage
})

/** Runs `body` on a host browser the test launches with `--remote-debugging-port`, stopped when `body` ends. */
const withHost = <A, E, R>(name: BrowserName, body: (host: Browser.Browser) => Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    return yield* body(yield* Browser.Browser)
  }).pipe(
    Effect.scoped,
    Effect.provide(backend(name, launchWith(name, { args: [`--remote-debugging-port=${debuggingPort}`] })))
  )

/**
 * A host browser the test launches with `--remote-debugging-port` and closes itself, as the original's `launch({})` browser
 * that a remote client connects to and the test then closes.
 */
const launchHost = (name: BrowserName) =>
  launchOwn(name, launchWith(name, { args: [`--remote-debugging-port=${debuggingPort}`] }))

/**
 * A scope no test closes, for a page that must outlive the connection that opened it: a page is closed when the scope it
 * was opened in closes, so a page opened in the connection's own scope would not survive the disconnect that the original
 * leaves it to. The host's browser, which the test closes, is what ends it.
 */
const survivingScope = Scope.make()

/** A client's connection to the host: its browser, and the scope the connection lives in. */
interface Client {
  readonly browser: Browser.Browser
  readonly scope: Scope.Closeable
}

/**
 * Puppeteer's `puppeteer.connect(options)`: a client of the running host. The connection ends with its scope, and the
 * test's finalizer ends it if the test ends first.
 */
const connect = Effect.fnUntraced(function*(
  name: Exclude<BrowserName, "webkit">,
  options?: Browser.ConnectOptions,
  port?: number
) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const connection = name === "firefox"
    ? Firefox.layerConnect(endpointOf(name, port), options)
    : Chromium.layerConnect(endpointOf(name, port), options)
  const services = yield* Layer.buildWithScope(
    connection.pipe(Layer.provide(Layer.mergeAll(NodeSocket.layerWebSocketConstructor, NodeServices.layer))),
    scope
  )
  return { browser: Context.get(services, Browser.Browser), scope } satisfies Client
})

/** Puppeteer's `disconnect()`: the client's connection ends, and the host keeps running. */
const disconnect = (client: Client) => Scope.close(client.scope, Exit.void)

/** Puppeteer's `dumpFrames` normalization: the port in each URL becomes `<PORT>`. */
const normalizePort = (line: string) => line.replace(/:\d{4,5}\//, ":<PORT>/")

/** The observed page at `url` among a browser's pages, if one shows it. */
const pageAt = Effect.fnUntraced(function*(browser: Browser.Browser, url: string) {
  for (const tab of yield* browser.pages) {
    if (String(yield* tab.url) === url) return tab
  }
  return undefined
})

upstream(import.meta.filename, {}, (test) => {
  // Browser.disconnect

  test("Launcher specs Puppeteer Browser.disconnect should reject navigation when browser closes", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName, server }) =>
    withHost(browserName, () =>
      Effect.gen(function*() {
        const remote = yield* connect(browserName as "chromium" | "firefox")
        server.setRoute("/one-style.css", () => {})
        const page = yield* defaultPage(remote.browser).pipe(Scope.provide(remote.scope))
        // Listen before the navigation sends the request, as the original's `waitForRequest` does
        const requested = yield* server.waitForRequest("/one-style.css")
        const navigation = yield* startWaiting(page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" }))
        yield* bounded("the stylesheet request", requested)
        yield* disconnect(remote)
        const error = yield* failureOf(Fiber.join(navigation.fiber), "the navigation")
        assert(
          Target.isTargetGone(error) || Page.isPageError(error),
          `the navigation failed with ${String(error)}, not with a closed page or target`
        )
      })))

  test("Launcher specs Puppeteer Browser.disconnect should reject waitForSelector when browser closes", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    withHost(browserName, () =>
      Effect.gen(function*() {
        const remote = yield* connect(browserName as "chromium" | "firefox")
        const page = yield* defaultPage(remote.browser).pipe(Scope.provide(remote.scope))
        const watchdog = yield* startWaiting(Expect.toBeAttached(page.locator("div")))
        yield* disconnect(remote)
        const error = yield* failureOf(Fiber.join(watchdog.fiber), "the wait for the selector")
        assert(
          Target.isTargetGone(error) || Expect.isExpectationFailed(error),
          `the wait ended with ${String(error)}, not with a closed page or a failed expectation`
        )
      })))

  // Browser.close

  test("Launcher specs Puppeteer Browser.close should terminate network waiters", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName, server }) =>
    Effect.gen(function*() {
      // The original connects a remote client to the browser, waits for a request and a response on the client's page, and
      // closes the browser itself
      const host = yield* launchHost(browserName)
      const remote = yield* connect(browserName as "chromium" | "firefox")
      const page = yield* defaultPage(remote.browser).pipe(Scope.provide(yield* survivingScope))
      // Both waiters are subscribed before the close, as the original's are before its `browser.close()`
      const requestWaiter = yield* NetworkRequest.next(page, { url: server.EMPTY_PAGE }).pipe(
        Scope.provide(remote.scope)
      )
      const responseWaiter = yield* NetworkResponse.next(page, { url: server.EMPTY_PAGE }).pipe(
        Scope.provide(remote.scope)
      )
      const request = yield* startWaiting(requestWaiter)
      const response = yield* startWaiting(responseWaiter)
      yield* Scope.close(host.scope, Exit.void)
      const requestError = yield* bounded(
        "the request waiter's end",
        failureOf(Fiber.join(request.fiber), "the request waiter")
      )
      const responseError = yield* bounded(
        "the response waiter's end",
        failureOf(Fiber.join(response.fiber), "the response waiter")
      )
      for (const error of [requestError, responseError]) {
        assert(!Deadline.isTimeout(error), "a waiter timed out, where the browser's close ends it")
        assert(Target.isTargetGone(error), `a waiter failed with ${String(error)}, not a closed target`)
        // The original accepts 'Target closed', 'Page closed!', or 'Browser already closed': any report that the target closed
        assert.include(["BrowserClosed", "ConnectionLost", "PageClosed"], error.reason._tag, String(error.reason))
      }
    }))

  // Puppeteer.launch

  test("Launcher specs Puppeteer Puppeteer.launch can launch and close the browser", {
    page: false
  }, ({ browserName }) => Effect.scoped(Layer.build(backend(browserName, undefined))).pipe(Effect.asVoid))

  test("Launcher specs Puppeteer Puppeteer.launch can launch multiple instances without node warnings", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // The original lowers Node's listener limit to one while two browsers launch, and records any warning Node emits
      let warning: Error | undefined
      const warningHandler = (emitted: Error) => {
        warning = emitted
      }
      const previous = process.getMaxListeners()
      process.on("warning", warningHandler)
      process.setMaxListeners(1)
      try {
        const launched = yield* Effect.all([launchOwn(browserName), launchOwn(browserName)], {
          concurrency: "unbounded"
        }).pipe(Effect.result)
        if (Result.isFailure(launched)) {
          warning = new Error(`a browser failed to launch: ${String(launched.failure)}`)
        } else {
          for (const instance of launched.success) yield* Scope.close(instance.scope, Exit.void)
        }
      } finally {
        process.setMaxListeners(previous)
        process.off("warning", warningHandler)
      }
      assert.strictEqual(warning?.stack, undefined, String(warning))
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should have default url when launching browser", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const own = yield* launchOwn(browserName)
      const urls: Array<string> = []
      for (const tab of yield* own.browser.pages) urls.push(String(yield* tab.url))
      assert.deepStrictEqual(urls, ["about:blank"])
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should close browser with beforeunload page", {
    page: false
  }, ({ browserName, server }) =>
    // A browser of the test's own, closed when its scope ends, which doesn't run `beforeunload` (as BU-001 does)
    Effect.scoped(
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
        // The page needs an interaction before its `beforeunload` handler can prompt, as the original's click gives it
        yield* page.locator("body").click()
      }).pipe(Effect.provide(backend(browserName, undefined)))
    ))

  test("Launcher specs Puppeteer Puppeteer.launch should reject all promises when browser is closed", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const own = yield* launchOwn(browserName)
      // The page's own scope stays open: the original closes the browser, not the page
      const page = yield* defaultPage(own.browser).pipe(Scope.provide(yield* survivingScope))
      const neverResolves = yield* startWaiting(page.evaluateInMainWorld(() => new Promise(() => {})))
      // One round trip, so the evaluation has reached the page before the close, as it has by the original's close
      yield* page.evaluateInMainWorld(() => 1)
      yield* Scope.close(own.scope, Exit.void)
      const error = yield* failureOf(Fiber.join(neverResolves.fiber), "the evaluation")
      assert(Target.isTargetGone(error), String(error))
      assert.strictEqual(error.reason._tag, "BrowserClosed", String(error.reason))
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should reject if executable path is invalid", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // A path that isn't absolute is refused before anything is looked up: `InvalidInput` (Browser.LaunchOptions)
      const error = yield* launchFailure(
        backend(browserName, launchWith(browserName, { executablePath: "random-invalid-path" }))
      )
      assert(Browser.isBrowserError(error), String(error))
      assert.strictEqual(error.reason._tag, "InvalidInput", String(error.reason))
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir option", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      try {
        const own = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        yield* defaultPage(own.browser).pipe(Scope.provide(own.scope))
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
        yield* Scope.close(own.scope, Exit.void)
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir option restores preferences", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      try {
        const prefsJSPath = path.join(userDataDir, "prefs.js")
        const userJSPath = path.join(userDataDir, "user.js")
        const prefsJSContent = "user_pref(\"browser.warnOnQuit\", true)"
        fs.writeFileSync(prefsJSPath, prefsJSContent)
        fs.writeFileSync(userJSPath, prefsJSContent)

        const own = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        yield* defaultPage(own.browser).pipe(Scope.provide(own.scope))
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
        yield* Scope.close(own.scope, Exit.void)
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
        assert.strictEqual(fs.readFileSync(prefsJSPath, "utf8"), prefsJSContent)
        assert.strictEqual(fs.readFileSync(userJSPath, "utf8"), prefsJSContent)
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir argument", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      try {
        // Chromium takes its profile as `--user-data-dir`, Firefox as `-profile`; the arguments reach the browser as given
        const args = browserName === "chromium" ? [`--user-data-dir=${userDataDir}`] : ["-profile", userDataDir]
        const own = yield* launchOwn(browserName, launchWith(browserName, { args }))
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
        yield* Scope.close(own.scope, Exit.void)
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir argument with non-existent dir", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      fs.rmSync(userDataDir, { recursive: true, force: true })
      try {
        const args = browserName === "chromium" ? [`--user-data-dir=${userDataDir}`] : ["-profile", userDataDir]
        const own = yield* launchOwn(browserName, launchWith(browserName, { args }))
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
        yield* Scope.close(own.scope, Exit.void)
        assert.isAbove(fs.readdirSync(userDataDir).length, 0)
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir option should restore state", {
    page: false
  }, ({ browserName, server }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      try {
        const first = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        const page = yield* defaultPage(first.browser).pipe(Scope.provide(first.scope))
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(() => (localStorage["hey"] = "hello"))
        yield* Scope.close(first.scope, Exit.void)

        const second = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        const page2 = yield* defaultPage(second.browser).pipe(Scope.provide(second.scope))
        yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(yield* page2.evaluateInMainWorld(() => localStorage["hey"]), "hello")
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch userDataDir option should restore cookies", {
    page: false
  }, ({ browserName, server }) =>
    Effect.gen(function*() {
      const userDataDir = fs.mkdtempSync(TMP_FOLDER)
      try {
        const first = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        const page = yield* defaultPage(first.browser).pipe(Scope.provide(first.scope))
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(() => {
          document.cookie = "doSomethingOnlyOnce=true; expires=Fri, 31 Dec 9999 23:59:59 GMT"
        })
        yield* Scope.close(first.scope, Exit.void)

        const second = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        const page2 = yield* defaultPage(second.browser).pipe(Scope.provide(second.scope))
        yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert.strictEqual(yield* page2.evaluateInMainWorld(() => document.cookie), "doSomethingOnlyOnce=true")
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true })
      }
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should have default URL when launching browser", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      const own = yield* launchOwn(browserName)
      const urls: Array<string> = []
      for (const tab of yield* own.browser.pages) urls.push(String(yield* tab.url))
      assert.deepStrictEqual(urls, ["about:blank"])
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should have custom URL when launching browser", {
    page: false
  }, ({ browserName, server }) =>
    Effect.gen(function*() {
      // The original passes the URL among the arguments, and the browser opens it as its first tab
      const own = yield* launchOwn(browserName, launchWith(browserName, { args: [server.EMPTY_PAGE] }))
      const tabs = yield* own.browser.pages
      assert.strictEqual(tabs.length, 1)
      const tab = tabs[0]!
      if (String(yield* tab.url) !== server.EMPTY_PAGE) {
        yield* bounded("the first tab's navigation", tab.url.waitFor((url) => url === server.EMPTY_PAGE))
      }
      assert.strictEqual(String(yield* tab.url), server.EMPTY_PAGE)
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should pass the timeout parameter to browser.waitForTarget", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // Puppeteer's `timeout: 1` is a deadline on the launch: a deadline of one millisecond ends it as a timeout
      const error = yield* failureOf(
        Effect.scoped(Layer.build(backend(browserName, undefined))).pipe(Deadline.within("1 millis")),
        "the launch"
      )
      assert(Deadline.isTimeout(error), `the launch failed with ${String(error)}, not a timeout`)
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should work with timeout = 0", {
    page: false
  }, ({ browserName }) =>
    // Puppeteer's `timeout: 0` turns the launch's timeout off; a Strider launch has no deadline unless the caller sets one
    Effect.scoped(Layer.build(backend(browserName, undefined))).pipe(Effect.asVoid))

  test("Launcher specs Puppeteer Puppeteer.launch should disable the default viewport", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // Strider's launch sets no viewport, so a page opened without emulation has none: `viewportSize` is none
      const own = yield* launchOwn(browserName)
      const page = yield* own.browser.newPage().pipe(Scope.provide(own.scope))
      assert.strictEqual((yield* page.viewportSize)._tag, "None")
    }))

  test("Launcher specs Puppeteer Puppeteer.launch should set the debugging port", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // Strider has no debugging-port option: the port is a launch argument, which both browsers take. The original reads the
      // port from the browser's WebSocket endpoint; here the browser answers a connection at the port.
      const port = 9999
      yield* launchOwn(browserName, launchWith(browserName, { args: [`--remote-debugging-port=${port}`] }))
      const client = yield* connect(browserName as "chromium" | "firefox", undefined, port)
      assert.strictEqual(client.browser.info.protocol, browserName === "firefox" ? "bidi" : "cdp")
    }))

  test("Launcher specs Puppeteer Puppeteer.launch throws an error if executable path is not valid with pipe=true", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // Strider has no `pipe` option (its transport is its own), so the executable path check is what remains
      const error = yield* launchFailure(
        backend(browserName, launchWith(browserName, { executablePath: "/tmp/does-not-exist" }))
      )
      assert(Browser.isBrowserError(error), String(error))
      assert(error.reason._tag === "ExecutableNotFound", String(error.reason))
      // Strider names the path in the reason's `searched`; its message doesn't repeat it
      assert.deepStrictEqual(error.reason.searched, ["/tmp/does-not-exist"])
    }))

  // Puppeteer.connect

  test("Launcher specs Puppeteer Puppeteer.connect should be able to connect multiple times to the same browser", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    withHost(browserName, (host) =>
      Effect.gen(function*() {
        const other = yield* connect(browserName as "chromium" | "firefox")
        const page = yield* defaultPage(other.browser).pipe(Scope.provide(other.scope))
        assert.strictEqual(yield* page.evaluateInMainWorld(() => 7 * 8), 56)
        yield* disconnect(other)

        // The host is untouched by the client's disconnect, and opens its own page
        const secondPage = yield* defaultPage(host)
        assert.strictEqual(yield* secondPage.evaluateInMainWorld(() => 7 * 6), 42)
      })))

  test("Launcher specs Puppeteer Puppeteer.connect should not modify the connect options", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    withHost(browserName, () =>
      Effect.gen(function*() {
        // Frozen options: connecting reads them, so the connection is made from values that can't change
        const other = yield* connect(
          browserName as "chromium" | "firefox",
          Object.freeze({ headers: Object.freeze({}) })
        )
        yield* disconnect(other)
      })))

  test("Launcher specs Puppeteer Puppeteer.connect should be able to reconnect to a disconnected browser", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName, server }) =>
    withHost(browserName, () =>
      Effect.gen(function*() {
        // A page a client opens in the default context outlives the client's disconnect
        const first = yield* connect(browserName as "chromium" | "firefox")
        const page = yield* defaultPage(first.browser).pipe(Scope.provide(yield* survivingScope))
        yield* page.goto(server.PREFIX + "/frames/nested-frames.html", { waitUntil: "load" })
        yield* disconnect(first)

        const second = yield* connect(browserName as "chromium" | "firefox")
        const restored = yield* pageAt(second.browser, server.PREFIX + "/frames/nested-frames.html")
        assert.isDefined(restored, "the reconnected browser has no page at nested-frames.html")
        const inspected = yield* restored!.inspect.pipe(Scope.provide(second.scope))
        assert.deepStrictEqual(dumpFrames(yield* inspected.frames).map(normalizePort), [
          "http://localhost:<PORT>/frames/nested-frames.html",
          "    http://localhost:<PORT>/frames/two-frames.html (2frames)",
          "        http://localhost:<PORT>/frames/frame.html (uno)",
          "        http://localhost:<PORT>/frames/frame.html (dos)",
          "    http://localhost:<PORT>/frames/frame.html (aframe)"
        ])
        const controlled = yield* restored!.control.pipe(Scope.provide(second.scope))
        assert.strictEqual(yield* controlled.evaluateInMainWorld(() => 7 * 8), 56)
      })))

  test("Launcher specs Puppeteer Puppeteer.connect should be able to connect to the same page simultaneously", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName }) =>
    withHost(browserName, (host) =>
      Effect.gen(function*() {
        const before = new Set((yield* host.pages).map((tab) => tab.id))
        const other = yield* connect(browserName as "chromium" | "firefox")
        const page2 = yield* defaultPage(other.browser).pipe(Scope.provide(other.scope))
        // The host observes the page the other client opened, as its own new page
        yield* bounded(
          "the host to observe the other client's page",
          host.pages.waitFor((tabs) => tabs.some((tab) => !before.has(tab.id)))
        )
        const page1 = (yield* host.pages).find((tab) => !before.has(tab.id))!
        const controlled = yield* page1.control
        assert.strictEqual(yield* controlled.evaluateInMainWorld(() => 7 * 8), 56)
        assert.strictEqual(yield* page2.evaluateInMainWorld(() => 7 * 6), 42)
      })))

  test("Launcher specs Puppeteer Puppeteer.connect should be able to reconnect", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName, server }) =>
    withHost(browserName, () =>
      Effect.gen(function*() {
        const first = yield* connect(browserName as "chromium" | "firefox")
        const pageOne = yield* defaultPage(first.browser).pipe(Scope.provide(yield* survivingScope))
        yield* pageOne.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* disconnect(first)

        const second = yield* connect(browserName as "chromium" | "firefox")
        const pageTwo = yield* pageAt(second.browser, server.EMPTY_PAGE)
        assert.isDefined(pageTwo, "the reconnected browser has no page at the empty page")
        const controlled = yield* pageTwo!.control.pipe(Scope.provide(second.scope))
        yield* controlled.reload({ waitUntil: "load" })
        // The original's `waitForSelector("body", { timeout: 10000 })`
        yield* Expect.toBeAttached(controlled.locator("body")).pipe(Deadline.within("10 seconds"))
      })))
})
