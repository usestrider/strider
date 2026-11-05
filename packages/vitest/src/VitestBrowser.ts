/**
 * The Vitest adapter: a browser layer for `@effect/vitest`, with `TestRun` for the test that's running.
 *
 * `VitestBrowser.layer` passes the backend's layer through unchanged. The package's peer dependency is `vitest` 5.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Browser from "@usestrider/browser/Browser"
import { TestRun } from "@usestrider/browser/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { recordArtifact, TestRunner } from "vitest"

declare module "vitest" {
  interface TestArtifactRegistry {
    "@usestrider/browser": {
      readonly type: "@usestrider/browser"
      readonly artifact: TestRun.TestArtifact["_tag"]
      readonly attachments: Array<{ readonly path: string; readonly contentType: string }>
    }
  }
}

type RunnerTest = NonNullable<ReturnType<typeof TestRunner.getCurrentTest>>

/** The test's path: its file, then each suite, then the test. */
const pathOf = (test: RunnerTest): string => {
  const names: Array<string> = [test.name]
  for (let suite = test.suite; suite !== undefined; suite = suite.suite) {
    if (suite.name !== "") names.unshift(suite.name)
  }
  return [test.file.name, ...names].join(" > ")
}

const env = (name: string): string =>
  (globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }).process?.env?.[name] ??
    ""

const infoOf = (test: RunnerTest | undefined): TestRun.TestInfo =>
  new TestRun.TestInfo({
    project: test?.file.projectName ?? "",
    file: test?.file.filepath ?? "",
    id: test === undefined ? "" : pathOf(test),
    attempt: test?.result?.retryCount ?? 0,
    worker: env("VITEST_POOL_ID"),
    shard: env("VITEST_SHARD")
  })

const contentType: Record<TestRun.TestArtifact["_tag"], string> = {
  Trace: "application/zip",
  Har: "application/json",
  Screenshot: "image/png"
}

/** `TestRun` for Vitest: the current test, read each time, and its artifacts. */
const testRun: TestRun.TestRun = {
  get info() {
    return infoOf(TestRunner.getCurrentTest())
  },
  attach: (artifact) =>
    Effect.suspend(() => {
      const test = TestRunner.getCurrentTest()
      if (test === undefined) {
        return Effect.logWarning(`TestRun.attach: no test is running, so ${artifact.path} wasn't attached`)
      }
      const type = artifact._tag === "Screenshot" && /\.jpe?g$/i.test(artifact.path)
        ? "image/jpeg"
        : contentType[artifact._tag]
      return Effect.tryPromise(() =>
        recordArtifact(test, {
          type: "@usestrider/browser",
          artifact: artifact._tag,
          attachments: [{ path: artifact.path, contentType: type }]
        })
      ).pipe(
        Effect.asVoid,
        Effect.catch((error) =>
          Effect.logWarning(`TestRun.attach: Vitest didn't attach ${artifact.path}: ${error.message}`)
        )
      )
    })
}

/**
 * Provides the backend you pass, unchanged, plus `TestRun` for the current test.
 *
 * **Details**
 *
 * The browser starts where the layer is built: given to `@effect/vitest`'s `layer`, once for the block, whose tests
 * share it; provided to one effect, as below, once for that effect.
 *
 * Vitest's default `testTimeout` is five seconds for the whole test, shorter than Strider's thirty-second budget
 * per operation, so a slow step can end with Vitest's generic timeout before Strider reports its failure.
 * Raise `testTimeout` in your Vitest config to allow time for all the test's operations:
 *
 * **Example** (Allowing time for browser operations)
 *
 * ```ts import.meta.vitest
 * import { defineConfig } from "vitest/config"
 *
 * export default defineConfig({
 *   test: { testTimeout: 60_000 }
 * })
 * ```
 *
 * **Example** (Providing a browser to a test)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { VitestBrowser } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const test = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage({ focus: "emulated" })
 *   yield* page.goto("https://shop.example.com")
 * })).pipe(
 *   Effect.provide(
 *     VitestBrowser.layer(Chromium.layer({ executablePath: "/usr/bin/chromium" }))
 *   )
 * )
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export const layer = <E, R>(
  backend: Layer.Layer<Browser.Browser, E, R>
): Layer.Layer<Browser.Browser | TestRun.TestRun, E, R> => Layer.merge(backend, Layer.succeed(TestRun.TestRun, testRun))
