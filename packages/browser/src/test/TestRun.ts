/**
 * Test support that works with any test runner: the running test, and the files attached to it.
 *
 * Nothing changes because it's a test: profile, focus, diagnostics and tracing are whatever the test chose, and a
 * test gets its page from `Browser.newPage()`, like any program. A runner's adapter, such as `@usestrider/vitest`,
 * provides `TestRun`, so that traces and screenshots attach to the test that made them.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
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
  worker: Schema.String,
  shard: Schema.String
}) {}

/**
 * Schema for a file to attach to the running test.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TestArtifact = Schema.Union([
  Schema.TaggedStruct("Trace", { path: FilePath.Local }),
  Schema.TaggedStruct("Har", { path: FilePath.Local }),
  Schema.TaggedStruct("Screenshot", { path: FilePath.Local })
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
   * The test running when this is read; in Vitest, `TestRunner.getCurrentTest()`. Outside a test, its fields
   * are empty.
   */
  readonly info: TestInfo
  /**
   * Attaches a file to the test running now; in Vitest, `recordArtifact`. Outside a test, or in a runner that
   * keeps no artifacts, nothing is attached and a warning is logged.
   */
  attach(artifact: TestArtifact): Effect.Effect<void>
}

/**
 * The service tag for `TestRun`.
 *
 * @stability unstable
 * @category tags
 * @since 0.1.0
 */
export const TestRun: Context.Service<TestRun, TestRun> = Context.Service<TestRun>("@usestrider/browser/test/TestRun")
