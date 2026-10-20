/**
 * The evidence every failure carries, and the preset that decides how much of it is shown.
 *
 * Each operation records what it sent and what it saw. When it fails, that record travels with the error as
 * `diagnostics`, so "did my click happen?" has an answer: not sent, maybe sent, or acknowledged. Values whose
 * detail depends on where they end up (URLs, titles, descriptions) implement Effect's `Redactable` and read
 * `CurrentPreset` from the fiber's context. Effect's own logs, spans, errors and inspection then apply the
 * preset too, in user code as well as ours.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as MonotonicInstant from "./MonotonicInstant.ts"

/**
 * Schema for the id that links an operation's span, its diagnostics and its trace entry.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OperationId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Diagnostics/OperationId"))

/**
 * Id that links an operation's span, its diagnostics and its trace entry.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type OperationId = typeof OperationId.Type

/**
 * Schema for whether an operation's effect reached the browser.
 *
 * **Details**
 *
 * `MayHaveBeenSent` means the command left but no answer came back, so the effect may or may not have
 * happened. Nothing is replayed automatically, because a second click is not the same as one click.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const DispatchState = Schema.Union([
  Schema.TaggedStruct("NotSent", {}),
  Schema.TaggedStruct("MayHaveBeenSent", {}),
  Schema.TaggedStruct("Acknowledged", { result: Schema.Literals(["ok", "rejected"]) })
])

/**
 * Whether an operation's effect reached the browser.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type DispatchState = typeof DispatchState.Type

/**
 * Schema for one step of an operation and how far it got.
 *
 * **Details**
 *
 * `step` names what was attempted, such as "resolve locator" or a protocol command like
 * `Input.dispatchMouseEvent`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const StepEvidence = Schema.Struct({
  step: Schema.String,
  state: Schema.Literals(["unsent", "uncertain", "ok", "rejected"]),
  at: MonotonicInstant.MonotonicInstant
})

/**
 * One step of an operation and how far it got.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type StepEvidence = typeof StepEvidence.Type

/**
 * Schema for one de-duplicated observation, as kept by `Timeout` and `ExpectationFailed`.
 *
 * **Details**
 *
 * `value` is whatever was observed: a text, a count, a status. Classified values are `Redactable`, so they
 * render according to the current preset.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const ObservedValue = Schema.Struct({
  at: MonotonicInstant.MonotonicInstant,
  value: Schema.Unknown
})

/**
 * One de-duplicated observation, as kept by `Timeout` and `ExpectationFailed`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type ObservedValue = typeof ObservedValue.Type

/**
 * Schema for what happened to the cleanup an operation needed, such as releasing a held key.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CleanupState = Schema.Union([
  Schema.TaggedStruct("NotNeeded", {}),
  Schema.TaggedStruct("Pending", {}),
  Schema.TaggedStruct("Completed", {}),
  Schema.TaggedStruct("Failed", { cause: Schema.String })
])

/**
 * What happened to the cleanup an operation needed.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CleanupState = typeof CleanupState.Type

/**
 * The evidence envelope every failure carries.
 *
 * **Details**
 *
 * `progress` lists the steps in order, so a failure shows where it stopped. `lastObserved` is the final
 * observation before the failure, when there was one.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Diagnostics extends Schema.Class<Diagnostics>("@usestrider/browser/Diagnostics")({
  operationId: OperationId,
  dispatch: DispatchState,
  progress: Schema.Array(StepEvidence),
  lastObserved: Schema.Option(ObservedValue),
  cleanup: CleanupState
}) {}

/**
 * Schema for how much detail `Redactable` values show.
 *
 * **Details**
 *
 * - `"strict"`: origins only, no titles. For production, exported traces and agents.
 * - `"local"`: paths and titles; query strings, fragments, user info and classified fields are stripped.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Preset = Schema.Literals(["local", "strict"])

/**
 * How much detail `Redactable` values show.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Preset = typeof Preset.Type

/**
 * Reference to the preset that `Redactable` values read when they render.
 *
 * **Details**
 *
 * The default is `"strict"`, tests included. `withPreset` is `Effect.provideService` on this reference.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export declare const CurrentPreset: Context.Reference<Preset>

/**
 * Sets the preset for everything inside an effect.
 *
 * **When to use**
 *
 * Use to see full URLs and titles while developing locally, without changing what production logs show.
 *
 * **Example** (Showing local detail while debugging)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Diagnostics, Page } from "@usestrider/browser"
 *
 * const openCart = Effect.fn("openCart")(function*(page: Page.Page) {
 *   yield* page.goto("https://shop.example.com/cart?session=abc")
 * }, Diagnostics.withPreset("local"))
 * ```
 *
 * @see {@link CurrentPreset} for the reference it sets
 *
 * @stability unstable
 * @category combinators
 * @since 0.1.0
 */
export declare const withPreset: {
  (preset: Preset): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, preset: Preset): Effect.Effect<A, E, R>
}
