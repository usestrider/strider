/**
 * effect-browser/test: runner-agnostic test helpers. Everything is a Layer or a scoped Effect, and nothing
 * changes because it's a test: profile, focus, diagnostics and tracing are whatever the test chose.
 */
import { Context } from "effect"
import type { Effect, Scope } from "effect"
import type { LocalPath } from "./Brand.ts"
import type { Browser } from "./Browser.ts"
import type { PageError } from "./Errors.ts"
import type { Page } from "./Page.ts"
import type { UserContextOptions } from "./UserContext.ts"

export interface TestInfo {
  readonly project: string
  readonly file: string
  readonly id: string                                   // file > suite > … > test
  readonly attempt: number
  readonly worker: string
  readonly shard: string
}
export type TestArtifact =
  | { readonly _tag: "Trace"; readonly path: LocalPath }
  | { readonly _tag: "Har"; readonly path: LocalPath }
  | { readonly _tag: "Screenshot"; readonly path: LocalPath }

export class TestRun extends Context.Service<TestRun, {   // per test, from the runner adapter
  readonly info: TestInfo
  attach(artifact: TestArtifact): Effect.Effect<void>    // Vitest: recordArtifact
}>()("effect-browser/TestRun") {}

export declare const BrowserTest: {
  /** Browser, then newPage: a fresh context and page, closed after the test. */
  readonly page: Effect.Effect<Page, PageError, Browser | Scope.Scope>
  pageWith(options: UserContextOptions): Effect.Effect<Page, PageError, Browser | Scope.Scope>
}
