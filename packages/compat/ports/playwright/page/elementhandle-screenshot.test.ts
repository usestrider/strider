/**
 * Playwright's `tests/page/elementhandle-screenshot.spec.ts`: an element's captures, scrolled into view, larger than the
 * viewport, transformed, fractional, or removed, and the format and the viewport a capture leaves behind.
 *
 * What the port changes:
 * - An `ElementHandle` is a locator here: `page.$(selector)` is `page.locator(selector)`, and `handle.screenshot()` is
 *   `page.screenshot({ area: { element } })`. A handle stays on the element it was given, where a locator finds the match
 *   again on each capture. The DOM changes during EH-083, where the element is removed, so the capture finds nothing and
 *   refuses with `NoMatch`. EH-091 and EH-092 change nothing in the DOM.
 * - Goldens (`toMatchSnapshot`) were made with Playwright's own browser builds, so their bytes aren't compared. Each
 *   test asserts what a golden shows that is the same in any build: the PNG's size from its header, the element's box in
 *   CSS pixels times the page's device pixel ratio, and the colors at a few pixels the golden has (the border and fill the
 *   element draws), which a capture of another element, or of another place, wouldn't have. The page's device pixel
 *   ratio is 1, so the pixels are in CSS pixels. Where the box is fractional or rotated (EH-082, EH-086, EH-087), the
 *   size is the smallest whole-pixel rectangle that holds the measured box, which Playwright captures
 *   (`enclosingIntRect`) and the Chromium goldens are the size of (51x22, 53x23 and 130x130).
 * - `page.setViewportSize` is `page.emulate({ viewport })`, and `verifyViewport` reads the viewport as the original does.
 * - `page.evaluate` and `handle.evaluate` run in the page's main world here, through `page.evaluateInMainWorld` and
 *   `document.querySelector`, the element the locator matches.
 * - `handle.screenshot({ path })` writes the file: the caller's own file I/O, which Strider doesn't do. EH-090 is not
 *   applicable, as page-screenshot's SS-030 to SS-032 are. EH-091 keeps its assertion on the bytes, which are JPEG,
 *   and passes Playwright's default quality, 80, since Strider has no default for it.
 * - EH-075 needs a WebP capture, which Strider lacks, so it's `needsFeature`. EH-084, EH-085, and EH-088 test that a
 *   capture waits for the element to become visible (EH-084, EH-085) or to stop moving (EH-088). Strider's capture
 *   measures the element's box once and never waits, and no decision settles that, so they are ported as written and
 *   fail. EH-084's timeout is `Deadline.within`.
 * - EH-083's failure is Playwright's "Element is not attached to the DOM"; Strider's refusal for a removed element is
 *   `NoMatch`, which the port asserts.
 * - `page.exposeFunction('resize', …)` isn't in Strider. EH-092's `resize` listener sets a flag on `window` in the main
 *   world, which the port reads, as page-screenshot's SS-037 does.
 * - `JSON.stringify` is replaced in EH-076 through `Reflect.set`, which is how the original replaces it too; the type
 *   of the replacement is the only difference.
 */
import { assert } from "@effect/vitest"
import { Deadline, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import { inflateSync } from "node:zlib"
import { failureOf, rafraf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A PNG's width and height in device pixels, from its IHDR chunk after the signature. */
const pngSize = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  assert.deepStrictEqual([...bytes.subarray(0, 8)], PNG_SIGNATURE)
  assert.strictEqual(Buffer.from(bytes.subarray(12, 16)).toString("latin1"), "IHDR")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * A PNG's pixels as RGBA bytes: 8-bit RGB or RGBA, non-interlaced, which is what every backend returns. It inflates the
 * IDAT chunks and undoes each scanline's filter, so two captures compare by what they draw, not by how they were
 * encoded.
 */
const decodePng = (
  bytes: Uint8Array
): { readonly width: number; readonly height: number; readonly data: Uint8Array } => {
  const { height, width } = pngSize(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const colorType = bytes[25]
  assert.strictEqual(bytes[24], 8, "bit depth")
  assert.isTrue(colorType === 2 || colorType === 6, `color type ${colorType}`)
  assert.strictEqual(bytes[28], 0, "interlace")
  const channels = colorType === 6 ? 4 : 3
  const chunks: Array<Buffer> = []
  for (let offset = 8; offset < bytes.byteLength;) {
    const length = view.getUint32(offset)
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1")
    if (type === "IDAT") chunks.push(Buffer.from(bytes.subarray(offset + 8, offset + 8 + length)))
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels]! : 0
      const up = previous[i]!
      const upLeft = i >= channels ? previous[i - channels]! : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      line[i] = (line[i]! + predictor) & 0xff
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * width + x) * 4 + c] = c < channels ? line[x * channels + c]! : 255
      }
    }
    previous = line
  }
  return { width, height, data: out }
}

const pixelAt = (image: ReturnType<typeof decodePng>, x: number, y: number): Array<number> => {
  const at = (y * image.width + x) * 4
  return [...image.data.subarray(at, at + 4)]
}

/** The colors a capture has at the given pixels, as the original's golden does. */
const assertPixels = (
  bytes: Uint8Array,
  expected: ReadonlyArray<readonly [x: number, y: number, rgba: ReadonlyArray<number>]>
) => {
  const image = decodePng(bytes)
  for (const [x, y, rgba] of expected) assert.deepStrictEqual(pixelAt(image, x, y), [...rgba], `pixel ${x},${y}`)
}

const BLUE = [0, 0, 255, 255]
const GREEN = [0, 128, 0, 255]
const WHITE = [255, 255, 255, 255]
const BLACK = [0, 0, 0, 255]

const isJpeg = (bytes: Uint8Array): boolean => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

/** A capture's PNG size: the CSS size times the page's device pixel ratio. */
const assertPngOfSize = Effect.fnUntraced(function*(
  page: Page.Page,
  bytes: Uint8Array,
  css: { readonly width: number; readonly height: number }
) {
  const ratio = yield* page.evaluateInMainWorld(() => window.devicePixelRatio)
  assert.deepStrictEqual(pngSize(bytes), { width: css.width * ratio, height: css.height * ratio })
})

/**
 * A capture of the element `selector` matches, whose box is fractional or rotated: its PNG size is the smallest whole
 * rectangle of device pixels that holds the box, which is what Playwright captures.
 */
const assertPngOfBox = Effect.fnUntraced(function*(page: Page.Page, bytes: Uint8Array, selector: string) {
  const box = yield* page.evaluateInMainWorld((selector) => {
    const rect = (document.querySelector(selector) as Element).getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, ratio: window.devicePixelRatio }
  }, selector)
  assert.deepStrictEqual(pngSize(bytes), {
    width: Math.ceil(box.right * box.ratio) - Math.floor(box.left * box.ratio),
    height: Math.ceil(box.bottom * box.ratio) - Math.floor(box.top * box.ratio)
  })
})

const setViewport = (page: Page.Page, width: number, height: number) => page.emulate({ viewport: { width, height } })

/** Playwright's `verifyViewport`: the viewport the page was given, as the page reports it. */
const verifyViewport = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  assert.deepStrictEqual(Option.getOrUndefined(yield* page.viewportSize), { width, height })
  assert.deepStrictEqual(
    yield* page.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight })),
    { width, height }
  )
})

upstream(import.meta.filename, {}, (test) => {
  test("EH-074", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
      // the third box: its darkgray border and its own background
      assertPixels(screenshot, [[0, 0, [169, 169, 169, 255]], [46, 46, [255, 210, 204, 255]]])
    }))

  test("EH-076", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        window.scrollBy(50, 100)
        Reflect.set(JSON, "stringify", () => undefined)
      })
      const screenshot = yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
      // the third box: its darkgray border and its own background
      assertPixels(screenshot, [[0, 0, [169, 169, 169, 255]], [46, 46, [255, 210, 204, 255]]])
    }))

  test("EH-077", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>div {
        border: 2px solid blue;
        background: green;
        width: 50px;
        height: 50px;
      }
      </style>
      <div id="d"></div>
    `)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div#d") } })
      // 50 CSS pixels of content, and a 2 pixel border on each side
      yield* assertPngOfSize(page, screenshot, { width: 54, height: 54 })
      assertPixels(screenshot, [[0, 0, BLUE], [2, 2, GREEN], [27, 27, GREEN], [53, 53, BLUE]])
    }))

  test("EH-078", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
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
      const toScreenshot = page.locator("div.to-screenshot")
      // The three captures run at once, as the original's `Promise.all` over its handles does
      const screenshots = yield* Effect.all(
        [0, 1, 2].map((index) => page.screenshot({ area: { element: toScreenshot.nth(index) } })),
        { concurrency: "unbounded" }
      )
      // 600 CSS pixels and a 1 pixel border on each side, beyond the 500 pixel viewport
      yield* assertPngOfSize(page, screenshots[2]!, { width: 602, height: 602 })
      assertPixels(screenshots[2]!, [[0, 0, BLUE], [1, 1, WHITE], [300, 300, WHITE], [601, 601, BLUE]])
      yield* verifyViewport(page, 500, 500)
    }))

  test("EH-079", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
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
      // Playwright's `page.$` is the first match
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot").nth(0) } })
      yield* assertPngOfSize(page, screenshot, { width: 602, height: 602 })
      assertPixels(screenshot, [[0, 0, BLUE], [1, 1, WHITE], [300, 300, WHITE], [601, 601, BLUE]])
      yield* verifyViewport(page, 500, 500)
    }))

  test("EH-080", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>div.above {
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
    `)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot") } })
      yield* assertPngOfSize(page, screenshot, { width: 54, height: 54 })
      assertPixels(screenshot, [[0, 0, BLUE], [2, 2, GREEN], [27, 27, GREEN], [53, 53, BLUE]])
    }))

  test("EH-081", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(`
      <div style="height: 14px">oooo</div>
      <style>div.above {
        border: 2px solid blue;
        background: red;
        height: 15000px;
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
    `)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div.to-screenshot") } })
      yield* assertPngOfSize(page, screenshot, { width: 54, height: 54 })
      assertPixels(screenshot, [[0, 0, BLUE], [2, 2, GREEN], [27, 27, GREEN], [53, 53, BLUE]])
    }))

  test("EH-082", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent(`<div style="position:absolute;
                                      top: 100px;
                                      left: 100px;
                                      width: 100px;
                                      height: 100px;
                                      background: green;
                                      transform: rotateZ(200deg);">&nbsp;</div>`)
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      yield* assertPngOfBox(page, screenshot, "div")
      // the golden is 130x130 here: the rotated square's box, with the green square at its middle and the page's white at the corners
      assert.deepStrictEqual(pngSize(screenshot), { width: 130, height: 130 })
      assertPixels(screenshot, [[0, 0, WHITE], [65, 65, GREEN], [129, 129, WHITE]])
    }))

  test("EH-083", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<h1>remove this</h1>")
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

  test("EH-084", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"width: 50px; height: 0\"></div>")
      const error = yield* failureOf(
        page.screenshot({ area: { element: page.locator("div") } }).pipe(Deadline.within("3 seconds")),
        "a capture of an element with no height"
      )
      assert(Deadline.isTimeout(error), String(error))
      assert.strictEqual(error.operation, "Page.screenshot")
      assert.strictEqual((Option.getOrUndefined(error.last)?.value as { _tag: string } | undefined)?._tag, "NotVisible")
    }))

  test("EH-085", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      const box = page.locator(".box:nth-of-type(3)")
      const setVisibility = (value: string) =>
        page.evaluateInMainWorld((value) => {
          ;(document.querySelector(".box:nth-of-type(3)") as HTMLElement).style.visibility = value
        }, value)
      yield* setVisibility("hidden")
      const waiting = yield* startWaiting(page.screenshot({ area: { element: box } }))
      yield* rafraf(page, 10)
      assert.isFalse(yield* waiting.done, "the capture finished while the element was hidden")
      yield* setVisibility("visible")
      const screenshot = yield* Fiber.join(waiting.fiber)
      yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
      assertPixels(screenshot, [[0, 0, [169, 169, 169, 255]], [46, 46, [255, 210, 204, 255]]])
    }))

  test("EH-086", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<div style=\"width:48.51px;height:19.8px;border:1px solid black;\"></div>")
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      yield* assertPngOfBox(page, screenshot, "div")
      // the golden's size: 48.51 and 2 border pixels wide, 19.8 and 2 high, from 8 pixels in
      assert.deepStrictEqual(pngSize(screenshot), { width: 51, height: 22 })
      assertPixels(screenshot, [[0, 0, BLACK], [1, 1, WHITE], [50, 21, BLACK]])
    }))

  test("EH-087", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        "<div style=\"position:absolute; top: 10.3px; left: 20.4px;width:50.3px;height:20.2px;border:1px solid black;\"></div>"
      )
      const screenshot = yield* page.screenshot({ area: { element: page.locator("div") } })
      yield* assertPngOfBox(page, screenshot, "div")
      // the golden's size: from 20.4 to 72.7 across, from 10.3 to 32.5 down
      assert.deepStrictEqual(pngSize(screenshot), { width: 53, height: 23 })
    }))

  test("EH-088", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      const box = page.locator(".box:nth-of-type(3)")
      yield* page.evaluateInMainWorld(() => document.querySelector(".box:nth-of-type(3)")!.classList.add("animation"))
      yield* rafraf(page)
      // Playwright's capture waits for the animation's two seconds to end, and the box to stop at its place; the golden
      // is the box that stands there, as in EH-074
      const screenshot = yield* page.screenshot({ area: { element: box } })
      yield* assertPngOfSize(page, screenshot, { width: 50, height: 50 })
      assertPixels(screenshot, [[0, 0, [169, 169, 169, 255]], [46, 46, [255, 210, 204, 255]]])
    }))

  test("EH-089", ({ page }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.setContent("<button disabled>Click me</button>")
      const screenshot = yield* page.screenshot({ area: { element: page.locator("button") } })
      assert.instanceOf(screenshot, Uint8Array)
      pngSize(screenshot)
    }))

  test("EH-091", ({ page, server }) =>
    Effect.gen(function*() {
      yield* setViewport(page, 500, 500)
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scrollBy(50, 100))
      // Playwright's `path` is the caller's file, here; the format is the one the call names, and quality is the
      // original's default, 80
      const buffer = yield* page.screenshot({
        area: { element: page.locator(".box:nth-of-type(3)") },
        format: "jpeg",
        quality: 80
      })
      assert.isTrue(isJpeg(buffer))
    }))

  test("EH-092", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
      // The listener is the test's, so a resize it sees sets a flag the port reads (Strider has no exposeFunction)
      yield* page.evaluateInMainWorld(() => {
        window.addEventListener("resize", () => {
          ;(window as unknown as { resized?: boolean }).resized = true
        })
      })
      yield* page.screenshot({ area: { element: page.locator(".box:nth-of-type(3)") } })
      const resized = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { resized?: boolean }).resized === true
      )
      assert.isFalse(resized)
    }))
})
