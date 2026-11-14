/**
 * Playwright's `tests/library/screenshot.spec.ts`: a page's and an element's captures on mobile and device-scale
 * viewports, clips, full-page captures of large and viewport-sized pages, parallel captures, and a capture while the
 * page's event loop is blocked or its main resource hangs.
 *
 * What the port changes:
 * - Most of the original's golden images (`toMatchSnapshot`, `toHaveScreenshot`) were made with Playwright's own
 *   browser builds and fonts, which Strider's pinned browsers don't match. A port keeps what the bytes can show: the
 *   image's size, read from its PNG header (`pngSize`), and the pixels where the original reads them (`decodePng`).
 *   A test that is only a golden comparison is not applicable (see the ledger). The PNG reader is the harness's
 *   (`harness/png.ts`).
 * - Each test makes its own contexts and pages (`page: false`), as the original does through its `browser` and
 *   `contextFactory` fixtures, except SS-080, which uses the harness page as the original does.
 * - `browser.newContext({ viewport, isMobile, deviceScaleFactor })` is `Browser.newContext({ emulation: { viewport } })`,
 *   with `mobile: true` and `deviceScaleFactor` on the viewport. A viewport's device scale defaults to 1, as Playwright's
 *   does.
 * - `page.setViewportSize(size)` is `page.emulate({ viewport })`, and `page.viewportSize()` is `page.viewportSize`, an
 *   `Option`. Each `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - `page.screenshot({ fullPage: true })` is `area: "fullPage"`, `{ clip }` is `area: { clip }`, and an element
 *   capture (`elementHandle.screenshot()` or `locator.screenshot()`) is `area: { element }`. Playwright's `scale: "css"`
 *   is Strider's `scale: "css"`, which Chromium has.
 * - Playwright's `PNG.bitblt` pixel read is `pixelAt` over the decoded image. Playwright's `expect(...).toBeInstanceOf(
 *   Buffer)` is an instance check on the `Uint8Array` Strider returns.
 * - SS-080 blocks the page with Playwright's `__testHookBeforeScreenshot`, which runs between a capture's preparation and
 *   its capture. Strider has no such hook, so the port starts the same blocked script before the capture, and waits for
 *   the same console message. The capture's `timeout: 200` is `Deadline.within("200 millis")`, and the error is a
 *   `Deadline.Timeout` of `Page.screenshot`, which is what the original's message names.
 * - SS-091's `page.goto(…, { timeout: 1000 })` is the goto under `Deadline.within("1 second")`, whose failure the
 *   original ignores. SS-091 is skipped on Chromium upstream (playwright#9757): Chromium never answers
 *   `Page.captureScreenshot` while the main resource is still loading, so Strider's capture ends at its deadline (see
 *   the ledger).
 * - SS-077's too-large full-page capture is refused as a `PageError` on stock WebKit, as SS-065 does. Playwright's own
 *   message ("Cannot take screenshot larger than 32767") is its wording, so the port asserts the refusal, not the words.
 *   Firefox's Playwright branch is for its non-BiDi backend and isn't asserted here, as the original doesn't assert it
 *   on BiDi.
 * - SS-078 and SS-079's `fixme`/`slow` annotations: SS-078 is a fixme only for headed Chromium on Linux, so it runs here;
 *   `browserTest.slow(…)` extends the original's timeout, which this harness doesn't do.
 * - The full-element captures of SS-092 and SS-093 are checked by size, the element's box times the device scale or
 *   the CSS size, and by the pixels at their corners and center (`assertWholeElement`), where the original compares a
 *   golden. The boxes are asserted first so a changed layout is named.
 * - SS-094 is a `toHaveScreenshot` of a transformed element at device scale, and its only check is that golden. It's
 *   not applicable (see the ledger).
 * - SS-075, SS-083, SS-084, and SS-088 render with `viewport: null`, which is a context with no viewport declaration:
 *   Strider's unset viewport is the window's own size, as Playwright's null is (`browsercontext-viewport`'s VP-010).
 * - Playwright's `verifyViewport` (`tests/config/utils.ts`) is `verifyViewport` here: the configured viewport and the
 *   page's own `innerWidth`/`innerHeight`.
 * - Fixed waits the original makes itself are `Effect.sleep`, and none is added.
 * - Mobile emulation is refused on Firefox and stock WebKit (`emulation.viewport.mobile`), and a device scale other than
 *   1 needs the same capability, so those tests are ledgered for those browsers. CSS-pixel scale is missing on both as
 *   well (`screenshot.cssScale`).
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, Deadline, Page, Pixels } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { failureOf } from "../../harness/playwright.ts"
import { decodePng, pixelAt, pngSize } from "../../harness/png.ts"
import { upstream } from "../../harness/upstream.ts"

/** Whether two PNGs draw the same pixels, whatever their encoding. */
const samePixels = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(decodePng(a).data).equals(decodePng(b).data)

/** A capture's PNG size: the CSS size times the page's device pixel ratio. */
const assertPngOfSize = Effect.fnUntraced(function*(
  page: Page.Page,
  bytes: Uint8Array,
  css: { readonly width: number; readonly height: number }
) {
  const ratio = yield* page.evaluateInMainWorld(() => window.devicePixelRatio)
  assert.deepStrictEqual(pngSize(bytes), { width: css.width * ratio, height: css.height * ratio })
})

const documentSize = (page: Page.Page) =>
  page.evaluateInMainWorld(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight
  }))

const bodySize = (page: Page.Page) =>
  page.evaluateInMainWorld(() => ({ width: document.body.offsetWidth, height: document.body.offsetHeight }))

const setViewport = (page: Page.Page, width: number, height: number) => page.emulate({ viewport: { width, height } })

/** Playwright's `verifyViewport`: the configured viewport, and the page's own window size, both as given. */
const verifyViewport = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  assert.deepStrictEqual(Option.getOrUndefined(yield* page.viewportSize), { width, height })
  assert.deepStrictEqual(
    yield* page.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight })),
    { width, height }
  )
})

/** An element's box, which the original's `elementHandle.boundingBox()` gives. */
const boxOf = Effect.fnUntraced(function*(page: Page.Page, selector: string) {
  return Option.getOrThrowWith(yield* page.locator(selector).boundingBox, () => new Error(`${selector} has no box`))
})

const clip = (x: number, y: number, width: number, height: number): Page.ScreenshotOptions["area"] => ({
  clip: { x: Pixels.Css.make(x), y: Pixels.Css.make(y), width: Pixels.Css.make(width), height: Pixels.Css.make(height) }
})

/** A new page in a new context with the viewport given: Playwright's `browser.newContext({ viewport, … })` then `newPage`. */
const newPageWith = Effect.fnUntraced(function*(viewport: {
  readonly width: number
  readonly height: number
  readonly deviceScaleFactor?: number
  readonly mobile?: boolean
}) {
  const context = yield* Browser.newContext({ emulation: { viewport } })
  return yield* context.newPage
})

/**
 * What the original's golden shows of SS-092 and SS-093's element: its red border at every corner, even the ones below the
 * viewport, and its blue fill between. A capture cropped to the viewport has no red at the far corner.
 */
const assertWholeElement = (image: ReturnType<typeof decodePng>) => {
  const red = [255, 0, 0, 255]
  assert.deepStrictEqual(pixelAt(image, 0, 0), red)
  assert.deepStrictEqual(pixelAt(image, image.width - 1, image.height - 1), red)
  assert.deepStrictEqual(pixelAt(image, image.width >> 1, image.height >> 1), [0, 100, 200, 255])
}

/** The reset grid.html's own margins and padding are cleared with, as Playwright's `setContent` pages do. */
const bodyReset = `<style>body {margin: 0; padding: 0;}</style>`

upstream(import.meta.filename, {}, (test) => {
  test("SS-068", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const N = 5
      const pages = yield* Effect.all(
        Array.from({ length: N }, () =>
          context.newPage.pipe(Effect.tap((page) => page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })))),
        { concurrency: "unbounded" }
      )
      const areas = Array.from({ length: N }, (_, i) =>
        clip(50 * (i % 2), 0, 50, 50))
      const screenshots = yield* Effect.all(
        pages.map((page, i) => page.screenshot({ area: areas[i] })),
        { concurrency: "unbounded" }
      )
      for (let i = 0; i < N; ++i) {
        const page = pages[i]!
        const screenshot = screenshots[i]!
        yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
        // The original compares each capture with its grid cell's golden. The port compares it with the same clip taken
        // alone on its own page, and with the capture of that cell from another page, so a capture from the wrong page
        // or the wrong cell fails
        const alone = yield* page.screenshot({ area: areas[i] })
        assert.isTrue(samePixels(screenshot, alone))
        assert.isTrue(samePixels(screenshot, screenshots[i % 2]!))
        // and the two cells differ, so a clip that ignored its x offset fails
        assert.isFalse(samePixels(screenshot, screenshots[(i + 1) % 2]!))
      }
    }))

  test("SS-069", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, mobile: true })
      yield* page.goto(server.PREFIX + "/overflow.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      assert.deepStrictEqual(pngSize(screenshot), { width: 320, height: 480 })
    }))

  test("SS-070", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, mobile: true })
      yield* page.goto(server.PREFIX + "/overflow.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(10, 10, 100, 150) })
      assert.deepStrictEqual(pngSize(screenshot), { width: 100, height: 150 })
    }))

  test("SS-071", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, mobile: true })
      yield* page.goto(server.PREFIX + "/overflow-large.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      yield* assertPngOfSize(page, screenshot, yield* documentSize(page))
    }))

  test("SS-072", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, deviceScaleFactor: 2 })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      assert.deepStrictEqual(pngSize(screenshot), { width: 640, height: 960 })
    }))

  test("SS-073", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 500, height: 500, deviceScaleFactor: 3 })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(50, 100, 150, 100) })
      assert.deepStrictEqual(pngSize(screenshot), { width: 450, height: 300 })
    }))

  test("SS-074", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, deviceScaleFactor: 2 })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ scale: "css" })
      // One image pixel per CSS pixel: the viewport's 320×480, not its 640×960 device pixels
      assert.deepStrictEqual(pngSize(screenshot), { width: 320, height: 480 })
    }))

  test("SS-075", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // `viewport: null` is a context with no viewport declaration (see the header)
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const { innerHeight, innerWidth } = yield* page.evaluateInMainWorld(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight
      }))
      const screenshot = yield* page.screenshot({ scale: "css" })
      assert.deepStrictEqual(pngSize(screenshot), { width: innerWidth, height: innerHeight })
    }))

  test("SS-076", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 500, height: 500, deviceScaleFactor: 3 })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(50, 100, 150, 100), scale: "css" })
      assert.deepStrictEqual(pngSize(screenshot), { width: 150, height: 100 })
    }))

  test("SS-077", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 500, height: 500, deviceScaleFactor: 2 })
      yield* page.setContent(`${bodyReset}<div style='min-height: 16383px; background: red;'></div>`)
      const result = yield* page.screenshot({ area: "fullPage" })
      pngSize(result)
      yield* page.setContent(`${bodyReset}<div style='min-height: 16384px; background: red;'></div>`)
      const exception = yield* Effect.result(page.screenshot({ area: "fullPage" }))
      // Playwright asserts the refusal on WebKit (outside macOS) and on Firefox's non-BiDi backend. Strider's stock
      // WebKit refuses it as a page error, with the browser's own wording, so the port asserts the refusal only
      if (browserName === "webkit") {
        assert.isTrue(Result.isFailure(exception), "WebKit captured a page taller than its limit")
        const refusal = Result.isFailure(exception) ? exception.failure : undefined
        assert(Page.isPageError(refusal), `expected a PageError, got ${String(refusal)}`)
      }
      // The css-scaled capture of the same page works on every backend that supports the scale
      const image = yield* page.screenshot({ area: "fullPage", scale: "css" })
      assert.deepStrictEqual(pngSize(image), yield* documentSize(page))
    }))

  test("SS-078", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 1280, height: 800 })
      yield* page.evaluateInMainWorld(() => {
        document.body.style.margin = "0"
        document.body.style.padding = "0"
        document.documentElement.style.margin = "0"
        document.documentElement.style.padding = "0"
        const div = document.createElement("div")
        div.style.width = "1250px"
        div.style.height = "8440px"
        div.style.background = "linear-gradient(red, blue)"
        document.body.appendChild(div)
      })
      const buffer = yield* page.screenshot({ area: "fullPage" })
      const decoded = decodePng(buffer)
      // The gradient runs red at the top to blue at the bottom of an 8440-pixel column
      const top = pixelAt(decoded, 0, 0)
      const bottom = pixelAt(decoded, 0, 8339)
      assert.isAbove(top[0]!, 128)
      assert.isBelow(top[2]!, 128)
      assert.isBelow(bottom[0]!, 128)
      assert.isAbove(bottom[2]!, 128)
    }))

  test("SS-079", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 1280, height: 720 })
      yield* setViewport(page, 800, 500)
      yield* page.evaluateInMainWorld(() => {
        document.body.style.margin = "0"
        document.body.style.padding = "0"
        document.documentElement.style.margin = "0"
        document.documentElement.style.padding = "0"
        const div = document.createElement("div")
        div.style.width = "100%"
        div.style.borderTop = "100vh solid red"
        div.style.borderBottom = "100vh solid blue"
        document.body.appendChild(div)
      })
      const buffer = yield* page.screenshot({ area: "fullPage" })
      const decoded = decodePng(buffer)
      // Each border is 100vh of the 500-pixel viewport: the page is 1000 pixels tall, red above and blue below
      const top = pixelAt(decoded, 0, 0)
      const bottom = pixelAt(decoded, 0, 999)
      assert.isAbove(top[0]!, 128)
      assert.isBelow(top[2]!, 128)
      assert.isBelow(bottom[0]!, 128)
      assert.isAbove(bottom[2]!, 128)
    }))

  test("SS-080", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // Playwright's `__testHookBeforeScreenshot` blocks the page between a capture's preparation and the capture, then
      // waits for the block's console message. Strider has no such hook: the port starts the same block before the
      // capture, and waits for the same message, so the capture starts on a page whose event loop is blocked
      const blocked = yield* ConsoleMessage.next(page, { text: "blocked" })
      yield* page.evaluateInMainWorld(() => {
        console.log("blocked")
        while (true) {}
      }).pipe(Effect.ignore, Effect.forkChild)
      yield* blocked.pipe(Effect.timeout("5 seconds"))
      const error = yield* failureOf(
        page.screenshot({ area: "fullPage" }).pipe(Deadline.within("200 millis")),
        "a capture of a blocked page"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Page.screenshot")
      // Strider's budget counts from when the capture starts, so it's the timeout less the moments before then
      assert.isAtMost(Duration.toMillis(error.budget), 200)
      assert.isAbove(Duration.toMillis(error.budget), 200 - 500)
    }))

  test("SS-081", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, mobile: true })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      const box = yield* boxOf(page, ".box:nth-of-type(3)")
      const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      yield* assertPngOfSize(page, screenshot, { width: box.width, height: box.height })
    }))

  test("SS-082", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 320, height: 480, deviceScaleFactor: 2 })
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      const box = yield* boxOf(page, ".box:nth-of-type(3)")
      const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      yield* assertPngOfSize(page, screenshot, { width: box.width, height: box.height })
    }))

  test("SS-083", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.setContent(`<div style='height: 10000px; background: red'></div>`)
      const windowSize = yield* page.evaluateInMainWorld(() => ({
        width: window.innerWidth * window.devicePixelRatio,
        height: window.innerHeight * window.devicePixelRatio
      }))
      const sizeBefore = yield* bodySize(page)
      const screenshot = yield* page.screenshot()
      assert.instanceOf(screenshot, Uint8Array)
      assert.deepStrictEqual(pngSize(screenshot), windowSize)
      assert.deepStrictEqual(yield* bodySize(page), sizeBefore)
    }))

  test("SS-084", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const sizeBefore = yield* bodySize(page)
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      assert.instanceOf(screenshot, Uint8Array)
      pngSize(screenshot)
      assert.deepStrictEqual(yield* bodySize(page), sizeBefore)
    }))

  test("SS-085", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 456, height: 789 })
      yield* verifyViewport(page, 456, 789)
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      assert.instanceOf(screenshot, Uint8Array)
      pngSize(screenshot)
      yield* verifyViewport(page, 456, 789)
    }))

  test("SS-088", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>
      div.to-screenshot {
        border: 1px solid blue;
        width: 600px;
        height: 600px;
        margin-left: 50px;
      }
      ::-webkit-scrollbar{
        display: none;
      }
      </style>
      <div class="to-screenshot"></div>
      <div class="to-screenshot"></div>
      <div class="to-screenshot"></div>
    `)
      const sizeBefore = yield* bodySize(page)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot").first } })
      assert.instanceOf(screenshot, Uint8Array)
      pngSize(screenshot)
      assert.deepStrictEqual(yield* bodySize(page), sizeBefore)
    }))

  test("SS-090", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* setViewport(page, 800, 500)
      yield* page.evaluateInMainWorld(() => {
        const div = document.createElement("div")
        div.style.width = "100%"
        div.style.borderTop = "100vh solid red"
        div.style.borderBottom = "100vh solid blue"
        document.body.appendChild(div)
      })
      const buffer = yield* page.screenshot({ area: { element: page.locator("div") } })
      const decoded = decodePng(buffer)
      // The element is the page's only div: 800 pixels wide and 1000 tall, its borders 500 pixels each
      const top = pixelAt(decoded, 0, 0)
      const bottom = pixelAt(decoded, 0, 999)
      assert.isAbove(top[0]!, 128)
      assert.isBelow(top[2]!, 128)
      assert.isBelow(bottom[0]!, 128)
      assert.isAbove(bottom[2]!, 128)
    }))

  test("SS-091", { page: false, browsers: ["firefox", "webkit"] }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      server.setRoute("/slow", (_request, response) => {
        response.writeHead(200, {
          "content-length": 4096,
          "content-type": "text/html"
        })
      })
      // The original's `goto` times out after a second, and its failure is ignored
      yield* Effect.result(page.goto(server.PREFIX + "/slow", { waitUntil: "load" }).pipe(Deadline.within("1 second")))
      const screenshot = yield* page.screenshot()
      pngSize(screenshot)
    }))

  test("SS-092", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 501, height: 501, deviceScaleFactor: 2.5 })
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>
      div.to-screenshot {
        border: 4px solid red;
        box-sizing: border-box;
        width: 600px;
        height: 600px;
        margin-left: 50px;
        background: rgb(0, 100, 200);
      }
      ::-webkit-scrollbar{
        display: none;
      }
      </style>
      <div class="to-screenshot"></div>
    `)
      // The element is larger than the 501-pixel viewport: the capture takes all of it, at 2.5 device pixels per CSS pixel
      const box = yield* boxOf(page, "div.to-screenshot")
      assert.deepStrictEqual([box.width, box.height], [600, 600])
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot") } })
      assert.deepStrictEqual(pngSize(screenshot), { width: 1500, height: 1500 })
      assertWholeElement(decodePng(screenshot))
    }))

  test("SS-093", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* newPageWith({ width: 501, height: 501, deviceScaleFactor: 2.5 })
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>
      div.to-screenshot {
        border: 4px solid red;
        box-sizing: border-box;
        width: 600px;
        height: 600px;
        margin-left: 50px;
        background: rgb(0, 100, 200);
      }
      ::-webkit-scrollbar{
        display: none;
      }
      </style>
      <div class="to-screenshot"></div>
    `)
      const box = yield* boxOf(page, "div.to-screenshot")
      assert.deepStrictEqual([box.width, box.height], [600, 600])
      const screenshot = yield* page.screenshot({
        area: { element: page.locator("div.to-screenshot") },
        scale: "css"
      })
      assert.deepStrictEqual(pngSize(screenshot), { width: 600, height: 600 })
      assertWholeElement(decodePng(screenshot))
    }))
})
