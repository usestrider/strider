/**
 * Playwright's `tests/library/downloads-path.spec.ts`: the folder a browser saves downloads into, and whether the folder
 * is kept when the browser closes.
 *
 * What the port changes:
 * - Playwright's `browserType.launch({ downloadsPath })` has no Strider counterpart on the launch. Strider's downloads go
 *   where their context says (`UserContext.Options.downloads`), so each test's `downloadsPath` is the `{ directory }`
 *   of the one page it opens, in a browser the test launches. A directory the caller owns is never removed, which is
 *   what DO-039 checks, and the browser closes when the test's scope ends, as `downloadsBrowser.close()` does.
 * - `download.path()` has no Strider counterpart (`method-download-path`). Where the original awaits the file's path
 *   (which waits for the download to finish, and ignores a failure), the port waits for `download.finished` the same way.
 *   Where it checks the path is in the folder, the port checks the folder holds the one file the download saved, with its content.
 * - DO-040 and DO-044 check that a file is deleted once its context closes, and that needs the path of a file the
 *   context made for itself; they're in the ledger. DO-043 needs a `downloadsPath` on a persistent context, which
 *   Strider's persistent contexts don't take; it's in the ledger too.
 * - Stock WebKit has no downloads (the `downloads` capability), so every test here is `needsFeature` there.
 */
import { assert } from "@effect/vitest"
import { Browser, Download } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend } from "../../harness/browsers.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

/** The download route the original's `beforeEach` sets: an attachment named `file.txt`. */
const serveDownload = (server: ServerShape) => {
  server.setRoute("/download", (_request, response) => {
    response.setHeader("Content-Type", "application/octet-stream")
    response.setHeader("Content-Disposition", "attachment; filename=file.txt")
    response.end("Hello world")
  })
}

/** A folder for one test's downloads, removed after the test: Playwright's `testInfo.outputPath('')`. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-downloads-path-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/**
 * `download.path().startsWith(downloadsPath)`: Strider's download has no path, so this checks what the assertion is
 * for: the file the download saved is in the folder, whole. Playwright names the file by a GUID, not by its suggested
 * name, so the port doesn't look for one.
 */
const assertSavedIn = (directory: string) => {
  const files = fs.readdirSync(directory)
  assert.strictEqual(files.length, 1, `the folder holds ${JSON.stringify(files)}`)
  assert.strictEqual(fs.readFileSync(path.join(directory, files[0]!), "utf8"), "Hello world")
}

upstream(import.meta.filename, {}, (test) => {
  test("DO-039", { page: false }, ({ server, browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownload(server)
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage({ downloads: { directory } })
          yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
          const downloaded = yield* Download.next(page)
          yield* page.locator("a").click()
          const download = yield* downloaded
          assert.strictEqual(download.url, `${server.PREFIX}/download`)
          assert.strictEqual(download.suggestedFilename, "file.txt")
          // `download.path()` waits for the download to finish, and the original ignores its failure
          yield* download.finished.pipe(Effect.ignore)
        }).pipe(Effect.scoped, Effect.provide(backend(browserName, undefined)))
        // The browser has closed, and the folder the caller owns is still there
        assert.isTrue(fs.existsSync(directory))
      })
    ))

  test("DO-041", { page: false }, ({ server, browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownload(server)
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage({ downloads: { directory } })
          yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
          const downloaded = yield* Download.next(page)
          yield* page.locator("a").click()
          const download = yield* downloaded
          // Playwright's `download.path()` is the file in the folder; it waits for the download to finish
          yield* download.finished
          assertSavedIn(directory)
        }).pipe(Effect.scoped, Effect.provide(backend(browserName, undefined)))
      })
    ))

  test("DO-042", { page: false }, ({ server, browserName }) =>
    withDirectory((directory) =>
      Effect.gen(function*() {
        serveDownload(server)
        // The folder given relative to the working directory, as the original gives it
        const relative = path.relative(process.cwd(), directory)
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage({ downloads: { directory: relative } })
          yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
          const downloaded = yield* Download.next(page)
          yield* page.locator("a").click()
          const download = yield* downloaded
          yield* download.finished
          assertSavedIn(directory)
        }).pipe(Effect.scoped, Effect.provide(backend(browserName, undefined)))
      })
    ))
})
