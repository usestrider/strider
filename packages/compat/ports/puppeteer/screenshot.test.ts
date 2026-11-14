/**
 * Puppeteer's `test/src/screenshot.test.ts`: a page's and an element's captures, their clips, full-page captures, and
 * parallel captures, and the transparency and encoding options.
 *
 * What the port changes:
 * - Puppeteer's goldens (`toBeGolden`) were made with its own browser builds and fonts. A port keeps what the bytes can
 *   show: the image's size, read from its PNG header (`pngSize`), where the golden is the size the test expects, and
 *   pixel colors at a few points the golden has. Two captures that Puppeteer compares with goldens are compared with
 *   each other, by decoded pixels (`decodePng`), where the golden is a cell of the grid (SS-010 in Playwright's port
 *   does the same). A test whose only check is a golden is not applicable (see the ledger).
 * - Puppeteer's `setViewport` is `page.emulate({ viewport })`. Its `defaultViewport: null` suites are pages with no
 *   emulation: `page: false` and `Browser.newPage()`, whose viewport is the window's own, and `viewportSize` is `None`.
 * - Puppeteer's `html` helper (`test/src/utils.ts`) is `html` here: the body inside a document with a doctype, charset,
 *   and viewport meta, as the original's goldens were rendered with.
 * - Strider's `area` is `"viewport"`, `"fullPage"`, `{ clip }`, or `{ element }`. A `page.$` handle is a locator, so
 *   `elementHandle.screenshot()` is `page.screenshot({ area: { element } })`. Strider's clip is a rectangle of the page,
 *   not the viewport's, which the tests with a clip bigger than the viewport show (see the ledger for the option the
 *   original sets).
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`.
 * - Puppeteer's `encoding: "base64"` returns a string for the caller to decode, and Strider returns bytes. The test is
 *   not applicable (see the ledger).
 * - Puppeteer's screenshots of "parallel with page.close()" start without being awaited: `startWaiting` starts each
 *   capture at once, as the original's promises do.
 * - Puppeteer's runner gives its Chromium `--force-device-scale-factor=1`, so the goldens are one image pixel per CSS
 *   pixel, and the port asserts sizes in device pixels that are the same as CSS pixels here.
 * - The goldens' sizes differ by engine for one test (the offset element, 53×22 in Chromium and 53×23 in Firefox), so
 *   that test expects the golden of its browser; stock WebKit has no golden of its own and must match one of the two.
 * - The page-level `captureBeyondViewport` option, and the `fromSurface` option, are Chromium's CDP capture options,
 *   which Strider's capture doesn't expose. The two tests whose point is the option, a full-page capture and a clip
 *   bigger than the viewport without `captureBeyondViewport` (goldens of 500×1000 and 25×25), are `needsFeature` (see
 *   the ledger). "Should restore to original viewport size" passes the option too, but its point, that a full-page
 *   capture leaves the window's size as it was, holds without it, so it's ported with the default capture.
 * - Where the golden shows the content, the port reads pixels at known points: the grid's boxes are `hsl(3.6 × i, 100%,
 *   90%)` (`assertBox`), and the other pages' borders and backgrounds are their CSS colors.
 * - "Should render white background on jpeg file" decodes the capture in the page (the harness has no JPEG decoder)
 *   and reads a pixel from a canvas.
 * - Strider refuses a clip and an element together (`area` is one of its values), so "should use element clip" is
 *   `needsFeature`. The WebP tests need a capture format Strider lacks (its format is PNG or JPEG), also `needsFeature`.
 * - The clip scale in "should use scale for clip" is a multiplier of the clip's pixels; Strider's `scale` is `"css"` or
 *   `"device"`, so the test is `needsFeature`.
 * - "should work with a null viewport" and the two "defaultViewport is null" tests read the window's size through
 *   `page.evaluateInMainWorld`, as the original reads `window.innerWidth`.
 * - Fixed waits the original makes itself: none.
 * - The "clip bigger than the viewport" test expects the golden's 25×100, the size Puppeteer's runner captures. Strider's
 *   clip is the page's rectangle, so this fails.
 * - SS-010's behavior is in "should run in parallel": concurrent clip captures on one page are compared with the same
 *   clip taken alone, so this test fails where concurrent captures return the same image.
 */
import { assert } from "@effect/vitest"
import { Browser, Page, Pixels } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { failureOf, startWaiting } from "../harness/playwright.ts"
import { decodePng, pixelAt, pngSize } from "../harness/png.ts"
import { html } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

const setViewport = (page: Page.Page, width: number, height: number) => page.emulate({ viewport: { width, height } })

const clip = (x: number, y: number, width: number, height: number): Page.ScreenshotOptions["area"] => ({
  clip: { x: Pixels.Css.make(x), y: Pixels.Css.make(y), width: Pixels.Css.make(width), height: Pixels.Css.make(height) }
})

/** How two captures differ, or `undefined` where they draw the same pixels, whatever their encoding. */
const difference = (a: Uint8Array, b: Uint8Array): string | undefined => {
  const left = decodePng(a)
  const right = decodePng(b)
  if (left.width !== right.width || left.height !== right.height) {
    return `${left.width}×${left.height} against ${right.width}×${right.height}`
  }
  let differing = 0
  let first = -1
  for (let at = 0; at < left.data.length; at += 4) {
    if (
      left.data[at] !== right.data[at] || left.data[at + 1] !== right.data[at + 1] ||
      left.data[at + 2] !== right.data[at + 2]
    ) {
      if (first < 0) first = at / 4
      differing++
    }
  }
  return differing === 0
    ? undefined
    : `${differing} pixels differ, the first at (${first % left.width}, ${Math.floor(first / left.width)})`
}

/**
 * The color of grid.html's box `index` (`hsl(3.6 × index, 100%, 90%)`, ten boxes of 50×50 to a row), as the page paints
 * it. A box's corner is its background: its digits are centered.
 */
const boxColor = (index: number): Array<number> => {
  const hue = (3.6 * (index % 100)) / 60
  const chroma = 0.2
  const x = chroma * (1 - Math.abs((hue % 2) - 1))
  const sectors: ReadonlyArray<ReadonlyArray<number>> = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x]
  ]
  return sectors[Math.floor(hue) % 6]!.map((channel) => Math.round((channel + 0.8) * 255)).concat(255)
}

/** Asserts that the pixel at (x, y) is box `index`'s color, within one level of rounding per channel. */
const assertBox = (image: ReturnType<typeof decodePng>, x: number, y: number, index: number) => {
  const actual = pixelAt(image, x, y)
  const expected = boxColor(index)
  assert.isTrue(
    actual.every((channel, i) => Math.abs(channel - expected[i]!) <= 1),
    `pixel (${x}, ${y}) is ${JSON.stringify(actual)}, not box ${index}'s ${JSON.stringify(expected)}`
  )
}

/** The window's inner size, read in the page's main world. */
const innerSize = (page: Page.Page) =>
  page.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight }))

/**
 * Puppeteer's "should run in parallel in multiple pages" body, in a context of its own: the grid's three cells in
 * two pages at once, each capture compared with the same clip taken alone, and each page closed.
 */
const captureCellsInParallel = Effect.fnUntraced(function*(server: { readonly PREFIX: string }) {
  const context = yield* Browser.newContext()
  const N = 2
  const pages = yield* Effect.all(
    Array.from({ length: N }, () =>
      context.newPage.pipe(
        Effect.tap((page) => page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" }))
      )),
    { concurrency: "unbounded" }
  )
  const captures = yield* Effect.all(
    pages.map((page, i) => page.screenshot({ area: clip(50 * i, 0, 50, 50) })),
    { concurrency: "unbounded" }
  )
  for (let i = 0; i < N; ++i) {
    assert.deepStrictEqual(pngSize(captures[i]!), { width: 50, height: 50 })
    // The original compares each capture with grid-cell-i.png. The port compares it with the same clip taken alone
    const alone = yield* pages[i]!.screenshot({ area: clip(50 * i, 0, 50, 50) })
    assert.isUndefined(difference(captures[i]!, alone), `page ${i}'s capture differs from the same clip taken alone`)
  }
  yield* Effect.all(pages.map((page) => page.close()), { concurrency: "unbounded" })
})

upstream(import.meta.filename, {}, (test) => {
  test("Screenshots Page.screenshot should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot()
      // The original compares this with screenshot-sanity.png, a 500×500 capture of the grid
      assert.deepStrictEqual(pngSize(screenshot), { width: 500, height: 500 })
      // The golden is the grid's top 10×10 boxes: the first and the last are in their cells
      const image = decodePng(screenshot)
      assertBox(image, 1, 1, 0)
      assertBox(image, 451, 451, 99)
    }))

  test("Screenshots Page.screenshot should clip rect", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(50, 100, 150, 100) })
      // screenshot-clip-rect.png is 150×100
      assert.deepStrictEqual(pngSize(screenshot), { width: 150, height: 100 })
      // The clip starts at box 21 (column 1, row 2) and ends in box 33 (column 3, row 3)
      const image = decodePng(screenshot)
      assertBox(image, 1, 1, 21)
      assertBox(image, 148, 98, 33)
    }))

  test("Screenshots Page.screenshot should get screenshot bigger than the viewport", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 50, 50)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: clip(25, 25, 100, 100) })
      // screenshot-offscreen-clip.png is 25×100. Strider's clip is the page's rectangle, so this fails
      assert.deepStrictEqual(pngSize(screenshot), { width: 25, height: 100 })
    }))

  test("Screenshots Page.screenshot should run in parallel", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const clips = [0, 1, 2].map((i) => clip(50 * i, 0, 50, 50))
      const parallel = yield* Effect.all(clips.map((area) => page.screenshot({ area })), { concurrency: "unbounded" })
      for (const screenshot of parallel) assert.deepStrictEqual(pngSize(screenshot), { width: 50, height: 50 })
      // The original compares the middle capture with grid-cell-1.png. The port compares it with the same clip taken
      // alone, by decoded pixels: two PNGs of the same pixels needn't be the same bytes
      // grid-cell-1.png is box 1
      assertBox(decodePng(parallel[1]!), 1, 1, 1)
      assertBox(decodePng(parallel[1]!), 48, 48, 1)
      const alone = yield* page.screenshot({ area: clips[1] })
      assert.isUndefined(difference(parallel[1]!, alone), "the parallel capture differs from the same clip taken alone")
    }))

  test("Screenshots Page.screenshot should take fullPage screenshots", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ area: "fullPage" })
      // screenshot-grid-fullpage.png is 500×1000
      assert.deepStrictEqual(pngSize(screenshot), { width: 500, height: 1000 })
      // The page is drawn to its end: the last box, beyond the 500-pixel viewport, is in its cell
      assertBox(decodePng(screenshot), 451, 951, 199)
    }))

  test(
    "Screenshots Page.screenshot should run in parallel in multiple pages",
    { page: false },
    ({ server }) => captureCellsInParallel(server)
  )

  test("Screenshots Page.screenshot should work with odd clip size on Retina displays", ({ page }) =>
    Effect.gen(function*() {
      // Make sure documentElement height is at least 11px
      yield* page.setContent(html(`<div style="width: 11px; height: 11px;"></div>`))
      const screenshot = yield* page.screenshot({ area: clip(0, 0, 11, 11) })
      // screenshot-clip-odd-size.png is 11×11
      assert.deepStrictEqual(pngSize(screenshot), { width: 11, height: 11 })
    }))

  test(
    "Screenshots Page.screenshot should take fullPage screenshots when defaultViewport is null",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        // A page with no emulation: its viewport is the window's own
        const page = yield* Browser.newPage()
        yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
        const screenshot = yield* page.screenshot({ area: "fullPage" })
        assert.instanceOf(screenshot, Uint8Array)
        pngSize(screenshot)
      })
  )

  test(
    "Screenshots Page.screenshot should restore to original viewport size after taking fullPage screenshots when defaultViewport is null",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const originalSize = yield* innerSize(page)
        yield* page.goto(server.PREFIX + "/scrollbar.html", { waitUntil: "load" })
        // Strider has no captureBeyondViewport option, so the capture is the full page as it is. The test checks the
        // viewport is restored afterwards
        yield* page.screenshot({ area: "fullPage" })
        assert.isTrue(Option.isNone(yield* page.viewportSize))
        const size = yield* innerSize(page)
        assert.strictEqual(size.width, originalSize.width)
        assert.strictEqual(size.height, originalSize.height)
      })
  )

  test("Screenshots ElementHandle.screenshot should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      // screenshot-element-bounding-box.png is 50×50
      assert.deepStrictEqual(pngSize(screenshot), { width: 50, height: 50 })
      // The third box, scrolled or not, is the one captured
      const image = decodePng(screenshot)
      assertBox(image, 1, 1, 2)
      assertBox(image, 48, 48, 2)
    }))

  test(
    "Screenshots ElementHandle.screenshot should work with a null viewport",
    { page: false },
    ({ server }) =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
        yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
        const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
        assert.isTrue(screenshot.byteLength > 0)
        assert.deepStrictEqual(pngSize(screenshot), { width: 50, height: 50 })
        assertBox(decodePng(screenshot), 1, 1, 2)
      })
  )

  test("Screenshots ElementHandle.screenshot should take into account padding and border", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(html(`
        something above
        <style>
          div {
            border: 2px solid blue;
            background: green;
            width: 50px;
            height: 50px;
          }
        </style>
        <div></div>
      `))
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      // screenshot-element-padding-border.png is 54×54: the 50-pixel box and its 2-pixel border
      assert.deepStrictEqual(pngSize(screenshot), { width: 54, height: 54 })
      const image = decodePng(screenshot)
      assert.deepStrictEqual(pixelAt(image, 0, 0), [0, 0, 255, 255])
      assert.deepStrictEqual(pixelAt(image, 2, 2), [0, 128, 0, 255])
    }))

  test("Screenshots ElementHandle.screenshot should capture full element when larger than viewport", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(html(`
        something above
        <style>
          :root {
            scrollbar-width: none;
          }
          div.to-screenshot {
            border: 1px solid blue;
            width: 600px;
            height: 600px;
            margin-left: 50px;
          }
        </style>
        <div class="to-screenshot"></div>
      `))
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot") } })
      // screenshot-element-larger-than-viewport.png is 602×602: the 600-pixel box and its border
      assert.deepStrictEqual(pngSize(screenshot), { width: 602, height: 602 })
      const image = decodePng(screenshot)
      assert.deepStrictEqual(pixelAt(image, 0, 0), [0, 0, 255, 255])
      assert.deepStrictEqual(pixelAt(image, 300, 300), [255, 255, 255, 255])
      assert.deepStrictEqual(
        yield* innerSize(page),
        { width: 500, height: 500 }
      )
    }))

  test("Screenshots ElementHandle.screenshot should scroll element into view", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(html(`
        something above
        <style>
          div.above {
            border: 2px solid blue;
            background: red;
            height: 1500px;
          }
          div.to-screenshot {
            border: 2px solid blue;
            background: green;
            width: 50px;
            height: 50px;
          }
        </style>
        <div class="above"></div>
        <div class="to-screenshot"></div>
      `))
      // Strider's element capture is taken beyond the viewport, never by scrolling, so the element is drawn where
      // it is. The golden, screenshot-element-scrolled-into-view.png, is 54×54 with the same colors
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot") } })
      assert.deepStrictEqual(pngSize(screenshot), { width: 54, height: 54 })
      const image = decodePng(screenshot)
      assert.deepStrictEqual(pixelAt(image, 0, 0), [0, 0, 255, 255])
      assert.deepStrictEqual(pixelAt(image, 2, 2), [0, 128, 0, 255])
      assert.deepStrictEqual(pixelAt(image, 27, 27), [0, 128, 0, 255])
    }))

  test("Screenshots ElementHandle.screenshot should work with a rotated element", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(html(`<!DOCTYPE html>
          <div
            style="position:absolute;
                                        top: 100px;
                                        left: 100px;
                                        width: 100px;
                                        height: 100px;
                                        background: green;
                                        transform: rotateZ(200deg);"
          >
            &nbsp;
          </div>`))
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      // screenshot-element-rotate.png is 128×128: the rotated square's box
      assert.deepStrictEqual(pngSize(screenshot), { width: 128, height: 128 })
      // The box is the rotated square's bounding box: its center is the square's green, and its corners, outside the
      // rotated square, are the page's white
      const image = decodePng(screenshot)
      assert.deepStrictEqual(pixelAt(image, 64, 64), [0, 128, 0, 255])
      assert.deepStrictEqual(pixelAt(image, 1, 1), [255, 255, 255, 255])
      assert.deepStrictEqual(pixelAt(image, 126, 126), [255, 255, 255, 255])
    }))

  test("Screenshots ElementHandle.screenshot should fail to screenshot a detached element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<h1>remove this</h1>`))
      // The original's handle is bound to the h1. The locator is not: the removal below leaves it nothing to match
      const heading = page.locator("h1")
      yield* page.evaluateInMainWorld(() => (document.querySelector("h1") as Element).remove())
      const failure = yield* failureOf(
        page.screenshot({ area: { element: heading } }),
        "a capture of a removed element"
      )
      assert(Page.isPageError(failure), `expected a PageError, got ${String(failure)}`)
      assert.strictEqual(failure.reason._tag, "NoMatch")
    }))

  test("Screenshots ElementHandle.screenshot should not hang with zero width/height element", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<div style="width: 50px; height: 0"></div>`))
      // Puppeteer's refusal reads "Node has 0 height."; Strider's refusal has its own reason. The port checks that the
      // capture is refused as a page error, rather than hanging
      const failure = yield* failureOf(
        page.screenshot({ area: { element: page.locator("div") } }),
        "a capture of a zero-height element"
      )
      assert(Page.isPageError(failure), `expected a PageError, got ${String(failure)}`)
    }))

  test(
    "Screenshots ElementHandle.screenshot should work for an element with fractional dimensions",
    ({ page }) =>
      Effect.gen(function*() {
        yield* page.setContent(html(`<div
          style="width:48.51px;height:19.8px;border:1px solid black;"
        ></div>`))
        const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
        // screenshot-element-fractional.png is 51×22: the 50.51×21.8 box, rounded to whole pixels
        assert.deepStrictEqual(pngSize(screenshot), { width: 51, height: 22 })
        // The capture starts at the element's border: its corner is the border's black, and its inside is white
        const image = decodePng(screenshot)
        assert.deepStrictEqual(pixelAt(image, 0, 0), [0, 0, 0, 255])
        assert.deepStrictEqual(pixelAt(image, 25, 10), [255, 255, 255, 255])
      })
  )

  test("Screenshots ElementHandle.screenshot should work for an element with an offset", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.setContent(html(`<!DOCTYPE html>
          <div
            style="position:absolute; top: 10.3px; left: 20.4px;width:50.3px;height:20.2px;border:1px solid black;"
          ></div>`))
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      // The goldens differ by engine: Chromium's, screenshot-element-fractional-offset.png, is 53×22, and Firefox's is
      // 53×23. Stock WebKit has no golden of its own, so its capture must be one of the two
      const expected = browserName === "firefox"
        ? [{ width: 53, height: 23 }]
        : browserName === "webkit"
        ? [{ width: 53, height: 22 }, { width: 53, height: 23 }]
        : [{ width: 53, height: 22 }]
      const size = pngSize(screenshot)
      assert.isTrue(
        expected.some((want) => want.width === size.width && want.height === size.height),
        `${browserName}'s capture is ${size.width}×${size.height}, not one of ${JSON.stringify(expected)}`
      )
    }))

  test(
    "Screenshots ElementHandle.screenshot should run in parallel in multiple pages",
    { page: false },
    ({ server }) => captureCellsInParallel(server)
  )

  test(
    "Screenshots ElementHandle.screenshot should run in parallel with page.close()",
    { page: false },
    () =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page1 = yield* context.newPage
        const page2 = yield* context.newPage
        // The original's captures aren't awaited where they start: each runs at once, and closes its page after it
        const screen1 = yield* startWaiting(page1.screenshot())
        const screen2 = yield* startWaiting(page2.screenshot())
        const close1 = Fiber.join(screen1.fiber).pipe(Effect.andThen(page1.close()))
        const close2 = Fiber.join(screen2.fiber).pipe(Effect.andThen(page2.close()))
        yield* Fiber.join(screen1.fiber)
        const page3 = yield* Browser.newPage()
        yield* page3.screenshot()
        const close3 = page3.close()
        yield* Effect.all([close1, close2, close3], { concurrency: "unbounded" })
      })
  )

  test("Screenshots Cdp should allow transparency", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 100, 100)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ omitBackground: true })
      // transparent.png is 100×100 and transparent
      assert.deepStrictEqual(pngSize(screenshot), { width: 100, height: 100 })
      const image = decodePng(screenshot)
      assert.strictEqual(pixelAt(image, 0, 0)[3], 0)
      assert.strictEqual(pixelAt(image, 50, 50)[3], 0)
    }))

  test("Screenshots Cdp should render white background on jpeg file", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 100, 100)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const screenshot = yield* page.screenshot({ omitBackground: true, format: "jpeg", quality: 80 })
      // white.jpg is a 100×100 white JPEG: a JPEG has no alpha, so the transparent background is drawn white. The
      // harness has no JPEG decoder, so the page's own decodes the capture, and the port reads a pixel from a canvas
      assert.deepStrictEqual([...screenshot.subarray(0, 3)], [0xff, 0xd8, 0xff])
      const pixel = yield* page.evaluateInMainWorld(async (base64: string) => {
        const image = new Image()
        image.src = `data:image/jpeg;base64,${base64}`
        await image.decode()
        const canvas = document.createElement("canvas")
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext("2d")!
        context.drawImage(image, 0, 0)
        return {
          width: image.naturalWidth,
          height: image.naturalHeight,
          rgba: Array.from(context.getImageData(50, 50, 1, 1).data)
        }
      }, Buffer.from(screenshot).toString("base64"))
      assert.deepStrictEqual({ width: pixel.width, height: pixel.height }, { width: 100, height: 100 })
      assert.isTrue(
        pixel.rgba.every((channel) => channel >= 253),
        `the capture's pixel is ${JSON.stringify(pixel.rgba)}, not white`
      )
    }))
})
