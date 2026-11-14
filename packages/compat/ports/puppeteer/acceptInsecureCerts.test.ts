/**
 * Puppeteer's `test/src/acceptInsecureCerts.test.ts`: a browser that accepts the fixture server's self-signed HTTPS
 * certificate, for navigations, requests, mixed content, and a service worker.
 *
 * What the port changes:
 * - Puppeteer launches its own browser with `acceptInsecureCerts: true`, for the whole file. Strider's is the context
 *   option `Browser.newContext({ acceptInsecureCerts: true })`, so each test creates the context it needs and opens the
 *   page in it (`page: false`). The tests that don't accept certificates use `Browser.newContext()`.
 * - Chromium refuses `acceptInsecureCerts` with Unsupported, because its certificate override applies to the whole
 *   browser, so the four tests that need an accepting context are `needsFeature` on Chromium in the ledger. The port
 *   runs them on the other browsers. (The Playwright port, `ignorehttpserrors.test.ts`, has the same gap.)
 * - `httpsServer` is `server.https`, and `httpsServer.setRoute` is `server.setRoute`, which answers the same routes over
 *   TLS. `httpsServer.waitForRequest` isn't ported: the three `Response.securityDetails` tests read what the response
 *   exposes, and Strider's `NetworkResponse` has no security details, so they are in the ledger instead.
 * - `response.ok()` is the committed navigation's response having a 2xx status (`isOk`).
 * - Puppeteer's `page.setRequestInterception(true)` with `request.continue()` is `page.route("**\/*", …)` with
 *   `Route.continue`, which resolves each request as it arrives.
 * - "should work with mixed content" reads the main frame in the main world (`page.evaluateInMainWorld`), and the blocked
 *   iframe through a frame locator's isolated world, which stock WebKit doesn't have (`method-frame-evaluate`). Puppeteer's
 *   `frame.evaluate` runs in the frame's main world; the blocked iframe is reached by its element here, as Strider reaches
 *   frames.
 * - "works for service worker" reads the page's own `registrationPromise` in the main world, as the original does.
 */
import { assert } from "@effect/vitest"
import { Browser, type PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { frameCount } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Puppeteer's `response.ok()`: the navigation committed with a response whose status is 2xx. */
const isOk = (navigation: PageNavigation.PageNavigation) =>
  navigation._tag === "Committed" &&
  Option.match(navigation.response, {
    onNone: () => false,
    onSome: (response) => response.status >= 200 && response.status < 300
  })

upstream(import.meta.filename, {}, (test) => {
  test("acceptInsecureCerts should work", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      const navigation = yield* page.goto(server.https.EMPTY_PAGE, load)
      assert.isTrue(isOk(navigation))
    })))

  test(
    "acceptInsecureCerts should work with request interception",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.route("**/*", () => Route.continue)
        const navigation = yield* page.goto(server.https.EMPTY_PAGE, load)
        const status = navigation._tag === "Committed"
          ? Option.map(navigation.response, (response) => response.status)
          : Option.none<number>()
        assert.deepStrictEqual(status, Option.some(200))
      }))
  )

  test(
    "acceptInsecureCerts should work with mixed content",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        server.setRoute("/mixedcontent.html", (_request, response) => {
          response.end(`<iframe src=${server.EMPTY_PAGE}></iframe>`)
        })
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.goto(server.https.PREFIX + "/mixedcontent.html", load)
        assert.strictEqual(yield* frameCount(page), 2)
        // Puppeteer's `page.frames()[0].evaluate('1 + 2')`: the main frame, in the main world
        assert.strictEqual(yield* page.evaluateInMainWorld(() => 1 + 2), 3)
        // Puppeteer's `page.frames()[1].evaluate('2 + 3')`: the blocked iframe's execution context works
        const blocked = page.frame(page.locator("iframe"))
        assert.strictEqual(yield* blocked.locator(":root").evaluate(() => 2 + 3), 5)
      }))
  )

  test(
    "acceptInsecureCerts works for service worker",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ acceptInsecureCerts: true })
        const page = yield* context.newPage
        yield* page.goto(server.https.PREFIX + "/serviceworkers/empty/sw.html", load)
        yield* page.evaluateInMainWorld(async () => {
          return await (
            globalThis as unknown as {
              registrationPromise: Promise<{ unregister: () => Promise<boolean> }>
            }
          ).registrationPromise.then((registration) => registration.unregister())
        })
      }))
  )
})
