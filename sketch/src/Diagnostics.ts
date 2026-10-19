/**
 * The diagnostic envelope every failure carries, and the preset that decides how much of it is rendered.
 *
 * Values whose detail depends on the preset (URLs, titles, descriptions) implement Effect's `Redactable`
 * and read `Diagnostics.Preset` from the current fiber's context, so Effect's own logs, spans, errors and
 * inspection apply the preset too, in user code as well as ours.
 */
import type { Context, Option } from "effect"
import type { Dual } from "./Deadline.ts"
import type { MonotonicInstant, OperationId } from "./Brand.ts"

export interface Diagnostics {
  readonly operationId: OperationId
  readonly dispatch: DispatchState
  readonly progress: ReadonlyArray<StepEvidence>
  readonly lastObserved: Option.Option<ObservedValue>
  readonly cleanup: CleanupState
}
export type DispatchState =
  | { readonly _tag: "NotSent" }
  | { readonly _tag: "MayHaveBeenSent" }                 // "did my click happen?" — maybe; nothing is replayed
  | { readonly _tag: "Acknowledged"; readonly result: "ok" | "rejected" }
export interface StepEvidence {
  readonly step: string                                 // e.g. "resolve locator", "Input.dispatchMouseEvent"
  readonly state: "unsent" | "uncertain" | "ok" | "rejected"
  readonly at: MonotonicInstant
}
export interface ObservedValue {                        // one de-duplicated observation, for Timeout and ExpectationFailed
  readonly at: MonotonicInstant
  readonly value: unknown                               // Redactable where classified
}
export type CleanupState =
  | { readonly _tag: "NotNeeded" } | { readonly _tag: "Pending" } | { readonly _tag: "Completed" }
  | { readonly _tag: "Failed"; readonly cause: string }

export type DiagnosticsPreset =
  | "local"                                             // paths and titles; query, fragment, userinfo and classified fields stripped
  | "strict"                                            // origins only, no titles: production, exported traces, agents

export declare const Diagnostics: {
  readonly withPreset: Dual<DiagnosticsPreset>          // "strict" unless set, tests included
  readonly Preset: Context.Reference<DiagnosticsPreset> // what Redactable values read; withPreset is Effect.provideService on it
}
