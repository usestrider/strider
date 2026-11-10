/**
 * Test support that works with any test runner: the running test, and the files attached to it.
 *
 * Nothing changes because it's a test: profile, focus, diagnostics and tracing are whatever the test chose, and a
 * test gets its page from `Browser.newPage()`, like any program. A runner's adapter, such as `@usestrider/vitest`,
 * provides `TestRun`, through which a test attaches its traces and screenshots.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as FilePath from "../FilePath.ts"

/**
 * Which test is running, as the runner reports it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class TestInfo extends Schema.Class<TestInfo>("@usestrider/browser/test/TestInfo")({
  project: Schema.String,
  file: Schema.String,
  /**
   * The test's path: file, then each suite, then the test.
   */
  id: Schema.String,
  attempt: Schema.Int,
  /**
   * Zero-based repetition within the test run, separate from its retry attempt. Optional for older
   * identity objects; construction and decoding supply zero when omitted.
   *
   * @default 0
   */
  repeat: Schema.optionalKey(Schema.Int).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(0)),
    Schema.withConstructorDefault(Effect.succeed(0))
  ),
  worker: Schema.String,
  shard: Schema.String
}) {}

/**
 * Schema for a file to attach to the running test: `{ trace }`, `{ har }` or `{ screenshot }`, each a path.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TestArtifact = Schema.Union([
  Schema.Struct({ trace: FilePath.Local }),
  Schema.Struct({ har: FilePath.Local }),
  Schema.Struct({ screenshot: FilePath.Local })
])

/**
 * A file to attach to the running test.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TestArtifact = typeof TestArtifact.Type

/**
 * The running test, provided by a test runner's adapter such as `@usestrider/vitest`.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export interface TestRun {
  /**
   * The test identity supplied by the adapter. Explicit callback bindings retain the identity, retry attempt and
   * repeat captured for that invocation. Vitest’s unbound layer uses a global lookup, which supports sequential tests
   * only; without a current test its project, file and id are empty and its attempt and repeat are zero.
   */
  readonly info: TestInfo
  /**
   * Attaches a file to the adapter’s test; an explicit callback binding uses its captured task. Outside a test, or in a runner that
   * keeps no artifacts, nothing is attached and a warning is logged. Complete bound attachments during their
   * callback; Vitest does not guarantee that artifacts attached later reach reporters.
   *
   * **Example** (Attaching a trace of a checkout)
   *
   * ```ts import.meta.vitest
   * import { Page, Trace } from "@usestrider/browser"
   * import { TestRun } from "@usestrider/browser/test"
   * import { Effect } from "effect"
   *
   * const tracedCheckout = Effect.fn("tracedCheckout")(function*(page: Page.Page) {
   *   const trace = yield* Trace.record(page, { screenshots: "perAction" })
   *   yield* page.getByRole("button", { name: "Checkout" }).click()
   *   const path = yield* trace.exportTrace("traces/checkout.zip")
   *   const run = yield* TestRun.TestRun
   *   yield* run.attach({ trace: path })
   * })
   * ```
   */
  attach(artifact: TestArtifact): Effect.Effect<void>
}

/**
 * The service tag for `TestRun`.
 *
 * **Example** (Reading the running test)
 *
 * ```ts import.meta.vitest
 * import { TestRun } from "@usestrider/browser/test"
 * import { Effect } from "effect"
 *
 * const testIdentity = Effect.gen(function*() {
 *   const { info } = yield* TestRun.TestRun
 *   return { test: info.id, attempt: info.attempt }
 * })
 * ```
 *
 * @stability unstable
 * @category tags
 * @since 0.1.0
 */
export const TestRun: Context.Service<TestRun, TestRun> = Context.Service<TestRun>("@usestrider/browser/test/TestRun")
