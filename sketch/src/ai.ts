/**
 * effect-browser/ai: the agent toolkit. One definition serves an in-process model, an MCP server and the CLI.
 *
 * Every page tool names its page; there is no current tab. No tool waits after it acts: each result carries
 * the call's outcome, then a digest of what the event logs recorded since the previous call. Tools are
 * effect/ai Tools with failureMode "return", so an ActionError, Timeout or StaleRef reaches the model as data,
 * hint included. Parameters are Schemas: a model's "e12" is decoded to a RefId and checked against that page's
 * latest snapshot.
 */
import type { Effect, Redacted, Scope } from "effect"
import type { Tool, Toolkit } from "effect/ai"
import type { UserContext } from "./UserContext.ts"

export type BrowserToolName =
  | "pages" | "newPage" | "goto" | "back" | "snapshot" | "screenshot"
  | "click" | "fill" | "press" | "select" | "scroll"
  | "next" | "await" | "expect" | "history"
  | "route" | "dialog"
export type BrowserTools = { readonly [K in BrowserToolName]: Tool.Any }

export interface CapturePolicy {                        // what snapshots, screenshots and digests may contain before reaching a model
  readonly screenshots: "allowed" | "denied"
  readonly snapshotText: "full" | "redacted"            // redacted: input values and classified text masked
  readonly consoleText: "full" | "redacted" | "omitted"
}
export declare const CapturePolicy: {
  readonly strict: CapturePolicy
  readonly local: CapturePolicy
}

export declare const BrowserToolkit: {
  /** The definitions alone, for the CLI and MCP surfaces. */
  readonly toolkit: Toolkit.Toolkit<BrowserTools>
  make(options: {
    readonly context: UserContext                       // the model works in this context
    readonly secrets: Readonly<Record<string, Redacted.Redacted<string>>>   // the model sees %name%; substitution happens at dispatch
    readonly capture: CapturePolicy                     // required
  }): Effect.Effect<Toolkit.WithHandler<BrowserTools>, never, Scope.Scope>
}
