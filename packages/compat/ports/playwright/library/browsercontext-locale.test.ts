/**
 * Playwright's `tests/library/browsercontext-locale.spec.ts`: a context's locale and timezone, what they change in the
 * page (`navigator.language`, `Intl`, `Date`, `Accept-Language`), and what a popup and a worker inherit from them.
 *
 * What the port changes:
 * - `browser.newContext({ locale, timezoneId })` is `Browser.newContext({ emulation: { locale, timezone } })`: the locale
 *   and timezone are emulation the context holds for its life. Each context a test makes runs in `Effect.scoped`, so it
 *   closes where the original calls `context.close()`.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A page that opens a popup with
 *   `window.open` runs that call as a user gesture under Strider's popup blocking (`Page.withUserGesture`).
 * - `page.waitForEvent("popup")` is `Popup.next(page)`, subscribed before the `window.open` it waits for. A popup that
 *   navigates is waited on until it has committed its address and parsed (`committed`, `parsed`), as popup.test.ts does
 *   for Playwright's `popup` event.
 * - `page.waitForEvent("console", predicate)` is `ConsoleMessage.next(page, { text })`, with a RegExp for the
 *   `startsWith` the predicate checks.
 * - `server.waitForWebSocketConnectionRequest()` is `server.waitForWebSocket`: its peer's `request` is the upgrade request.
 * - LC-008's `it.slow()` triples the original's timeout; the port keeps the harness's 30 seconds. Its eight pages open at
 *   once, as the original's `Promise.all` does.
 * - LC-013 and LC-014 are `it.fixme` for Chromium before 151 upstream. The pinned Chromium is newer, so they run as written.
 * - `window["result"]` and `window.initialNavigatorLanguage` are read with `Reflect.get`, as the other ports read a page's
 *   globals.
 * - LC-010's `browserName === "webkit"` branch is kept, since the file runs on stock WebKit too, where the locale is `ru`.
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, Page, Popup, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `waitForLoadState("domcontentloaded")`: the document has parsed, its readiness `interactive` or `complete`. */
const parsed = (status: Page.Status) => status._tag === "Open" && status.document.readiness !== "loading"

/**
 * Playwright reports a popup once its first navigation has committed, so what a test reads from a popup after
 * `waitForEvent("popup")` is the loaded document. Strider reports a popup as soon as it appears, so the port waits for
 * the committed address the original's event implies.
 */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

/** The locale a context's `Intl.NumberFormat` resolves, in a fresh context that the test then closes. */
const numberFormatLocale = (options: UserContext.Options | undefined) =>
  Effect.scoped(Effect.gen(function*() {
    const context = yield* Browser.newContext(options)
    const page = yield* context.newPage
    return yield* page.evaluateInMainWorld(() => (new Intl.NumberFormat()).resolvedOptions().locale)
  }))

upstream(import.meta.filename, {}, (test) => {
  test("LC-001", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "fr-CH" } })
      const page = yield* context.newPage
      const requested = yield* server.waitForRequest("/empty.html")
      yield* page.goto(server.EMPTY_PAGE)
      const request = yield* requested
      assert.strictEqual(String(request.headers["accept-language"]).slice(0, 5), "fr-CH")
    })))

  test("LC-002", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "fr-FR" } })
      const page = yield* context.newPage
      assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.language), "fr-FR")
    })))

  test("LC-003", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { locale: "en-US" } })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE)
        assert.strictEqual(yield* page.evaluateInMainWorld(() => (1000000.50).toLocaleString()), "1,000,000.5")
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { locale: "fr-FR" } })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE)
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => (1000000.50).toLocaleString().replace(/\s/g, " ")),
          "1 000 000,5"
        )
      }))
    }))

  test("LC-004", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({
          emulation: { locale: "en-US", timezone: "America/Los_Angeles" }
        })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE)
        const formatted = "Sat Nov 19 2016 10:12:34 GMT-0800 (Pacific Standard Time)"
        assert.strictEqual(yield* page.evaluateInMainWorld(() => new Date(1479579154987).toString()), formatted)
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { locale: "de-DE", timezone: "Europe/Berlin" } })
        const page = yield* context.newPage
        yield* page.goto(server.EMPTY_PAGE)
        const formatted = "Sat Nov 19 2016 19:12:34 GMT+0100 (Mitteleuropäische Normalzeit)"
        assert.strictEqual(yield* page.evaluateInMainWorld(() => new Date(1479579154987).toString()), formatted)
      }))
    }))

  test("LC-005", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "fr-FR" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.PREFIX + "/formatted-number.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/formatted-number.html")
      yield* popup.status.waitFor(parsed)
      assert.strictEqual(yield* popup.evaluateInMainWorld(() => Reflect.get(window, "result")), "1 000 000,5")
    })))

  test("LC-006", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "fr-FR" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.PREFIX + "/formatted-number.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/formatted-number.html")
      yield* popup.status.waitFor(parsed)
      assert.strictEqual(
        yield* popup.evaluateInMainWorld(() => Reflect.get(window, "initialNavigatorLanguage")),
        "fr-FR"
      )
    })))

  test("LC-007", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "ru-RU" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* opened
      // The popup opens a popup of its own: the same wait, on the popup's page
      const openedAgain = yield* Popup.next(popup)
      yield* popup.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      yield* openedAgain
    })))

  test("LC-008", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // The original's `it.slow()` isn't ported: the harness's 30 seconds is the budget for this test
      const context1 = yield* Browser.newContext({ emulation: { locale: "en-US" } })
      // By default firefox limits number of child web processes to 8.
      yield* Effect.forEach(Array.from({ length: 8 }), () => context1.newPage, { concurrency: "unbounded" })
      const context2 = yield* Browser.newContext({ emulation: { locale: "ru-RU" } })
      const page2 = yield* context2.newPage
      const localeNumber = () => (1000000.50).toLocaleString()
      const numbers = yield* Effect.forEach(
        yield* context1.pages,
        (page) => page.evaluateInMainWorld(localeNumber),
        { concurrency: "unbounded" }
      )
      for (const value of numbers) assert.strictEqual(value, "1,000,000.5")
      assert.strictEqual(yield* page2.evaluateInMainWorld(localeNumber), "1\u00a0000\u00a0000,5")
    })))

  test("LC-009", { page: false }, () =>
    Effect.gen(function*() {
      const defaultLocale = yield* numberFormatLocale(undefined)
      const localeOverride = defaultLocale === "es-MX" ? "de-DE" : "es-MX"
      assert.strictEqual(yield* numberFormatLocale({ emulation: { locale: localeOverride } }), localeOverride)
      assert.strictEqual(yield* numberFormatLocale(undefined), defaultLocale)
    }))

  test("LC-010", { page: false }, ({ server, browserName }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "ru-RU" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const message = yield* ConsoleMessage.next(page, { text: /^locale:/ })
      const languages = yield* ConsoleMessage.next(page, { text: /^languages:/ })
      const requested = yield* server.waitForRequest("/title.html")
      yield* page.evaluateInMainWorld((url) => {
        new Worker(URL.createObjectURL(
          new Blob([`
      console.log("locale:" + Intl.NumberFormat().resolvedOptions().locale);
      console.log("languages:" + navigator.languages);
      fetch(${JSON.stringify(url)});
    `], {
            type: "application/javascript"
          })
        ))
      }, server.PREFIX + "/title.html")
      const msg = yield* message
      const languagesMessage = yield* languages
      const request = yield* requested
      if (browserName === "webkit") {
        // Webkit on Ubuntu is "ru-RU", and on other platforms is "ru"
        assert.include(msg.text, "locale:ru")
        assert.include(languagesMessage.text, "languages:ru")
      } else {
        assert.strictEqual(msg.text, "locale:ru-RU")
        assert.strictEqual(languagesMessage.text, "languages:ru-RU")
      }
      assert.include(String(request.headers["accept-language"]), "ru-RU")
    })))

  test("LC-011", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "en-GB" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (new Intl.DateTimeFormat()).resolvedOptions().locale),
        "en-GB"
      )
    })))

  test("LC-012", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "en-GB" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      {
        const requested = yield* server.waitForRequest("/empty.html")
        yield* page.evaluateInMainWorld(async (url) => {
          await fetch(url, {
            headers: {
              "Content-Type": "application/json",
              "Accept-Language": "de"
            }
          })
        }, server.EMPTY_PAGE)
        const request = yield* requested
        assert.strictEqual(request.headers["accept-language"], "de")
      }
      {
        const requested = yield* server.waitForRequest("/empty.html")
        yield* page.evaluateInMainWorld(async (url) => {
          await fetch(url, {
            headers: {
              "Content-Type": "application/json"
            }
          })
        }, server.EMPTY_PAGE)
        const request = yield* requested
        assert.include(String(request.headers["accept-language"]), "en-GB")
      }
    })))

  test("LC-013", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "en-GB" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const connected = yield* server.waitForWebSocket
      yield* page.evaluateInMainWorld((port) => {
        new WebSocket(`ws://localhost:${port}/ws`)
      }, server.PORT)
      const peer = yield* connected
      assert.include(String(peer.request.headers["accept-language"]), "en-GB")
    })))

  test("LC-014", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { locale: "en-GB" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      const connected = yield* server.waitForWebSocket
      yield* page.evaluateInMainWorld((port) => {
        const code = `new WebSocket(${JSON.stringify(`ws://localhost:${port}/ws`)});`
        new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })))
      }, server.PORT)
      const peer = yield* connected
      assert.include(String(peer.request.headers["accept-language"]), "en-GB")
    })))
})
