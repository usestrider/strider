/**
 * Dialogs, file choosers, and paused requests that a default policy decided, because no handler or route did.
 *
 * Each such decision is reported, never made silently, so a test can check that none happened and an agent can see
 * why a dialog disappeared.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as AutoResolutionImpl from "./internal/autoResolution.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as NetworkRequest from "./NetworkRequest.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for what was decided: a dialog, a file chooser, or a paused request.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Subject = Schema.Union([
  Schema.TaggedStruct("Dialog", {
    kind: Schema.Literals(["Alert", "Confirm", "Prompt", "BeforeUnload", "Unknown"]),
    message: Schema.String
  }),
  Schema.TaggedStruct("FileChooser", {}),
  Schema.TaggedStruct("PausedRequest", { request: NetworkRequest.NetworkRequest })
])

/**
 * What was decided: a dialog, a file chooser, or a paused request.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Subject = typeof Subject.Type

/**
 * Schema for what chose an automatic decision: a context option, or Strider's fixed rule for its kind.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Policy = Schema.Union([
  Schema.TaggedStruct("ContextOption", { name: Schema.Literal("dialogs"), value: Schema.String }),
  Schema.TaggedStruct("Default", {})
])

/**
 * What chose an automatic decision.
 *
 * **Details**
 *
 * - `ContextOption`: an option the context was made with, such as `dialogs: "dismiss"`.
 * - `Default`: Strider's fixed rule for the kind, which no option changes: a file chooser nothing decides is
 *   canceled, and a request no route decides continues, as `Route.continue` does. At an authentication challenge,
 *   that means the page gets the server's response, never the browser's own prompt.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Policy = typeof Policy.Type

/**
 * One dialog, file chooser, or paused request that a default policy decided.
 *
 * **Details**
 *
 * `decision` is what was done, such as `"dismiss"`, `"cancel"`, or `"continue"`; `policy` is what chose it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class AutoResolution extends Schema.Class<AutoResolution>("@usestrider/browser/AutoResolution")({
  subject: Subject,
  decision: Schema.String,
  policy: Policy,
  at: MonotonicInstant.MonotonicInstant
}) {}

/**
 * Which automatic decisions to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match decisions about these kinds of subject: `"Dialog"`, `"FileChooser"`, or `"PausedRequest"`.
   *
   * @default any kind
   */
  readonly subject?: Subject["_tag"] | ReadonlyArray<Subject["_tag"]> | undefined
}

/**
 * Subscribes to automatic decisions and returns the wait: an effect that gives the first match, the same each
 * time it runs.
 *
 * **Example** (What the context's policy did with a dialog)
 *
 * ```ts import.meta.vitest
 * import { AutoResolution, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const deleteUnhandled = Effect.fn("deleteUnhandled")(function*(page: Page.Page) {
 *   const decided = yield* AutoResolution.next(page, { subject: "Dialog" })
 *   yield* page.getByRole("button", { name: "Delete account" }).click()
 *   const resolution = yield* decided
 *   return resolution.decision
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<AutoResolution, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<AutoResolution, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => AutoResolutionImpl.next(target, filter, where)

/**
 * Subscribes to automatic decisions and emits every match from now on.
 *
 * **Example** (Warning about every default decision in a context)
 *
 * ```ts import.meta.vitest
 * import { AutoResolution, Page } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const warnOnDefaults = Effect.fn("warnOnDefaults")(function*(page: Page.Page) {
 *   const decisions = yield* AutoResolution.stream(page.context)
 *   yield* decisions.pipe(
 *     Stream.runForEach((resolution) =>
 *       Effect.logWarning(`${resolution.subject._tag}: ${resolution.decision}`)
 *     ),
 *     Effect.forkScoped
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<AutoResolution, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<AutoResolution, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => AutoResolutionImpl.stream(target, filter, where)

/**
 * Reads the automatic decisions still in the event log; never waits.
 *
 * **Example** (Checking that no default decided anything)
 *
 * ```ts import.meta.vitest
 * import { AutoResolution, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const nothingDefaulted = Effect.fn("nothingDefaulted")(function*(page: Page.Page) {
 *   const decisions = yield* AutoResolution.history(page)
 *   return decisions.entries.length === 0 && decisions.dropped === 0
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<AutoResolution>, Subscription.SubscriptionError> =>
  AutoResolutionImpl.history(target, filter)
