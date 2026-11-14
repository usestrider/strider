/**
 * Puppeteer's `test/src/download.test.ts`: the downloads a context saves into a directory the test names, and the ones
 * a context denies.
 *
 * What the port changes:
 * - Puppeteer's `createBrowserContext({ downloadBehavior })` is `Browser.newPage({ downloads })` in a scope the test ends:
 *   `{ directory }` for `policy: "allow"` with a `downloadPath`, and `"deny"` for `policy: "deny"`.
 * - Puppeteer waits for a file named `download.txt` in the directory. Strider names a download's file itself, so the
 *   port checks that the directory holds the one download, with its bytes (`AABBCCDD`) and `suggestedFilename`
 *   `download.txt`. The download is finished before the check.
 * - The denied download is canceled, which Strider reports as `DownloadCanceled` from `download.finished`; the port
 *   checks that and that the directory holds no file.
 * - Puppeteer's `Puppeteer.launch({ downloadBehavior })` sets the default context's downloads at launch. Strider's
 *   default context takes no downloads option at launch, so that test is not ported (the ledger says why).
 * - The context is made for the page, so the downloads directory is the caller's, which is removed here, after the page's
 *   context closes.
 * - Stock WebKit has no downloads (`Unsupported`), so the two context tests run on Chromium and Firefox; the ledger marks
 *   WebKit.
 */
import { assert } from "@effect/vitest"
import { Browser, Download } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { upstream } from "../harness/upstream.ts"

/** A temporary directory for one test, removed when the test ends. */
const withDirectory = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-pptr-download-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/** The reason a failure names, as Strider's typed errors carry it. */
const reasonOf = (error: unknown): string =>
  Predicate.hasProperty(error, "reason") && Predicate.hasProperty(error.reason, "_tag")
    ? String(error.reason._tag)
    : String(error)

upstream(import.meta.filename, {}, (test) => {
  test("Download Browser.createBrowserContext should download to configured location", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ server }) =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage({ downloads: { directory } })
        yield* page.goto(server.PREFIX + "/download.html", { waitUntil: "load" })
        const downloaded = yield* Download.next(page)
        yield* page.locator("#download").click()
        const download = yield* downloaded
        yield* download.finished
        assert.strictEqual(download.suggestedFilename, "download.txt")
        const saved = fs.readdirSync(directory)
        assert.strictEqual(saved.length, 1)
        assert.strictEqual(fs.readFileSync(path.join(directory, saved[0]!), "utf8"), "AABBCCDD")
      }))
    ))

  test("Download Browser.createBrowserContext should not download to location", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ server }) =>
    withDirectory((directory) =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage({ downloads: "deny" })
        yield* page.goto(server.PREFIX + "/download.html", { waitUntil: "load" })
        const downloaded = yield* Download.next(page)
        yield* page.locator("#download").click()
        const download = yield* downloaded
        const failure = yield* Effect.flip(download.finished)
        assert.strictEqual(reasonOf(failure), "DownloadCanceled")
        assert.deepStrictEqual(fs.readdirSync(directory), [])
      }))
    ))
})
