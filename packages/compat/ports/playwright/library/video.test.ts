/**
 * Playwright's `tests/library/video.spec.ts`: recording a page to a WebM file, and what the file holds: its size, its
 * frames (the last one, and every frame for a navigation), its path, and the copies and popups a recording makes.
 *
 * What the port changes:
 * - Strider records by capability: `page.capability(Capability.Video)`, acquired in a scope the recording lasts for.
 *   Playwright's `recordVideo.dir` is the context's `downloads` directory, which Strider keeps when it's a directory the
 *   caller names (`{ directory }`), so the tests that read the file after their context closes name one. The recording's
 *   `file` completes once its scope has closed, so each port reads it after the scope, where the original reads
 *   `page.video().path()` before `context.close()`.
 * - Each test makes its own context (`{ page: false }`): a recording needs a downloads directory, and the harness's pages
 *   have none. `browser.newContext({ recordVideo })` is `Browser.newContext({ downloads, emulation })`, and the harness
 *   launches the browser, so a test that closes the browser (VI-023 to VI-026) only closes its context.
 * - Playwright's `video.path()`, `video.delete()` and `video.saveAs()` are the file's path, a file operation the caller
 *   owns, and a copy (VI-031). Playwright's `page.video()` accessor has no counterpart (VI-001).
 * - Strider's video is the page's first picture in device pixels, and it has no `size`, default size, or `fps` option, so
 *   a test that asks for another size or rate isn't ported (see the ledger). Where a test's requested size is the
 *   viewport, the port asserts the file is the viewport's size: that is Strider's own rule (the first picture's size,
 *   fixed for the file), so the check fails if Strider scaled or padded the picture, not a check of an option.
 *   VI-029 keeps the original's 600 by 400 at a device scale factor of 3.
 * - Decoding: the integration tests decode Chromium's video with ffmpeg through `STRIDER_FFMPEG`, and so does this port.
 *   Playwright's `VideoPlayer` resamples to 25 fps and reads PNGs; this port decodes the file's own frames in order
 *   (`-fps_mode passthrough`, since ffmpeg's constant-rate default turns a variable-rate file into thousands of frames), so
 *   `seekLastFrame` is the file's last frame, and `findFrame` searches the frames in order. `STRIDER_FFPROBE` gives the
 *   stream's size and duration.
 * - `ensureSomeFrames(page)` is `rafraf(page, 100)` and a screenshot, as in the original.
 * - `page.evaluate` runs in the main world (`evaluateInMainWorld`). A script that opens a popup runs as a user gesture
 *   (`Page.withUserGesture`), and popups are read from `Popup.next`, subscribed before the action that opens them.
 * - Playwright's `it.fixme` and `it.skip` for headed runs, other platforms, and older Chromium don't apply to this
 *   harness; each port runs on every browser the file covers, and its ledger entries say where a browser can't record.
 * - VI-014 emulates focus on Chromium: Playwright's pages all report focus, so the opener keeps rendering behind its
 *   popup, where Strider's default leaves it in the background and its animation frames never run.
 * - VI-021 is Strider's `launchPersistentContext`: a browser launched on a `userDataDir`, whose default context is
 *   controlled, as DC-* and HA-004 do. VI-023 builds its own browser layer so the test closes it.
 * - The tests not ported are in the ledger: requested and default sizes and the frame rate (VI-004, VI-015 to VI-020), the
 *   browser's kill (VI-024), the trace's frames (VI-030), `page.video()` (VI-001), `delete()` (VI-007), and the
 *   recordVideo option's shape (VI-002).
 * - The harness launches stock WebKit without its writer and polling options, so acquiring `Capability.Video` there is
 *   `Unsupported`; the tests are needsFeature on WebKit, and run on Chromium (a `VideoWriter` from `STRIDER_FFMPEG`) and
 *   Firefox, which writes its own file.
 */
import { assert } from "@effect/vitest"
import { Browser, Capability, Page, Popup } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend } from "../../harness/browsers.ts"
import { upstream } from "../../harness/upstream.ts"
import {
  block,
  decodeFrames,
  ensureSomeFrames,
  expectAll,
  expectRedFrames,
  isAlmostRed,
  lastFrame,
  probe,
  type Rgb,
  type Size
} from "../../harness/video.ts"

const isAlmostBlack = ([r, g, b]: Rgb) => r < 70 && g < 70 && b < 70
const isAlmostGray = ([r, g, b]: Rgb) => r > 70 && r < 185 && g > 70 && g < 185 && b > 70 && b < 185

/** Whether some frame has `predicate` true of its 10×10 block at `offset`, Playwright's `findFrame` over the block. */
const someFrame = Effect.fnUntraced(function*(
  file: string,
  size: Size,
  predicate: (pixels: ReadonlyArray<Rgb>) => boolean
) {
  const seen = { found: false }
  yield* decodeFrames(file, size, (frame) => {
    if (predicate(block(frame, size, { x: 10, y: 10 }))) seen.found = true
    return seen.found
  })
  return seen.found
})

const paintRed = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    document.body.style.backgroundColor = "red"
  })

/**
 * A fresh directory for a test's files, which the test removes. Playwright's `testInfo.outputPath("")`.
 */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-video-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/**
 * A context whose videos go to `directory`: Playwright's `recordVideo.dir`, which Strider keeps because the directory
 * is the caller's. The viewport is Playwright's default when none is given.
 */
const videoContext = (
  directory: string,
  viewport: { readonly width: number; readonly height: number; readonly deviceScaleFactor?: number } = {
    width: 1280,
    height: 720
  },
  focus?: "system" | "emulated"
) => Browser.newContext({ downloads: { directory }, emulation: { viewport }, focus })

/**
 * Records `page` while `steps` run, then gives the file once the recording's scope has closed, as Playwright's
 * `page.video().path()` after its context closes.
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

// Firefox's minimum video size is 500 by 400 (450 high on other platforms in Playwright); other browsers use 320 by 240.
const smallSize = (browserName: string): Size =>
  browserName === "firefox" ? { width: 500, height: 400 } : { width: 320, height: 240 }

upstream(import.meta.filename, {}, (test) => {
  test(
    "VI-003",
    { page: false },
    ({ browserName }) =>
      withDirectory((directory) =>
        Effect.scoped(Effect.gen(function*() {
          const size = smallSize(browserName)
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          const file = yield* recorded(
            page,
            Effect.gen(function*() {
              yield* paintRed(page)
              yield* ensureSomeFrames(page)
            })
          )
          yield* expectRedFrames(file, size)
        }))
      )
  )

  test(
    "VI-005",
    { page: false },
    ({ browserName }) =>
      withDirectory((directory) =>
        Effect.scoped(Effect.gen(function*() {
          const size = smallSize(browserName)
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          const file = yield* recorded(
            page,
            Effect.gen(function*() {
              yield* page.setContent("<a target=_blank href=\"about:blank\">clickme</a>")
              // The popup is subscribed to before the click that opens it, as Playwright's `Promise.all` waits on it.
              const opened = yield* Popup.next(page)
              yield* page.locator("a").click()
              const popup = yield* opened
              yield* popup.close()
              yield* page.evaluateInMainWorld(() => {
                document.body.textContent = ""
                document.body.style.backgroundColor = "red"
              })
              yield* ensureSomeFrames(page)
            })
          )
          yield* expectRedFrames(file, size)
        }))
      )
  )

  test("VI-006", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          const file = yield* recorded(page, paintRed(page))
          assert.include(file, directory)
          return file
        }))
        // The file outlives its context, since the directory is the caller's.
        assert.isTrue(fs.existsSync(file))
      })
    ))

  test("VI-008", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          // A blank page, with no step: the recording's path is known and the file exists once it has ended.
          const file = yield* recorded(page, Effect.void)
          assert.include(file, directory)
          return file
        }))
        assert.isTrue(fs.existsSync(file))
      })
    ))

  test("VI-009", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 1904, height: 609 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          const file = yield* recorded(page, Effect.void)
          assert.include(file, directory)
          return file
        }))
        assert.isTrue(fs.existsSync(file))
      })
    ))

  test("VI-010", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        // A directory given relative to the working directory, as Playwright's test passes it.
        const relative = path.relative(process.cwd(), directory)
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(relative, size)
          const page = yield* context.newPage
          return yield* recorded(page, Effect.void)
        }))
        assert.isTrue(fs.existsSync(file))
      })
    ))

  test("VI-011", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          // `window.open` from a script is a user gesture under Strider's popup blocking.
          const opened = yield* Popup.next(page)
          yield* page.evaluateInMainWorld(() => {
            window.open("about:blank")
          }).pipe(Page.withUserGesture)
          const popup = yield* opened
          const file = yield* recorded(popup, Effect.void)
          assert.include(file, directory)
          return file
        }))
        assert.isTrue(fs.existsSync(file))
      })
    ))

  test("VI-012", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const size = { width: 1280, height: 720 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        const file = yield* recorded(
          page,
          Effect.gen(function*() {
            yield* page.goto(server.PREFIX + "/background-color.html#rgb(0,0,0)")
            yield* ensureSomeFrames(page)
            yield* page.goto(server.CROSS_PROCESS_PREFIX + "/background-color.html#rgb(100,100,100)")
            yield* ensureSomeFrames(page)
          })
        )
        assert.isAbove(probe(file).duration, 0)
        // Some frame shows the first page, every pixel almost black.
        assert.isTrue(
          yield* someFrame(file, size, (pixels) => pixels.every(isAlmostBlack)),
          "a frame with all almost-black pixels"
        )
        const last = yield* lastFrame(file, size)
        expectAll(block(last, size, { x: 10, y: 10 }), isAlmostGray, "almost gray")
      }))
    ))

  test("VI-013", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        // The viewport matches the video's size, so the frames aren't scaled.
        const size = { width: 600, height: 400 }
        const context = yield* videoContext(directory, size)
        const page = yield* context.newPage
        const file = yield* recorded(
          page,
          Effect.gen(function*() {
            yield* page.goto(server.PREFIX + "/rotate-z.html")
            yield* ensureSomeFrames(page)
          })
        )
        assert.isAbove(probe(file).duration, 0)
        const last = yield* lastFrame(file, size)
        expectAll(block(last, size, { x: 95, y: 45 }), isAlmostRed, "almost red")
      }))
    ))

  test("VI-014", { page: false }, ({ server, browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 600, height: 400 }
        const files = yield* Effect.scoped(Effect.gen(function*() {
          // Playwright's pages all report focus, so the opener keeps rendering behind its popup. Strider's contexts
          // leave focus to the system, which puts the opener in the background, where it renders too few frames to
          // act on, so the context emulates focus (Chromium; Firefox has no focus emulation and leaves it).
          const context = yield* videoContext(directory, size, browserName === "chromium" ? "emulated" : "system")
          const page = yield* context.newPage
          yield* page.goto(server.EMPTY_PAGE)
          const opened = yield* Popup.next(page)
          yield* page.evaluateInMainWorld(() => {
            window.open("about:blank")
          }).pipe(Page.withUserGesture)
          const popup = yield* opened
          // Each page has its own recording, and both run until the scope closes, as Playwright's record both.
          const recordings = yield* Effect.scoped(Effect.gen(function*() {
            const pageVideo = yield* page.capability(Capability.Video)
            const popupVideo = yield* popup.capability(Capability.Video)
            yield* popup.evaluateInMainWorld(() => {
              document.body.style.backgroundColor = "red"
            })
            yield* Effect.all([ensureSomeFrames(page), ensureSomeFrames(popup)], { concurrency: "unbounded" })
            return { pageVideo, popupVideo }
          }))
          return {
            page: String(yield* recordings.pageVideo.file),
            popup: String(yield* recordings.popupVideo.file)
          }
        }))
        assert.notStrictEqual(files.page, files.popup)
        yield* expectRedFrames(files.popup, size)
        assert.strictEqual(videosIn(directory).length, 2)
      })
    ))

  test("VI-021", { page: false }, ({ browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 600, height: 400 }
        // Strider's `launchPersistentContext`: a browser launched on a profile directory, whose default context is the
        // persistent one, controlled for the scope.
        const file = yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          return yield* Effect.scoped(Effect.gen(function*() {
            const context = yield* browser.defaultContext.control
            yield* context.emulate({ viewport: size })
            const [page] = yield* context.pages.waitFor((pages) => pages.length >= 1)
            return yield* recorded(
              page!,
              Effect.gen(function*() {
                yield* paintRed(page!)
                yield* ensureSomeFrames(page!)
              })
            )
          }))
        }).pipe(
          Effect.provide(backend(browserName, { [browserName]: { userDataDir: path.join(directory, "profile") } }))
        )
        yield* expectRedFrames(file, size)
      })
    ))

  test("VI-025", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          // The page closes inside its recording, which then finishes the file, as Playwright's test waits for.
          const recording = yield* Effect.scoped(Effect.gen(function*() {
            const video = yield* page.capability(Capability.Video)
            yield* ensureSomeFrames(page)
            yield* page.close()
            return video
          }))
          return String(yield* recording.file)
        }))
        assert.strictEqual(videosIn(directory).length, 1)
        const info = probe(file)
        assert.strictEqual(info.width, size.width)
        assert.strictEqual(info.height, size.height)
      })
    ))

  test("VI-023", { page: false }, ({ browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        // The test's own browser, as the original launches one, so that closing it is the test's.
        const browserScope = yield* Scope.make()
        const browser = Context.get(
          yield* Layer.buildWithScope(backend(browserName, undefined), browserScope),
          Browser.Browser
        )
        const recordingScope = yield* Scope.make()
        const recording = yield* Effect.gen(function*() {
          const context = yield* browser.newContext({ downloads: { directory }, emulation: { viewport: size } })
          const page = yield* context.newPage
          const video = yield* page.capability(Capability.Video)
          yield* ensureSomeFrames(page)
          return video
        }).pipe(Scope.provide(recordingScope))
        yield* Scope.close(browserScope, Exit.void)
        // Playwright's `saveAs` fails with "browser has been closed"; Strider's file fails too, as a typed failure.
        const exit = yield* Effect.exit(recording.file)
        yield* Scope.close(recordingScope, Exit.void)
        assert.isTrue(
          Exit.isFailure(exit),
          `the file of a recording whose browser closed fails, but it is ${JSON.stringify(exit)}`
        )
      })
    ))

  test("VI-026", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 320, height: 240 }
        yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          // Each page records and closes with no frame between, as the original's two pages do.
          for (const _ of [1, 2]) {
            const page = yield* context.newPage
            yield* Effect.scoped(page.capability(Capability.Video).pipe(Effect.andThen(page.close())))
          }
        }))
        // Playwright writes a file for each page; a Strider recording that received no image writes none.
        assert.strictEqual(videosIn(directory).length, 2)
      })
    ))

  test("VI-027", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        server.setRoute("/empty.html", (_request, response) => {
          response.setHeader("Set-Cookie", "name=value")
          response.end()
        })
        yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory)
          const page = yield* context.newPage
          yield* recorded(
            page,
            Effect.gen(function*() {
              yield* page.goto(server.EMPTY_PAGE)
              yield* ensureSomeFrames(page)
              const cookies = yield* context.cookies.list
              assert.strictEqual(cookies.length, 1)
              yield* context.exportStorageState
            })
          )
        }))
        // Only the page's recording is in the directory.
        assert.strictEqual(fs.readdirSync(directory).length, 1)
      })
    ))

  test("VI-028", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 600, height: 400 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          return yield* recorded(
            page,
            Effect.gen(function*() {
              yield* page.setContent(
                `<div style='margin: 0; background: red; position: fixed; right:0; bottom:0; width: 30; height: 30;'></div>`
              )
              yield* ensureSomeFrames(page)
              yield* page.close()
            })
          )
        }))
        assert.strictEqual(videosIn(directory).length, 1)
        const info = probe(file)
        assert.strictEqual(info.width, size.width)
        assert.strictEqual(info.height, size.height)
        // Bottom right corner should be part of the red border.
        const last = yield* lastFrame(file, size)
        expectAll(block(last, size, { x: size.width - 20, y: size.height - 20 }), isAlmostRed, "almost red")
      })
    ))

  test("VI-029", { page: false }, () =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        const size = { width: 600, height: 400 }
        const file = yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* videoContext(directory, { ...size, deviceScaleFactor: 3 })
          const page = yield* context.newPage
          return yield* recorded(
            page,
            Effect.gen(function*() {
              yield* page.setContent(
                `<div style='margin: 0; background: red; position: fixed; right:0; bottom:0; width: 30; height: 30;'></div>`
              )
              yield* ensureSomeFrames(page)
              yield* page.close()
            })
          )
        }))
        assert.strictEqual(videosIn(directory).length, 1)
        const info = probe(file)
        assert.strictEqual(info.width, size.width)
        assert.strictEqual(info.height, size.height)
        // Bottom right corner should be part of the red border.
        const last = yield* lastFrame(file, size)
        expectAll(block(last, size, { x: size.width - 20, y: size.height - 20 }), isAlmostRed, "almost red")
      })
    ))

  test(
    "VI-031",
    { page: false },
    ({ browserName }) =>
      withDirectory((directory) =>
        Effect.scoped(Effect.gen(function*() {
          const size = smallSize(browserName)
          const context = yield* videoContext(directory, size)
          const page = yield* context.newPage
          const file = yield* recorded(
            page,
            Effect.gen(function*() {
              yield* paintRed(page)
              yield* ensureSomeFrames(page)
            })
          )
          // Playwright's `saveAs` copies the file to a path of the caller's choice; a Strider file is copied the same way.
          const saved = path.join(directory, "my-video.webm")
          fs.copyFileSync(file, saved)
          assert.isTrue(fs.existsSync(saved))
        }))
      )
  )
})
