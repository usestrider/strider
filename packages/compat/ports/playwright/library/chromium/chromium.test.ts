/**
 * Playwright's `tests/library/chromium/chromium.spec.ts`: Chromium's service workers and their requests, console
 * messages and network, launch arguments and the profile directory, the WebUI pages, and the CDP session the original
 * uses for a dialog. Chromium only, as the original is.
 *
 * What the port changes:
 * - Strider has no separate context for a service worker: a context's `workers` watchable lists its shared and service
 *   workers, and `BrowserWorker.next(context, { kind: "service" })` is Playwright's `waitForEvent("serviceworker")`,
 *   subscribed before the action that starts the worker, as the original does. `worker.evaluate` runs in the worker's
 *   global, as the original's does.
 * - Playwright's `request.serviceWorker()` is the worker whose realm made the request. Strider names a request's
 *   initiator: a `Worker` carries its realm, which `serviceWorkerOf` matches to a service worker of the context. A
 *   request the browser couldn't attribute is `Unattributed`, and no worker has it.
 * - `request.frame()` is the navigable of a `Document` initiator: a worker's request has none, so the port asserts the
 *   initiator is not a document where the original's `frame()` throws. `response.fromServiceWorker()` is the response's
 *   `servedBy` being `serviceWorker`.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A promise a page or worker
 *   evaluation returns is awaited inside the function, as Playwright awaits it.
 * - `context.setOffline(true)` and `context.setExtraHTTPHeaders` are the context's `emulate({ network: "offline" })` and
 *   `emulate({ extraHTTPHeaders })`, which last for the caller's scope.
 * - `browser.newContext({ httpCredentials })` gives the context its credentials, as `test.use` does for the original's
 *   pages. The fixture server has no `setAuth`, so the port answers the two paths the original protects itself, with a
 *   401 challenge until the Basic credentials match, serving the same vendored assets.
 * - A test that launches its own browser (CR-008, CR-009, CR-022, CR-023) launches it through the harness's backend
 *   with the arguments and profile directory the original passed. Playwright's `launchPersistentContext(dir, { args })`
 *   is `LaunchOptions` with `userDataDir` and `args` together, which Strider's `Chromium.layer` takes.
 * - A response wait the original holds (`context.waitForEvent("response", …)`) is `NetworkResponse.next` subscribed before
 *   the action. `request.response()` is `NetworkRequest.response`, awaited after it.
 * - CR-025 and CR-031 are ledgered: a console message's arguments and the CDP session. CR-026 subscribes to the context's
 *   console messages before the navigation starts the worker, where the original asks the worker afterwards and
 *   Playwright keeps the first line's message for it.
 * - CR-017 and CR-018 read the network log as Playwright's event table reads it. Playwright emits each request on the
 *   context and, for a request a page made, on the page as well; the port's rows do the same from one retained log.
 *   Playwright aborts the browser's own `/favicon.ico` request and never reports it, so the rows leave it out. The
 *   routed requests are those a route handler saw, by hop.
 * - CR-027 is Playwright's refusal of WebUI pages, which has no counterpart: Strider hands the navigation to the browser.
 *   The port keeps what the refusal is for, that the browser survives each navigation, in a browser of its own.
 * - CR-029 and CR-030 are skipped by the original when headless. The port launches Chromium headed on the integration
 *   environment's X server (`headless: false`), where the WebUI pages are available.
 * - CR-022 and CR-023 expect the second launch of a locked profile to fail as Strider reports a browser that exited: a
 *   `ProcessExited` whose stderr has Chromium's own notice. Playwright's "This usually means" wording is its own. Each
 *   launch has a layer of its own, since providing one layer twice builds it once.
 * - CR-010, CR-011, CR-014 and CR-015 wait for the responses and requests the original waits for, with the service
 *   worker's own as `where` predicates, subscribed before the navigation.
 * - CR-019 is `test.fixme()` in the original. The port runs its body as written, so its outcome is a finding for the run.
 * - Playwright's `test.skip` and `test.fixme` conditions on its own fixtures (`headless`, `channel`, `browserMajorVersion`,
 *   `platform`) are the ones this run meets, except `headless` (CR-029, CR-030): Chromium is not Edge, not a headless
 *   shell, and its version is above 104.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert } from "@effect/vitest"
import {
  Browser,
  BrowserWorker,
  Condition,
  ConsoleMessage,
  Expect,
  Har,
  NetworkRequest,
  NetworkResponse,
  Page,
  Route,
  type UserContext
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { useXvfb } from "../../../../../browser/test/integration/stockWebKit.ts"
import { backend } from "../../../harness/browsers.ts"
import { assetPath, failureOf } from "../../../harness/playwright.ts"
import { type ServerShape } from "../../../harness/server.ts"
import { upstream } from "../../../harness/upstream.ts"

/** A temporary profile directory for one test, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-chromium-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/** The service worker in a context whose realm is the request's initiator, the worker a request is "from". */
const serviceWorkerOf = Effect.fnUntraced(function*(
  context: UserContext.UserContext,
  request: NetworkRequest.NetworkRequest
) {
  if (request.initiator._tag !== "Worker") return undefined
  const realm = request.initiator.realm
  const workers = yield* context.workers
  return workers.find((worker) => worker.kind === "service" && worker.realm === realm)
})

/** The response a request got, once it has arrived: Playwright's `request.response()`, `None` when it has none. */
const responseOf = Effect.fnUntraced(function*(
  context: UserContext.UserContext,
  request: NetworkRequest.NetworkRequest
) {
  const wait = yield* NetworkRequest.response(context, request)
  return yield* wait
})

/** Whether a request's response came from a service worker: Playwright's `response.fromServiceWorker()`. */
const fromServiceWorker = Effect.fnUntraced(function*(
  context: UserContext.UserContext,
  request: NetworkRequest.NetworkRequest
) {
  const response = yield* responseOf(context, request)
  return Option.exists(response, (found) => found.servedBy === "serviceWorker")
})

/** The service workers of a context, as Playwright's `context.serviceWorkers()`. */
const serviceWorkers = Effect.fnUntraced(function*(context: UserContext.UserContext) {
  const workers = yield* context.workers
  return workers.filter((worker) => worker.kind === "service")
})

/** The `Basic` header the original's `setAuth` checks for `user:pass`. */
const expectedAuth = "Basic " + Buffer.from("user:pass").toString("base64")

/**
 * Playwright's `server.setAuth(path, "user", "pass")` for a path the fixture server answers with `asset`: a 401 challenge
 * until the Basic credentials match, then the vendored asset.
 */
const setAuth = (server: ServerShape, route: string, asset: string, contentType: string) =>
  server.setRoute(route, (request, res) => {
    if (request.headers.authorization !== expectedAuth) {
      res.writeHead(401, { "WWW-Authenticate": "Basic realm=\"Secure Area\"" }).end()
      return
    }
    res.writeHead(200, { "Content-Type": contentType })
    res.end(fs.readFileSync(assetPath("playwright", asset)))
  })

/**
 * Chromium's own notices that its profile is in use by another instance, which Playwright's launch error is keyed on
 * (`profileInUseError`): its "This usually means that the profile is already in use" wording is Playwright's.
 */
const profileInUse =
  /Failed to create a ProcessSingleton for your profile directory\.|Opening in existing browser session\./

/**
 * Asserts that a launch refused the locked profile as Strider reports it: the browser exited, and the error carries
 * the stderr that says why.
 */
const assertProfileInUse = (error: unknown) => {
  assert.isTrue(Browser.isBrowserError(error), `the launch failed with ${String(error)}`)
  if (!Browser.isBrowserError(error)) return
  const reason = error.reason
  assert.strictEqual(reason._tag, "ProcessExited", `the launch failed with ${error.message}`)
  if (reason._tag !== "ProcessExited") return
  assert.match(reason.stderrTail, profileInUse)
}

/** The page of Playwright's `workers` tests: the service worker tests' home page, with its update button. */
const updateHome = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Service Worker Update Demo</title>
        </head>
        <body>
          <button id="update" disabled>update service worker</button>
          <script>
            const updateBtn = document.getElementById('update');
            updateBtn.addEventListener('click', evt => {
              evt.preventDefault();
              registration.then(r => r.update());
            });

            const registration = new Promise(r => navigator.serviceWorker.register('/worker.js').then(r));
            registration.then(() => updateBtn.disabled = false);
          </script>
        </body>
      </html>
    `

/** The header of Playwright's network table in CR-017 and CR-018. */
const tableHeader =
  "| Event                             | Owner            | URL                            | Routed | [`method: Response.fromServiceWorker`] |"

/** One row of that table, with the same column widths as the original's `formatRequest`. */
const tableRow = (
  onPage: boolean,
  owner: boolean,
  url: string,
  routed: boolean,
  fromSW: boolean
) =>
  `| ${(onPage ? "[`event: Page.request`]" : "[`event: BrowserContext.request`]").padEnd(33, " ")} | ${
    (owner ? "Service [Worker]" : "[Frame]").padEnd(16, " ")
  } | ${(url.split("/").pop() ?? "").padEnd(30, " ")} | ${(routed ? "Yes" : "").padEnd(6, " ")} | ${
    (fromSW ? "Yes" : "").padEnd(37, " ")
  } |`

/**
 * Playwright's network table: for each request the context's row, then the page's row for a request a page made, with
 * whether it was routed and whether its response came from a service worker.
 */
const networkTable = Effect.fnUntraced(function*(page: Page.Page, routed: ReadonlySet<string>) {
  const context = page.context
  const history = yield* NetworkRequest.history(context)
  const rows: Array<string> = []
  for (const request of history.entries) {
    // Playwright aborts the browser's own favicon request and never reports it
    if (new URL(String(request.url)).pathname === "/favicon.ico") continue
    const owner = (yield* serviceWorkerOf(context, request)) !== undefined
    const fromSW = yield* fromServiceWorker(context, request)
    const url = String(request.url)
    const isRouted = routed.has(request.hop)
    rows.push(tableRow(false, owner, url, isRouted, fromSW))
    if (request.initiator._tag === "Document") rows.push(tableRow(true, owner, url, isRouted, fromSW))
  }
  return [tableHeader, ...rows]
})

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("CR-001", ({ page, server }) =>
    Effect.gen(function*() {
      const started = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const worker = yield* started
      assert.strictEqual(yield* worker.evaluate(() => self.toString()), "[object ServiceWorkerGlobalScope]")
    }))

  test("CR-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**", () => Route.continue)
      const started = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const worker = yield* started
      assert.strictEqual(yield* worker.evaluate(() => self.toString()), "[object ServiceWorkerGlobalScope]")
    }))

  test("CR-003", ({ page, server }) =>
    Effect.gen(function*() {
      let version = 0
      server.setRoute("/worker.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/javascript" })
        res.write(`self.PW_VERSION = ${version++};`)
        res.end()
      })
      server.setRoute("/home", (_request, res) => {
        res.write(updateHome)
        res.end()
      })

      const started = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/home", { waitUntil: "load" })
      const sw = yield* started
      yield* Expect.that(
        sw.evaluate(() => Reflect.get(self, "PW_VERSION")),
        Condition.make("version 0", (value: unknown) => value === 0)
      )

      const updated = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.locator("#update").click()
      const updatedSW = yield* updated
      yield* Expect.that(
        updatedSW.evaluate(() => Reflect.get(self, "PW_VERSION")),
        Condition.make("version 1", (value: unknown) => value === 1)
      )
    }))

  test("CR-004", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      setAuth(server, "/serviceworkers/fetch/sw.html", "serviceworkers/fetch/sw.html", "text/html")
      setAuth(server, "/empty.html", "empty.html", "text/html")
      const context = yield* Browser.newContext({
        httpCredentials: { username: "user", password: Redacted.make("pass") }
      })
      const page = yield* context.newPage
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      const worker = yield* started
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      assert.strictEqual(
        yield* worker.evaluate(async () => (await fetch("/empty.html")).status),
        200
      )
    })))

  test("CR-005", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const worker1 = yield* started
      let workers = yield* serviceWorkers(context)
      assert.strictEqual(workers.length, 1)

      const restarted = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const worker2 = yield* restarted
      workers = yield* serviceWorkers(context)
      assert.strictEqual(workers.length, 2)
      assert.isTrue(workers.some((worker) => worker.realm === worker1.realm))
      assert.isTrue(workers.some((worker) => worker.realm === worker2.realm))
    }))

  test("CR-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        void new SharedWorker("data:text/javascript,console.log(\"hi\")")
      })
      // The original listens for `serviceworker` and checks its flag straight after the evaluation; the port reads the
      // context's service workers at the same point.
      assert.strictEqual((yield* serviceWorkers(page.context)).length, 0)
    }))

  test("CR-008", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const contextScope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(contextScope))
      const page = yield* context.newPage.pipe(Scope.provide(contextScope))
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const worker = yield* started
      const messages: Array<string> = []
      const workerClosed = yield* Effect.forkChild(
        worker.closed.pipe(Effect.tap(() => Effect.sync(() => messages.push("worker"))))
      )
      const contextClosed = yield* Effect.forkChild(
        context.closed.pipe(Effect.tap(() => Effect.sync(() => messages.push("context"))))
      )
      yield* Scope.close(contextScope, Exit.void)
      yield* Fiber.join(workerClosed)
      yield* Fiber.join(contextClosed)
      assert.strictEqual(messages.join("|"), "worker|context")
    })).pipe(Effect.provide(backend("chromium", undefined))))

  test("CR-009", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const userDataDir = yield* scratch
      const userAgent = yield* Effect.scoped(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.defaultContext.control
        const page = yield* context.newPage
        return yield* page.evaluateInMainWorld(() => navigator.userAgent)
      })).pipe(Effect.provide(backend("chromium", { chromium: { userDataDir, args: ["--user-agent=I am Foo"] } })))
      assert.strictEqual(userAgent, "I am Foo")
    })))

  test("CR-010", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      const htmlSent = yield* NetworkRequest.next(context, { url: "**/sw.html" })
      const mainSent = yield* NetworkRequest.next(context, { url: "**/sw.js" })
      const inWorkerSent = yield* NetworkRequest.next(context, { url: "**/request-from-within-worker.txt" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      const worker = yield* started
      const html = yield* htmlSent
      const main = yield* mainSent
      const inWorker = yield* inWorkerSent

      assert.strictEqual(html.initiator._tag, "Document")
      assert.isUndefined(yield* serviceWorkerOf(context, html))
      assert.isFalse(yield* fromServiceWorker(context, html))

      assert.notStrictEqual(main.initiator._tag, "Document")
      assert.strictEqual((yield* serviceWorkerOf(context, main))?.realm, worker.realm)
      assert.isFalse(yield* fromServiceWorker(context, main))

      assert.notStrictEqual(inWorker.initiator._tag, "Document")
      assert.strictEqual((yield* serviceWorkerOf(context, inWorker))?.realm, worker.realm)
      assert.isFalse(yield* fromServiceWorker(context, inWorker))

      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      const innerSWSent = yield* NetworkRequest.next(
        context,
        { url: "**/inner.txt" },
        (request) => Effect.map(serviceWorkerOf(context, request), (found) => found !== undefined)
      )
      const innerPageSent = yield* NetworkRequest.next(
        context,
        { url: "**/inner.txt" },
        (request) => Effect.map(serviceWorkerOf(context, request), (found) => found === undefined)
      )
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/inner.txt")
      })
      const innerSW = yield* innerSWSent
      const innerPage = yield* innerPageSent
      assert.isUndefined(yield* serviceWorkerOf(context, innerPage))
      assert.isTrue(yield* fromServiceWorker(context, innerPage))

      assert.strictEqual((yield* serviceWorkerOf(context, innerSW))?.realm, worker.realm)
      assert.isFalse(yield* fromServiceWorker(context, innerSW))
    }))

  test("CR-011", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.route("**/request-from-within-worker", () =>
        Route.fulfill(HttpServerResponse.text("\"intercepted!\"", { contentType: "application/json" })))
      yield* context.route("**/sw.js", () =>
        Route.fulfill(HttpServerResponse.text(
          `
          self.contentPromise = new Promise(res => fetch('/request-from-within-worker').then(r => r.json()).then(res));
        `,
          { contentType: "text/javascript" }
        )))

      const started = yield* BrowserWorker.next(context, { kind: "service" })
      const withinResponse = yield* NetworkResponse.next(context, { url: "**/request-from-within-worker" })
      const mainRequest = yield* NetworkRequest.next(
        context,
        { url: "**/sw.js" },
        (request) =>
          Effect.map(serviceWorkerOf(context, request), (found) => found !== undefined)
      )
      const mainResponse = yield* NetworkResponse.next(
        context,
        { url: "**/sw.js" },
        (response) => Effect.succeed(response.servedBy !== "serviceWorker")
      )
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const sw = yield* started
      yield* withinResponse
      yield* mainRequest
      yield* mainResponse
      assert.strictEqual(
        yield* sw.evaluate(async () => await Reflect.get(self, "contentPromise")),
        "intercepted!"
      )
    }))

  test("CR-012", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* browser.newContext()
      const page = yield* context.newPage
      server.setRoute("/serviceworkers/fetch/sw.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/html" })
        res.write(`console.log('hi from sw');`)
        res.end()
      })
      const received = yield* server.waitForRequest("/serviceworkers/fetch/sw.js")
      const mainSent = yield* NetworkRequest.next(context, { url: "**/sw.js" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      yield* received
      const main = yield* mainSent
      // The original awaits the main request's response and checks nothing about it.
      yield* responseOf(context, main)
    })))

  test("CR-013", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* browser.newContext()
      const page = yield* context.newPage
      server.setRedirect("/serviceworkers/empty/sw.js", "/dev/null")
      const received = yield* server.waitForRequest("/serviceworkers/empty/sw.js")
      const mainSent = yield* NetworkRequest.next(context, { url: "**/sw.js" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      yield* received
      const main = yield* mainSent
      const response = yield* responseOf(context, main)
      assert.strictEqual(Option.getOrUndefined(response)?.status, 302)
    })))

  test("CR-014", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.route("**/import.js", () =>
        Route.fulfill(HttpServerResponse.text("self.exportedValue = 47;", { contentType: "text/javascript" })))
      yield* context.route("**/sw.js", () =>
        Route.fulfill(HttpServerResponse.text(
          `
          importScripts('/import.js');
          self.importedValue = self.exportedValue;
        `,
          { contentType: "text/javascript" }
        )))

      const started = yield* BrowserWorker.next(context, { kind: "service" })
      const imported = yield* NetworkResponse.next(context, { url: "**/import.js" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const sw = yield* started
      yield* imported
      assert.strictEqual(
        yield* sw.evaluate(() =>
          Reflect.get(self, "importedValue")
        ),
        47
      )
    }))

  test("CR-015", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const context = page.context
      yield* context.route("**/request-from-within-worker", () =>
        Route.fulfill(HttpServerResponse.text("\"intercepted!\"", {
          contentType: "application/json",
          headers: { "x-pw-test": "request-within-worker" }
        })))
      yield* context.route("**/sw.js", () =>
        Route.fulfill(HttpServerResponse.text(
          `
          self.contentPromise = new Promise(res => fetch('/request-from-within-worker').then(r => r.json()).then(res));
        `,
          { contentType: "text/javascript", headers: { "x-pw-test": "intercepted-main" } }
        )))
      const recording = yield* Har.record(context, { inFlightAtStop: "wait", content: "embed" })
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      const withinResponse = yield* NetworkResponse.next(context, { url: "**/request-from-within-worker" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      const sw = yield* started
      yield* withinResponse
      assert.strictEqual(
        yield* sw.evaluate(async () =>
          await Reflect.get(self, "contentPromise")
        ),
        "intercepted!"
      )
      const file = yield* recording.exportHar(path.join(directory, "test.har"))
      const log = JSON.parse(fs.readFileSync(file, "utf8")).log as {
        readonly entries: ReadonlyArray<{
          readonly request: { readonly url: string }
          readonly response: {
            readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>
            readonly content: { readonly text?: string }
          }
        }>
      }
      const script = log.entries.filter((entry) => entry.request.url.endsWith("sw.js"))
      assert.strictEqual(script.length, 1)
      assert.deepStrictEqual(
        script[0]!.response.headers.filter((header) => header.name === "x-pw-test"),
        [{ name: "x-pw-test", value: "intercepted-main" }]
      )
      const within = log.entries.filter((entry) => entry.request.url.endsWith("request-from-within-worker"))
      assert.strictEqual(within.length, 1)
      assert.deepStrictEqual(
        within[0]!.response.headers.filter((header) => header.name === "x-pw-test"),
        [{ name: "x-pw-test", value: "request-within-worker" }]
      )
      assert.strictEqual(within[0]!.response.content.text, "\"intercepted!\"")
    })))

  test("CR-016", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      yield* context.route("**/data.json", (intercepted) =>
        Effect.gen(function*() {
          const worker = yield* serviceWorkerOf(context, intercepted.request)
          return yield* (worker === undefined
            ? Route.continue
            : Route.fulfill(HttpServerResponse.text("from sw", { contentType: "text/plain" })))
        }))

      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      const sw = yield* started
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => fetch("/data.json").then((response) => response.text())),
        "from sw"
      )
      const intercepted = yield* sw.evaluate(() => Reflect.get(self, "intercepted") as Array<string>)
      assert.match(intercepted[0] ?? "", /\/data\.json$/)
    }))

  test("CR-017", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      server.setRoute("/index.html", (_request, res) => {
        res.write(`
      <script>
        window.registrationPromise = navigator.serviceWorker.register('/transparent-service-worker.js');
      </script>
    `)
        res.end()
      })
      server.setRoute("/transparent-service-worker.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/javascript" })
        res.write(`
      self.addEventListener("fetch", (event) => {
        // actually make the request
        const responsePromise = fetch(event.request);
        // send it back to the page
        event.respondWith(responsePromise);
      });

      self.addEventListener("activate", (event) => {
        event.waitUntil(clients.claim());
      });
    `)
        res.end()
      })

      const routed = new Set<string>()
      const recordRouted = (intercepted: { readonly request: NetworkRequest.NetworkRequest }) =>
        Effect.sync(() => routed.add(intercepted.request.hop))
      yield* context.route("**", (intercepted) => Effect.andThen(recordRouted(intercepted), Route.continue))
      yield* page.route("**", (intercepted) => Effect.andThen(recordRouted(intercepted), Route.continue))

      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/index.html", { waitUntil: "load" })
      const sw = yield* started
      yield* Expect.that(
        sw.evaluate(() => (Reflect.get(self, "registration") as ServiceWorkerRegistration).active?.state),
        Condition.make("activated", (state: unknown) => state === "activated")
      )

      yield* page.evaluateInMainWorld(async () => {
        await fetch("/data.json")
      })

      assert.deepStrictEqual(yield* networkTable(page, routed), [
        tableHeader,
        "| [`event: BrowserContext.request`] | [Frame]          | index.html                     | Yes    |                                        |",
        "| [`event: Page.request`]           | [Frame]          | index.html                     | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | Service [Worker] | transparent-service-worker.js  | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | Service [Worker] | data.json                      | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | [Frame]          | data.json                      |        | Yes                                    |",
        "| [`event: Page.request`]           | [Frame]          | data.json                      |        | Yes                                    |"
      ])
    }))

  test("CR-018", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      server.setRoute("/index.html", (_request, res) => {
        res.write(`
      <script>
        window.registrationPromise = navigator.serviceWorker.register('/complex-service-worker.js');
      </script>
    `)
        res.end()
      })
      server.setRoute("/complex-service-worker.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/javascript" })
        res.write(`
      self.addEventListener("install", function (event) {
        event.waitUntil(
          caches.open("v1").then(function (cache) {
            // 1. Pre-fetches and caches /addressbook.json
            return cache.add("/addressbook.json");
          })
        );
      });

      // Opt to handle FetchEvent's from the page
      self.addEventListener("fetch", (event) => {
        event.respondWith(
          (async () => {
            // 1. Try to first serve directly from caches
            let response = await caches.match(event.request);
            if (response) return response;

            // 2. Re-write request for /foo to /bar
            if (event.request.url.endsWith("foo")) return fetch("./bar");

            // 3. Prevent tracker.js from being retrieved, and returns a placeholder response
            if (event.request.url.endsWith("tracker.js"))
              return new Response('console.log("no trackers!")', {
                status: 200,
                headers: { "Content-Type": "text/javascript" },
              });

            // 4. Otherwise, fallthrough, perform the fetch and respond
            return fetch(event.request);
          })()
        );
      });

      self.addEventListener("activate", (event) => {
        event.waitUntil(clients.claim());
      });
    `)
        res.end()
      })
      server.setRoute("/addressbook.json", (_request, res) => {
        res.write("{}")
        res.end()
      })

      const routed = new Set<string>()
      const recordRouted = (intercepted: { readonly request: NetworkRequest.NetworkRequest }) =>
        Effect.sync(() => routed.add(intercepted.request.hop))
      yield* context.route("**", (intercepted) => Effect.andThen(recordRouted(intercepted), Route.continue))
      yield* page.route("**", (intercepted) => Effect.andThen(recordRouted(intercepted), Route.continue))

      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/index.html", { waitUntil: "load" })
      const sw = yield* started
      yield* Expect.that(
        sw.evaluate(() => (Reflect.get(self, "registration") as ServiceWorkerRegistration).active?.state),
        Condition.make("activated", (state: unknown) => state === "activated")
      )

      for (const url of ["/addressbook.json", "/foo", "/tracker.js", "/fallthrough.txt"]) {
        yield* page.evaluateInMainWorld(async (url) => {
          await fetch(url)
        }, url)
      }

      assert.deepStrictEqual(yield* networkTable(page, routed), [
        tableHeader,
        "| [`event: BrowserContext.request`] | [Frame]          | index.html                     | Yes    |                                        |",
        "| [`event: Page.request`]           | [Frame]          | index.html                     | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | Service [Worker] | complex-service-worker.js      | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | Service [Worker] | addressbook.json               | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | [Frame]          | addressbook.json               |        | Yes                                    |",
        "| [`event: Page.request`]           | [Frame]          | addressbook.json               |        | Yes                                    |",
        "| [`event: BrowserContext.request`] | Service [Worker] | bar                            | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | [Frame]          | foo                            |        | Yes                                    |",
        "| [`event: Page.request`]           | [Frame]          | foo                            |        | Yes                                    |",
        "| [`event: BrowserContext.request`] | [Frame]          | tracker.js                     |        | Yes                                    |",
        "| [`event: Page.request`]           | [Frame]          | tracker.js                     |        | Yes                                    |",
        "| [`event: BrowserContext.request`] | Service [Worker] | fallthrough.txt                | Yes    |                                        |",
        "| [`event: BrowserContext.request`] | [Frame]          | fallthrough.txt                |        | Yes                                    |",
        "| [`event: Page.request`]           | [Frame]          | fallthrough.txt                |        | Yes                                    |"
      ])
    }))

  test("CR-019", ({ page, server }) =>
    Effect.gen(function*() {
      // The original is `test.fixme()`: its body runs here as written, and its outcome is a finding for the run.
      let version = 0
      server.setRoute("/worker.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/javascript" })
        res.write(`self.PW_VERSION = ${version++};`)
        res.end()
      })
      server.setRoute("/home", (_request, res) => {
        res.write(updateHome)
        res.end()
      })

      const context = page.context
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/home", { waitUntil: "load" })
      const sw = yield* started
      yield* Expect.that(
        sw.evaluate(() => Reflect.get(self, "PW_VERSION")),
        Condition.make("version 0", (value: unknown) => value === 0)
      )

      // Before triggering, the update request is intercepted.
      yield* context.route("**/worker.js", () =>
        Route.fulfill(
          HttpServerResponse.text("self.PW_VERSION = \"intercepted\";", { contentType: "text/javascript" })
        ))

      const updated = yield* BrowserWorker.next(context, { kind: "service" })
      const updateRequest = yield* NetworkRequest.next(context, { url: "**/worker.js" })
      yield* page.locator("#update").click()
      const updatedSW = yield* updated
      yield* updateRequest
      yield* Expect.that(
        updatedSW.evaluate(() => Reflect.get(self, "PW_VERSION")),
        Condition.make("intercepted", (value: unknown) => value === "intercepted")
      )
    }))

  test("CR-020", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      const worker = yield* started
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      yield* context.emulate({ network: "offline" })
      const innerSent = yield* NetworkRequest.next(context, { url: "**/inner.txt" })
      const error = yield* worker.evaluate(async () =>
        fetch("/inner.txt").then(() => "", (reason: unknown) => `REJECTED: ${reason}`)
      )
      yield* innerSent
      assert.match(error, /REJECTED.*Failed to fetch/)
    }))

  test("CR-021", ({ page, server }) =>
    Effect.gen(function*() {
      const context = page.context
      const started = yield* BrowserWorker.next(context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/fetch/sw.html", { waitUntil: "load" })
      const worker = yield* started
      yield* page.evaluateInMainWorld(async () => {
        await Reflect.get(window, "activationPromise")
      })
      yield* context.emulate({ extraHTTPHeaders: { "x-custom-header": "custom!" } })
      const requestPromise = yield* server.waitForRequest("/inner.txt")
      yield* worker.evaluate(async () => {
        await fetch("/inner.txt")
      })
      const req = yield* requestPromise
      assert.strictEqual(req.headers["x-custom-header"], "custom!")
    }))

  test("CR-022", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const userDataDir = yield* scratch
      const first = backend("chromium", {
        chromium: { userDataDir, args: ["--remote-debugging-port=9222"] }
      })
      const second = backend("chromium", {
        chromium: { userDataDir, args: ["--remote-debugging-port=9223"] }
      })
      const error = yield* Effect.scoped(Effect.gen(function*() {
        yield* Browser.Browser
        return yield* failureOf(
          Effect.scoped(Browser.Browser.pipe(Effect.provide(second))),
          "the second launch"
        )
      })).pipe(Effect.provide(first))
      assertProfileInUse(error)
    })))

  test("CR-023", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const userDataDir = yield* scratch
      // Two layers: providing one layer twice builds it once, and the second launch would be the first's browser again.
      const first = backend("chromium", { chromium: { userDataDir } })
      const second = backend("chromium", { chromium: { userDataDir } })
      const error = yield* Effect.scoped(Effect.gen(function*() {
        yield* Browser.Browser
        return yield* failureOf(
          Effect.scoped(Browser.Browser.pipe(Effect.provide(second))),
          "the second launch"
        )
      })).pipe(Effect.provide(first))
      assertProfileInUse(error)
    })))

  test("CR-026", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/serviceworkers/empty/sw.js", (_request, res) => {
        res.writeHead(200, "OK", { "Content-Type": "text/javascript" })
        res.write(`console.log('Hello from the first line of sw.js');`)
        res.end()
      })
      // The original asks the worker for its console messages after the worker exists, and Playwright holds the ones its
      // first line wrote. A Strider subscription gets what arrives after it, so it is made before the navigation starts
      // the worker: the first line's message must reach it.
      const logged = yield* ConsoleMessage.next(page.context, { text: "Hello from the first line of sw.js" })
      const started = yield* BrowserWorker.next(page.context, { kind: "service" })
      yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html", { waitUntil: "load" })
      yield* started
      const message = yield* logged
      assert.strictEqual(message.text, "Hello from the first line of sw.js")
      assert.strictEqual(message.level, "log")
    }))

  // CR-027 is Playwright's refusal of WebUI pages that crash its browser. Strider has no list of refused pages and passes
  // the navigation to the browser, so the port keeps what the refusal is for: whatever each navigation does, the browser
  // survives and the page evaluates afterwards. The original's `Cannot navigate to` message is Playwright's own.
  test("CR-027", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const hosts = ["apps", "extensions", "help", "history", "password-manager", "settings"]
      const urls = [
        ...hosts.map((host) => `chrome://${host}`),
        "chrome://extensions/",
        "chrome://settings/help",
        "chrome://SETTINGS",
        "chrome:settings",
        "chrome:///settings",
        "view-source:chrome://settings"
      ]
      const browser = yield* Browser.Browser
      const context = yield* browser.newContext()
      const page = yield* context.newPage
      for (const url of urls) yield* Effect.result(page.goto(url))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 1), 2)
    })).pipe(Effect.provide(backend("chromium", undefined))))

  // The original skips CR-029 and CR-030 when headless, as every run of its suite but a headed one is. Strider launches
  // Chromium headed (`headless: false`) on the integration environment's X server, so the port runs what they check.
  test("CR-029", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      yield* useXvfb().pipe(Effect.provide(NodeServices.layer))
      const navigation = yield* Effect.scoped(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.newContext()
        const page = yield* context.newPage
        return yield* page.goto("chrome://version")
      })).pipe(Effect.provide(backend("chromium", { chromium: { headless: false } })))
      assert.strictEqual(navigation._tag, "Committed")
      if (navigation._tag !== "Committed") return
      assert.isTrue(Option.isSome(navigation.response))
      assert.strictEqual(Option.getOrUndefined(navigation.response)?.status, 200)
    })))

  test("CR-030", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      yield* useXvfb().pipe(Effect.provide(NodeServices.layer))
      const userDataDir = yield* scratch
      const navigation = yield* Effect.scoped(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.defaultContext.control
        const page = yield* context.newPage
        // Committing the navigation is all this asserts - waiting for the WebUI to load is slow and beside the point.
        return yield* page.goto("chrome://extensions", { waitUntil: "commit" })
      })).pipe(Effect.provide(backend("chromium", { chromium: { headless: false, userDataDir } })))
      assert.strictEqual(navigation._tag, "Committed")
      if (navigation._tag !== "Committed") return
      assert.isTrue(Option.isSome(navigation.response))
      assert.strictEqual(Option.getOrUndefined(navigation.response)?.status, 200)
    })))
})
