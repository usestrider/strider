/**
 * `@usestrider/vitest`'s screenshot baselines against a real browser: a baseline written, a match, a mismatch
 * with its images attached, an element's capture, and a screenshot refusal passing through.
 */
import { assert, describe, layer } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import { ScreenshotBaseline, VitestBrowser } from "@usestrider/vitest"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"

const timeout = 60_000

/** The comparison's reason, failing the test if the matcher failed some other way. */
const reasonOf = (error: unknown) => {
  assert.isTrue(ScreenshotBaseline.isScreenshotBaselineError(error), String(error))
  return (error as ScreenshotBaseline.ScreenshotBaselineError).reason
}

const html = (colour: string) =>
  `<!DOCTYPE html><style>body{margin:0}div{width:40px;height:30px;background:${colour}}</style><div id="box"></div>`

/** The engine part of a baseline's key, by suite. */
const engines: Readonly<Record<string, string>> = { Chromium: "chromium", Firefox: "firefox", WebKit: "webkit" }

export const screenshotBaselines = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} screenshot baselines`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)
      const engine = engines[name]
      /** A page showing `html`, with baselines and failure images in a directory of their own. */
      const setup = Effect.fnUntraced(function*(markup: string) {
        const directory = mkdtempSync(join(tmpdir(), "strider-baselines-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(directory, { recursive: true, force: true })))
        const { origin } = yield* site
        const page = yield* SharedContext.newPage
        yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(markup)}`)
        const settings = (update: ScreenshotBaseline.Update) =>
          Effect.provideService(ScreenshotBaseline.CurrentSettings, {
            update,
            path: (key: ScreenshotBaseline.Key) => join(directory, `${key.name}-${key.browser}.png`),
            outputDirectory: join(directory, "results")
          })
        return { directory, page, settings }
      })

      it.effect("writes a missing baseline, fails, then matches it", (context) =>
        Effect.gen(function*() {
          const { directory, page, settings } = yield* setup(html("teal"))
          const first = reasonOf(
            yield* page.pipe(ScreenshotBaseline.toMatch("page"), settings("missing"), Effect.flip)
          )
          assert.deepInclude(first, {
            _tag: "MissingBaseline",
            baseline: join(directory, `page-${engine}.png`),
            written: true
          })
          assert.isTrue(existsSync(join(directory, `page-${engine}.png`)))
          yield* page.pipe(ScreenshotBaseline.toMatch("page"), settings("none"))
        }).pipe(VitestBrowser.withTest(context)), timeout)

      it.effect("fails a mismatch, writing and attaching its images", (context) =>
        Effect.gen(function*() {
          const { page, settings } = yield* setup(html("teal"))
          const box = page.locator("#box")
          yield* page.pipe(ScreenshotBaseline.toMatch("box", { area: { element: box } }), settings("all"))
          yield* page.evaluateInMainWorld(() => void (document.getElementById("box")!.style.background = "orange"))
          const reason = reasonOf(
            yield* page.pipe(
              ScreenshotBaseline.toMatch("box", { area: { element: box } }),
              settings("none"),
              Effect.flip
            )
          )
          assert.strictEqual(reason._tag, "Mismatch")
          const mismatch = reason as ScreenshotBaseline.Mismatch
          // The element alone: every pixel of it changed
          assert.strictEqual(mismatch.diffPixelRatio, 1)
          for (const path of [mismatch.actual, mismatch.expected, mismatch.diff]) {
            assert.deepStrictEqual([...readFileSync(path).subarray(1, 4)], [80, 78, 71])
          }
          assert.isAbove(mismatch.diffPixels, 0)
        }).pipe(VitestBrowser.withTest(context)), timeout)

      it.effect("passes a screenshot's refusal through", (context) =>
        Effect.gen(function*() {
          const { page, settings } = yield* setup(html("teal"))
          const exit = yield* page.pipe(
            ScreenshotBaseline.toMatch("css", { scale: "css" }),
            settings("all"),
            Effect.exit
          )
          if (yield* supports("screenshot.cssScale")) {
            assert.strictEqual(exit._tag, "Success")
          } else {
            assert.isTrue(exit._tag === "Failure")
            const error = JSON.stringify(exit)
            assert.include(error, "PageError")
            assert.include(error, "screenshot.cssScale")
          }
        }).pipe(VitestBrowser.withTest(context)), timeout)
    })
  })
