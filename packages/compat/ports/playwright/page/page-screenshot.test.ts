/**
 * Playwright's `tests/page/page-screenshot.spec.ts`: a page's and an element's captures, their clips, formats, and
 * timing, and the animations, masks, and caret a capture can hide or show.
 *
 * What the port changes:
 * - Most of the original's golden images (`toMatchSnapshot`, `toHaveScreenshot`) were made with Playwright's own
 *   browser builds and fonts, which Strider's pinned browsers don't match. A port keeps the property a golden
 *   checks that the bytes can show: the image's size, read from its PNG header (`pngSize`), its format, and that two
 *   captures match or differ. Pixel values aren't read, so a golden's color or content check is not ported. A test
 *   that is only a golden comparison is not applicable (see the ledger).
 * - Strider's `area` is one of `"viewport"`, `"fullPage"`, `{ clip }`, or `{ element }`, and its clip is a rectangle
 *   of the page. An element is a locator, which the original's `ElementHandle` screenshots call as well.
 * - Strider returns the image's bytes and writes nothing, so the original's `path` option is the caller's own file I/O.
 *   SS-029 asserts the bytes; SS-030 through SS-032 test the option itself and are not applicable.
 * - Strider's `scale` is `"device"`, the default, and a page's device pixel ratio sets the image's size. Sizes are
 *   asserted as the CSS size times `window.devicePixelRatio`, read from the page.
 * - Strider's `quality` is typed for JPEG only and requires a value; Strider has no default, so the JPEG tests state
 *   the value Playwright uses by default, 80, where the original doesn't pass one.
 * - `page.setViewportSize` is `page.emulate({ viewport })`, whose registration lives while the test's scope does.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A `page.$eval`,
 *   `element.evaluate`, or `element.setAttribute` runs there too, through `document.querySelectorAll`.
 * - `div.type(…)` is `div.focus()` then `div.pressSequentially(…)`. Playwright's `type` focuses the element first.
 * - `page.exposeFunction('resize', …)` isn't in Strider. SS-037 has the page's `resize` listener set a flag on
 *   `window` in the main world, which the port reads.
 * - Fixed waits the original makes itself (`setTimeout` for 150 ms or 100 ms) are `Effect.sleep` with the same delay.
 * - `it.slow()` (SS-039) isn't ported: it extends the original's timeout, and this harness gives every test the same
 *   30 seconds.
 * - `it.fixme(webkit)` on SS-096 doesn't skip it here: the port runs on every browser, as the harness does for any
 *   upstream fixme.
 * - SS-029's and SS-036's `path` writes are the caller's own I/O; the port asserts the bytes Strider returns.
 * - The `window.builtins` in SS-059 is Playwright's injected copy of `Date`, which a page can't replace. The page here
 *   runs no script of its own, so the port uses `Date.now`.
 * - SS-066 and SS-067 are `toHaveScreenshot` golden comparisons: not applicable (see the ledger). The
 *   `__testHookBeforeScreenshot` in SS-055 is Playwright's internal hook (see the ledger).
 * - SS-095 compares the two captures' decoded pixels (`decodePng`) where the original compares them with its comparator.
 *   SS-010 does the same with a capture taken alone where the original has a golden, and SS-014 reads the golden's three
 *   bands as pixels. SS-002 compares bytes, as the original does.
 * - SS-065 expects the too-large capture's message where Playwright's is named. Strider's Firefox is WebDriver BiDi, so
 *   its message is BiDi's. The Chromium branch asserts nothing, as the original does.
 * - SS-027 catches Strider's `CaptureInvalidated`, a capture whose document the page replaced, where the original
 *   catches Playwright's "Cannot take a screenshot while page is navigating". Any other failure fails the test.
 * - SS-039 captures during reloads. The original has no catch, since Playwright's capture handles a replaced document
 *   itself. Chromium's fails with `CaptureInvalidated` (docs/decisions.md, "Chromium capture invalidation on document
 *   replacement") and leaves any retry to the caller, so the port allows that one failure and no other.
 * - SS-065's stock WebKit branch asserts only that the capture is refused: Playwright's "larger than 32767" wording is
 *   its own check.
 * - SS-007 and SS-008 assert Playwright's clip, which takes the part of the clip inside the viewport. Strider's clip is
 *   a rectangle of the page, so these fail where Strider's clip takes the rectangle as given.
 * - The caret, mask, style, animation, WebP, and handle-mask tests need options Strider lacks, and SS-033 and SS-034
 *   pass a quality Strider's types refuse for PNG. They aren't ported (see the ledger). SS-064 waits for fonts, which
 *   Strider's captures never do.
 */
import { assert } from "@effect/vitest"
import { Page, Pixels } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf, rafraf } from "../../harness/playwright.ts"
import { decodePng, pixelAt, pngSize } from "../../harness/png.ts"
import { upstream } from "../../harness/upstream.ts"

const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b))

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

const setViewport = (page: Page.Page, width: number, height: number) => page.emulate({ viewport: { width, height } })

const clip = (x: number, y: number, width: number, height: number): Page.ScreenshotOptions["area"] => ({
  clip: { x: Pixels.Css.make(x), y: Pixels.Css.make(y), width: Pixels.Css.make(width), height: Pixels.Css.make(height) }
})

const withCaret = `
      <!-- Refer to stylesheet from other origin. Accessing this
           stylesheet rules will throw.
      -->
      <link rel=stylesheet href="__CROSS__/injectedstyle.css">
      <!-- make life harder: define caret color in stylesheet -->
      <style>
        div {
          caret-color: #000 !important;
        }
      </style>
      <div contenteditable="true"></div>
    `

upstream(import.meta.filename, {}, (test) => {
  test("SS-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 500, height: 500 })
    }))

  test("SS-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(withCaret.replace("__CROSS__", server.CROSS_PROCESS_PREFIX))
      const div = page.locator("div")
      // Playwright's `div.type` focuses the element before typing
      yield* div.focus()
      yield* div.pressSequentially("foo bar")
      const screenshot = yield* page.screenshot({ area: { element: div } })
      for (let i = 0; i < 10; ++i) {
        // Caret blinking time is set to 500ms. Capture a variety of screenshots to make sure the caret isn't captured.
        yield* Effect.sleep("150 millis")
        const next = yield* page.screenshot({ area: { element: div } })
        assert.isTrue(sameBytes(next, screenshot))
      }
    }))

  test("SS-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(50, 100, 150, 100) })
      yield* assertPngOfSize(page, screenshot, { width: 150, height: 100 })
    }))

  test("SS-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // Playwright takes the part of this clip inside the 500×500 viewport: 450 wide and 50 high
      const screenshot = yield* page.screenshot({ area: clip(50, 450, 1000, 100) })
      yield* assertPngOfSize(page, screenshot, { width: 450, height: 50 })
    }))

  test("SS-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // Playwright refuses a clip wholly outside the viewport, as "Clipped area is either empty or outside the resulting
      // image"; Strider's refusal is its typed InvalidInput for an area, when there is one
      const error = yield* failureOf(page.screenshot({ area: clip(50, 650, 100, 100) }), "a clip outside the viewport")
      assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
      assert.strictEqual(error.reason._tag, "InvalidInput")
    }))

  test("SS-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const error = yield* failureOf(page.screenshot({ area: clip(50, 50, -100, 100) }), "a negative clip width")
      assert(Page.isPageError(error), `expected a PageError, got ${String(error)}`)
      assert.strictEqual(error.reason._tag, "InvalidInput")
      assert.include(error.message, "-100×100")
    }))

  test("SS-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const clips = [0, 1, 2].map((i) => clip(50 * i, 0, 50, 50))
      const parallel = yield* Effect.all(clips.map((area) => page.screenshot({ area })), { concurrency: "unbounded" })
      // The original compares the middle capture with a golden of that grid cell. The port compares it with the same
      // clip taken alone, by decoded pixels: two PNGs of the same pixels needn't be the same bytes
      const alone = yield* page.screenshot({ area: clips[1] })
      for (const screenshot of parallel) yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
      assert.isTrue(sameBytes(decodePng(parallel[1]!).data, decodePng(alone).data))
    }))

  test("SS-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      yield* assertPngOfSize(page, screenshot, yield* documentSize(page))
    }))

  test("SS-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      assert.instanceOf(screenshot, Uint8Array)
      pngSize(screenshot)
      // The viewport is 500×500 again after the full-page capture
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight })),
        { width: 500, height: 500 }
      )
      const configured = yield* page.viewportSize
      assert.isTrue(Option.isSome(configured))
      assert.deepStrictEqual(Option.getOrUndefined(configured), { width: 500, height: 500 })
    }))

  test("SS-014", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 300, 300)
      yield* page.setContent(`
      <style>
        body { margin: 0 }
        div { width: 300px; height: 100px; }
      </style>
      <div style="background:black"></div>
      <div style="background:white"></div>
      <div style="background:transparent"></div>
    `)
      const transparent = yield* page.screenshot({ omitBackground: true })
      const opaque = yield* page.screenshot()
      yield* assertPngOfSize(page, transparent, { width: 300, height: 300 })
      // The golden's three bands: black and white stay opaque, the transparent one has no alpha
      const ratio = yield* page.evaluateInMainWorld(() => window.devicePixelRatio)
      const image = decodePng(transparent)
      assert.deepStrictEqual(pixelAt(image, 150 * ratio, 50 * ratio), [0, 0, 0, 255])
      assert.deepStrictEqual(pixelAt(image, 150 * ratio, 150 * ratio), [255, 255, 255, 255])
      assert.strictEqual(pixelAt(image, 150 * ratio, 250 * ratio)[3], 0)
      // Omitting the default white background changes the image
      assert.isFalse(sameBytes(transparent, opaque))
    }))

  test("SS-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 300, 300)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Strider's JPEG quality has no default; 80 is Playwright's. The white background the golden checks is pixel
      // content, which the port doesn't read.
      const screenshot = yield* page.screenshot({ omitBackground: true, format: "jpeg", quality: 80 })
      assert.isTrue(isJpeg(screenshot))
    }))

  test("SS-022", ({ page }) =>
    Effect.gen(function*() {
      const screenshot = yield* page.screenshot({ area: clip(0, 0, 11, 11) })
      yield* assertPngOfSize(page, screenshot, { width: 11, height: 11 })
    }))

  test("SS-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/screenshots/canvas.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 500, height: 500 })
    }))

  test("SS-024", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto("data:text/html,<canvas></canvas>", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const canvas = document.querySelector("canvas") as HTMLCanvasElement
        canvas.width = 600
        canvas.height = 600
      })
      const addLine = (step: number) =>
        page.evaluateInMainWorld((n) => {
          const canvas = document.querySelector("canvas") as HTMLCanvasElement
          const ctx = canvas.getContext("2d") as CanvasRenderingContext2D
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, n * 100)
          ctx.lineTo(300, n * 100)
          ctx.stroke()
        }, step)
      const shots: Array<Uint8Array> = []
      for (let i = 0; i < 3; i++) {
        yield* addLine(i)
        // The original's own fixed wait, for WebKit to reflect the change in its screenshot
        yield* Effect.sleep("100 millis")
        shots.push(yield* page.screenshot())
      }
      // Each line the canvas gains shows in the next capture
      assert.isFalse(sameBytes(shots[0]!, shots[1]!))
      assert.isFalse(sameBytes(shots[1]!, shots[2]!))
    }))

  test("SS-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 640, 480)
      yield* page.goto(server.PREFIX + "/screenshots/webgl.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 640, height: 480 })
    }))

  test("SS-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/screenshots/translateZ.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 500, height: 500 })
    }))

  test("SS-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/redirectloop1.html", { waitUntil: "load" })
      for (let i = 0; i < 10; i++) {
        // Playwright refuses a capture while the page is navigating and the original returns an empty buffer for it.
        // Strider's equivalent is `CaptureInvalidated`: the page replaced the capture's document. Any other failure
        // is the test's failure, as in the original
        const screenshot = yield* page.screenshot({ area: "fullPage" }).pipe(
          Effect.catchTag("PageError", (error) =>
            error.reason._tag === "CaptureInvalidated" ? Effect.succeed(new Uint8Array()) : Effect.fail(error))
        )
        assert.instanceOf(screenshot, Uint8Array)
        if (screenshot.byteLength > 0) {
          pngSize(screenshot)
        }
      }
    }))

  test("SS-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid-iframe-in-shadow.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 500, height: 500 })
    }))

  test("SS-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // Playwright's `path` writes this image; here the caller writes the bytes, so the port asserts them
      const screenshot = yield* page.screenshot()
      yield* assertPngOfSize(page, screenshot, { width: 500, height: 500 })
    }))

  test("SS-035", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const zeroQuality = yield* page.screenshot({ format: "jpeg", quality: 0 })
      const highQuality = yield* page.screenshot({ format: "jpeg", quality: 100 })
      assert.isTrue(isJpeg(zeroQuality))
      assert.isTrue(isJpeg(highQuality))
      assert.isBelow(zeroQuality.byteLength, highQuality.byteLength)
    }))

  test("SS-036", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `path` takes its format from the extension unless `type` is given. Strider has no path: the
      // format is the one the call names, so this asserts the bytes of a JPEG request
      const screenshot = yield* page.screenshot({ format: "jpeg", quality: 80 })
      assert.isTrue(isJpeg(screenshot))
    }))

  test("SS-037", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // The listener is the test's, so a resize it sees sets a flag the port reads (Strider has no exposeFunction)
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener("resize", () => {
          ;(window as unknown as { resized?: boolean }).resized = true
        })
      })
      yield* page.screenshot()
      const resized = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { resized?: boolean }).resized === true
      )
      assert.isFalse(resized)
    }))

  test("SS-038", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // The full-page size and the pixel ratio are read before `Array` is deleted, since reading them needs the page's
      // own methods
      const expected = yield* documentSize(page)
      const ratio = yield* page.evaluateInMainWorld(() => window.devicePixelRatio)
      yield* page.evaluateInMainWorld(() => Reflect.deleteProperty(window, "Array"))
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      assert.deepStrictEqual(pngSize(screenshot), { width: expected.width * ratio, height: expected.height * ratio })
    }))

  test("SS-039", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const reloadSeveralTimes = Effect.gen(function*() {
        for (let i = 0; i < 5; ++i) yield* page.reload({ waitUntil: "load" })
      })
      // The original has no catch: Playwright's capture handles a replaced document itself. Strider's fails with
      // `CaptureInvalidated` and leaves a retry to the caller, so that is the one failure allowed here
      const screenshotSeveralTimes = Effect.gen(function*() {
        for (let i = 0; i < 5; ++i) {
          const screenshot = yield* page.screenshot({ area: "fullPage" }).pipe(
            Effect.catchTag("PageError", (error) =>
              error.reason._tag === "CaptureInvalidated" ? Effect.succeed(new Uint8Array()) : Effect.fail(error))
          )
          if (screenshot.byteLength > 0) {
            pngSize(screenshot)
          }
        }
      })
      yield* Effect.all([reloadSeveralTimes, screenshotSeveralTimes], { concurrency: "unbounded" })
    }))

  test("SS-065", ({ page, browserName }) =>
    Effect.gen(function*() {
      // Strider's Firefox is WebDriver BiDi, which allows 65535 rows; the other backends allow 32767
      const maxSize = browserName === "firefox" ? 65535 : 32767
      yield* page.setContent(
        `<style>body {margin: 0; padding: 0;}</style><div style='min-height: ${maxSize}px; background: red;'></div>`
      )
      const result = yield* page.screenshot({ area: "fullPage" })
      pngSize(result)
      yield* page.setContent(
        `<style>body {margin: 0; padding: 0;}</style><div style='min-height: ${maxSize + 1}px; background: red;'></div>`
      )
      if (browserName === "firefox") {
        const exception = yield* failureOf(page.screenshot({ area: "fullPage" }), "a capture one row too tall")
        assert.include(exception.message, "65536 exceeds the maximum allowed screenshot height of 65535 pixels")
      } else if (browserName === "webkit") {
        // Playwright's "Cannot take screenshot larger than 32767" is its own check; stock WebKit's refusal has the
        // browser's wording, so the port asserts only that the capture is refused, as a page error
        const exception = yield* failureOf(page.screenshot({ area: "fullPage" }), "a capture one row too tall")
        assert(Page.isPageError(exception), `expected a PageError, got ${String(exception)}`)
      } else {
        // Playwright asserts nothing about this capture on Chromium
        yield* Effect.result(page.screenshot({ area: "fullPage" }))
      }
    }))

  test("SS-095", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 200, 200)
      yield* page.setContent(
        `<body style="margin:0"><div style="width:100px;height:100px;background:rgb(0,255,0)"></div></body>`
      )
      const expected = yield* page.screenshot()
      yield* page.setContent(`<body style="margin:0"><canvas style="width:100px;height:100px"></canvas><script>
      const gl = document.querySelector('canvas').getContext('webgl');
      window.draw = size => {
        gl.canvas.width = size;
        gl.canvas.height = size;
        gl.viewport(0, 0, size, size);
        gl.clearColor(0, 1, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      };
      draw(100);
    </script></body>`)
      yield* rafraf(page)
      yield* page.evaluateInMainWorld(() => (window as unknown as { draw: (size: number) => void }).draw(50))
      yield* rafraf(page)
      assert.isTrue(sameBytes(decodePng(yield* page.screenshot()).data, decodePng(expected).data))
    }))

  test("SS-096", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
      <style>
      @font-face {
        font-family: 'pwtest-iconfont';
        src: local('NoSuchFont'), url('${server.PREFIX}/webfont/iconfont.woff2') format('woff2');
        unicode-range: U+0400-04FF;
      }
      </style>
      <div style="font-family: 'pwtest-iconfont'">hello</div>
    `)
      yield* page.screenshot()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.fonts.status), "loaded")
    }))
})
