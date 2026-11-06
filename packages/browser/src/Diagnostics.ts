/**
 * The record of what happened that every failure carries, and the preset that decides how much of a URL is shown.
 *
 * Every failure carries its operation's record as `diagnostics`, which says, for an action, whether the input was
 * sent. `CurrentPreset` decides how much of a URL is shown: in an operation's span attributes, and wherever Effect's
 * logger, formatter or inspection shows a `NetworkRequest` or `NetworkResponse`. Under `"strict"`, the default, a URL
 * keeps its origin and path with each query value redacted; under `"local"` it's shown whole.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
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
 * Schema for whether an operation's command reached the browser.
 *
 * **Details**
 *
 * `MayHaveBeenSent`: the command left and no answer came back, so it may have taken effect. Strider never sends
 * it again, since a second click isn't the same as one. `Acknowledged` records a successful adapter write or
 * creation reply, a dispatched evaluation's reply, an engine action's confirmation, or an explicit browser rejection. Local refusal and a missing
 * reply do not prove acknowledgement. A later write starts uncertain again; earlier replies do not confirm it.
 * Overlapping calls and steps stay uncertain if any write is still unanswered, including one whose wait ended
 * without a reply or was interrupted. When all writes in that overlap are acknowledged, any browser rejection
 * makes the result `"rejected"`. A subsequent sequential write starts with evidence of its own.
 *
 * Acknowledgement can describe a retried held-key or held-button release. It does not by itself prove that the
 * requested gesture was sent: recovery can fail, or the gesture can be refused before dispatch after recovery.
 * An adapter method can send several commands, so its reply does not describe each intermediate command.
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
 * Whether an operation's command reached the browser.
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
 * `value` is whatever was observed: a text, a count, a status.
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
 * Schema for what was known about cleanup owned by an operation and its steps when an error was built.
 *
 * **Details**
 *
 * A retried held-input release reports `Completed` or `Failed`. An abandoned page or context creation reports
 * `Pending`: its reply or release may still be outstanding. Reporting does not extend the deadline or transfer
 * cleanup ownership. For several outcomes, `Failed` takes precedence over `Pending`, then `Completed`, then
 * `NotNeeded`; the first known failure supplies the cause. Later scope finalizers do not change an earlier snapshot.
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
 * The record of what an operation sent and saw, which every failure carries as `diagnostics`.
 *
 * **Details**
 *
 * `progress` lists the steps in order, so a failure shows where it stopped. `lastObserved` is the final
 * observation before the failure, when there was one. All fields are snapshots of the evidence then known.
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
 * Schema for how much of a URL Strider shows in its spans, logs and exported traces.
 *
 * **Details**
 *
 * - `"strict"`: a URL keeps its origin and path, with each query value `REDACTED` and no credentials or
 *   fragment. For production, exported traces and agents.
 * - `"local"`: a URL is shown whole. For a developer's own machine.
 *
 * Text passed as `Redacted` stays redacted under both, except in an exported trace's DOM snapshots: there,
 * `"local"` shows the values of password inputs and of fields filled with `Redacted` text.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Preset = Schema.Literals(["local", "strict"])

/**
 * How much of a URL Strider shows in its spans, logs and exported traces.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Preset = typeof Preset.Type

/**
 * Reference to the preset in effect, which Strider reads when it shows a URL.
 *
 * **Details**
 *
 * The default is `"strict"`, tests included; set it with `withPreset`. Each operation's span reads it as it
 * opens, for its `url.full` and a connection's `browser.endpoint`.
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const CurrentPreset: Context.Reference<Preset> = Context.Reference<Preset>(
  "@usestrider/browser/Diagnostics/CurrentPreset",
  { defaultValue: () => "strict" }
)

/**
 * Sets the preset for everything inside an effect.
 *
 * **When to use**
 *
 * Use to see whole URLs while developing locally, without changing what production shows.
 *
 * **Example** (Showing local detail while debugging)
 *
 * ```ts import.meta.vitest
 * import { Diagnostics, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
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
export const withPreset: {
  (preset: Preset): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, preset: Preset): Effect.Effect<A, E, R>
} = dual(
  2,
  <A, E, R>(self: Effect.Effect<A, E, R>, preset: Preset): Effect.Effect<A, E, R> =>
    Effect.provideService(self, CurrentPreset, preset)
)
