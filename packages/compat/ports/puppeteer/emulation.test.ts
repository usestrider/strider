/**
 * Puppeteer's `test/src/emulation.test.ts`: the viewport, mobile and touch emulation, the media a page reports, the time
 * zone, locale, network conditions, CPU slowdown, and focus a page is emulated with.
 *
 * What the port changes:
 * - `page.setViewport`, `page.emulate(device)`, `emulateMediaType`, `emulateMediaFeatures`, `emulateTimezone`,
 *   `emulateLocale`, and `emulateNetworkConditions` are `page.emulate`, a registration that lasts while its scope does.
 *   Puppeteer replaces what it sets, so `withEmulation` closes the previous registration before it opens the next (its
 *   fields restore first), and an empty settings object only closes it. A device's viewport carries its touch flag as
 *   `touch`, which Puppeteer's `hasTouch` is; the mobile flag stays on the viewport.
 * - `page.viewport()` is `page.viewportSize`, which reads the configured size as Puppeteer's getter does, as an `Option`.
 *   The harness's page is 1280×720, not Puppeteer's 800×600, so the first read is 1280×720.
 * - `page.evaluate` runs in the main world, so every page read is `page.evaluateInMainWorld`.
 * - `page.$('button')` is `page.locator('button')`, and its `style.marginTop` is set in the main world.
 * - `page.addScriptTag({ url })` has no Strider counterpart, so the "should detect touch when applying viewport with
 *   touches" test inserts the same `<script src>` element in the main world and waits for it to load. The test's point
 *   is the touch flag Modernizr reads, not the insertion, and the script is the vendored `modernizr.js`.
 * - "should support touch emulation" and "should support landscape emulation" check the page's current document. Strider
 *   applies touch handlers at the next document (`emulation.touch`'s note), and Chromium doesn't set the screen's size
 *   or orientation (ROOK-564), so those assertions fail on Chromium. "should detect touch when applying viewport with
 *   touches" fails the same way: its page is still the first document when the script runs, and Strider applies touch at
 *   the next one. "should support timezone offset" fails because Strider's `timezone` accepts IANA names only and refuses
 *   `GMT+10:00` before the browser sees it. These four are Strider's behavior, with no ledger entry.
 * - "should update media queries when resolution changes" compares its screenshot with Puppeteer's golden PNG, which the
 *   harness doesn't carry for Strider's output. The port keeps the property the golden checks that the bytes can show:
 *   the image's size, device pixels, read from its PNG header (`pngSize`), as the Playwright screenshot port does.
 * - The offline tests call `emulateNetworkConditions({ offline: true, … })`, whose throughput and latency are zero:
 *   Strider's `network: "offline"` is the offline mode with none of those fields, so the port uses it.
 * - "should change navigator.connection.effectiveType" takes Puppeteer's `PredefinedNetworkConditions` values, converted
 *   to Strider's bytes per second and milliseconds: Fast 3G and Slow 3G.
 * - "should emulate focus" makes its page with `focus: "emulated"`, as the Playwright emulation-focus port does: Strider has
 *   focus emulation at a page's creation, not as an emulation to switch on afterwards. "should reset focus" switches it
 *   off again, which Strider has no call for, so it isn't ported (see the ledger).
 * - `page.bringToFront()` is `page.activate`.
 * - "should throw in case of bad argument" for the media types and features, and for the vision deficiency, is in the
 *   ledger: Puppeteer checks a string at run time, and Strider's types reject a value outside the union before the call.
 *   An invalid time zone is refused at run time by Strider's schema, so "should throw for invalid timezone IDs" is
 *   ported: its assertion is Strider's typed reason, not Puppeteer's message.
 * - Puppeteer's `emulateMediaFeatures` lists features that Strider's `Emulation.Media` doesn't name (`color-gamut`,
 *   `prefers-reduced-transparency`), so the two tests that set them are not ported.
 * - `emulateVisionDeficiency` and its two tests aren't ported: Strider has no vision deficiency emulation.
 */
import { assert } from "@effect/vitest"
import { Browser, Declaration, Emulation, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import { failureOf } from "../harness/playwright.ts"
import { pngSize } from "../harness/png.ts"
import { upstream } from "../harness/upstream.ts"

type Settings = Emulation.Emulation

/**
 * Holds the page's emulation: each `emulate` call replaces what the previous one held, as Puppeteer's setters do. An
 * empty settings object releases the previous registration and holds nothing.
 */
const withEmulation = Effect.fnUntraced(function*<A, E, R>(
  page: Page.Page,
  body: (emulate: (settings: Settings) => Effect.Effect<void, unknown>) => Effect.Effect<A, E, R>
) {
  const held = yield* Ref.make<Option.Option<Scope.Closeable>>(Option.none())
  const release = Effect.gen(function*() {
    const current = yield* Ref.getAndSet(held, Option.none())
    if (Option.isSome(current)) yield* Scope.close(current.value, Exit.void)
  })
  const emulate = Effect.fnUntraced(function*(settings: Settings) {
    // Close the previous registration first: its restoration would otherwise replace the new one's fields
    yield* release
    if (Object.keys(settings).length === 0) return
    const scope = yield* Scope.make()
    yield* page.emulate(settings).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    yield* Ref.set(held, Option.some(scope))
  })
  return yield* body(emulate).pipe(Effect.ensuring(release))
})

/** Puppeteer's `KnownDevices['iPhone 6']`: its viewport (mobile, touch, device scale 2) and its user agent. */
const iPhone6Viewport = { width: 375, height: 667, deviceScaleFactor: 2, mobile: true } as const
const iPhone6: Settings = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/11.0 Mobile/15A372 Safari/604.1",
  viewport: iPhone6Viewport,
  touch: true
}

/** Puppeteer's `KnownDevices['iPhone 6 landscape']`. */
const iPhone6Landscape: Settings = {
  userAgent: iPhone6.userAgent,
  viewport: { width: 667, height: 375, deviceScaleFactor: 2, mobile: true },
  touch: true
}

/** Puppeteer's `KnownDevices['iPhone 13']`. */
const iPhone13: Settings = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  touch: true
}

/** Puppeteer's `KnownDevices['iPad Pro landscape']`. */
const iPadProLandscape: Settings = {
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 11_0 like Mac OS X) AppleWebKit/604.1.34 (KHTML, like Gecko) Version/11.0 Mobile/15A5341f Safari/604.1",
  viewport: { width: 1366, height: 1024, deviceScaleFactor: 2, mobile: true },
  touch: true
}

/** Puppeteer's `PredefinedNetworkConditions`, in bytes per second and milliseconds. */
const slow3G: Settings = { network: { download: 50_000, upload: 50_000, latency: 2_000 } }
const fast3G: Settings = { network: { download: 180_000, upload: 84_375, latency: 562.5 } }

/** The page's `window.innerWidth`, in its main world. */
const innerWidth = (page: Page.Page) => page.evaluateInMainWorld(() => window.innerWidth)

/** The page's `matchMedia(query).matches`, in its main world. */
const matches = (page: Page.Page, query: string) =>
  page.evaluateInMainWorld((query: string) => matchMedia(query).matches, query)

/** A page global, read in its main world. */
const pageGlobal = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name: string) => Reflect.get(window, name), name)

/** Puppeteer's `page.addScriptTag({ url })`: a `<script src>` in the main world, awaited until it loads. */
const addScriptTag = (page: Page.Page, url: string) =>
  page.evaluateInMainWorld(
    (url: string) =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script")
        script.src = url
        script.onload = () => resolve()
        script.onerror = () => reject(new Error(`the script ${url} didn't load`))
        document.head.appendChild(script)
      }),
    url
  )

/** The page's `dispatchTouch`: a touch the page's handler receives, and a value its own promise settles with. */
function dispatchTouch() {
  let fulfill!: (value: string) => void
  const promise = new Promise<string>((x) => {
    fulfill = x
  })
  window.ontouchstart = () => {
    fulfill("Received touch")
  }
  window.dispatchEvent(new Event("touchstart"))

  fulfill("Did not receive touch")

  return promise
}

upstream(import.meta.filename, {}, (test) => {
  test("Emulation Page.viewport should get the proper viewport size", ({ page }) =>
    Effect.gen(function*() {
      // The harness's page is 1280×720, where Puppeteer's default is 800×600
      assert.deepStrictEqual(Option.getOrUndefined(yield* page.viewportSize), { width: 1280, height: 720 })
      yield* page.emulate({ viewport: { width: 123, height: 456 } })
      assert.deepStrictEqual(Option.getOrUndefined(yield* page.viewportSize), { width: 123, height: 456 })
    }))

  test("Emulation Page.viewport should support mobile emulation", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
        // The harness's page is 1280 wide, where Puppeteer's default is 800
        assert.strictEqual(yield* innerWidth(page), 1280)
        yield* emulate({ viewport: iPhone6Viewport, touch: true })
        assert.strictEqual(yield* innerWidth(page), 375)
        yield* emulate({ viewport: { width: 400, height: 300 } })
        assert.strictEqual(yield* innerWidth(page), 400)
      })))

  test("Emulation Page.viewport should support touch emulation", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
        assert.isFalse(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
        yield* emulate({ viewport: iPhone6Viewport, touch: true })
        assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
        assert.strictEqual(yield* page.evaluateInMainWorld(dispatchTouch), "Received touch")
        yield* emulate({ viewport: { width: 100, height: 100 } })
        assert.isFalse(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
      })))

  test("Emulation Page.viewport should be detectable by Modernizr", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const text = () => page.evaluateInMainWorld(() => document.body.textContent!.trim())
        yield* page.goto(server.PREFIX + "/detect-touch.html", { waitUntil: "load" })
        assert.strictEqual(yield* text(), "NO")
        yield* emulate({ viewport: iPhone6Viewport, touch: true })
        yield* page.goto(server.PREFIX + "/detect-touch.html", { waitUntil: "load" })
        assert.strictEqual(yield* text(), "YES")
      })))

  test("Emulation Page.viewport should detect touch when applying viewport with touches", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        // Puppeteer's `hasTouch` with no mobile flag: a touch-enabled desktop-sized viewport
        yield* emulate({ viewport: { width: 800, height: 600 }, touch: true })
        yield* addScriptTag(page, server.PREFIX + "/modernizr.js")
        assert.isTrue(
          yield* page.evaluateInMainWorld(() =>
            (globalThis as unknown as { Modernizr: { touchevents: boolean } }).Modernizr.touchevents
          )
        )
      })))

  test("Emulation Page.viewport should support landscape emulation", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const orientation = () => page.evaluateInMainWorld(() => screen.orientation.type)
        yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
        assert.strictEqual(yield* orientation(), "portrait-primary")
        yield* emulate({ viewport: iPhone6Landscape.viewport, touch: true })
        assert.strictEqual(yield* orientation(), "landscape-primary")
        yield* emulate({ viewport: { width: 100, height: 100 } })
        assert.strictEqual(yield* orientation(), "portrait-primary")
      })))

  test("Emulation Page.viewport should update media queries when resolution changes", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const fontSize = () =>
          page.evaluateInMainWorld(() => parseInt(window.getComputedStyle(document.querySelector("p")!).fontSize, 10))
        for (const dpr of [1, 2, 3]) {
          yield* emulate({ viewport: { width: 800, height: 600, deviceScaleFactor: dpr } })
          yield* page.goto(server.PREFIX + "/resolution.html", { waitUntil: "load" })
          assert.strictEqual(yield* fontSize(), dpr)
          // Puppeteer compares this capture with its golden `device-pixel-ratio${dpr}.png`; the golden's size is the check
          // the port keeps, in device pixels
          const screenshot = yield* page.screenshot()
          assert.deepStrictEqual(pngSize(screenshot), { width: 800 * dpr, height: 600 * dpr })
        }
      })))

  test("Emulation Page.viewport should load correct pictures when emulation dpr", ({ page, server }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const currentSrc = () => page.evaluateInMainWorld(() => document.querySelector("img")!.currentSrc)
        for (const dpr of [1, 2, 3]) {
          yield* emulate({ viewport: { width: 800, height: 600, deviceScaleFactor: dpr } })
          yield* page.goto(server.PREFIX + "/picture.html", { waitUntil: "load" })
          assert.match(String(yield* currentSrc()), new RegExp(`logo-${dpr}x.png`))
        }
      })))

  test("Emulation Page.emulate should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      yield* page.emulate(iPhone6)
      assert.strictEqual(yield* innerWidth(page), 375)
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
    }))

  test("Emulation Page.emulate should work twice on about:blank", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("about:blank", { waitUntil: "load" })
      yield* page.emulate(iPhone13)
      yield* page.emulate(iPadProLandscape)
    }))

  test("Emulation Page.emulate should support clicking", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate(iPhone6)
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      // Puppeteer's `button.style.marginTop = '200px'`, in the main world
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.style.marginTop = "200px"
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* pageGlobal(page, "result"), "Clicked")
    }))

  test("Emulation Page.emulateMediaType should work", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        assert.isTrue(yield* matches(page, "screen"))
        assert.isFalse(yield* matches(page, "print"))
        yield* emulate({ media: { type: "print" } })
        assert.isFalse(yield* matches(page, "screen"))
        assert.isTrue(yield* matches(page, "print"))
        // Puppeteer's `emulateMediaType()` with no type resets it
        yield* emulate({})
        assert.isTrue(yield* matches(page, "screen"))
        assert.isFalse(yield* matches(page, "print"))
      })))

  test("Emulation Page.emulateMediaFeatures should work with prefers-contrast", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* emulate({ media: { contrast: "more" } })
        assert.isTrue(yield* matches(page, "(prefers-contrast: more)"))
        assert.isFalse(yield* matches(page, "(prefers-contrast: no-preference)"))
      })))

  test("Emulation Page.emulateMediaFeatures should work with forced-colors", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* emulate({ media: { forcedColors: "active" } })
        assert.isTrue(yield* matches(page, "(forced-colors: active)"))
        assert.isFalse(yield* matches(page, "(forced-colors: none)"))
      })))

  test("Emulation Page.emulateTimezone should work", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const date = () => page.evaluateInMainWorld(() => String(Reflect.get(globalThis, "date")))
        yield* page.evaluateInMainWorld(() => {
          Reflect.set(globalThis, "date", new Date(1479579154987))
        })
        yield* emulate({ timezone: "America/Jamaica" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 13:12:34 GMT-0500 (Eastern Standard Time)")

        yield* emulate({ timezone: "Pacific/Honolulu" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 08:12:34 GMT-1000 (Hawaii-Aleutian Standard Time)")

        yield* emulate({ timezone: "America/Buenos_Aires" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 15:12:34 GMT-0300 (Argentina Standard Time)")

        yield* emulate({ timezone: "Europe/Berlin" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 19:12:34 GMT+0100 (Central European Standard Time)")

        yield* emulate({ timezone: "GMT" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 18:12:34 GMT+0000 (Greenwich Mean Time)")
      })))

  test("Emulation Page.emulateTimezone should support timezone offset", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const date = () => page.evaluateInMainWorld(() => String(Reflect.get(globalThis, "date")))
        yield* page.evaluateInMainWorld(() => {
          Reflect.set(globalThis, "date", new Date(1479579154987))
        })
        yield* emulate({ timezone: "GMT+10:00" })
        assert.strictEqual(yield* date(), "Sun Nov 20 2016 04:12:34 GMT+1000 (GMT+10:00)")

        yield* emulate({ timezone: "GMT-12:34" })
        assert.strictEqual(yield* date(), "Sat Nov 19 2016 05:38:34 GMT-1234 (GMT-12:34)")
      })))

  test("Emulation Page.emulateTimezone should throw for invalid timezone IDs", ({ page }) =>
    Effect.gen(function*() {
      for (const timezone of ["Foo/Bar", "Baz/Qux"]) {
        // Strider refuses the zone before the browser sees it, with the field's name and the zone in the hint
        const error = yield* failureOf(page.emulate({ timezone }), `an emulation in ${timezone}`)
        assert(Declaration.isDeclarationError(error), String(error))
        assert(error.reason._tag === "InvalidInput", error.reason._tag)
        assert.strictEqual(error.reason.input, "timezone")
        assert.include(error.message, timezone)
      }
    }))

  test("Emulation Page.emulateLocale should work", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const resolvedLocale = () => page.evaluateInMainWorld(() => Intl.NumberFormat().resolvedOptions().locale)
        const defaultLocale = yield* resolvedLocale()
        const defaultLanguage = yield* page.evaluateInMainWorld(() => navigator.language)

        yield* emulate({ locale: "de-DE" })
        assert.strictEqual(yield* resolvedLocale(), "de-DE")
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => new Intl.NumberFormat().format(123456.78)),
          "123.456,78"
        )
        assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.language), "de-DE")
        assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.languages[0]), "de-DE")

        yield* emulate({ locale: "fr-FR" })
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() => Intl.DateTimeFormat().resolvedOptions().locale),
          "fr-FR"
        )

        // Puppeteer's `emulateLocale()` with no locale resets it
        yield* emulate({})
        assert.strictEqual(yield* resolvedLocale(), defaultLocale)
        assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.language), defaultLanguage)
      })))

  test("Emulation Page.emulateNetworkConditions should support offline", ({ page, server, browserName }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* emulate({ network: "offline" })
        const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
        assert(Page.isPageError(error), String(error))
        assert(error.reason._tag === "NavigationFailed", error.reason._tag)
        assert.include(
          error.reason.netError,
          browserName === "firefox" ? "NS_ERROR_OFFLINE" : "ERR_INTERNET_DISCONNECTED"
        )
      })))

  test("Emulation Page.emulateNetworkConditions should support offline without additional parameters", ({ page, server, browserName }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* emulate({ network: "offline" })
        const error = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the goto")
        assert(Page.isPageError(error), String(error))
        assert(error.reason._tag === "NavigationFailed", error.reason._tag)
        assert.include(
          error.reason.netError,
          browserName === "firefox" ? "NS_ERROR_OFFLINE" : "ERR_INTERNET_DISCONNECTED"
        )

        // Puppeteer's `emulateNetworkConditions(null)`
        yield* emulate({})
        const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        assert(navigation._tag === "Committed", navigation._tag)
        assert.strictEqual(Option.getOrUndefined(Option.map(navigation.response, (response) => response.status)), 200)
      })))

  test("Emulation Page.emulateNetworkConditions should change navigator.connection.effectiveType", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        const effectiveType = () =>
          page.evaluateInMainWorld(() =>
            (navigator as unknown as { connection: { effectiveType: string } }).connection.effectiveType
          )
        assert.strictEqual(yield* effectiveType(), "4g")
        yield* emulate(fast3G)
        assert.strictEqual(yield* effectiveType(), "3g")
        yield* emulate(slow3G)
        assert.strictEqual(yield* effectiveType(), "2g")
        yield* emulate({})
      })))

  test("Emulation Page.emulateCPUThrottling should change the CPU throttling rate successfully", ({ page }) =>
    withEmulation(page, (emulate) =>
      Effect.gen(function*() {
        yield* emulate({ cpuSlowdown: 100 })
        yield* emulate({})
      })))

  test("Emulation Page.emulateFocusedPage should emulate focus", { page: false }, () =>
    Effect.gen(function*() {
      // Puppeteer emulates focus on the page the test has; Strider takes it when a page is made, so this page is made with it
      const page = yield* Browser.newPage({ focus: "emulated" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => document.hasFocus()))
      const page2 = yield* page.context.newPage
      // Move the page into the background by focusing page2
      yield* page2.activate
      assert.isTrue(yield* page.evaluateInMainWorld(() => document.hasFocus()))
    }))

  // Not ported, see the ledger: the vision deficiency tests, the media features Strider doesn't name, the bad-argument
  // tests Strider's types make unreachable, and "should reset focus", which Strider's focus emulation can't turn off.
})
