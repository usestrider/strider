/**
 * Runner-agnostic test support (`@usestrider/browser/test`).
 *
 * Nothing changes because it's a test: profile, focus, diagnostics and tracing are whatever the test chose.
 * A test gets its page from `Browser.newPage()`, like any program. A runner adapter, such as
 * `@usestrider/browser/test/vitest`, provides `TestRun` so that traces and screenshots attach to the test that
 * made them.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Context from "effect/Context"
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
 * The running test, provided per test by a runner adapter.
 *
 * @stability unstable
 * @category services
 * @since 0.1.0
 */
export interface TestRun {
  readonly info: TestInfo
  /**
   * Attaches a file to the test; in Vitest, `recordArtifact`.
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
export declare const TestRun: Context.Service<TestRun, TestRun>
