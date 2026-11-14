/**
 * Puppeteer's `test/src/cdp/screencast.test.ts`: recording a page to a video file, several at once, at a fractional
 * device scale, and the options each recording takes.
 *
 * What the port changes:
 * - Puppeteer's `page.screencast({ path })` is a recording to a file, which is `page.capability(Capability.Video)`
 *   in a scope: its `file` completes with the WebM once the scope has closed. `recorder.stop()` is closing that scope,
 *   and the file is read after, as `screencast.test.ts` (library) reads its recordings.
 * - Recordings are written to the context's downloads directory, which the original's unique placeholder names
 *   stand in for. Chromium and Firefox need that directory; the video's size is the viewport's.
 * - The original's `scale`, `crop`, `speed`, and the rest of the options aren't Strider's (`option-screencast-start-*`),
 *   so "should work" and "should validate options" are `needsFeature` in the ledger and aren't ported.
 * - "should work concurrently": the first recording starts with the second and stops before the second's second
 *   input. `Effect.scoped` nests the two scopes: the second recording's scope is the outer one, so its file is written
 *   after both inputs. The size ratio check is the original's.
 * - "should work with a fractional device scale factor" passes Chromium `--force-device-scale-factor=1.15` at launch in
 *   the original, which applies to the whole browser. A file's launch settings apply to every test in it, so the port
 *   gives this context the same scale as its viewport's `deviceScaleFactor` (`Browser.newContext({ emulation })`), at
 *   the original's 800 by 600. The frames' device pixels are what the original checks are fractional, which the file's
 *   size check doesn't read.
 * - Stock WebKit's video needs explicit polling options and a writer (`option-screencast-start-path`), so the ledger
 *   marks WebKit for the three recordings.
 * - Puppeteer skips these on Chrome for want of an ffmpeg download and on Firefox for being CDP-specific. This harness
 *   has ffmpeg (`STRIDER_FFMPEG`), and Strider's video isn't CDP-only, so the port runs on each browser that records.
 * - `input.type('ab', { delay: 100 })` is `page.locator("input").pressSequentially("ab", …)`, which waits for the input
 *   and types one key at a time with the delay.
 * - `page.goto('data:text/html,<input>')` is `page.goto` with `waitUntil: "load"`.
 */
import { assert } from "@effect/vitest"
import { Browser, Capability, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** A fresh directory for a test's recordings, which the test removes. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-puppeteer-screencast-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/** Types `ab` into the page's input with Puppeteer's 100 ms delay between keys. */
const typeAb = (page: Page.Page) => page.locator("input").pressSequentially("ab", { delay: "100 millis" })

/**
 * Records `page` while `steps` run, then gives the file once the recording's scope has closed, as Puppeteer's
 * `recorder.stop()` does once the file is written.
 */
const recorded = Effect.fnUntraced(function*(page: Page.Page, steps: Effect.Effect<void, unknown, never>) {
  const recording = yield* Effect.scoped(Effect.gen(function*() {
    const video = yield* page.capability(Capability.Video)
    yield* steps
    return video
  }))
  return String(yield* recording.file)
})

upstream(import.meta.filename, {}, (test) => {
  test(
    "Screencasts Page.screencast should work concurrently",
    { page: false },
    () =>
      withDirectory((directory) =>
        Effect.scoped(Effect.gen(function*() {
          const context = yield* Browser.newContext({ downloads: { directory } })
          const page = yield* context.newPage
          yield* page.goto("data:text/html,<input>", load)
          // The second recording spans both inputs; the first stops after the first
          const [first, second] = yield* Effect.scoped(Effect.gen(function*() {
            const second = yield* page.capability(Capability.Video)
            const first = yield* Effect.scoped(Effect.gen(function*() {
              const first = yield* page.capability(Capability.Video)
              yield* typeAb(page)
              return first
            }))
            yield* typeAb(page)
            return [first, second] as const
          }))
          const file1 = String(yield* first.file)
          const file2 = String(yield* second.file)
          // Since file2 spent about double the time of file1 recording, so file2 should be around double the size of file1.
          const ratio = fs.statSync(file2).size / fs.statSync(file1).size

          // We use a range because we cannot be precise.
          const DELTA = 1.3
          assert.isAbove(ratio, 2 - DELTA)
          assert.isBelow(ratio, 2 + DELTA)
        }))
      )
  )

  test(
    "Screencasts Page.screencast should work with a fractional device scale factor",
    { page: false },
    () =>
      withDirectory((directory) =>
        Effect.scoped(Effect.gen(function*() {
          // 800 * 1.15 and 600 * 1.15 are just below whole numbers in floating point, while the frames are 920 x 690.
          const context = yield* Browser.newContext({
            downloads: { directory },
            emulation: { viewport: { width: 800, height: 600, deviceScaleFactor: 1.15 } }
          })
          const page = yield* context.newPage
          const file = yield* recorded(
            page,
            Effect.gen(function*() {
              yield* page.goto("data:text/html,<input>", load)
              yield* typeAb(page)
            })
          )
          assert.isAbove(fs.statSync(file).size, 0)
        }))
      )
  )
})
