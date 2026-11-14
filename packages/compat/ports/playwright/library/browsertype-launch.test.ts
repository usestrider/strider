/**
 * Playwright's `tests/library/browsertype-launch.spec.ts`: what launching a browser does and reports, and what closing one
 * does to its contexts and pages.
 *
 * What the port changes:
 * - `browserType.launch(options)` is a browser built from a backend layer with those options. `backend` takes the
 *   overrides, and it replaces the pinned executable only where a test names one. A test that closes its own browser,
 *   as the original's `browser.close()` does, builds it with `Layer.buildWithScope` on a scope it ends, as download.test.ts's
 *   DO-021 does.
 * - A launch failure is `Browser.BrowserError`, whose `reason` says what went wrong: `InvalidInput` for a path that isn't
 *   absolute, as the original's `random-invalid-path` is, and `ExecutableNotFound` for an absolute path with no file
 *   (BT-011, which checks both), `ProcessExited` for a browser that exits before it is ready (BT-010). The port checks
 *   those reasons instead of Playwright's wording.
 * - A browser closed by its scope ends the contexts and pages in it, as the original's `browser.close()` does. BT-004 and
 *   BT-015 make those in scopes the test doesn't end, so it's the browser's close that ends them, and the reason is
 *   `BrowserClosed`.
 * - BT-010's dummy executable is the vendored script, copied to a directory the test makes and removes, with its
 *   executable bit set: the vendoring tool keeps a file's content, not its mode.
 * - BT-014 passes Node's `process` object among the options, as the original does. Strider's options are plain data, so
 *   the cast is there only for that object.
 */
import { assert } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { backend, type BrowserName, type Launch } from "../../harness/browsers.ts"
import { assetPath, failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The launch settings for one browser: the options go to the browser the test runs on. */
const launchWith = (browserName: BrowserName, options: Partial<Browser.LaunchOptions>): Launch =>
  browserName === "chromium"
    ? { chromium: options }
    : browserName === "firefox"
    ? { firefox: options }
    : { webkit: options }

/** Playwright's `browserType.launch()` for a test that closes its own browser, in a scope the test ends. */
const launchOwn = Effect.fnUntraced(function*(browserName: BrowserName) {
  const scope = yield* Scope.make()
  const services = yield* Layer.buildWithScope(backend(browserName, undefined), scope)
  return { scope, services }
})

/** The error a launch fails with, from the browser's layer built and released in a scope of its own. */
const launchFailure = (layer: Layer.Layer<Browser.Browser, unknown>) =>
  failureOf(Effect.scoped(Layer.build(layer)), "the launch")

upstream(import.meta.filename, {}, (test) => {
  test("BT-004", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const { scope, services } = yield* launchOwn(browserName)
      // The page's context is left to the browser: closing the browser is what ends it
      const pageScope = yield* Scope.make()
      const page = yield* Browser.newPage().pipe(Effect.provideContext(services), Scope.provide(pageScope))
      const neverResolves = yield* startWaiting(page.evaluateInMainWorld(() => new Promise(() => {})))
      // The original's `window.builtins.setTimeout` is the page's own timer here: one round trip before the close
      yield* page.evaluateInMainWorld(() => new Promise((resolve) => setTimeout(resolve, 0)))
      yield* Scope.close(scope, Exit.void)
      const error = yield* failureOf(Fiber.join(neverResolves.fiber), "the evaluation")
      assert(Target.isTargetGone(error), String(error))
      assert.strictEqual(error.reason._tag, "BrowserClosed")
    }))

  test("BT-010", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "compat-bt-010-"))
      try {
        const executable = path.join(directory, "dummy_bad_browser_executable.js")
        fs.copyFileSync(assetPath("playwright", "dummy_bad_browser_executable.js"), executable)
        fs.chmodSync(executable, 0o755)
        const error = yield* launchFailure(
          backend(browserName, launchWith(browserName, { executablePath: executable }))
        )
        assert(Browser.isBrowserError(error), String(error))
        assert.strictEqual(error.reason._tag, "ProcessExited", String(error.reason))
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    }))

  test("BT-011", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      // A path that isn't absolute is refused before anything is looked up: `InvalidInput` (Browser.LaunchOptions)
      const relative = yield* launchFailure(
        backend(browserName, launchWith(browserName, { executablePath: "random-invalid-path" }))
      )
      assert(Browser.isBrowserError(relative), String(relative))
      assert.strictEqual(relative.reason._tag, "InvalidInput")
      // An absolute path with no file there is the executable not being found
      const absolute = yield* launchFailure(
        backend(browserName, launchWith(browserName, { executablePath: "/random-invalid-path" }))
      )
      assert(Browser.isBrowserError(absolute), String(absolute))
      assert.strictEqual(absolute.reason._tag, "ExecutableNotFound")
    }))

  test("BT-014", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const launch = launchWith(browserName, { process } as unknown as Partial<Browser.LaunchOptions>)
      // Built and released: the launch's success is the check, as the original's `browser.close()` ends it
      yield* Effect.scoped(Layer.build(backend(browserName, launch)))
    }))

  test("BT-015", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const { scope, services } = yield* launchOwn(browserName)
      // The context is left to the browser, which ends it with the close
      const contextScope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Effect.provideContext(services), Scope.provide(contextScope))
      const closed = yield* startWaiting(context.closed)
      yield* Scope.close(scope, Exit.void)
      const reason = yield* Fiber.join(closed.fiber)
      assert.strictEqual(reason._tag, "BrowserClosed")
    }))
})
