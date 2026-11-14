/**
 * Playwright's `tests/library/geolocation.spec.ts`: a context's position for `navigator.geolocation`, set after its
 * creation or with its options, isolated per context, and followed by `watchPosition`, and a popup's inherits it.
 *
 * What the port changes:
 * - `context.grantPermissions(["geolocation"])` is `page.context.grant`, and `context.setGeolocation` is `emulate` with a
 *   `geolocation` field. An emulation lasts while its registration does, so GE-008, which moves the position, removes
 *   the previous registration before it sets the next, as the original's setGeolocation replaces the position.
 * - `browser.newContext({ geolocation, permissions })` is `Browser.newContext({ emulation: { geolocation }, permissions })`.
 *   A context made in the test is closed when its scope ends, as Playwright's `context.close()` does.
 * - `page.evaluate` reads `navigator.geolocation` in the page's main world, with `page.evaluateInMainWorld`, which awaits
 *   the promise.
 * - GE-002 (an out-of-range longitude is refused) has `emulate` fail with a `DeclarationError`: Strider checks no range itself,
 *   and the browser's refusal comes back as the failure.
 * - GE-004 and GE-006 test Playwright's runtime message for a missing field, which the `@ts-expect-error` in the original
 *   shows is a compile error for Strider's `Geolocation` type too; they're in the ledger as `notApplicable`.
 * - GE-008's console messages are read from `ConsoleMessage.next` (the message each step waits for) and from
 *   `ConsoleMessage.history` at the end, where the original's listener collected them from the first step on.
 * - GE-009 opens its popup from a script with `window.open`, which Strider's popup blocking treats as a user gesture
 *   only inside `Page.withUserGesture`. The popup's `waitForLoadState` is its status's readiness reaching `complete`.
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, Declaration, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A scope of the test's own, closed when the body ends, however it ends: Playwright's `context.close()` at the end. */
const inScope = <A, E, R>(body: (scope: Scope.Scope) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(Scope.make(), body, (scope) => Scope.close(scope, Exit.void))

/** The position `navigator.geolocation` reports in the page's main world: the original's `page.evaluate` of it. */
const currentPosition = (page: Page.Page) =>
  page.evaluateInMainWorld(() =>
    new Promise<{ latitude: number; longitude: number }>((resolve) =>
      navigator.geolocation.getCurrentPosition((position) => {
        resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude })
      })
    )
  )

/** A console message whose text includes `text`, subscribed to now: the wait the original's `waitForEvent` starts. */
const logged = (page: Page.Page, text: string) =>
  ConsoleMessage.next(page, undefined, (message) => Effect.succeed(message.text.includes(text)))

upstream(import.meta.filename, {}, (test) => {
  test("GE-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["geolocation"])
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.context.emulate({ geolocation: { longitude: 10, latitude: 10 } })
      assert.deepStrictEqual(yield* currentPosition(page), { latitude: 10, longitude: 10 })
    }))

  test("GE-002", ({ page }) =>
    Effect.gen(function*() {
      const failure = yield* failureOf(
        page.context.emulate({ geolocation: { longitude: 200, latitude: 10 } }),
        "emulate"
      )
      // The browser refuses the position, and `emulate` reports the refusal instead of applying it
      assert(Declaration.isDeclarationError(failure), String(failure))
      assert.include(failure.message, "geolocation")
    }))

  test("GE-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["geolocation"])
      yield* page.context.emulate({ geolocation: { longitude: 10, latitude: 10 } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })

      yield* inScope((scope) =>
        Effect.gen(function*() {
          const context2 = yield* Browser.newContext({
            permissions: ["geolocation"],
            emulation: { geolocation: { longitude: 20, latitude: 20 } }
          }).pipe(Scope.provide(scope))
          const page2 = yield* context2.newPage.pipe(Scope.provide(scope))
          yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })

          assert.deepStrictEqual(yield* currentPosition(page), { latitude: 10, longitude: 10 })
          assert.deepStrictEqual(yield* currentPosition(page2), { latitude: 20, longitude: 20 })
        })
      )
    }))

  test("GE-005", { page: false }, () =>
    Effect.gen(function*() {
      const geolocation = { longitude: 10, latitude: 10 }
      const options = { emulation: { geolocation } }
      yield* inScope((scope) =>
        Effect.gen(function*() {
          const context = yield* Browser.newContext(options).pipe(Scope.provide(scope))
          yield* context.emulate({ geolocation: { longitude: 20, latitude: 20 } }).pipe(Scope.provide(scope))
          // Strider's options are values the caller keeps: the position it was given is the one the caller passed
          assert.strictEqual(options.emulation.geolocation, geolocation)
        })
      )
    }))

  test("GE-007", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const options = {
        emulation: { geolocation: { longitude: 10, latitude: 10 } },
        permissions: ["geolocation"]
      }
      yield* inScope((scope) =>
        Effect.gen(function*() {
          const context = yield* Browser.newContext(options).pipe(Scope.provide(scope))
          const page = yield* context.newPage.pipe(Scope.provide(scope))
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.deepStrictEqual(yield* currentPosition(page), { latitude: 10, longitude: 10 })
        })
      )
    }))

  test("GE-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.grant(["geolocation"])
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      let position = yield* page.context.emulate({ geolocation: { latitude: 0, longitude: 0 } })
      // Each step replaces the position: the previous registration goes, then the next one is made
      const moveTo = Effect.fnUntraced(function*(latitude: number, longitude: number) {
        yield* position.remove
        position = yield* page.context.emulate({ geolocation: { latitude, longitude } })
      })

      yield* page.evaluateInMainWorld(() => {
        navigator.geolocation.watchPosition((pos) => {
          const coords = pos.coords
          console.log(`lat=${coords.latitude} lng=${coords.longitude}`)
        }, (_err) => {})
      })
      const first = yield* logged(page, "lat=0 lng=10")
      yield* moveTo(0, 10)
      yield* first
      const second = yield* logged(page, "lat=20 lng=30")
      yield* moveTo(20, 30)
      yield* second
      const third = yield* logged(page, "lat=40 lng=50")
      yield* moveTo(40, 50)
      yield* third

      const allMessages = (yield* ConsoleMessage.history(page)).entries.map((message) => message.text).join("|")
      assert.include(allMessages, "lat=0 lng=10")
      assert.include(allMessages, "lat=20 lng=30")
      assert.include(allMessages, "lat=40 lng=50")
    }))

  test("GE-009", ({ page, server }) =>
    Effect.gen(function*() {
      const url = server.PREFIX + "/geolocation.html"
      yield* page.context.grant(["geolocation"])
      yield* page.context.emulate({ geolocation: { longitude: 10, latitude: 10 } })

      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url) => {
        Reflect.set(window, "_popup", window.open(url))
      }, url).pipe(Page.withUserGesture)
      const popup = yield* opened
      // Strider reports the popup before its first navigation commits, so the port waits for the URL first
      yield* popup.url.waitFor((current) => current === url)
      yield* popup.status.waitFor((status) => status._tag === "Open" && status.document.readiness === "complete")

      const geolocation = yield* popup.evaluateInMainWorld(() => Reflect.get(window, "geolocationPromise"))
      assert.deepStrictEqual(geolocation, { longitude: 10, latitude: 10 })
    }))
})
