/**
 * Puppeteer's `test/src/cdp/userDataDir.test.ts`: a profile directory one browser is running on can't be launched on
 * again, and a profile directory that can't be written to fails the launch.
 *
 * What the port changes:
 * - Puppeteer runs the first test once with `pipe: true` and once with `pipe: false`, under one key. Strider's Chromium
 *   always launches over a pipe and has no `pipe` option, so the port runs the test once, on the browser the test's
 *   backend launches.
 * - Puppeteer's `launch({ userDataDir })` is `launchOwn` with the directory as the browser's `userDataDir`, a profile the
 *   caller owns and Strider never deletes. The second launch uses the same directory.
 * - Puppeteer checks its own message ("The browser is already running for"). Strider's launch fails with a `BrowserError`
 *   whose reason is `ProcessExited`, the browser exiting before it was ready, so the port checks that reason.
 * - The permission test is skipped on Windows and as root, as Puppeteer's is, because neither can observe the failure.
 *   Its failure is checked by the same reason.
 * - The directories are removed after the browsers that run on them have closed, and the read-only one is made writable
 *   again first.
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
import { backend, type BrowserName, type Launch } from "../../harness/browsers.ts"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A profile directory for one test, made read-write, and removed when the test ends. */
const withProfile = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-pptr-profile-"))),
    use,
    (directory) =>
      Effect.sync(() => {
        fs.chmodSync(directory, 0o755)
        fs.rmSync(directory, { recursive: true, force: true })
      })
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

/** The error a launch fails with, from the browser's layer built and released in a scope of its own. */
const launchFailure = (name: BrowserName, launch: Launch) =>
  failureOf(Effect.scoped(Layer.build(backend(name, launch))), "the launch")

upstream(import.meta.filename, {}, (test) => {
  test("userDataDir should not launch the browser twice with the same userDataDir with pipe=${pipe}", {
    page: false
  }, ({ browserName }) =>
    withProfile((userDataDir) =>
      Effect.gen(function*() {
        const first = yield* launchOwn(browserName, launchWith(browserName, { userDataDir }))
        // Open a page to make sure it's functional.
        yield* first.browser.newPage().pipe(Scope.provide(first.scope))
        assert.isTrue(fs.readdirSync(userDataDir).length > 0)
        const failure = yield* launchFailure(browserName, launchWith(browserName, { userDataDir }))
        assert(Browser.isBrowserError(failure), String(failure))
        assert.strictEqual(failure.reason._tag, "ProcessExited")
        yield* Scope.close(first.scope, Exit.void)
      })
    ))

  test("userDataDir should report a permission error when the userDataDir is not writable", {
    page: false
  }, ({ browserName }) =>
    Effect.gen(function*() {
      // Windows ignores the read-only bit for the directory owner, and root bypasses the write check entirely, so
      // neither can observe the failure.
      if (process.platform === "win32" || process.getuid?.() === 0) return
      yield* withProfile((userDataDir) =>
        Effect.gen(function*() {
          fs.chmodSync(userDataDir, 0o555)
          const failure = yield* launchFailure(browserName, launchWith(browserName, { userDataDir }))
          assert(Browser.isBrowserError(failure), String(failure))
          assert.strictEqual(failure.reason._tag, "ProcessExited")
        })
      )
    }))
})
