/**
 * Playwright's `tests/library/defaultbrowsercontext-2.spec.ts`: a browser launched on a profile directory, and the
 * default context its `launchPersistentContext` makes, whose options, storage, pages, and close it checks.
 *
 * What the port changes:
 * - A persistent context is a browser launched with `userDataDir`, whose default context is the profile's.
 *   `persistent` launches it and takes that context with `defaultContext.control` for the body, so its pages are
 *   controlled (HA-004 does the same). The browser closes when the body ends, as `context.close()` closes it in the
 *   original. Each launch of a test is its own browser; the file's browser isn't used by these tests.
 * - `launchPersistentContext(dir, options)` options are declarations on the controlled context, made before the
 *   context's first page: `context.emulate({ … })` for emulation, `context.grant([…])` for permissions. This is the
 *   translation `tap.test.ts` makes for `hasTouch`. It applies the option after the launch, not at it, so a request
 *   sent before the declaration isn't affected; no test here makes one. `ignoreHTTPSErrors` has no declaration, so
 *   DC-021 is ledgered.
 * - The original's `launchPersistent` returns the profile's first tab (`context.pages()[0]`), which DC-012 to DC-022,
 *   DC-027, DC-028, DC-037, DC-039, and DC-040 use. The port waits for it and takes it from the controlled context's
 *   pages, and its declaration applies to the tab that already exists, not to a tab opened after it. DC-025 and DC-042
 *   open their own page, as the original does: `context.newPage` on the controlled default context, a tab in the
 *   profile's context.
 * - `page.evaluate(…)` runs in the page's main world, so it's `page.evaluateInMainWorld`. A promise it returns is
 *   awaited, as the original's is.
 * - `expect.soft` (DC-017) reads both values and asserts both, so the second check still runs when the first fails.
 * - DC-023 to DC-026 check the profile directory itself: the browser writes into a directory the test owns, which
 *   Strider never deletes. Chromium creates a missing one (DC-026), and a relative `userDataDir` resolves from the
 *   browser's working directory (DC-024).
 * - DC-025 restores state from the profile: two launches on one `userDataDir` share localStorage, and a fresh profile
 *   doesn't. The original's `it.slow()` triples Playwright's 30 seconds; this port keeps the 30 seconds, since a
 *   longer deadline is not a port's to choose.
 * - DC-028 reads the controlled context's pages after waiting for the first tab, as the first-tab helper does.
 * - DC-029 is not ported (the ledger explains): Playwright refuses a page URL among `args`, and Strider passes `args`
 *   to the browser unchanged.
 * - DC-031, DC-032, and DC-036 use Playwright's internal `__testHook…` options. DC-038 calls Playwright's internal
 *   channel. None is ported; the ledger gives each one's reason.
 * - DC-041 keeps its page open when the browser closes, as `browser.close()` finds it. The original's last line,
 *   `context.close()` after the browser closed must not throw, has no counterpart: a controlled context has no close.
 * - DC-033 is `defaultContext.closed`, which resolves with the reason the context ended. It is taken from the
 *   observed default context, which outlives the browser, and the port asserts the reason.
 * - DC-037 is `page.routeFromHAR(file)` as `page.route("**\/*", Route.fromHar(file))`, with the file system the replay
 *   reads with. The asset is vendored `har-fulfill.har`.
 * - DC-039's dialog is `Dialog.handle` with `Dialog.acceptAll`, registered before the click, and the port records the
 *   dialogs it's given, as DI-001 does. Stock WebKit doesn't say which kind a dialog is, so there it's `Unknown`.
 * - DC-042's `navigator.storage.getDirectory()` runs in the main world, where Playwright's `evaluate` runs.
 * - DC-034 (JS coverage) and DC-035 (custom selector engines) have no Strider counterpart; the ledger names their
 *   matrix rows.
 */
import { NodeServices } from "@effect/platform-node"
import { assert } from "@effect/vitest"
import { Browser, Dialog, Expect, Route, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend, type BrowserName } from "../../harness/browsers.ts"
import { assetPath } from "../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../harness/upstream.ts"

/** A temporary directory for one test, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-dc2-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/**
 * Runs `body` in a browser launched on `userDataDir`, with its default context controlled for the body. The browser
 * closes when the body ends.
 */
const persistent = <A, E, R>(
  browserName: BrowserName,
  userDataDir: string,
  body: (context: UserContext.UserContext) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function*() {
    const browser = yield* Browser.Browser
    return yield* Effect.scoped(browser.defaultContext.control.pipe(Effect.flatMap(body)))
  }).pipe(Effect.provide(backend(browserName, { [browserName]: { userDataDir } })))

/**
 * The profile's first tab, which the launch opens: `launchPersistent`'s `page`, which the original reads as
 * `context.pages()[0]`. Playwright's launch returns once it exists, so the wait is the launch's own.
 */
const firstTab = (context: UserContext.UserContext) =>
  context.pages.waitFor((pages) => pages.length >= 1).pipe(Effect.map(([page]) => page!))

/** Strider's `Route.fromHar` for a file, with the file system it reads with. */
const replay = (file: string) => Route.fromHar(file).pipe(Effect.provide(NodeServices.layer))

/** The kind Strider reports for an alert; stock WebKit doesn't say which kind a dialog is, so every one is `Unknown`. */
const alertKind = (browserName: Fixtures["browserName"]): Dialog.Kind => browserName === "webkit" ? "Unknown" : "Alert"

upstream(import.meta.filename, {}, (test) => {
  test("DC-012", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ touch: true })
          const page = yield* firstTab(context)
          yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
          assert.isTrue(yield* page.evaluateInMainWorld(() => "ontouchstart" in window))
        }))
    }))

  test("DC-013", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ viewport: { width: 320, height: 480, mobile: true } })
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 980)
        }))
    }))

  test("DC-014", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ media: { colorScheme: "dark" } })
          const page = yield* firstTab(context)
          assert.isFalse(yield* page.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: light)").matches))
          assert.isTrue(yield* page.evaluateInMainWorld(() => matchMedia("(prefers-color-scheme: dark)").matches))
        }))
    }))

  test("DC-015", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ media: { reducedMotion: "reduce" } })
          const page = yield* firstTab(context)
          assert.isTrue(
            yield* page.evaluateInMainWorld(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
          )
          assert.isFalse(
            yield* page.evaluateInMainWorld(() => matchMedia("(prefers-reduced-motion: no-preference)").matches)
          )
        }))
    }))

  test("DC-016", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ media: { forcedColors: "active" } })
          const page = yield* firstTab(context)
          assert.isTrue(yield* page.evaluateInMainWorld(() => matchMedia("(forced-colors: active)").matches))
          assert.isFalse(yield* page.evaluateInMainWorld(() => matchMedia("(forced-colors: none)").matches))
        }))
    }))

  test("DC-017", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ media: { contrast: "more" } })
          const page = yield* firstTab(context)
          // Both are read before either is asserted, as `expect.soft` lets both run
          const more = yield* page.evaluateInMainWorld(() => matchMedia("(prefers-contrast: more)").matches)
          const noPreference = yield* page.evaluateInMainWorld(() =>
            matchMedia("(prefers-contrast: no-preference)").matches
          )
          assert.isTrue(more)
          assert.isFalse(noPreference)
        }))
    }))

  test("DC-018", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ locale: "en-US", timezone: "America/Jamaica" })
          const page = yield* firstTab(context)
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() => new Date(1479579154987).toString()),
            "Sat Nov 19 2016 13:12:34 GMT-0500 (Eastern Standard Time)"
          )
        }))
    }))

  test("DC-019", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ locale: "fr-FR" })
          const page = yield* firstTab(context)
          assert.strictEqual(yield* page.evaluateInMainWorld(() => navigator.language), "fr-FR")
        }))
    }))

  test("DC-020", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ geolocation: { longitude: 10, latitude: 10 } })
          yield* context.grant(["geolocation"])
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const geolocation = yield* page.evaluateInMainWorld(() =>
            new Promise<{ latitude: number; longitude: number }>((resolve) =>
              navigator.geolocation.getCurrentPosition((position) => {
                resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude })
              })
            )
          )
          assert.deepStrictEqual(geolocation, { latitude: 10, longitude: 10 })
        }))
    }))

  test("DC-022", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          yield* context.emulate({ extraHTTPHeaders: { foo: "bar" } })
          const page = yield* firstTab(context)
          // The declaration is made before the navigation that sends the request, and the load waits for it
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const request = server.requests.findLast((received) => received.path === "/empty.html")
          assert.strictEqual(request?.headers["foo"], "bar")
        }))
    }))

  test("DC-023", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const before = yield* persistent(
        browserName,
        directory,
        () => Effect.sync(() => fs.readdirSync(directory).length)
      )
      assert.isAbove(before, 0)
      assert.isAbove(fs.readdirSync(directory).length, 0)
    }))

  test("DC-024", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const relative = path.relative(process.cwd(), path.join(directory, "foobar"))
      yield* persistent(browserName, relative, () =>
        Effect.sync(() => {
          assert.isAbove(fs.readdirSync(path.join(directory, "foobar")).length, 0)
        }))
      assert.isAbove(fs.readdirSync(path.join(directory, "foobar")).length, 0)
    }))

  test("DC-025", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const profile = path.join(directory, "profile")
      const fresh = path.join(directory, "fresh")
      yield* persistent(browserName, profile, (context) =>
        Effect.gen(function*() {
          const page = yield* context.newPage
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          yield* page.evaluateInMainWorld(() => {
            localStorage.hey = "hello"
          })
          // Browsers do not persist local storage immediately, they do it asynchronously in another process.
          // Navigate away to give it a chance to save (best-effort).
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        }))
      yield* persistent(browserName, profile, (context) =>
        Effect.gen(function*() {
          const page = yield* context.newPage
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.strictEqual(yield* page.evaluateInMainWorld(() => localStorage.hey), "hello")
        }))
      yield* persistent(browserName, fresh, (context) =>
        Effect.gen(function*() {
          const page = yield* context.newPage
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          assert.notStrictEqual(yield* page.evaluateInMainWorld(() => localStorage.hey), "hello")
        }))
    }))

  test("DC-026", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const userDataDir = path.join(directory, "nonexisting")
      yield* persistent(browserName, userDataDir, () => Effect.void)
      assert.isAbove(fs.readdirSync(userDataDir).length, 0)
    }))

  test("DC-027", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const [page] = yield* context.pages.waitFor((pages) => pages.length >= 1)
          yield* page!.goto("about:blank", { waitUntil: "load" })
        }))
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const [page] = yield* context.pages.waitFor((pages) => pages.length >= 1)
          yield* page!.goto("about:blank", { waitUntil: "load" })
          assert.strictEqual(String(yield* page!.url), "about:blank")
        }))
    }))

  test("DC-028", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          // Playwright's launch returns once the first tab exists, so the wait is the launch's own
          const pages = yield* context.pages.waitFor((pages) => pages.length >= 1)
          const urls = yield* Effect.forEach(pages, (page) => page.url)
          assert.deepStrictEqual(urls.map(String), ["about:blank"])
        }))
    }))

  test("DC-033", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      // The observed default context outlives the browser, so its `closed` resolves once the browser has closed
      const observed = yield* Effect.scoped(
        Effect.gen(function*() {
          const browser = yield* Browser.Browser
          return browser.defaultContext
        }).pipe(Effect.provide(backend(browserName, { [browserName]: { userDataDir: directory } })))
      )
      const reason = yield* observed.closed
      assert.strictEqual(reason._tag, "BrowserClosed")
    }))

  test("DC-037", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          const handler = yield* replay(assetPath("playwright", "har-fulfill.har"))
          yield* page.route("**/*", handler)
          yield* page.goto("http://no.playwright/", { waitUntil: "load" })
          // HAR contains a redirect for the script that should be followed automatically.
          assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "value")), "foo")
          // HAR contains a POST for the css file that should not be used.
          yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgb(255, 0, 0)"))
        }))
    }))

  test("DC-039", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          const seen: Array<Dialog.Dialog> = []
          yield* Dialog.handle(page, (dialog) => {
            seen.push(dialog)
            return Dialog.acceptAll(dialog)
          })
          yield* page.goto(
            "data:text/html,<html><title>Title</title><button onclick=\"alert('Alert')\">Button</button></html>",
            { waitUntil: "load" }
          )
          yield* page.getByRole("button", { name: "Button" }).click()
          assert.strictEqual(seen.length, 1)
          const [dialog] = seen
          assert.strictEqual(dialog!._tag, alertKind(browserName))
        }))
    }))

  test("DC-040", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* firstTab(context)
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          yield* page.evaluateInMainWorld(async () => {
            const cache = await caches.open("repro-cache")
            await cache.put("/meta", new Response("payload"))
          })
          yield* page.reload({ waitUntil: "load" })
          const after = yield* page.evaluateInMainWorld(async () => {
            const cache = await caches.open("repro-cache")
            const response = await cache.match("/meta")
            return response ? await response.text() : null
          })
          assert.strictEqual(after, "payload")
        }))
    }))

  test("DC-041", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const observed = yield* Effect.scoped(
        Effect.gen(function*() {
          const browser = yield* Browser.Browser
          assert.isTrue(browser.info.version.length > 0)
          // The profile's first tab is open when the browser closes, as `context.pages()` holds it in the original
          yield* browser.defaultContext.pages.waitFor((pages) => pages.length >= 1)
          // The page is open too: the browser's scope closes it, as `browser.close()` does
          const page = yield* browser.newPage()
          yield* page.goto("data:text/html,<html><title>Title</title></html>", { waitUntil: "load" })
          assert.strictEqual(yield* page.title, "Title")
          return browser.defaultContext
        }).pipe(Effect.provide(backend(browserName, { [browserName]: { userDataDir: directory } })))
      )
      // The browser has closed, and the default context has no pages left
      assert.strictEqual((yield* observed.pages).length, 0)
    }))

  test("DC-042", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* persistent(browserName, directory, (context) =>
        Effect.gen(function*() {
          const page = yield* context.newPage
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          const name = yield* page.evaluateInMainWorld(async () => (await navigator.storage.getDirectory()).name)
          assert.strictEqual(name, "")
        }))
    }))
})
