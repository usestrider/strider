/**
 * Playwright's `tests/page/page-set-input-files.spec.ts`: setting a file input's files from paths, from bytes, and
 * from a folder, and the events the input dispatches.
 *
 * What the port changes:
 * - `elementHandle.setInputFiles(path)` and `page.setInputFiles(selector, path)` are `Locator.setInputFiles` on a
 *   locator, with `FileInput.local` for each path and `FileInput.bytes` for the in-memory files. A path is a vendored
 *   asset's `assetPath`, absolute; where the original passes `path.relative(process.cwd(), …)` (IF-001, IF-008,
 *   IF-011, IF-012) so does the port, and Strider resolves it against the working directory.
 * - `page.$("input")` is the first input, as the original's test pages have one file input first. Pages that also have
 *   a submit button select `input[type=file]`, which is the same element.
 * - `page.evaluate(e => …, input)` reads the input's `files` in the page's main world, where the page's own `document`
 *   is, so it's `page.evaluateInMainWorld` with the element found by its selector.
 * - IF-004 and IF-005 pass a directory with a second path to a `webkitdirectory` input that isn't `multiple`. Strider has
 *   no rule about directories: it refuses the call by its count rule (`InvalidInput` on `files`, at most one file for
 *   an input without `multiple`), which is not the original's point (multiple directories; a directory with files), so
 *   they pass without exercising it.
 * - A folder upload's directory is made in a temporary directory that the test removes when its scope closes, as
 *   Playwright's `test.info().outputDir` is removed with its run.
 * - Errors are Strider's typed `LocatorError` reasons. A missing file is `FileUnreadable`, which names the path. A
 *   directory and files passed together, and a folder passed to a file input, are checked by their reason and the
 *   path or count they name, not by Playwright's wording.
 * - IF-018 and IF-020 record input and change events with listeners the test installs itself, in the page's main world,
 *   on the input, as IF-019 and IF-021 do with `locator.evaluate`. Playwright's `page.exposeFunction` isn't in Strider.
 * - `server.setCSP` is `server.setExtraHeaders` with the same `Content-Security-Policy` header, which is all Playwright's
 *   `setCSP` sets.
 * - IF-015 and IF-016 read multipart bodies. The original parses them with `formidable`; the port reads each part of the
 *   request body, its name, file name, content type and bytes, from the request the server recorded.
 * - IF-009 and IF-011 upload a 200 MB file written in a temporary directory, as the original does, and read the
 *   multipart body the server recorded for its name and size. The original's `test.slow()` triples Playwright's
 *   timeout; the harness has no such setting, so they run in the harness's 30 seconds.
 * - `page.popup` is `Popup.next`. The `window.open` in IF-008 runs as a user gesture, since Strider keeps popup
 *   blocking on (`Page.withUserGesture`).
 * - IF-022 is `test.fixme` on WebKit upstream; the port runs on every browser, since the fixme is about WebKit.
 */
import { assert } from "@effect/vitest"
import { FileInput, Locator, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assetPath, failureOf } from "../../harness/playwright.ts"
import { type Received, type ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** A directory that's removed when the test's scope closes: Playwright's `test.info().outputDir`. */
const outputDirectory = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-file-upload-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/** The text of file `index` of the input, read with a `FileReader` in the page, as the original reads it. */
const fileText = (page: Page.Page, selector: string, index: number) =>
  page.evaluateInMainWorld(
    (selector: string, index: number) => {
      const input = document.querySelector(selector) as HTMLInputElement
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsText(input.files![index]!)
      })
    },
    selector,
    index
  )

/** The `name` of each file the input holds, in order. */
const fileNames = (page: Page.Page, selector: string) =>
  page.evaluateInMainWorld(
    (selector: string) => [...(document.querySelector(selector) as HTMLInputElement).files!].map((file) => file.name),
    selector
  )

/** A vendored asset's path relative to the working directory, as the original's `path.relative(process.cwd(), asset(…))`. */
const relativeAsset = (name: string) => path.relative(process.cwd(), assetPath("playwright", name))

/** A 200 MB file of `A`s, written in the test's output directory. */
const writeLargeFile = Effect.gen(function*() {
  const file = path.join(yield* outputDirectory, "200MB.zip")
  const chunk = Buffer.alloc(4 * 1024, "A")
  const fd = fs.openSync(file, "w")
  try {
    for (let i = 0; i < 50 * 1024; i++) fs.writeSync(fd, chunk)
  } finally {
    fs.closeSync(fd)
  }
  return file
})

/** IF-009's body, and IF-011's with `relative`: the upload of a large file, its events, and what the server receives. */
const largeUpload = Effect.fnUntraced(function*(page: Page.Page, server: ServerShape, relative: boolean) {
  yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
  const uploadFile = yield* writeLargeFile
  yield* page.evaluateInMainWorld(() => {
    const events: Array<string> = []
    ;(window as unknown as { __events: Array<string> }).__events = events
    const input = document.querySelector("input[type=\"file\"]")!
    input.addEventListener("input", () => events.push("input"))
    input.addEventListener("change", () => events.push("change"))
  })
  const given = relative ? path.relative(process.cwd(), uploadFile) : uploadFile
  if (relative) assert.isFalse(path.isAbsolute(given))
  yield* page.locator("input[type=\"file\"]").setInputFiles(FileInput.local(given))
  assert.strictEqual((yield* fileNames(page, "input[type=file]"))[0], "200MB.zip")
  assert.deepStrictEqual(
    yield* page.evaluateInMainWorld(() => (window as unknown as { __events: Array<string> }).__events),
    ["input", "change"]
  )
  server.setRoute("/upload", (_request, response) => {
    response.end()
  })
  const upload = yield* server.waitForRequest("/upload")
  yield* page.locator("input[type=submit]").click()
  const file1 = partsOf(yield* upload).find((part) => part.name === "file1")!
  assert.strictEqual(file1.filename, "200MB.zip")
  assert.strictEqual(file1.content.length, 200 * 1024 * 1024)
})

/** One part of a `multipart/form-data` request body. */
interface Part {
  readonly name: string
  readonly filename: string | undefined
  readonly contentType: string | undefined
  readonly content: Buffer
}

/** The parts of a multipart request, as formidable's `parse` gives them: each by its form name, with its file details. */
const partsOf = (request: Received): ReadonlyArray<Part> => {
  const boundary = /boundary=(.+)$/.exec(String(request.headers["content-type"]))![1]!
  const delimiter = Buffer.from(`--${boundary}`)
  const parts: Array<Part> = []
  let start = request.body.indexOf(delimiter) + delimiter.length
  for (;;) {
    const end = request.body.indexOf(delimiter, start)
    if (end < 0) break
    // Each part runs from its CRLF after the delimiter to the CRLF before the next one
    const segment = request.body.subarray(start + 2, end - 2)
    const headersEnd = segment.indexOf("\r\n\r\n")
    const headers = segment.subarray(0, headersEnd).toString("latin1")
    const name = /(?:^|;)\s*name="([^"]*)"/.exec(headers)?.[1]
    const filename = /filename="([^"]*)"/.exec(headers)?.[1]
    const contentType = /^content-type:\s*(.*)$/im.exec(headers)?.[1]?.trim()
    parts.push({
      name: name!,
      filename,
      contentType,
      content: segment.subarray(headersEnd + 4)
    })
    start = end + delimiter.length
  }
  return parts
}

upstream(import.meta.filename, {}, (test) => {
  test("IF-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      yield* page.locator("input[type=file]").setInputFiles(
        FileInput.local(relativeAsset("file-to-upload.txt"))
      )
      assert.strictEqual(
        (yield* fileNames(page, "input[type=file]")).join(),
        "file-to-upload.txt"
      )
      assert.strictEqual(yield* fileText(page, "input[type=file]", 0), "contents of the file")
    }))

  test("IF-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/folderupload.html", { waitUntil: "load" })
      const dir = path.join(yield* outputDirectory, "file-upload-test")
      fs.mkdirSync(path.join(dir, "sub-dir"), { recursive: true })
      fs.writeFileSync(path.join(dir, "file1.txt"), "file1 content")
      fs.writeFileSync(path.join(dir, "file2"), "file2 content")
      fs.writeFileSync(path.join(dir, "sub-dir", "really.txt"), "sub-dir file content")
      yield* page.locator("input[type=file]").setInputFiles(FileInput.local(dir))
      const webkitRelativePaths = yield* page.evaluateInMainWorld(
        () =>
          [...(document.querySelector("input[type=file]") as HTMLInputElement).files!].map((file) =>
            file.webkitRelativePath
          )
      )
      // Note: this did not work before Chrome 127, see https://issues.chromium.org/issues/345393164.
      assert.sameMembers(webkitRelativePaths, [
        "file-upload-test/sub-dir/really.txt",
        "file-upload-test/file1.txt",
        "file-upload-test/file2"
      ])
      for (let i = 0; i < webkitRelativePaths.length; i++) {
        const content = yield* fileText(page, "input[type=file]", i)
        assert.strictEqual(content, fs.readFileSync(path.join(dir, "..", webkitRelativePaths[i]!)).toString())
      }
    }))

  test("IF-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<label for="folder">Folder</label><input id="folder" type="file" webkitdirectory>`)
      const dir = path.join(yield* outputDirectory, "file-upload-test")
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, "file1.txt"), "file1 content")
      yield* page.getByText("Folder").setInputFiles(FileInput.local(dir))
      const relative = yield* page.evaluateInMainWorld(
        () => [...(document.querySelector("input") as HTMLInputElement).files!].map((file) => file.webkitRelativePath)
      )
      assert.deepStrictEqual(relative, ["file-upload-test/file1.txt"])
    }))

  test("IF-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/folderupload.html", { waitUntil: "load" })
      const dir = path.join(yield* outputDirectory, "file-upload-test")
      fs.mkdirSync(path.join(dir, "folder1"), { recursive: true })
      fs.writeFileSync(path.join(dir, "folder1", "file1.txt"), "file1 content")
      fs.mkdirSync(path.join(dir, "folder2"), { recursive: true })
      fs.writeFileSync(path.join(dir, "folder2", "file2.txt"), "file2 content")
      const error = yield* failureOf(
        page.locator("input[type=file]").setInputFiles([
          FileInput.local(path.join(dir, "folder1")),
          FileInput.local(path.join(dir, "folder2"))
        ]),
        "setting two directories"
      )
      assert(Locator.isLocatorError(error), String(error))
      // Strider's count rule refuses it, not a rule about directories (see the header)
      assert(error.reason._tag === "InvalidInput", String(error.reason))
      assert.strictEqual(error.reason.input, "files")
    }))

  test("IF-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/folderupload.html", { waitUntil: "load" })
      const dir = path.join(yield* outputDirectory, "file-upload-test")
      fs.mkdirSync(path.join(dir, "folder1"), { recursive: true })
      fs.writeFileSync(path.join(dir, "folder1", "file1.txt"), "file1 content")
      const error = yield* failureOf(
        page.locator("input[type=file]").setInputFiles([
          FileInput.local(path.join(dir, "folder1")),
          FileInput.local(path.join(dir, "folder1", "file1.txt"))
        ]),
        "setting a directory and a file"
      )
      assert(Locator.isLocatorError(error), String(error))
      // Strider's count rule refuses it, not a rule about directories (see the header)
      assert(error.reason._tag === "InvalidInput", String(error.reason))
      assert.strictEqual(error.reason.input, "files")
    }))

  test("IF-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      const dir = path.join(yield* outputDirectory, "file-upload-test")
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, "file1.txt"), "file1 content")
      const error = yield* failureOf(
        page.locator("input[type=file]").setInputFiles(FileInput.local(dir)),
        "setting a directory on a file input"
      )
      assert(Locator.isLocatorError(error), String(error))
    }))

  test("IF-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/folderupload.html", { waitUntil: "load" })
      const error = yield* failureOf(
        page.locator("input[type=file]").setInputFiles(FileInput.local(assetPath("playwright", "file to upload.txt"))),
        "setting a file on a directory input"
      )
      assert(Locator.isLocatorError(error), String(error))
    }))

  test("IF-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      {
        // Strider keeps popup blocking on, so the script's `window.open` runs as a user gesture, where Playwright's
        // Chromium doesn't block it
        const popups = yield* Popup.next(page)
        yield* page.evaluateInMainWorld(() => {
          ;(window as unknown as { __popup?: unknown }).__popup = window.open("about:blank")
        }).pipe(Page.withUserGesture)
        const popup = yield* popups
        yield* popup.close()
      }
      yield* page.locator("input[type=file]").setInputFiles(
        FileInput.local(relativeAsset("file-to-upload.txt"))
      )
      assert.strictEqual(
        (yield* fileNames(page, "input[type=file]")).join(),
        "file-to-upload.txt"
      )
    }))

  test("IF-009", ({ page, server }) => largeUpload(page, server, false))

  test("IF-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      const error = yield* failureOf(
        page.locator("input[type=file]").setInputFiles(FileInput.local("i actually do not exist.txt")),
        "setting a file that doesn't exist"
      )
      assert(Locator.isLocatorError(error), String(error))
      // Strider names the file it couldn't read; Playwright's wording is ENOENT
      assert.strictEqual(error.reason._tag, "FileUnreadable")
      assert.include(error.reason.message, "i actually do not exist.txt")
    }))

  test("IF-011", ({ page, server }) => largeUpload(page, server, true))

  test("IF-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      yield* page.locator("input[type=file]").setInputFiles(
        FileInput.local(relativeAsset("file to upload.txt"))
      )
      assert.strictEqual(
        (yield* fileNames(page, "input[type=file]")).join(),
        "file to upload.txt"
      )
      assert.strictEqual(yield* fileText(page, "input[type=file]", 0), "contents of the file")
    }))

  test("IF-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").setInputFiles(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files!.length), 1)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files![0]!.name),
        "file-to-upload.txt"
      )
    }))

  test("IF-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").setInputFiles(
        FileInput.bytes("test.txt", "text/plain", new TextEncoder().encode("this is a test"))
      )
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files!.length), 1)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files![0]!.name),
        "test.txt"
      )
    }))

  test("IF-015", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `server.setCSP` sets this header and no other
      server.setExtraHeaders("/empty.html", { "Content-Security-Policy": "default-src \"none\"" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<input type=file>`)
      yield* page.locator("input").setInputFiles(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files!.length), 1)
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => document.querySelector("input")!.files![0]!.name),
        "file-to-upload.txt"
      )
    }))

  test("IF-016", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/upload", (_request, response) => {
        response.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <form action="/upload" method="post" enctype="multipart/form-data" >
      <input type="file" name="file1">
      <input type="file" name="file2">
      <input type="submit" value="Submit">
    </form>`)
      yield* page.locator("input[name=file1]").setInputFiles(
        FileInput.local(assetPath("playwright", "file-to-upload.txt"))
      )
      yield* page.locator("input[name=file2]").setInputFiles(FileInput.local(assetPath("playwright", "pptr.png")))
      const upload = yield* server.waitForRequest("/upload")
      yield* page.locator("input[type=submit]").click()
      const request = yield* upload
      const parts = partsOf(request)
      const file1 = parts.find((part) => part.name === "file1")!
      const file2 = parts.find((part) => part.name === "file2")!
      assert.strictEqual(file1.filename, "file-to-upload.txt")
      assert.strictEqual(file1.contentType, "text/plain")
      assert.isTrue(file1.content.equals(fs.readFileSync(assetPath("playwright", "file-to-upload.txt"))))
      assert.strictEqual(file2.filename, "pptr.png")
      assert.strictEqual(file2.contentType, "image/png")
      assert.isTrue(file2.content.equals(fs.readFileSync(assetPath("playwright", "pptr.png"))))
    }))

  // @see https://github.com/microsoft/playwright/issues/4704
  test("IF-017", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/upload", (_request, response) => {
        response.end()
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const DATA_SIZE = Math.pow(2, 20)
      const upload = yield* server.waitForRequest("/upload")
      yield* page.evaluateInMainWorld(async (size: number) => {
        const body = new FormData()
        body.set("file", new Blob([new Uint8Array(size)]))
        await fetch("/upload", { method: "POST", body })
      }, DATA_SIZE)
      const request = yield* upload
      const file = partsOf(request).find((part) => part.name === "file")!
      assert.strictEqual(file.content.length, DATA_SIZE)
    }))

  test("IF-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input id=input type=file></input>`)
      // The test's own listeners record what the input dispatches, in the order it dispatches them
      yield* page.evaluateInMainWorld(() => {
        const events: Array<string> = []
        ;(window as unknown as { __events: Array<string> }).__events = events
        const input = document.querySelector("#input")!
        input.addEventListener("input", (e) => events.push(e.type))
        input.addEventListener("change", (e) => events.push(e.type))
      })
      yield* page.locator("#input").setInputFiles(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      const events = yield* page.evaluateInMainWorld(() => (window as unknown as { __events: Array<string> }).__events)
      assert.deepStrictEqual(events, ["input", "change"])
    }))

  test("IF-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<body><script>
  const div = document.createElement('div');
  const shadowRoot = div.attachShadow({mode: 'open'});
  shadowRoot.innerHTML = '<input type=file></input>';
  document.body.appendChild(div);
</script></body>`)
      // Listeners on the body and on the input, recording each event's type and whether it's composed
      yield* page.evaluateInMainWorld(() => {
        const globals = window as unknown as Record<string, Array<string>>
        globals["firedBodyEvents"] = []
        for (const event of ["input", "change"]) {
          document.body.addEventListener(
            event,
            (e) => globals["firedBodyEvents"]!.push(e.type + ":" + e.composed),
            false
          )
        }
        const input = document.querySelector("div")!.shadowRoot!.querySelector("input")!
        globals["firedEvents"] = []
        for (const event of ["input", "change"]) {
          input.addEventListener(event, (e) => globals["firedEvents"]!.push(e.type + ":" + e.composed), false)
        }
      })
      yield* page.locator("input").setInputFiles(
        FileInput.bytes("test.txt", "text/plain", new TextEncoder().encode("this is a test"))
      )
      const globals = (name: string) =>
        page.evaluateInMainWorld((name) => (window as unknown as Record<string, Array<string>>)[name], name)
      // The input's events are composed: they cross the shadow root to the body, but `change` doesn't
      assert.deepStrictEqual(yield* globals("firedEvents"), ["input:true", "change:false"])
      assert.deepStrictEqual(yield* globals("firedBodyEvents"), ["input:true"])
    }))

  test("IF-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file multiple=true/>`)
      // The test's listeners record the input's events, as IF-018's do
      const events = (globals: string) =>
        page.evaluateInMainWorld((name) => (window as unknown as Record<string, Array<string>>)[name], globals)
      yield* page.evaluateInMainWorld(() => {
        const recorded: Array<string> = []
        ;(window as unknown as { __events: Array<string> }).__events = recorded
        const input = document.querySelector("input")!
        input.addEventListener("input", () => recorded.push("input"))
        input.addEventListener("change", () => recorded.push("change"))
      })
      yield* page.locator("input").setInputFiles(FileInput.local(assetPath("playwright", "file-to-upload.txt")))
      assert.strictEqual(
        yield* fileNames(page, "input").pipe(Effect.map((names) => names.join())),
        "file-to-upload.txt"
      )
      assert.deepStrictEqual(yield* events("__events"), ["input", "change"])

      yield* page.evaluateInMainWorld(() => {
        ;(window as unknown as { __events: Array<string> }).__events.length = 0
      })
      yield* page.locator("input").setInputFiles(FileInput.local(assetPath("playwright", "pptr.png")))
      assert.strictEqual(yield* fileNames(page, "input").pipe(Effect.map((names) => names.join())), "pptr.png")
      assert.deepStrictEqual(yield* events("__events"), ["input", "change"])
    }))

  test("IF-021", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<input type=file multiple=true/>`)
      const files = ["file-to-upload.txt", "file-to-upload-2.txt"]
      yield* page.locator("input").setInputFiles(files.map((file) => FileInput.local(assetPath("playwright", file))))
      assert.deepStrictEqual(yield* fileNames(page, "input"), files)
      const timestamps = yield* page.evaluateInMainWorld(() =>
        [...(document.querySelector("input") as HTMLInputElement).files!].map((file) => file.lastModified)
      )
      const expectedTimestamps = files.map((file) => Math.round(fs.statSync(assetPath("playwright", file)).mtimeMs))
      // On Linux browser sometimes reduces the timestamp by 1ms: 1696272058110.0715  -> 1696272058109 or even
      // rounds it to seconds in WebKit: 1696272058110 -> 1696272058000.
      for (let i = 0; i < timestamps.length; i++) {
        assert.isAtMost(
          Math.abs(timestamps[i]! - expectedTimestamps[i]!),
          1000,
          `expected: ${expectedTimestamps}; actual: ${timestamps}`
        )
      }
    }))

  test("IF-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/fileupload.html", { waitUntil: "load" })
      yield* page.locator("input[type=file]").setInputFiles(
        FileInput.local(assetPath("playwright", "file-to-upload.txt"))
      )
      const storedFile = yield* page.evaluateInMainWorld(async () => {
        const input = document.querySelector("input[type=file]") as HTMLInputElement
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("file-upload")
          request.onupgradeneeded = () => request.result.createObjectStore("files")
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const file = await new Promise<File>((resolve, reject) => {
          const transaction = db.transaction("files", "readwrite")
          const store = transaction.objectStore("files")
          store.put(input.files![0], "file")
          const request = store.get("file")
          transaction.oncomplete = () => resolve(request.result)
          transaction.onabort = () => reject(transaction.error)
        })
        db.close()
        return { name: file.name, text: await file.text() }
      })
      assert.deepStrictEqual(storedFile, { name: "file-to-upload.txt", text: "contents of the file" })
    }))
})
