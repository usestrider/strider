/**
 * Puppeteer's `test/src/input.test.ts`: uploading files to an input, the file choosers a page opens, and deciding them
 * (accepting, canceling, and what a chooser accepts).
 *
 * What the port changes:
 * - `ElementHandle.uploadFile(path)` is `locator.setInputFiles(FileInput.local(path))`. The original's `using input`
 *   handle is the locator, and its `input.evaluate` reads are reads in the page's main world.
 * - A chooser is an event and a decision. `Page.waitForFileChooser` is `FileChooser.next`, subscribed before the click
 *   that opens the picker, as the original's `Promise.all` subscribes. Strider's chooser is a value, `Single` or
 *   `Multiple`, so `chooser.isMultiple()` is its `_tag`, and the original's `toBeTruthy` is an assertion on that tag.
 * - `FileChooser.accept(files)` is a handler: `FileChooser.handle(page, FileChooser.choose(files))`. The handler decides
 *   after the click, so each test waits for what the original waits for: the page's own `input` event, a count of the
 *   input's files, or the handler's `handled` count.
 * - `FileChooser.cancel()` is the handler's `chooser.cancel`.
 * - `page.setDefaultTimeout(1)` for one call is `defaultTimeout("1 millis")`, and an exact `{ timeout: 1 }` is
 *   `Deadline.within("1 millis")`: a `Deadline.Timeout` is what Strider's wait fails with, where the original's is a
 *   `TimeoutError`. `{ timeout: 0 }` (no timeout) is a wait with no deadline of its own, under the harness's 30 s.
 * - `page.$eval` and `page.evaluate` that click an input run as a user gesture (`Page.withUserGesture`), as Puppeteer's
 *   do on Chromium. `locator.click()` is a trusted click and needs none.
 * - Puppeteer's `page.$eval` callbacks that read the input's files are `page.evaluateInMainWorld` reads.
 * - A single chooser refuses several files or none, with `InvalidInput`. The refusal reaches the handler, which records it
 *   and cancels the chooser; the port records refusals through `Effect.result` to assert them, where the original's
 *   `accept` rejects. A file that doesn't exist is handed to the browser, which gives the same read error as Puppeteer's.
 * - The original's "unhandled rejection" check watches the Node process. Strider has no process-level rejection to watch:
 *   the page's own `showOpenFilePicker` rejection is caught in its `onclick`, so the port checks that the page logged no
 *   uncaught exception.
 * - `accept([])` on a single-file input (the reset test) is refused by Strider, as in `page-filechooser.test.ts`'s FC-020,
 *   and the chooser is canceled. The port waits for the handler's decision, as the original waits for the `input` event,
 *   and checks that the selection wasn't refused and that the input has no files, as the original does, so it fails
 *   where Strider refuses the empty selection.
 * - The tests that cancel with an abort signal, and that check Puppeteer's "already handled" errors, aren't ported; the
 *   ledger says why each is.
 */
import { assert } from "@effect/vitest"
import { Condition, Deadline, Expect, FileChooser, FileInput, Page, UncaughtException } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import { assetPath, defaultTimeout, failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** A condition that a value equals `expected`, for a poll. */
const equalTo = <A>(expected: A) =>
  Condition.make(
    `equal to ${JSON.stringify(expected)}`,
    (value: A) => JSON.stringify(value) === JSON.stringify(expected)
  )

/** The text file Puppeteer's tests upload. */
const textFile = () => FileInput.local(assetPath("puppeteer", "file-to-upload.txt"))

/** The number of files the page's first input holds, read in the page's main world. */
const fileCount = (page: Page.Page) => page.evaluateInMainWorld(() => document.querySelector("input")!.files!.length)

/** Clicks the page's first input from its main world, as Puppeteer's `page.$eval(…, input => input.click())` does. */
const clickInput = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    document.querySelector("input")!.click()
  }).pipe(Page.withUserGesture)

/**
 * A handler that chooses `files`, and records the refusal the choice gets, then cancels the chooser. Puppeteer's
 * `accept` rejects with that refusal; a handler's failure goes to the log instead, so the port keeps it for the test.
 */
const choosing = (
  files: FileInput.FileInput | ReadonlyArray<FileInput.FileInput>,
  refused: Array<FileChooser.FileChooserError>
) =>
(chooser: FileChooser.Pending) =>
  Effect.gen(function*() {
    const outcome = yield* Effect.result(FileChooser.choose(files)(chooser))
    if (Result.isFailure(outcome)) {
      refused.push(outcome.failure)
      return yield* chooser.cancel
    }
    return outcome.success
  })

upstream(import.meta.filename, {}, (test) => {
  test("input tests ElementHandle.uploadFile should upload the file", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html")
      // The page's own input gets listeners that record its events, as the original's `input.evaluate` adds them
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        ;(globalThis as any)._inputEvents = []
        input.addEventListener("change", (ev) => (globalThis as any)._inputEvents.push(ev.type))
        input.addEventListener("input", (ev) => (globalThis as any)._inputEvents.push(ev.type))
      })
      yield* page.locator("input").setInputFiles(textFile())

      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files?.[0]?.name),
        "file-to-upload.txt"
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files?.[0]?.type),
        "text/plain"
      )
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => (globalThis as any)._inputEvents),
        ["input", "change"]
      )
    }))

  test("input tests ElementHandle.uploadFile should read the file", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html")
      yield* page.evaluateInMainWorld(() => {
        const input = document.querySelector("input")!
        ;(globalThis as any)._inputEvents = []
        input.addEventListener("change", (ev) => (globalThis as any)._inputEvents.push(ev.type))
        input.addEventListener("input", (ev) => (globalThis as any)._inputEvents.push(ev.type))
      })
      yield* page.locator("input").setInputFiles(textFile())

      assert.strictEqual(
        yield* page.evaluateInMainWorld(async () => {
          const file = document.querySelector("input")!.files?.[0]
          if (!file) throw new Error("No file found")
          const reader = new FileReader()
          const loaded = new Promise<void>((fulfill) => {
            reader.onload = () => fulfill()
          })
          reader.readAsText(file)
          await loaded
          return reader.result
        }),
        "contents of the file"
      )
    }))

  test("input tests Page.waitForFileChooser should work when file input is attached to DOM", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("input tests Page.waitForFileChooser should work when file input is not attached to DOM", ({ page }) =>
    Effect.gen(function*() {
      const chooser = yield* FileChooser.next(page)
      yield* page.evaluateInMainWorld(() => {
        const el = document.createElement("input")
        el.type = "file"
        el.click()
      }).pipe(Page.withUserGesture)
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("input tests Page.waitForFileChooser should respect timeout", ({ page }) =>
    Effect.gen(function*() {
      const chooser = yield* FileChooser.next(page)
      const error = yield* failureOf(chooser.pipe(Deadline.within("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("input tests Page.waitForFileChooser should respect default timeout when there is no custom timeout", ({ page }) =>
    Effect.gen(function*() {
      // `page.setDefaultTimeout(1)` for this one wait
      const chooser = yield* FileChooser.next(page)
      const error = yield* failureOf(chooser.pipe(defaultTimeout("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("input tests Page.waitForFileChooser should prioritize exact timeout over default timeout", ({ page }) =>
    Effect.gen(function*() {
      // `page.setDefaultTimeout(0)` (no default timeout) is moot beside the exact timeout of 1 ms, which decides the wait
      const chooser = yield* FileChooser.next(page)
      const error = yield* failureOf(chooser.pipe(Deadline.within("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("input tests Page.waitForFileChooser should work with no timeout", ({ page }) =>
    Effect.gen(function*() {
      // `{ timeout: 0 }` is no deadline of the wait's own: the harness's 30 s is the only bound
      const chooser = yield* FileChooser.next(page)
      yield* page.evaluateInMainWorld(() => {
        return window.setTimeout(() => {
          const el = document.createElement("input")
          el.type = "file"
          el.click()
        }, 50)
      }).pipe(Page.withUserGesture)
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test(
    "input tests Page.waitForFileChooser should return the same file chooser when there are many watchdogs simultaneously",
    ({ page }) =>
      Effect.gen(function*() {
        yield* page.setContent(`<input type="file" />`)
        const first = yield* FileChooser.next(page)
        const second = yield* FileChooser.next(page)
        yield* clickInput(page)
        const one = yield* first
        const other = yield* second
        // Strider's chooser is a value with no identity to compare: both waits see the one chooser that the click opened
        assert.strictEqual(one._tag, "Single")
        assert.strictEqual(other._tag, "Single")
        const opened = yield* FileChooser.history(page)
        assert.strictEqual(opened.entries.length, 1)
      })
  )

  test("input tests Page.waitForFileChooser should not throw unhandled rejection when file picker is opened without an input element", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<button onclick="window.showOpenFilePicker?.().catch(() => {})"></button>`)
      const chooser = yield* FileChooser.next(page)
      // Puppeteer's `Promise.all` rejects with the first failure, so the wait's timeout and the click are run together
      const outcome = yield* Effect.all([chooser.pipe(Deadline.within("200 millis")), page.locator("button").click()], {
        concurrency: "unbounded"
      }).pipe(Effect.result)
      assert(Result.isFailure(outcome), "the wait for a chooser succeeded, where Puppeteer's times out")
      assert.isTrue(Deadline.isTimeout(outcome.failure))
      // The original's Node-level `unhandledRejection` listener has no counterpart in Strider; the page's own uncaught
      // errors are what it would see, and the picker's rejection is caught in the button's handler
      const uncaught = yield* UncaughtException.history(page)
      assert.strictEqual(uncaught.entries.length, 0)
    }))

  test("input tests FileChooser.accept should accept single file", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" oninput="javascript:console.timeStamp()" />`)
      const handler = yield* FileChooser.handle(page, FileChooser.choose(textFile()))
      yield* page.locator("input").click()
      // The handler decides after the click, and Puppeteer's `accept` resolves once the input has the file
      yield* handler.handled.waitFor((count) => count === 1)
      yield* Expect.that(fileCount(page), equalTo(1))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files![0]!.name),
        "file-to-upload.txt"
      )
    }))

  test("input tests FileChooser.accept should be able to read selected file", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      yield* FileChooser.handle(page, FileChooser.choose(textFile()))
      const text = yield* page.evaluateInMainWorld(async () => {
        const pick = document.querySelector("input")!
        pick.click()
        await new Promise<Event>((resolve) => {
          pick.oninput = resolve
        })
        const reader = new FileReader()
        const loaded = new Promise<void>((fulfill) => {
          reader.onload = () => fulfill()
        })
        reader.readAsText(pick.files![0]!)
        await loaded
        return reader.result
      }).pipe(Page.withUserGesture)
      assert.strictEqual(text, "contents of the file")
    }))

  test("input tests FileChooser.accept should be able to reset selected files with empty file list", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      // The first selection: the chooser takes the asset, and the input says it did
      yield* Effect.scoped(Effect.gen(function*() {
        const handler = yield* FileChooser.handle(page, FileChooser.choose(textFile()))
        yield* page.locator("input").click()
        yield* handler.handled.waitFor((count) => count === 1)
        yield* Expect.that(fileCount(page), equalTo(1))
      }))
      // The reset: `accept([])` resolves and the input is left with no files. Strider's handler records a refusal the
      // choice gets (a single chooser refuses an empty selection as `InvalidInput`) and cancels the chooser, so the refusal
      // is what the port checks first, and then the input's files, which the original reads after the `input` event
      const refused: Array<FileChooser.FileChooserError> = []
      const reset = yield* FileChooser.handle(page, choosing([], refused))
      yield* page.locator("input").click()
      yield* reset.handled.waitFor((count) => count === 1)
      assert.deepStrictEqual(refused.map((error) => error.reason._tag), [])
      yield* Expect.that(fileCount(page), equalTo(0))
    }))

  test("input tests FileChooser.accept should not accept multiple files for single-file input", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      const refused: Array<FileChooser.FileChooserError> = []
      yield* FileChooser.handle(
        page,
        choosing([textFile(), FileInput.local(assetPath("puppeteer", "pptr.png"))], refused)
      )
      yield* page.locator("input").click()
      yield* Expect.that(Effect.sync(() => refused.length), equalTo(1))
      // The original's `accept` rejects; the refusal is the chooser's `InvalidInput`
      assert.strictEqual(refused[0]!.reason._tag, "InvalidInput")
    }))

  test("input tests FileChooser.accept should succeed even for non-existent files", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      const refused: Array<FileChooser.FileChooserError> = []
      const handler = yield* FileChooser.handle(
        page,
        choosing(FileInput.local("file-does-not-exist.txt"), refused)
      )
      yield* page.locator("input").click()
      yield* handler.handled.waitFor((count) => count === 1)
      // Puppeteer's `accept` resolves for a missing file: no error reaches the caller
      assert.deepStrictEqual(refused.map((error) => error.reason._tag), [])
    }))

  test("input tests FileChooser.accept should error on read of non-existent files", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      // `void page.waitForFileChooser().then(accept)`: the handler decides in the background
      yield* FileChooser.handle(page, FileChooser.choose(FileInput.local("file-does-not-exist.txt")))
      const failedToRead = yield* page.evaluateInMainWorld(async () => {
        const pick = document.querySelector("input")!
        pick.click()
        await new Promise<Event>((resolve) => {
          pick.oninput = resolve
        })
        const reader = new FileReader()
        const failed = new Promise<boolean>((fulfill) => {
          reader.onerror = () => fulfill(true)
        })
        reader.readAsText(pick.files![0]!)
        return await failed
      }).pipe(Page.withUserGesture)
      assert.isTrue(failedToRead)
    }))

  test("input tests FileChooser.cancel should cancel dialog", ({ page }) =>
    Effect.gen(function*() {
      // Consider file chooser canceled if we can summon another one. Strider decides each chooser with the handler, so
      // the canceled chooser is the one the handler's `cancel` answers.
      yield* page.setContent(`<input type="file" />`)
      const handler = yield* FileChooser.handle(page, (chooser) => chooser.cancel)
      yield* clickInput(page)
      yield* handler.handled.waitFor((count) => count === 1)
      // If this resolves, than we successfully canceled file chooser
      const second = yield* FileChooser.next(page)
      yield* clickInput(page)
      assert.strictEqual((yield* second)._tag, "Single")
    }))

  test("input tests FileChooser.isMultiple should work for single file pick", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type="file" />`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("input tests FileChooser.isMultiple should work for \"multiple\"", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input multiple type="file" />`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Multiple")
    }))

  test("input tests FileChooser.isMultiple should work for \"webkitdirectory\"", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input multiple webkitdirectory type="file" />`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Multiple")
    }))
})
