/**
 * Playwright's `tests/library/browsercontext-timezone-id.spec.ts`: a context's `timezoneId`, which sets the time zone of
 * its pages and workers, and leaves other contexts alone.
 *
 * What the port changes:
 * - `browser.newContext({ timezoneId })` is `Browser.newContext({ emulation: { timezone } })`, and `locale` is
 *   `emulation.locale`. A context is held in a scope the test ends, so its pages close with it, as `context.close()` does.
 * - Strider refuses an invalid time zone when the context is created, with `InvalidInput` naming `timezone`
 *   (`UserContext.UserContextError`), before any page is made. TZ-002 asserts that typed reason, where Playwright
 *   asserts its message text, which differs by browser.
 * - `page.evaluate(…)` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - `expect.soft` (TZ-001) checks all four zones, and fails once with every mismatch, as the original's soft checks do.
 * - TZ-003 opens popups from scripts, which run as user gestures under Strider's popup blocking (`Page.withUserGesture`),
 *   and waits for each popup to reach its URL before evaluating in it.
 * - TZ-006 reads a dedicated worker's console message on its page, which Strider reports (`ConsoleMessage`).
 * - `page.goto` waits for `load` in Playwright and returns at commit in Strider, so the navigations name `waitUntil: "load"`.
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, Page, Popup, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `popup.waitForEvent` settles at the popup's first committed address: this waits for the same. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

/** The page's time zone, as its main world reads it. */
const timezoneOf = (page: Page.Page) => page.evaluateInMainWorld(() => Intl.DateTimeFormat().resolvedOptions().timeZone)

upstream(import.meta.filename, {}, (test) => {
  test("TZ-001", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      // Playwright's note: time zone names differ between browsers and platforms, so only the GMT offset is checked
      const func = () => new Date(1479579154987).toString()
      const cases: ReadonlyArray<readonly [string, string]> = [
        ["America/Jamaica", "Sat Nov 19 2016 13:12:34 GMT-0500"],
        ["Pacific/Honolulu", "Sat Nov 19 2016 08:12:34 GMT-1000"],
        [
          browserName === "firefox" ? "America/Argentina/Buenos_Aires" : "America/Buenos_Aires",
          "Sat Nov 19 2016 15:12:34 GMT-0300"
        ],
        ["Europe/Berlin", "Sat Nov 19 2016 19:12:34 GMT+0100"]
      ]
      // `expect.soft` keeps going after a mismatch, so every zone is read and the mismatches are reported together
      const mismatches: Array<string> = []
      for (const [timezone, expected] of cases) {
        yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* Browser.newContext({ emulation: { locale: "en-US", timezone } })
          const page = yield* context.newPage
          const text = yield* page.evaluateInMainWorld(func)
          if (!text.includes(expected)) mismatches.push(`${timezone}: "${text}" doesn't include "${expected}"`)
        }))
      }
      assert.deepStrictEqual(mismatches, [])
    }))

  test("TZ-002", { page: false }, () =>
    Effect.gen(function*() {
      for (const timezone of ["Foo/Bar", "Baz/Qux"]) {
        // Strider refuses the zone when the context is created, so the page isn't reached; its reason is typed
        const error = yield* failureOf(
          Effect.scoped(Browser.newContext({ emulation: { timezone } })),
          `a context in ${timezone}`
        )
        assert(UserContext.isUserContextError(error), String(error))
        assert.strictEqual(error.reason._tag, "InvalidInput")
        assert.include(error.message, timezone)
      }
    }))

  test("TZ-003", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { timezone: "Europe/Moscow" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `Promise.all([page.waitForEvent('popup'), page.evaluate(...)])`: subscribed before the script opens the popup
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.EMPTY_PAGE)
      // The popup opens a popup of its own, and the second wait is subscribed on the popup before its script runs
      const openedByPopup = yield* Popup.next(popup)
      yield* popup.evaluateInMainWorld((url) => {
        window.open(url)
      }, server.EMPTY_PAGE).pipe(Page.withUserGesture)
      const second = yield* openedByPopup
      yield* committed(second, server.EMPTY_PAGE)
    })))

  test("TZ-004", { page: false }, () =>
    Effect.gen(function*() {
      const defaultTimezone = yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        return yield* timezoneOf(yield* context.newPage)
      }))
      const timezoneOverride = defaultTimezone === "Europe/Moscow" ? "America/Los_Angeles" : "Europe/Moscow"
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext({ emulation: { timezone: timezoneOverride } })
        assert.strictEqual(yield* timezoneOf(yield* context.newPage), timezoneOverride)
      }))
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        assert.strictEqual(yield* timezoneOf(yield* context.newPage), defaultTimezone)
      }))
    }))

  test("TZ-005", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { timezone: "America/Jamaica" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => new Intl.DateTimeFormat().resolvedOptions().timeZone),
        "America/Jamaica"
      )
    })))

  test("TZ-006", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { timezone: "America/Jamaica" } })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // `Promise.all([page.waitForEvent('console'), page.evaluate(() => new Worker(...))])`
      const logged = yield* ConsoleMessage.next(page)
      yield* page.evaluateInMainWorld(() => {
        // The worker is not returned: a Worker doesn't cross as a value, as Playwright's `evaluate` doesn't return it
        new Worker(URL.createObjectURL(
          new Blob(["console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"], {
            type: "application/javascript"
          })
        ))
      })
      const message = yield* logged
      assert.strictEqual(message.text, "America/Jamaica")
    })))
})
