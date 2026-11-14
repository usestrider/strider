/**
 * Playwright's `tests/library/ignorehttpserrors.spec.ts`: a context that accepts the fixture server's self-signed HTTPS
 * certificate, isolated from contexts that don't, and what it does for mixed content and WebSockets.
 *
 * What the port changes:
 * - The original's `ignoreHTTPSErrors` is `acceptInsecureCerts` in `Browser.newContext`. Chromium refuses it, because its
 *   certificate override applies to the whole browser, so these tests run on Firefox and stock WebKit only, and the ledger
 *   marks Chromium `needsFeature` (as browsercontext-cookies-third-party's CO-052 does). NE-141 needs no such context, so
 *   it runs on every browser.
 * - `httpsServer` is `server.https`, and `httpsServer.setRoute` is `server.setRoute`, which answers the same routes over
 *   TLS. `httpsServer.sendOnWebSocketConnection` is `server.sendOnWebSocketConnection`, which serves either server.
 * - `page.goto` waits for `load`, as the original's does. A navigation's `response.ok()` is the committed navigation's
 *   response status being 2xx.
 * - `expect(error).not.toBe(null)` on a navigation is `failureOf`: the navigation's failure, or the test fails.
 * - NE-138: the original leaves its first context open (its `context.close()` is commented out), so the port does too; the
 *   context closes with the test.
 * - NE-139 reads the second frame's execution context with `locator.evaluate` in the frame's isolated world. Stock WebKit
 *   has no isolated worlds (method-frame-evaluate), so the port runs on Firefox only, and the ledger marks WebKit.
 *   `page.frames().length` is `frameCount`, and the main frame's `page.evaluate` is `page.evaluateInMainWorld`.
 * - NE-140 and NE-141 run `page.evaluate` in the page's main world. Their `httpsServer.PREFIX.replace(/https/, 'wss')` is
 *   `server.https.PREFIX` with the scheme changed.
 * - NE-142 is `it.fixme` for Chromium, where it also needs the refused `acceptInsecureCerts`, so Chromium is `needsFeature`.
 *   It runs on Firefox and WebKit, as upstream's own skips aren't ours. Its `context.route('**\/*', route => route.continue())`
 *   is `context.route` with `Route.continue`. `page.textContent('body')` is `readText` of the body.
 */
import { assert } from "@effect/vitest"
import { Browser, type PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf, frameCount } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Playwright's `response.ok()`: the navigation committed with a response whose status is 2xx. */
const isOk = (navigation: PageNavigation.PageNavigation) =>
  navigation._tag === "Committed" &&
  Option.match(navigation.response, {
    onNone: () => false,
    onSome: (response) => response.status >= 200 && response.status < 300
  })

upstream(import.meta.filename, {}, (test) => {
  test(
    "NE-136",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        const navigation = yield* page.goto(server.https.EMPTY_PAGE, load)
        assert.isTrue(isOk(navigation))
      }))
  )

  test("NE-137", { page: false, browsers: ["firefox", "webkit"] }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        const navigation = yield* page.goto(server.https.EMPTY_PAGE, load)
        assert.isTrue(isOk(navigation))
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* failureOf(page.goto(server.https.EMPTY_PAGE, load), "the navigation to the self-signed certificate")
      }))
    }))

  test("NE-138", {
    page: false,
    browsers: ["firefox", "webkit"]
  }, ({ server }) =>
    Effect.gen(function*() {
      // The first context stays open, as the original's commented-out `context.close()` leaves it.
      const first = yield* Browser.newContext({ acceptInsecureCerts: true })
      const firstPage = yield* first.newPage
      const navigation = yield* firstPage.goto(server.https.EMPTY_PAGE, load)
      assert.isTrue(isOk(navigation))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* failureOf(page.goto(server.https.EMPTY_PAGE, load), "the navigation, where a TLS error is expected")
      }))
    }))

  test("NE-139", { page: false, browsers: ["firefox"] }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/mixedcontent.html", (_request, response) => {
        response.end(`<iframe src=${server.EMPTY_PAGE}></iframe>`)
      })
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      yield* page.goto(server.https.PREFIX + "/mixedcontent.html", load)
      assert.strictEqual(yield* frameCount(page), 2)
      // The main frame's evaluate, in the page's main world
      assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
      // The blocked iframe has a functional execution context: its isolated world evaluates
      const blocked = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* blocked.locator(":root").evaluate(() => 2 + 3), 5)
    })))

  test(
    "NE-140",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        server.sendOnWebSocketConnection("incoming")
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        const value = yield* page.evaluateInMainWorld((endpoint) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(endpoint)
            ws.addEventListener("message", (data) => {
              ws.close()
              resolve(data.data)
            })
            ws.addEventListener("error", () => resolve("Error"))
          }), server.https.PREFIX.replace(/https/, "wss") + "/ws")
        assert.strictEqual(value, "incoming")
      }))
  )

  test("NE-141", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const value = yield* page.evaluateInMainWorld((endpoint) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(endpoint)
          ws.addEventListener("message", (data) => {
            ws.close()
            resolve(data.data)
          })
          ws.addEventListener("error", () => resolve("Error"))
        }), server.https.PREFIX.replace(/https/, "wss") + "/ws")
      assert.strictEqual(value, "Error")
    })))

  test("NE-142", {
    page: false,
    browsers: ["firefox", "webkit"]
  }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      yield* context.route("**/*", () => Route.continue)
      server.setRoute("/sw.js", (_request, response) => {
        response.setHeader("Content-Type", "application/javascript")
        response.end(`
      self.addEventListener('fetch', event => {
        event.respondWith(new Response('intercepted'));
      });
      self.addEventListener('activate', event => {
        event.waitUntil(clients.claim());
      });
    `)
      })
      yield* page.goto(server.https.EMPTY_PAGE, load)
      yield* page.evaluateInMainWorld(async () => {
        const waitForControllerChange = new Promise((resolve) => navigator.serviceWorker.oncontrollerchange = resolve)
        await navigator.serviceWorker.register("/sw.js")
        await waitForControllerChange
      })
      yield* page.reload(load)
      assert.strictEqual(yield* page.locator("body").readText, "intercepted")
    })))
})
