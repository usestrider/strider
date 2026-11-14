/**
 * Puppeteer's `test/src/headful.test.ts`: a cookie a headed browser writes to a profile is read back by a headless
 * browser on the same profile.
 *
 * What the port changes:
 * - Puppeteer's two launches are two browsers in scopes of their own (`launchOwn`), each closed before the next one
 *   opens on the profile, and the test's page is opened in the headed one's scope.
 * - Puppeteer's `browser.newPage()` opens the page in the browser's default context, whose cookies the profile keeps.
 *   Strider's `Browser.newPage` makes a context of its own, which never reaches the profile, so the port opens the
 *   page with the default context's `newPage`.
 * - A headed launch (`headless: false`) gets an X server of the harness's own, as the integration environment has no
 *   display. The headless read is `headless: true`.
 * - Stock WebKit has no headless mode: its headless launch fails with `InvalidInput`. The test runs on Chromium and Firefox,
 *   and the ledger marks WebKit.
 * - Puppeteer removes the profile after the test, ignoring a failure. The port removes it with the test's directory.
 * - The original's 20-second suite timeout is the harness's 30 seconds per test.
 */
import { assert } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend, type BrowserName, type Launch } from "../harness/browsers.ts"
import { upstream } from "../harness/upstream.ts"

/** A profile directory for one test, removed when the test ends. */
const withProfile = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-pptr-headful-"))),
    use,
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/** The launch settings for one browser: the options go to the browser the test runs on. */
const launchWith = (name: BrowserName, options: Partial<Browser.LaunchOptions>): Launch =>
  name === "chromium" ? { chromium: options } : name === "firefox" ? { firefox: options } : { webkit: options }

/** A browser the test launches and closes itself, in a scope of its own. */
const launchOwn = Effect.fnUntraced(function*(name: BrowserName, launch: Launch) {
  const scope = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
  const services = yield* Layer.buildWithScope(backend(name, launch), scope)
  return { scope, browser: Context.get(services, Browser.Browser) }
})

/** Puppeteer's `browser.newPage()`: a page in the browser's default context, which the caller's scope owns. */
const defaultPage = Effect.fnUntraced(function*(browser: Browser.Browser) {
  const context = yield* browser.defaultContext.control
  return yield* context.newPage
})

upstream(import.meta.filename, {}, (test) => {
  test("headful tests HEADFUL headless should be able to read cookies written by headful", {
    browsers: ["chromium", "firefox"],
    page: false
  }, ({ browserName, server }) =>
    withProfile((userDataDir) =>
      Effect.gen(function*() {
        // Write a cookie in a headed browser
        const headful = yield* launchOwn(browserName, launchWith(browserName, { headless: false, userDataDir }))
        const headfulPage = yield* defaultPage(headful.browser).pipe(Scope.provide(headful.scope))
        yield* headfulPage.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* headfulPage.evaluateInMainWorld(() => {
          document.cookie = "foo=true; expires=Fri, 31 Dec 9999 23:59:59 GMT"
        })
        yield* Scope.close(headful.scope, Exit.void)
        // Read the cookie from a headless browser on the same profile
        const headless = yield* launchOwn(browserName, launchWith(browserName, { headless: true, userDataDir }))
        const headlessPage = yield* defaultPage(headless.browser).pipe(Scope.provide(headless.scope))
        yield* headlessPage.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const cookie = yield* headlessPage.evaluateInMainWorld(() => document.cookie)
        yield* Scope.close(headless.scope, Exit.void)
        assert.strictEqual(cookie, "foo=true")
      })
    ))
})
