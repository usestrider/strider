/**
 * Playwright's `tests/library/download.spec.ts`: the files a page downloads, how they are read, saved, canceled, and
 * deleted with their context, and the downloads a navigation, a link, or a route starts.
 *
 * What the port changes:
 * - A download is `Download.next(page)`, subscribed before the action that starts it, as `page.waitForEvent('download')`
 *   is. The subscription belongs to the page, which is what `download.page()` gives the original; a `Download` has no
 *   page accessor (`method-download-page`), so the port doesn't check it.
 * - `download.path()` has no Strider counterpart (`method-download-path`): the file is in a directory the context owns.
 *   Where the original reads the file at `path()`, the port reads its bytes through `download.stream`, or copies them
 *   out with `saveAs` and reads the copy. Where it checks that the file exists, the port waits for the download to
 *   complete (`download.finished`, or its status). A file that's gone reads as `TargetGone`.
 * - `download.failure()` is the download's status: `Canceled` and `Failed` are the failures `finished` reports as a
 *   `DownloadError`, and `Completed` is success. The original's messages name the cause in Playwright's words
 *   (`acceptDownloads`, `canceled`); the port checks Strider's reason, `DownloadCanceled` or `DownloadFailed`.
 * - `acceptDownloads: false` is `downloads: "deny"`, and Playwright's default `acceptDownloads: true` is Strider's
 *   default `downloads: "temporary"`, a directory the context makes and removes when it closes.
 * - `browser.newPage(options)` is `Browser.newPage(options)`, in a scope the test ends to close the context. Tests that
 *   need another browser, or close one, make it with `Layer.buildWithScope` on a scope they end, as
 *   `emulation-focus.test.ts` does for EM-024. `browserType.launch({ artifactsDir })` is a context's `downloads`
 *   directory, which the caller owns and Strider never removes.
 * - A navigation that becomes a download is `goto` with `accept: ["download"]` (DO-001, DO-002), or a failure whose
 *   reason is `BecameDownload` where the original's `goto` rejects with "Download is starting". The page stays where it
 *   was, as the original checks.
 * - `page.route(…, () => route.continue())` is `Route.continue`. The route that fetches the PDF and fulfills it with an
 *   attachment header (DO-032) is a response-phase route that reads the paused response's body and fulfills with it
 *   (`Route.fulfill`), the server's headers and an attachment one: the same response, without a second request.
 * - `page.frame({ url })` finds a frame by its URL; Strider enters a frame by its element, so DO-030 enters the outer
 *   iframe, then the inner one, by their elements.
 * - `page.click('a')` with `{ modifiers: ['Alt'] }` is `locator.click({ modifiers: ["Alt"] })`, `text=download` is
 *   `getByText("download")`, and `page.getByText` and `page.setContent` are as written.
 * - Playwright's `it.skip` and `it.fixme` for other browsers aren't ours: the port runs every test on every browser, so
 *   a skipped one on Firefox or WebKit shows as its result there. The original's skip for old Chromium doesn't apply to
 *   Chromium 155.
 * - `testInfo.outputPath(…)` is a directory the test makes and removes.
 * - `server.serveFile` (DO-026) is the route reading the file itself.
 * - The original's `it.info().annotations` links to issues (DO-035, DO-036, DO-037) are metadata, not checks.
 * - DO-012 and DO-018 delete a download's file with `download.delete()`, which Strider doesn't have
 *   (`method-download-delete`), so they aren't ported (see the ledger). DO-025 kills the browser process with
 *   Playwright's `killForTests`, which is Playwright's own test hook, so it isn't ported either.
 * - Stock WebKit has no downloads (the `downloads` capability): every download is `Unsupported` there, so each ported
 *   test is marked needsFeature on WebKit. Firefox's BiDi can't cancel (`downloads.cancel`), so DO-027 and DO-028 are
 *   marked on Firefox too.
 */
import { assert } from "@effect/vitest"
import { Browser, Download, Route, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Headers from "effect/http/Headers"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend } from "../../harness/browsers.ts"
import { assetPath, failureOf } from "../../harness/playwright.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * The four routes the original's `beforeEach` sets, for each test of its `download event` block. Each test sets them
 * again, so the routes are the same as the original's whichever test runs.
 */
const serveDownloads = (server: ServerShape) => {
  server.setRoute("/download", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment")
    response.end("Hello world")
  })
  server.setRoute("/downloadWithFilename", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment; filename=file.txt")
    response.end("Hello world")
  })
  server.setRoute("/downloadWithDelay", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment; filename=file.txt")
    // Chromium requires a large enough payload to trigger the download event soon enough
    response.write("a".repeat(4096))
    response.write("foo")
    response.uncork()
  })
  server.setRoute("/downloadWithCOOP", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment")
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin")
    response.end("Hello world")
  })
}

/** A download that stalls: its headers arrive, and its body never finishes. */
const serveStalled = (server: ServerShape) =>
  server.setRoute("/downloadStall", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment; filename=file.txt")
    response.writeHead(200)
    response.flushHeaders()
    response.write("Hello world")
  })

/** A directory for the files the test saves, removed after the test: Playwright's `testInfo.outputPath`. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "strider-compat-download-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/** The text of a download, read through its stream once it completes. */
const contentOf = (download: Download.Download) => download.stream.pipe(Stream.decodeText, Stream.mkString)

/** The bytes of a download, read through its stream once it completes. */
const bytesOf = (download: Download.Download) =>
  download.stream.pipe(
    Stream.runCollect,
    Effect.map((chunks) => Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
  )

/** The reason an operation failed with, as Strider names it: `DownloadCanceled`, `BecameDownload`, and so on. */
const reasonOf = (error: unknown): string =>
  Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "_tag")
    ? String(error.reason._tag)
    : String(error)

/** What ended a download's file in an operation's failure: its reason, or `TargetGone` when its context went first. */
const endedBy = (error: unknown): string => Target.isTargetGone(error) ? "TargetGone" : reasonOf(error)

/** Playwright's `assertDownloadToPDF`: the suggested name, the URL, the `%PDF` prefix, and the file's bytes. */
const assertDownloadToPDF = Effect.fnUntraced(function*(download: Download.Download, filePath: string) {
  assert.strictEqual(download.suggestedFilename, path.basename(filePath))
  const data = yield* bytesOf(download)
  assert.isTrue(download.url.endsWith("/" + path.basename(filePath)))
  assert.strictEqual(data.subarray(0, 4).toString("latin1"), "%PDF")
  assert.isTrue(data.equals(fs.readFileSync(filePath)), "the downloaded PDF differs from the vendored one")
})

upstream(import.meta.filename, {}, (test) => {
  test("DO-001", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      const downloaded = yield* Download.next(page)
      // Playwright's `goto` rejects with "Download is starting"; Strider's fails with `BecameDownload`
      const navigation = yield* failureOf(page.goto(server.PREFIX + "/download"), "the navigation")
      assert.strictEqual(reasonOf(navigation), "BecameDownload")
      assert.include(navigation.message, "became a download")
      const download = yield* downloaded
      assert.strictEqual(download.url, server.PREFIX + "/download")
      assert.strictEqual(yield* contentOf(download), "Hello world")
      assert.strictEqual(yield* page.url, "about:blank")
    }))

  test("DO-002", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      const downloaded = yield* Download.next(page)
      const navigation = yield* failureOf(page.goto(server.PREFIX + "/downloadWithCOOP"), "the navigation")
      assert.strictEqual(reasonOf(navigation), "BecameDownload")
      assert.include(navigation.message, "became a download")
      const download = yield* downloaded
      assert.strictEqual(download.url, server.PREFIX + "/downloadWithCOOP")
      assert.strictEqual(yield* contentOf(download), "Hello world")
      assert.strictEqual(yield* page.url, "about:blank")
    }))

  test("DO-003", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      serveDownloads(server)
      const page = yield* Browser.newPage({ downloads: "deny" })
      yield* page.setContent(`<a href="${server.PREFIX}/downloadWithFilename">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(download.url, server.PREFIX + "/downloadWithFilename")
      assert.strictEqual(download.suggestedFilename, "file.txt")
      // Playwright's `path()` waits for the download to end, and it ends canceled: the context denies downloads
      const failure = yield* failureOf(download.finished, "the download's completion")
      assert.strictEqual(reasonOf(failure), "DownloadCanceled")
    })))

  test("DO-004", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-005", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.setContent(`<a href="${server.PREFIX}/chromium-linux.zip" download="foo.zip">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(download.url, server.PREFIX + "/chromium-linux.zip")
    }))

  test("DO-006", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.setContent(`<a href="${server.PREFIX}/chromium-linux.zip" download="foo.zip">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(download.suggestedFilename, "foo.zip")
      // The original reads `path()`, which waits for the download to end; the file exists once it has completed
      yield* download.finished
      assert.strictEqual((yield* download.status)._tag, "Completed")
    }))

  test("DO-007", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const userPath = path.join(directory, "download.txt")
        yield* download.saveAs(userPath)
        assert.isTrue(fs.existsSync(userPath))
        assert.strictEqual(fs.readFileSync(userPath).toString(), "Hello world")
        // The download's own file is still there after the copy
        assert.strictEqual(yield* contentOf(download), "Hello world")
      })
    ))

  test("DO-008", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const userPath = path.join(directory, "download.txt")
        yield* download.saveAs(userPath)
        assert.isTrue(fs.existsSync(userPath))
        assert.strictEqual(fs.readFileSync(userPath).toString(), "Hello world")

        const anotherUserPath = path.join(directory, "download (2).txt")
        yield* download.saveAs(anotherUserPath)
        assert.isTrue(fs.existsSync(anotherUserPath))
        assert.strictEqual(fs.readFileSync(anotherUserPath).toString(), "Hello world")
      })
    ))

  test("DO-009", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const dir = path.join(directory, "downloads")
        const userPath = path.join(dir, "download.txt")
        yield* download.saveAs(userPath)
        assert.strictEqual(fs.readdirSync(dir).length, 1)
        yield* download.saveAs(userPath)
        assert.strictEqual(fs.readdirSync(dir).length, 1)
        assert.isTrue(fs.existsSync(userPath))
        assert.strictEqual(fs.readFileSync(userPath).toString(), "Hello world")
      })
    ))

  test("DO-010", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const nestedPath = path.join(directory, "these", "are", "directories", "download.txt")
        yield* download.saveAs(nestedPath)
        assert.isTrue(fs.existsSync(nestedPath))
        assert.strictEqual(fs.readFileSync(nestedPath).toString(), "Hello world")
      })
    ))

  test("DO-011", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        serveDownloads(server)
        const page = yield* Browser.newPage({ downloads: "deny" })
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const userPath = path.join(directory, "download.txt")
        const failure = yield* failureOf(download.saveAs(userPath), "the save")
        assert.strictEqual(reasonOf(failure), "DownloadCanceled")
      }))
    ))

  test("DO-013", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      // Mac WebKit embedder does not download in this case, although Safari does.
      server.setRoute("/download", (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream")
        response.end("Hello world")
      })
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<a download="file.txt" href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(download.suggestedFilename, "file.txt")
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  // Playwright's `page.on('download', …)` listener reads the file's path in the handler. Strider's `next` delivers the
  // event to the waiting test, which reads the file once the download arrives, as the handler's `path()` did.
  test("DO-014", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      const downloaded = yield* Download.next(page)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-015", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      const downloaded = yield* Download.next(page)
      yield* page.goto(server.PREFIX + "/download-blob.html")
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-016", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      server.setRoute("/download", (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream")
        response.end("Hello world")
      })
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click({ modifiers: ["Alt"] })
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-017", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.setContent(`<a target=_blank href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* download.finished
      assert.strictEqual((yield* download.status)._tag, "Completed")
    }))

  test("DO-019", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-020", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      // The original closes the context; the scope that holds it is closed here, as `page-event-crash.test.ts` does
      const scope = yield* Scope.make()
      const page = yield* Browser.newPage().pipe(Scope.provide(scope))
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const first = yield* Download.next(page)
      yield* page.locator("a").click()
      const download1 = yield* first
      const second = yield* Download.next(page)
      yield* page.locator("a").click()
      const download2 = yield* second
      assert.strictEqual(yield* contentOf(download1), "Hello world")
      assert.strictEqual(yield* contentOf(download2), "Hello world")
      yield* Scope.close(scope, Exit.void)
      // Each file went with its context: reading it now fails with `TargetGone`
      const gone1 = yield* failureOf(contentOf(download1), "reading the first download")
      const gone2 = yield* failureOf(contentOf(download2), "reading the second download")
      assert.isTrue(Target.isTargetGone(gone1))
      assert.isTrue(Target.isTargetGone(gone2))
    }))

  test("DO-021", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      // The original launches its own browser and closes it: a browser this test builds, in a scope it ends
      const scope = yield* Scope.make()
      const services = yield* Layer.buildWithScope(backend(browserName, undefined), scope)
      const page = yield* Browser.newPage().pipe(Effect.provideContext(services), Scope.provide(scope))
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const first = yield* Download.next(page)
      yield* page.locator("a").click()
      const download1 = yield* first
      const second = yield* Download.next(page)
      yield* page.locator("a").click()
      const download2 = yield* second
      assert.strictEqual(yield* contentOf(download1), "Hello world")
      assert.strictEqual(yield* contentOf(download2), "Hello world")
      yield* Scope.close(scope, Exit.void)
      // The downloads' directories went with the browser, as the original checks their files do
      const gone1 = yield* failureOf(contentOf(download1), "reading the first download")
      const gone2 = yield* failureOf(contentOf(download2), "reading the second download")
      assert.isTrue(Target.isTargetGone(gone1))
      assert.isTrue(Target.isTargetGone(gone2))
    }))

  test("DO-022", { page: false }, ({ server, browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        // The original's `artifactsDir` is a launch option; Strider's is the context's `downloads` directory, which the
        // caller owns and which is never removed
        const artifactsDir = path.join(directory, "artifacts")
        fs.mkdirSync(artifactsDir)
        const scope = yield* Scope.make()
        const services = yield* Layer.buildWithScope(backend(browserName, undefined), scope)
        const page = yield* Browser.newPage({ downloads: { directory: artifactsDir } }).pipe(
          Effect.provideContext(services),
          Scope.provide(scope)
        )
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        yield* download.finished
        // The download is in the directory the caller named
        assert.isTrue(fs.readdirSync(artifactsDir, { recursive: true }).length > 0)
        yield* Scope.close(scope, Exit.void)
        // User-provided artifactsDir should not be cleaned up.
        assert.isTrue(fs.existsSync(artifactsDir))
      })
    ))

  test("DO-023", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        // The original's `page` is a page of the test's browser: one this test opens, to close its context below
        const scope = yield* Scope.make()
        const page = yield* Browser.newPage().pipe(Scope.provide(scope))
        yield* page.goto(server.EMPTY_PAGE)
        yield* page.setContent(
          `<a href="${server.https.PREFIX}/downloadWithFilename" download="file.txt">click me</a>`
        )
        const downloaded = yield* Download.next(page)
        // Use alt-click to force the download. Otherwise browsers might try to navigate first,
        // probably because of http -> https link.
        yield* page.locator("a").click({ modifiers: ["Alt"] })
        const download = yield* downloaded
        const [downloadError, saveError] = yield* Effect.all([
          Effect.result(download.finished),
          Effect.result(download.saveAs(path.join(directory, "download.txt"))),
          Scope.close(scope, Exit.void)
        ], { concurrency: "unbounded" })
        assert(Result.isFailure(downloadError), "the download completed before its context closed")
        assert.strictEqual(reasonOf(downloadError.failure), "DownloadCanceled")
        assert(Result.isFailure(saveError), "the save completed before its context closed")
        assert.strictEqual(reasonOf(saveError.failure), "DownloadCanceled")
      })
    ))

  test("DO-024", { page: false }, ({ server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        serveStalled(server)
        const scope = yield* Scope.make()
        const page = yield* Browser.newPage().pipe(Scope.provide(scope))
        yield* page.goto(server.EMPTY_PAGE)
        yield* page.setContent(`<a href="${server.PREFIX}/downloadStall" download="file.txt">click me</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const [downloadError, saveError] = yield* Effect.all([
          Effect.result(download.finished),
          Effect.result(download.saveAs(path.join(directory, "download.txt"))),
          Scope.close(scope, Exit.void)
        ], { concurrency: "unbounded" })
        // The exact error is racy, because sometimes the browser is fast enough to cancel the download first, as the
        // original's two messages allow: canceled, or the target gone with its context
        assert(Result.isFailure(downloadError), "the download completed before its context closed")
        assert.include(["DownloadCanceled", "TargetGone"], endedBy(downloadError.failure))
        assert(Result.isFailure(saveError), "the save completed before its context closed")
        assert.include(["DownloadCanceled", "TargetGone"], endedBy(saveError.failure))
      })
    ))

  test("DO-026", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownloads(server)
        const zipFile = path.join(directory, "binary.zip")
        const content = crypto.randomBytes(1 << 20)
        fs.writeFileSync(zipFile, content)
        server.setRoute("/binary.zip", (_request, response) => {
          response.setHeader("Content-Type", "application/zip")
          response.end(fs.readFileSync(zipFile))
        })

        yield* page.goto(server.PREFIX + "/empty.html")
        yield* page.setContent(`<a href="${server.PREFIX}/binary.zip" download="binary.zip">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const saved = path.join(directory, "saved.zip")
        yield* download.saveAs(saved)
        const fileContent = fs.readFileSync(saved)
        assert.strictEqual(fileContent.byteLength, content.byteLength)
        assert.isTrue(fileContent.equals(content))

        const data = yield* bytesOf(download)
        assert.strictEqual(data.byteLength, content.byteLength)
        assert.isTrue(data.equals(content))
      })
    ))

  test("DO-027", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.setContent(`<a href="${server.PREFIX}/downloadWithDelay">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* download.cancel
      // Playwright's `failure()` waits for the download to end; `finished` fails with the reason it ended
      const failure = yield* failureOf(download.finished, "the download's completion")
      assert.strictEqual(reasonOf(failure), "DownloadCanceled")
    }))

  test("DO-028", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* download.finished
      assert.strictEqual(yield* contentOf(download), "Hello world")
      // A cancel after the download ended changes nothing: it stays completed
      yield* download.cancel
      assert.strictEqual((yield* download.status)._tag, "Completed")
    }))

  test("DO-029", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      yield* page.route("**/*", () => Route.continue)
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-030", ({ page, server }) =>
    Effect.gen(function*() {
      serveDownloads(server)
      server.setRoute("/1", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`<iframe src="${server.PREFIX}/2"></iframe>`)
      })
      server.setRoute("/2", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`<iframe src="${server.PREFIX}/3"></iframe>`)
      })
      server.setRoute("/3", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(` <a href="${server.PREFIX}/download">download</a>`)
      })
      yield* page.goto(server.PREFIX + "/1")
      // The original finds the innermost frame by its URL; Strider enters each frame by its iframe element
      const outer = page.frame(page.locator("iframe"))
      const inner = outer.frame(outer.locator("iframe"))
      const downloaded = yield* Download.next(page)
      yield* inner.getByText("download").click()
      const download = yield* downloaded
      assert.strictEqual(yield* contentOf(download), "Hello world")
    }))

  test("DO-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
    <a href="/empty.pdf" download>download</a>
  `)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* assertDownloadToPDF(download, assetPath("playwright", "empty.pdf"))
    }))

  test("DO-032", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      // Playwright fetches the response and fulfills it with its own headers plus an attachment one. Strider reads the
      // paused response's body and fulfills with it, without a second request.
      yield* page.route(
        "**/empty.pdf",
        ({ response, responseBody }) =>
          Effect.flatMap(responseBody, (bytes) =>
            Route.fulfill(HttpServerResponse.uint8Array(bytes, {
              status: response.status,
              headers: Headers.set(response.headers, "content-disposition", "attachment")
            }))),
        { phase: "response" }
      )
      yield* page.setContent(`
    <a href="/empty.pdf">open</a>
  `)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* assertDownloadToPDF(download, assetPath("playwright", "empty.pdf"))
    }))

  // The original skips Chromium that isn't the headless shell: the PDF viewer opens there. Strider's Chromium is the
  // full browser in `--headless`, so the viewer opens and no download starts; the port runs it anyway.
  test("DO-033", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
    <a href="/empty.pdf">open</a>
  `)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      yield* assertDownloadToPDF(download, assetPath("playwright", "empty.pdf"))
    }))

  test("DO-034", ({ page, server }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        server.setRoute("/download", (_request, response) => {
          response.setHeader("Content-Type", "application/octet-stream")
          response.setHeader("Content-Disposition", "attachment")
          response.end("Hello world")
        })
        yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
        const downloaded = yield* Download.next(page)
        yield* page.locator("a").click()
        const download = yield* downloaded
        const userPath = path.join(directory, "download.txt")
        yield* download.saveAs(userPath)
        assert.isTrue(fs.existsSync(userPath))
        assert.strictEqual(fs.readFileSync(userPath).toString(), "Hello world")
      })
    ))

  test("DO-035", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's issue annotation (microsoft/playwright#19939) is metadata, not a check
      server.setRoute("/download", (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream")
        // Do not set the "attachment" value.
        response.setHeader("Content-Disposition", "filename=foo.txt")
        response.end("Hello world")
      })
      yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      yield* downloaded
    }))

  test("DO-036", ({ page, server }) =>
    Effect.gen(function*() {
      // The original's issue annotation (microsoft/playwright#19939) is metadata, not a check
      server.setRoute("/download", (_request, response) => {
        response.setHeader("Content-Type", "application/octet-stream")
        response.end("Hello world")
      })
      const downloaded = yield* Download.next(page)
      // `goto` fails with `BecameDownload` for the download, which the original's `.catch` ignores
      yield* Effect.result(page.goto(`${server.PREFIX}/download`))
      yield* downloaded
    }))

  test("DO-037", ({ page }) =>
    Effect.gen(function*() {
      // The original's issue annotation (microsoft/playwright#21892) is metadata, not a check
      yield* page.setContent(
        "<a download=\"SomeFile.txt\" href=\"data:text/plain;charset=utf8;,hello world\">Download!</a>"
      )
      const downloaded = yield* Download.next(page)
      yield* page.getByText("Download").click()
      const download = yield* downloaded
      assert.strictEqual(download.suggestedFilename, "SomeFile.txt")
    }))

  test("DO-038", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**/*", () => Route.continue)
      yield* page.goto(server.PREFIX + "/empty.html")
      yield* page.setContent(`<a href="${server.PREFIX}/chromium-linux.zip" download="foo.zip">download</a>`)
      const downloaded = yield* Download.next(page)
      yield* page.locator("a").click()
      const download = yield* downloaded
      assert.strictEqual(download.suggestedFilename, "foo.zip")
      assert.strictEqual(download.url, server.PREFIX + "/chromium-linux.zip")
      yield* download.finished
      assert.strictEqual((yield* download.status)._tag, "Completed")
    }))
})
