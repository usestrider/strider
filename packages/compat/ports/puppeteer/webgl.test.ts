/**
 * Puppeteer's `test/src/webgl.test.ts`: a WebGL context can be created with the software-rendering flags Puppeteer's
 * suite launches Chromium with.
 *
 * What the port changes:
 * - The flags are Chromium's, so they go to the Chromium launch only. Puppeteer passes them to every browser it runs
 *   and skips Firefox for them; the port runs the test on each browser with its own default launch, as the rest of
 *   the Puppeteer ports do.
 * - Puppeteer's `page.evaluate` runs in the main world, so the canvas is created with `evaluateInMainWorld`.
 */
import * as Effect from "effect/Effect"
import { upstream } from "../harness/upstream.ts"

upstream(
  import.meta.filename,
  {
    launch: {
      chromium: {
        args: [
          // Current flags that enable software rendering.
          "--disable-gpu",
          "--enable-features=AllowSwiftShaderFallback,AllowSoftwareGLFallbackDueToCrashes",
          "--enable-unsafe-swiftshader"
        ]
      }
    }
  },
  (test) => {
    test("webgl Create webgl context should work", ({ page }) =>
      Effect.gen(function*() {
        yield* page.evaluateInMainWorld(() => {
          const canvas = document.createElement("canvas")
          const gl = canvas.getContext("webgl")
          if (!gl) {
            throw new Error("WebGL context not created")
          }
        })
      }))
  }
)
