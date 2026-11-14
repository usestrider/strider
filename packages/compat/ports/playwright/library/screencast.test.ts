/**
 * Playwright's `tests/library/screencast.spec.ts`: the frames a page's screencast delivers, and the video files a
 * recording writes, with their last frames' colors.
 *
 * What the port changes:
 * - Playwright's `page.screencast.start({ onFrame })` is `page.capability(Capability.Screencast)` in a scope, and its
 *   `frames` stream is consumed by a forked fiber for that scope. `stop()` and the returned disposable are closing the
 *   scope. Strider has no `stop`, so SC-012 isn't ported (see the ledger).
 * - Playwright's `start({ path })` is `page.capability(Capability.Video)`, a recording whose `file` is read once its scope
 *   has closed, as video.test's ports do. Strider names the file itself, in the context's downloads directory, so SC-007
 *   counts the recordings in that directory rather than naming two files. SC-013 and SC-014 and SC-015 read their file the
 *   same way.
 * - Playwright's `browserType.launch({ artifactsDir })` is the context's `downloads` directory (SC-007).
 * - SC-013's `page.screencast.stop()` after the page closed rejects with the target closed message. Strider has no `stop`: the
 *   recording ends with its page and `video.file` completes with the video, which the port checks, and a new recording of the
 *   closed page fails with `Target.TargetGone`.
 * - SC-002 and SC-006's `viewport` contexts are `Browser.newContext`, with the original's viewport. The frames are JPEG
 *   bytes at device pixels, Strider's `ScreencastFrame.jpeg`.
 * - `page.evaluate` runs in the main world (`evaluateInMainWorld`). Strider's `page.evaluate` runs in an isolated world.
 * - `expect.poll(…)` is `Expect.that` over the poll's read, with the original's condition. SC-002's `ensureSomeFrames` and
 *   `page.evaluate` run inside the poll, as the original's do.
 * - Playwright's `test.skip` for `mode`, `video: 'on'`, and `trace: 'on'`, and the headed Firefox `fixme`, are Playwright's
 *   options and platforms, which the harness doesn't have. Each port runs on every browser the file covers.
 * - `ensureSomeFrames(page)` is `rafraf(page, 100)` and a screenshot, as in the original.
 * - The video files are read with the harness's `video.ts`, as video.test's ports are: ffmpeg through `STRIDER_FFMPEG`, size
 *   and duration through `STRIDER_FFPROBE`, in place of Playwright's `VideoPlayer`.
 * - SC-008 (`recordVideo` with a manual screencast) isn't ported: Strider's recording is a capability the caller acquires,
 *   not a context option (see the ledger). SC-009 and SC-010 ask for an `fps` Strider doesn't have. SC-001, SC-003, and
 *   SC-005 ask for a `size` Strider doesn't have, so SC-001 and SC-003 check its scaling. SC-004 and SC-011 expect a second
 *   acquisition to be refused, where Strider shares the stream (see the ledger).
 * - SC-006 doesn't assert the frames' size, so its context is the original's 500 by 400 viewport without the `size` option.
 */
import { assert } from "@effect/vitest"
import { Browser, Capability, Condition, Expect, Page, Target } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"
import { ensureSomeFrames, expectFrames, isAlmostRed, type Rgb, type Size } from "../../harness/video.ts"

const isAlmostWhite = ([r, g, b]: Rgb) => r > 185 && g > 185 && b > 185

const paint = (page: Page.Page, color: string) =>
  page.evaluateInMainWorld((color) => {
    document.body.style.backgroundColor = color
  }, color)

/** A fresh directory for a test's files, which the test removes. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-screencast-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/**
 * A context whose video files go to `directory`, as Playwright's `artifactsDir` and `recordVideo.dir` do. Strider's
 * recordings have the viewport's size, which is the `size` the original passes.
 */
const videoContext = (directory: string, size: Size) =>
  Browser.newContext({ downloads: { directory }, emulation: { viewport: size } })

/**
 * Records `page` while `steps` run, then gives the file once the recording's scope has closed, as Playwright's
 * `screencast.stop()` does once the video is written.
 */
const recorded = Effect.fnUntraced(function*(page: Page.Page, steps: Effect.Effect<void, unknown, Scope.Scope>) {
  const recording = yield* Effect.scoped(Effect.gen(function*() {
    const video = yield* page.capability(Capability.Video)
    yield* steps
    return video
  }))
  return String(yield* recording.file)
})

const videosIn = (directory: string) => fs.readdirSync(directory).filter((name) => name.endsWith("webm"))

upstream(import.meta.filename, {}, (test) => {
  test("SC-002", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 500, height: 400 } } })
      const page = yield* context.newPage
      const screencast = yield* page.capability(Capability.Screencast)
      const callbackDone = yield* Deferred.make<void>()
      const firstFrameReceived = yield* Deferred.make<void>()
      let frameCount = 0
      let lastFrameTimestamp = 0
      // `onFrame` is a stream consumer that holds each frame until `callbackDone`, which is what backpressure is
      yield* Effect.forkScoped(
        screencast.frames.pipe(
          Stream.runForEach(() =>
            Effect.gen(function*() {
              ++frameCount
              lastFrameTimestamp = Date.now()
              yield* Deferred.succeed(firstFrameReceived, undefined)
              yield* Deferred.await(callbackDone)
            })
          )
        )
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const animate = () => {
          document.body.style.backgroundColor = document.body.style.backgroundColor === "red" ? "blue" : "red"
          requestAnimationFrame(animate)
        }
        requestAnimationFrame(animate)
      })
      yield* Deferred.await(firstFrameReceived)
      yield* Expect.that(
        Effect.sync(() => Date.now() - lastFrameTimestamp),
        Condition.make("more than a second since the last frame", (age) => age > 1000)
      )

      const framesWhileBlocked = frameCount
      yield* ensureSomeFrames(page)
      assert.strictEqual(frameCount, framesWhileBlocked)

      yield* Deferred.succeed(callbackDone, undefined)
      yield* Expect.that(
        Effect.gen(function*() {
          yield* page.evaluateInMainWorld(() => {
            document.body.style.backgroundColor = document.body.style.backgroundColor === "red" ? "blue" : "red"
          })
          yield* ensureSomeFrames(page)
          return frameCount
        }),
        Condition.make("more frames once the callback returns", (count) => count > framesWhileBlocked)
      )
    })))

  test("SC-006", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { viewport: { width: 500, height: 400 } } })
      const page = yield* context.newPage
      const frames: Array<Uint8Array> = []
      // The frames stream lives in its own scope, which is what the original's disposable stops
      yield* Effect.scoped(Effect.gen(function*() {
        const screencast = yield* page.capability(Capability.Screencast)
        yield* Effect.forkScoped(
          screencast.frames.pipe(Stream.runForEach((frame) => Effect.sync(() => frames.push(frame.jpeg))))
        )
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* paint(page, "red")
        yield* ensureSomeFrames(page)
      }))
      const frameCountAfterDispose = frames.length
      assert.isAbove(frameCountAfterDispose, 0)

      // No more frames should arrive after the scope closed
      yield* paint(page, "blue")
      yield* ensureSomeFrames(page)
      assert.strictEqual(frames.length, frameCountAfterDispose)
    })))

  test("SC-007", { page: false }, () =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const size = { width: 800, height: 800 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        // Two recordings one after the other, in the context's own directory, as the original's two start/stop pairs
        yield* recorded(
          page,
          Effect.gen(function*() {
            yield* paint(page, "red")
            yield* ensureSomeFrames(page)
          })
        )
        yield* recorded(
          page,
          Effect.gen(function*() {
            yield* paint(page, "blue")
            yield* ensureSomeFrames(page)
          })
        )
        assert.strictEqual(videosIn(directory).length, 2)
      }))
    ))

  test("SC-013", { page: false }, () =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const size = { width: 800, height: 800 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        const video = yield* page.capability(Capability.Video)
        yield* paint(page, "red")
        yield* ensureSomeFrames(page)
        yield* page.close()
        // The recording finishes with its page, where the original's `stop()` after the close rejects with the target closed
        // message: Strider ends a recording when its page ends and writes the file, so `file` completes with the video
        // the page showed. Asking the closed page for another recording is what fails as the target is gone.
        const file = String(yield* video.file)
        yield* expectFrames(file, size, isAlmostRed, "almost red")
        const error = yield* failureOf(page.capability(Capability.Video), "a recording of the closed page")
        assert.isTrue(Target.isTargetGone(error), String(error))
      }))
    ))

  test("SC-014", { page: false }, () =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const size = { width: 800, height: 800 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        // The file is read after its recording has ended, with no picture drawn
        const file = yield* recorded(page, Effect.void)
        yield* expectFrames(file, size, isAlmostWhite, "almost white")
      }))
    ))

  test("SC-015", { page: false }, () =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const size = { width: 800, height: 800 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        // The recording's scope is its disposable: it ends when the steps do, and the file is read after that
        const file = yield* recorded(
          page,
          Effect.gen(function*() {
            yield* paint(page, "red")
            yield* ensureSomeFrames(page)
          })
        )
        yield* expectFrames(file, size, isAlmostRed, "almost red")
      }))
    ))
})
