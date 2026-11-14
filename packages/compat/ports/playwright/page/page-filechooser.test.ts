/**
 * Playwright's `tests/page/page-filechooser.spec.ts`: the file pickers a page opens, which Strider reports as events
 * and a handler decides.
 *
 * What the port changes:
 * - A chooser is an event and a decision. `FileChooser.next` (or `stream`) reports it, subscribed before the click that
 *   opens it, as `page.waitForEvent('filechooser')` is. The decision is a handler: `FileChooser.handle` registers it,
 *   and `chooser.setFiles(files)` is `FileChooser.choose(files)` inside it. A chooser that no handler answers is
 *   canceled by the context's policy, so a test that only observes a chooser has no handler.
 * - `setFiles` in Playwright resolves once the input has the files. Here the handler decides after the click, so each
 *   test waits for what the original waits for: the page's own `input` event, or a count of the input's files.
 * - Strider's chooser is a value, `Single` or `Multiple`, with no page or input element. `isMultiple()` is its `_tag`.
 *   FC-017 reads the chooser's `page()` and `element()`, which Strider doesn't have (`method-filechooser-page`,
 *   `method-filechooser-element`), so it isn't ported (see the ledger).
 * - The original's `expect(chooser).toBeTruthy()` is an assertion on the chooser's `_tag`, which is more specific.
 * - `page.evaluate` grants transient user activation in every browser, so a page script that opens a chooser from
 *   `evaluate` runs under `Page.withUserGesture`, as Strider's `evaluateInMainWorld` runs without a gesture unless
 *   asked. `page.$eval` grants one too, so FC-016 and FC-019 do the same.
 * - `page.evaluate` and `page.$eval` run in the main world, so they're `page.evaluateInMainWorld`. The original's
 *   `window.builtins.setTimeout` is Playwright's injected copy of `setTimeout`; the page here runs no script that
 *   replaces it, so the port calls `window.setTimeout`.
 * - `frame.setContent(html)` has no Strider counterpart on a frame. `setFrameContent` writes the frame's document in its
 *   main world, as `setContent` does: `document.open`, `write`, `close`. Scripts in the content run as they do there.
 * - `page.waitForFunction(() => window.__done)` polls, so it's `Expect.that` on the page's main-world value.
 * - `page.waitForTimeout(…)` is the original's own fixed wait, so it's an `Effect.sleep` of the same length, with its
 *   comment.
 * - Timeouts (FC-011 to FC-013): Strider has no mutable default timeout; a wait's budget is a deadline, and the
 *   harness's 30 s deadline encloses every test, so `Deadline.within` with the original's 1 ms stands for the exact
 *   and the default timeout alike. The errors are `Deadline.Timeout`, which `Deadline.isTimeout` recognizes.
 * - FC-018 reads the uploaded file's size from the multipart body the server captured, where Playwright uses
 *   `formidable`, which the port doesn't have.
 * - FC-020's second step is a chooser that Strider refuses: a single chooser takes exactly one file, so an empty
 *   selection fails with `InvalidInput`, which the chooser's handler records and then cancels. The original waits for
 *   an `input` event that can't come, so the port waits for the refusal and then checks the input's file count as the
 *   original does.
 * - FC-024 and FC-025 skip only on old Chromium and Electron in the original. Strider drives Chromium 155, so they run.
 * - FC-003, FC-005, and FC-006 test Playwright's event emitter (`prependListener`, `on`/`off`, `addListener`), which
 *   Strider doesn't have, so they aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Condition, ConsoleMessage, Deadline, Expect, FileChooser, FileInput, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assetPath, attachFrame, failureOf } from "../../harness/playwright.ts"
import type { Received, ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** A condition that a value equals `expected`, for a poll. */
const equalTo = <A>(expected: A) => Condition.make(`equal to ${String(expected)}`, (value: A) => value === expected)

/** Playwright's `frame.setContent(html)`: the frame's document is written in its main world, as `setContent` does. */
const setFrameContent = (page: Page.Page, selector: string, html: string) =>
  page.evaluateInMainWorld(
    (selector, html) => {
      const doc = document.querySelector<HTMLIFrameElement>(selector)?.contentDocument
      if (doc === null || doc === undefined) throw new Error(`${selector} has no document`)
      doc.open()
      doc.write(html)
      doc.close()
    },
    selector,
    html
  )

/** A directory for files the test writes, removed after the test. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-filechooser-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/** The bytes of the `file` part of a multipart request the server captured. */
const fileBytes = (received: Received): string => {
  const boundary = /boundary=(.+)$/.exec(String(received.headers["content-type"]))?.[1]
  if (boundary === undefined) throw new Error("the upload isn't multipart")
  // latin1 keeps one character per byte, so a string's length is the part's byte count
  const part = received.body.toString("latin1").split(`--${boundary}`).find((p) => p.includes("name=\"file\""))
  if (part === undefined) throw new Error("the upload has no file part")
  return part.slice(part.indexOf("\r\n\r\n") + 4, part.lastIndexOf("\r\n"))
}

/** The page the user activation tests open, with its picker and the `showPicker` probe. */
const activationHtml = `
    <button id="once">once</button>
    <button id="twice">twice</button>
    <input type=file>
    <script>
      const input = document.querySelector('input');
      document.querySelector('#once').addEventListener('click', () => input.click());
      document.querySelector('#twice').addEventListener('click', () => { input.click(); input.click(); });
      window.showPicker = () => {
        try {
          input.showPicker();
          return 'ok';
        } catch (e) {
          return e.name;
        }
      };
      if (location.search === '?click')
        setTimeout(() => input.click(), 0);
      if (location.search === '?showPicker')
        setTimeout(() => console.log('showPicker:' + window.showPicker()), 0);
    </script>
  `

upstream(import.meta.filename, {}, (test) => {
  test("FC-001", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        yield* page.goto(server.PREFIX + "/input/fileupload-multi.html")
        const filesCount = 10
        // The original writes 49 MiB in 1 KiB chunks, close to the actual limit; one write makes the same bytes
        const uploadFile = path.join(directory, "50MB_1.zip")
        fs.writeFileSync(uploadFile, Buffer.alloc(49 * 1024 * 1024, "A"))
        const uploadFiles = [uploadFile]
        for (let i = 2; i <= filesCount; i++) {
          const dstFile = path.join(directory, `50MB_${i}.zip`)
          fs.copyFileSync(uploadFile, dstFile)
          uploadFiles.push(dstFile)
        }
        const chooses: Array<string> = []
        yield* FileChooser.handle(page, (chooser) => {
          chooses.push(chooser._tag)
          return FileChooser.choose(uploadFiles.map((file) => FileInput.local(file)))(chooser)
        })
        yield* page.locator("input[type=\"file\"]").click()
        yield* Expect.that(
          page.evaluateInMainWorld(() => document.getElementsByTagName("input")[0]!.files!.length),
          equalTo(filesCount)
        )
        assert.deepStrictEqual(chooses, ["Multiple"])
      })
    ))

  test("FC-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      // Strider's chooser is a typed value, more specific than the original's truthy check
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("FC-004", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // The page is about:blank and the frame is another origin, so the parent can't reach its document; the frame
      // writes its own, through its isolated world (stock WebKit reports no file chooser, so this test doesn't run there)
      yield* frame.locator("html").evaluate((html) => {
        const doc = html.ownerDocument
        doc.open()
        doc.write("<input type=file>")
        doc.close()
      })
      const chooser = yield* FileChooser.next(page)
      yield* frame.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("FC-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("FC-008", ({ page }) =>
    Effect.gen(function*() {
      yield* FileChooser.handle(
        page,
        FileChooser.choose(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      )
      const content = yield* page.evaluateInMainWorld(async () => {
        const el = document.createElement("input")
        el.type = "file"
        el.click()
        await new Promise<Event>((resolve) => {
          el.oninput = resolve
        })
        const reader = new FileReader()
        const promise = new Promise((fulfill) => {
          reader.onload = fulfill
        })
        reader.readAsText(el.files![0]!)
        await promise
        return reader.result
      }).pipe(Page.withUserGesture)
      assert.strictEqual(content, "contents of the file")
    }))

  test("FC-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html")
      yield* setFrameContent(
        page,
        "iframe",
        `
    <div>Click me</div>
    <script>
      document.querySelector('div').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.click();
        window.parent.__done = true;
      });
    </script>
  `
      )
      const chooser = yield* FileChooser.next(page)
      yield* page.frame(page.locator("iframe")).locator("div").click()
      yield* chooser
      yield* Expect.that(
        page.evaluateInMainWorld(() => (window as unknown as { __done?: boolean }).__done === true),
        equalTo(true)
      )
    }))

  test("FC-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame.html")
      yield* setFrameContent(
        page,
        "iframe",
        `
    <div>Click me</div>
    <script>
      document.querySelector('div').addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.click();
        window.parent.__done = true;
        const iframe = window.parent.document.querySelector('iframe');
        iframe.remove();
      });
    </script>
  `
      )
      // The original's `page.on('filechooser', () => {})` makes sure choosers are handled; this handler cancels each,
      // as the context's policy would
      yield* FileChooser.handle(page, (chooser) => chooser.cancel)
      yield* page.frame(page.locator("iframe")).locator("div").click()
      yield* Expect.that(
        page.evaluateInMainWorld(() => (window as unknown as { __done?: boolean }).__done === true),
        equalTo(true)
      )
    }))

  test("FC-011", ({ page }) =>
    Effect.gen(function*() {
      const chooser = yield* FileChooser.next(page)
      const error = yield* failureOf(chooser.pipe(Deadline.within("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("FC-012", ({ page }) =>
    Effect.gen(function*() {
      const chooser = yield* FileChooser.next(page)
      // `setDefaultTimeout(1)`: Strider has no mutable default; the budget is a deadline on the wait. The harness's
      // 30 s deadline encloses the test and a default budget never applies beneath it, so `within` is the translation.
      const error = yield* failureOf(chooser.pipe(Deadline.within("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("FC-013", ({ page }) =>
    Effect.gen(function*() {
      // `setDefaultTimeout(0)` (no default timeout) is moot beside an exact timeout of 1 ms, which decides the wait
      const chooser = yield* FileChooser.next(page)
      const error = yield* failureOf(chooser.pipe(Deadline.within("1 millis")), "the wait")
      assert.isTrue(Deadline.isTimeout(error))
    }))

  test("FC-014", ({ page }) =>
    Effect.gen(function*() {
      const chooser = yield* FileChooser.next(page)
      // The original's `builtins.setTimeout`, as the page's own `setTimeout`
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          const el = document.createElement("input")
          el.type = "file"
          el.click()
        }, 50)
      }).pipe(Page.withUserGesture)
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("FC-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      const first = yield* FileChooser.next(page)
      const second = yield* FileChooser.next(page)
      yield* page.evaluateInMainWorld(() => document.querySelector("input")!.click()).pipe(Page.withUserGesture)
      const one = yield* first
      const other = yield* second
      // Strider's choosers are values, so "the same chooser" is equal values, both waits reporting the one chooser
      assert.deepStrictEqual(one, other)
      assert.strictEqual(one._tag, "Single")
    }))

  test("FC-018", ({ page, server }) =>
    Effect.gen(function*() {
      // The route answers with nothing: the server keeps the request's body, which the test reads
      server.setRoute("/upload", (_request, response) => {
        response.end()
      })
      yield* page.goto(server.EMPTY_PAGE)
      const DATA_SIZE = Math.pow(2, 20)
      const upload = yield* server.waitForRequest("/upload")
      yield* page.evaluateInMainWorld(async (size) => {
        const body = new FormData()
        body.set("file", new Blob([new Uint8Array(size)]))
        await fetch("/upload", { method: "POST", body })
      }, DATA_SIZE)
      const received = yield* upload
      assert.strictEqual(fileBytes(received).length, DATA_SIZE)
    }))

  test("FC-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      yield* FileChooser.handle(
        page,
        FileChooser.choose(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      )
      const content = yield* page.evaluateInMainWorld(async () => {
        const picker = document.querySelector("input")!
        picker.click()
        await new Promise<Event>((resolve) => {
          picker.oninput = resolve
        })
        const reader = new FileReader()
        const promise = new Promise((fulfill) => {
          reader.onload = fulfill
        })
        reader.readAsText(picker.files![0]!)
        await promise
        return reader.result
      }).pipe(Page.withUserGesture)
      assert.strictEqual(content, "contents of the file")
    }))

  test("FC-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      // The first selection: the chooser takes the asset, and the input's `input` event says it did
      yield* Effect.scoped(Effect.gen(function*() {
        yield* FileChooser.handle(
          page,
          FileChooser.choose(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
        )
        const fileLength1 = yield* page.evaluateInMainWorld(async () => {
          const picker = document.querySelector("input")!
          picker.click()
          await new Promise<Event>((resolve) => {
            picker.oninput = resolve
          })
          return picker.files!.length
        }).pipe(Page.withUserGesture)
        assert.strictEqual(fileLength1, 1)
      }))
      // The reset: a single chooser takes exactly one file, so an empty selection is refused as `InvalidInput`. The
      // handler records the refusal and cancels the chooser.
      const refused: Array<FileChooser.FileChooserError> = []
      yield* FileChooser.handle(page, (chooser) =>
        Effect.gen(function*() {
          const outcome = yield* Effect.result(FileChooser.choose([])(chooser))
          if (Result.isFailure(outcome)) {
            refused.push(outcome.failure)
            return yield* chooser.cancel
          }
          return outcome.success
        }))
      yield* page.locator("input").click()
      yield* Expect.that(Effect.sync(() => refused.length), equalTo(1))
      assert.strictEqual(refused[0]!.reason._tag, "InvalidInput")
      yield* Expect.that(
        page.evaluateInMainWorld(() => document.querySelector("input")!.files!.length),
        equalTo(0)
      )
    }))

  test("FC-021", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  test("FC-022", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input multiple type=file>`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Multiple")
    }))

  test("FC-023", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input multiple webkitdirectory type=file>`)
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Multiple")
    }))

  test("FC-024", ({ page, server }) =>
    Effect.gen(function*() {
      // The chooser stream is subscribed before the first navigation, and collects the two choosers the test expects
      const choosers = yield* FileChooser.stream(page)
      const logs: Array<string> = []
      const logging = yield* choosers.pipe(
        Stream.take(2),
        Stream.runForEach((chooser) =>
          Effect.sync(() => {
            logs.push(chooser._tag)
          })
        ),
        Effect.forkChild
      )
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").click()
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").click()
      yield* Fiber.join(logging)
      assert.deepStrictEqual(logs, ["Single", "Single"])
    }))

  test("FC-025", ({ page, server }) =>
    Effect.gen(function*() {
      // Add the listener before the cross process navigations
      const chooser = yield* FileChooser.next(page)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").click()
      assert.strictEqual((yield* chooser)._tag, "Single")
    }))

  // Each test navigates to a fresh document, because transient activation (including the one granted by
  // page.evaluate in all browsers) sticks to the document for several seconds. The original routes every
  // `activation.html` URL to `html`; here the route answers the path, whatever its query.
  const serveActivation = (server: ServerShape) => {
    server.setRoute("/activation.html", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(activationHtml)
    })
  }

  test("FC-026", ({ page, server }) =>
    Effect.gen(function*() {
      serveActivation(server)
      const choosers = yield* FileChooser.stream(page)
      const seen: Array<FileChooser.FileChooser> = []
      yield* choosers.pipe(
        Stream.runForEach((chooser) =>
          Effect.sync(() => {
            seen.push(chooser)
          })
        ),
        Effect.forkChild
      )
      yield* page.goto(server.PREFIX + "/activation.html?click")
      // The original's `page.waitForTimeout(500)`: time for a chooser to open
      yield* Effect.sleep("500 millis")
      assert.strictEqual(seen.length, 0)
      // The original doesn't poll the page with waitForFunction, since each poll evaluates with a user gesture, which
      // would let showPicker() succeed. The console message the page logs is awaited instead.
      const message = yield* ConsoleMessage.next(page, { text: /^showPicker:/ })
      yield* page.goto(server.PREFIX + "/activation.html?showPicker")
      assert.strictEqual((yield* message).text, "showPicker:NotAllowedError")
      assert.strictEqual(seen.length, 0)
    }))

  test("FC-027", ({ page, server }) =>
    Effect.gen(function*() {
      serveActivation(server)
      yield* page.goto(server.PREFIX + "/activation.html")
      const chooser = yield* FileChooser.next(page)
      yield* page.locator("#once").click()
      assert.strictEqual((yield* chooser)._tag, "Single")

      // page.evaluate grants transient user activation in all browsers, which withUserGesture grants here.
      yield* page.goto(server.PREFIX + "/activation.html")
      const chooser2 = yield* FileChooser.next(page)
      yield* page.evaluateInMainWorld(() => document.querySelector("input")!.click()).pipe(Page.withUserGesture)
      assert.strictEqual((yield* chooser2)._tag, "Single")
      yield* page.goto(server.PREFIX + "/activation.html")
      const showPicker = yield* page.evaluateInMainWorld(() =>
        (window as unknown as { showPicker: () => string }).showPicker()
      ).pipe(Page.withUserGesture)
      assert.strictEqual(showPicker, "ok")
    }))

  test("FC-028", ({ page, server }) =>
    Effect.gen(function*() {
      serveActivation(server)
      const choosers = yield* FileChooser.stream(page)
      const seen: Array<FileChooser.FileChooser> = []
      yield* choosers.pipe(
        Stream.runForEach((chooser) =>
          Effect.sync(() => {
            seen.push(chooser)
          })
        ),
        Effect.forkChild
      )
      yield* page.goto(server.PREFIX + "/activation.html")
      yield* page.locator("#twice").click()
      // The original's `page.waitForTimeout(500)`: time for a second chooser to open, if the first hadn't used the gesture
      yield* Effect.sleep("500 millis")
      assert.strictEqual(seen.length, 1)
    }))
})
