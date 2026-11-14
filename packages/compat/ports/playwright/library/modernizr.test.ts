/**
 * Playwright's `tests/library/modernizr.spec.ts`: Modernizr's feature report from a WebKit page, against the expectation
 * recorded from Safari. WebKit only, as the original is.
 *
 * What the port changes:
 * - CA-031's `playwright.devices['iPhone 12']` is written out, as the values its device table holds (Strider has no device
 *   table, `property-playwright-devices`), as `browsercontext-viewport-mobile.test.ts` does. Its emulation is a mobile
 *   viewport, which stock WebKit refuses, so the ledger holds the test for WebKit.
 * - `browser.newContext({ deviceScaleFactor: 2, ignoreHTTPSErrors: true })` is `Browser.newContext` with a viewport of
 *   the factor and `acceptInsecureCerts`, which Strider supports on Firefox and launched WebKit.
 * - The page is served over TLS from the fixture server, as Playwright's `httpsServer`.
 * - `page.evaluate("window.report")` is `evaluateInMainWorld`, where Modernizr's report is.
 * - The original's `it.skip` conditions for Intel macOS and frozen WebKit builds don't apply to this harness, so they
 *   aren't stated. The `platform` branches are the Linux ones, the harness's host.
 * - Not run in this batch: the port's file is for the WebKit run in CI.
 */
import { assert } from "@effect/vitest"
import { Browser, type Emulation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import { assetPath } from "../../harness/playwright.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

type Report = Record<string, unknown>

/** Playwright's `devices['iPhone 12']`, the emulation of Playwright's device table (see the header). */
const iPhone12: Emulation.Emulation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 664, deviceScaleFactor: 3, mobile: true },
  touch: true
}

/** The report the page makes in a context with `options`, and the expectation recorded for `name`. */
const checkFeatures = (server: ServerShape, name: string, emulation: Emulation.Emulation) =>
  Effect.scoped(Effect.gen(function*() {
    const context = yield* Browser.newContext({ emulation, acceptInsecureCerts: true })
    const page = yield* context.newPage
    yield* page.goto(server.https.PREFIX + "/modernizr/index.html", { waitUntil: "load" })
    const actual = (yield* page.evaluateInMainWorld(() => (window as unknown as { report: unknown }).report)) as Report
    const expected = JSON.parse(fs.readFileSync(assetPath("playwright", `modernizr/${name}.json`), "utf-8")) as Report
    return { actual, expected }
  }))

upstream(import.meta.filename, { browsers: ["webkit"] }, (test) => {
  test("CA-030", { browsers: ["webkit"] }, ({ server }) =>
    Effect.gen(function*() {
      const { actual, expected } = yield* checkFeatures(server, "safari-26", {
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 }
      })

      // Shipping Safari exposes `font-display` as a settable CSS property (element.style.fontDisplay === ''),
      // but open-source WebKit keeps it a @font-face descriptor only, so it is undefined here. No runtime
      // flag bridges the gap, hence the override.
      expected.fontdisplay = false

      delete expected.webglextensions
      delete actual.webglextensions
      expected.audio = !!expected.audio
      actual.audio = !!actual.audio
      expected.video = !!expected.video
      actual.video = !!actual.video

      if (os.platform() === "linux") {
        expected.speechrecognition = false
        expected.mediastream = false
        expected.todataurlwebp = true

        // GHA
        delete actual.variablefonts
        delete expected.variablefonts
      }

      assert.deepEqual(actual, expected)
    }))

  test("CA-031", { browsers: ["webkit"] }, ({ server }) =>
    Effect.gen(function*() {
      const { actual, expected } = yield* checkFeatures(server, "mobile-safari-26", iPhone12)

      // All platforms.
      expected.capture = false
      expected.cssscrollbar = true
      expected.cssvhunit = true
      expected.cssvmaxunit = true
      expected.overflowscrolling = false
      expected.mediasource = true
      expected.scrolltooptions = false

      // Shipping Safari exposes `font-display` as a settable CSS property (element.style.fontDisplay === ''),
      // but open-source WebKit keeps it a @font-face descriptor only, so it is undefined here. No runtime
      // flag bridges the gap, hence the override.
      expected.fontdisplay = false

      delete expected.webglextensions
      delete actual.webglextensions
      expected.audio = !!expected.audio
      actual.audio = !!actual.audio
      expected.video = !!expected.video
      actual.video = !!actual.video

      if (os.platform() === "linux") {
        expected.speechrecognition = false
        expected.mediastream = false
        expected.todataurlwebp = true

        // GHA
        delete actual.variablefonts
        delete expected.variablefonts
      }

      assert.deepEqual(actual, expected)
    }))
})
