/**
 * Playwright's `tests/library/defaultbrowsercontext-1.spec.ts`: a browser launched on a profile directory, and the default
 * context its `launchPersistentContext` makes, with the options that launch takes, and its cookies and downloads.
 *
 * What the port changes:
 * - As defaultbrowsercontext-2 does, `persistent` launches a browser on a profile directory and takes its default context
 *   with `defaultContext.control` for the body, closed when the body ends. The original's `launchPersistent` returns the
 *   profile's first tab, which `firstTab` takes.
 * - A launch option is a declaration on the controlled context, made before the tab's reads: `viewport`, `userAgent`,
 *   `deviceScaleFactor`, `javaScriptEnabled`, and `offline` are `context.emulate({ … })`. A declaration applies to the tab
 *   that already exists, as defaultbrowsercontext-2 notes. `deviceScaleFactor` is a viewport's field, so DC-005 gives the
 *   original's default viewport, 1280×720, with it.
 * - DC-001 and DC-002 read a cookie's `sameSite` as Strider reads it. A cookie the page sets names no SameSite, which
 *   Strider reads as none, where the original expects Chromium's `Lax`, so DC-001 asserts `undefined`, as
 *   browsercontext-cookies' CO-002 does. DC-002's `addCookies` with `sameSite: 'Lax'` is `cookies.set` with `"lax"`.
 * - `context.cookies([])` is an empty list of URLs; the port reads the context's own list after the clear, which is what
 *   the original's `[]` expects: no cookie remains.
 * - `page.evaluate(…)` runs in the page's main world, so it's `page.evaluateInMainWorld`. `page.reload()` names
 *   `waitUntil: "load"`, as the original's reload waits for `load`.
 * - DC-006 reads the request's headers from `server.waitForRequest`, listened to before the navigation.
 * - DC-008's `page.evaluate('something')` is a function that reads the page's global `something`, which the page's script
 *   declares only when scripts run. The reference is left undeclared here, so the error is the page's own ReferenceError,
 *   reported as `EvaluationThrown`.
 * - DC-011's `download.path()` is Playwright's temporary file. Strider's downloads are saved with `saveAs`, so the port
 *   saves the download to a file it names, and reads that copy.
 * - DC-007 (`bypassCSP`) and DC-009 (`httpCredentials`) are launch options Strider's controlled default context doesn't
 *   take; the ledger names their matrix rows.
 */
import { assert } from "@effect/vitest"
import { Browser, CookieJar, Download, Page, type UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend } from "../../harness/browsers.ts"
import { failureOf } from "../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/** Playwright's `server.HOSTNAME`: the host of `server.PREFIX`. */
const HOSTNAME = "localhost"

/** A temporary directory for one test, removed when the test's scope closes. */
const scratch = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), prefix))),
    (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
  )

/**
 * Runs `body` in a browser launched on `userDataDir`, with its default context controlled for the body. The browser
 * closes when the body ends.
 */
const persistent = <A, E, R>(
  browserName: Fixtures["browserName"],
  userDataDir: string,
  body: (context: UserContext.UserContext) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const browser = yield* Browser.Browser
    return yield* Effect.scoped(browser.defaultContext.control.pipe(Effect.flatMap(body)))
  }).pipe(Effect.provide(backend(browserName, { [browserName]: { userDataDir } })))

/** The profile's first tab, which the launch opens. */
const firstTab = (context: UserContext.UserContext) =>
  context.pages.waitFor((pages) => pages.length >= 1).pipe(Effect.map(([page]) => page!))

/**
 * A cookie in the original's shape: `expires` is -1 for a session cookie, as Playwright reports it, and `value` is the
 * plain string. `sameSite` is Strider's word for it.
 */
interface PlaywrightCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly expires: number
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: "lax" | "strict" | "none" | undefined
}

const asPlaywright = (cookie: CookieJar.Cookie): PlaywrightCookie => ({
  name: cookie.name,
  value: Redacted.value(cookie.value),
  domain: cookie.domain,
  path: cookie.path,
  expires: Option.match(cookie.expires, {
    onNone: () => -1,
    onSome: (when) => DateTime.toEpochMillis(when) / 1000
  }),
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  sameSite: Option.getOrUndefined(cookie.sameSite)
})

/** Playwright's `verifyViewport`: the viewport size, as the page and as the page's own window report it. */
const verifyViewport = Effect.fnUntraced(function*(page: Page.Page, width: number, height: number) {
  assert.deepStrictEqual(yield* page.viewportSize, Option.some({ width, height }))
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), width)
  assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerHeight), height)
})

upstream(import.meta.filename, {}, (test) => {
  test("DC-001", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const documentCookie = yield* page.evaluateInMainWorld(() => {
            document.cookie = "username=John Doe"
            return document.cookie
          })
          assert.strictEqual(documentCookie, "username=John Doe")
          assert.deepStrictEqual((yield* context.cookies.list).map(asPlaywright), [{
            name: "username",
            value: "John Doe",
            domain: HOSTNAME,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            // The page's cookie names no SameSite, which Strider reads as none; the original expects Chromium's `Lax`
            sameSite: undefined
          }])
        }))
    }))

  test("DC-002", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          yield* context.cookies.set({
            name: "username",
            value: "John Doe",
            scope: { url: server.EMPTY_PAGE },
            sameSite: "lax"
          })
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "username=John Doe")
          assert.deepStrictEqual((yield* context.cookies.list).map(asPlaywright), [{
            name: "username",
            value: "John Doe",
            domain: HOSTNAME,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "lax"
          }])
        }))
    }))

  test("DC-003", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          yield* context.cookies.set({ name: "cookie1", value: "1", scope: { url: server.EMPTY_PAGE } })
          yield* context.cookies.set({ name: "cookie2", value: "2", scope: { url: server.EMPTY_PAGE } })
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "cookie1=1; cookie2=2")
          yield* context.cookies.clear
          yield* page.reload({ waitUntil: "load" })
          // The original lists the cookies of no URL, which leaves none; after the clear the context holds none at all
          assert.deepStrictEqual(yield* context.cookies.list, [])
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.cookie), "")
        }))
    }))

  test("DC-004", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ viewport: { width: 456, height: 789 } })
          const page = yield* firstTab(context)
          yield* verifyViewport(page, 456, 789)
          const page2 = yield* context.newPage
          yield* verifyViewport(page2, 456, 789)
        }))
    }))

  test("DC-005", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          // The original's default viewport, 1280×720, with the scale factor it gives
          yield* context.emulate({ viewport: { width: 1280, height: 720, deviceScaleFactor: 3 } })
          const page = yield* firstTab(context)
          assert.strictEqual(yield* page.evaluateInMainWorld(() => window.devicePixelRatio), 3)
        }))
    }))

  test("DC-006", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ userAgent: "foobar" })
          const page = yield* firstTab(context)
          assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.userAgent), "foobar")
          // Listened to before the navigation, as the original's `Promise.all` starts it
          const request = yield* server.waitForRequest("/empty.html")
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.strictEqual((yield* request).headers["user-agent"], "foobar")
        }))
    }))

  test("DC-008", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ javaScript: "disabled" })
          const page = yield* firstTab(context)
          yield* page.goto("data:text/html, <script>var something = \"forbidden\"</script>", { waitUntil: "load" })
          // The page's own variable, which its script didn't declare: the original's `page.evaluate('something')`
          // @ts-expect-error `something` is the page's global, undeclared in this file
          const failure = yield* failureOf(page.evaluateInMainWorld(() => something), "the evaluation")
          assert.isTrue(Page.isPageError(failure))
          if (!Page.isPageError(failure) || failure.reason._tag !== "EvaluationThrown") assert.fail(String(failure))
          assert.strictEqual(failure.reason.exception.name, "ReferenceError")
          // WebKit words the same ReferenceError differently, as the original's `browserName` branch does
          assert.include(
            failure.reason.exception.message,
            browserName === "webkit" ? "Can't find variable: something" : "something is not defined"
          )
        }))
    }))

  test("DC-010", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ network: "offline" })
          const page = yield* firstTab(context)
          const failure = yield* failureOf(page.goto(server.EMPTY_PAGE, { waitUntil: "load" }), "the navigation")
          // The original only expects an error; Strider's says the navigation failed
          if (!Page.isPageError(failure) || failure.reason._tag !== "NavigationFailed") assert.fail(String(failure))
        }))
    }))

  test("DC-011", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch("compat-dc1-")
      const saved = yield* scratch("compat-dc1-saved-")
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          server.setRoute("/download", (_req, res) => {
            res.setHeader("Content-Type", "application/octet-stream")
            res.setHeader("Content-Disposition", "attachment")
            res.end("Hello world")
          })
          const page = yield* firstTab(context)
          yield* page.setContent(`<a href="${server.PREFIX}/download">download</a>`)
          const downloaded = yield* Download.next(page)
          yield* page.locator("a").click()
          const download = yield* downloaded
          // Playwright's `download.path()` is a temporary file; Strider's download is saved to a file the port names
          const file = path.join(saved, "download.txt")
          yield* download.saveAs(file)
          assert.isTrue(fs.existsSync(file))
          assert.strictEqual(fs.readFileSync(file).toString(), "Hello world")
        }))
    }))
})
