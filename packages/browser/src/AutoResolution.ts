/**
 * Obligations decided by a default policy because no handler decided them.
 *
 * A dialog nobody handled, a file chooser nobody answered, a paused request whose handler failed: each is
 * decided by a stated policy, never silently. This event reports each such decision, so a test can assert
 * that none happened, and an agent can see why a dialog vanished.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import * as NetworkRequest from "./NetworkRequest.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for what was decided.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Subject = Schema.Union([
  Schema.TaggedStruct("Dialog", {
    kind: Schema.Literals(["Alert", "Confirm", "Prompt", "BeforeUnload"]),
    message: Schema.String
  }),
  Schema.TaggedStruct("FileChooser", {}),
  Schema.TaggedStruct("PausedRequest", { request: NetworkRequest.NetworkRequest })
])

/**
 * What was decided.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Subject = typeof Subject.Type

/**
 * One obligation decided by a default policy.
 *
 * **Details**
 *
 * `decision` is what was done, such as `"dismiss"`, `"cancel"` or `"continue"`; `policy` is the setting that
 * chose it, such as `dialogs: "dismiss"`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class AutoResolution extends Schema.Class<AutoResolution>("@usestrider/browser/AutoResolution")({
  subject: Subject,
  decision: Schema.String,
  policy: Schema.String,
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
   * Match decisions about these kinds of obligation.
   *
   * @default any kind
   */
  readonly subject?: Subject["_tag"] | ReadonlyArray<Subject["_tag"]> | undefined
}

// ── Implementation ──

const kinds = { alert: "Alert", confirm: "Confirm", prompt: "Prompt", beforeunload: "BeforeUnload" } as const

const deliver = (event: Model.AutoResolutionEvent): AutoResolution => {
  switch (event._tag) {
    case "Dialog":
      return new AutoResolution({
        subject: { _tag: "Dialog", kind: kinds[event.prompt.kind], message: event.prompt.message },
        decision: event.decision,
        policy: `dialogs: "${event.policy}"`,
        at: event.at
      })
    case "FileChooser":
      return new AutoResolution({
        subject: { _tag: "FileChooser" },
        decision: event.decision,
        policy: `fileChoosers: "cancel"`,
        at: event.at
      })
    case "PausedRequest":
      // No route decided a request one matched (review 17, candidate 1)
      return new AutoResolution({
        subject: { _tag: "PausedRequest", request: event.request },
        decision: event.decision,
        policy: `routes: "continue"`,
        at: event.at
      })
  }
}

const kind = (operation: string): Events.Kind<Model.AutoResolutionEvent, AutoResolution> => ({
  operation,
  noun: "an automatic decision",
  deliver
})

const channel = (target: Page.Page | UserContext.UserContext) => {
  const found = Handles.target(target)
  return found.behind.entry.events.autoResolution
}

const accepts = (filter: Filter | undefined) => {
  const wanted = Filters.among(filter?.subject)
  return (entry: Events.Entry<Model.AutoResolutionEvent>) => wanted(entry.value._tag)
}

/**
 * Subscribes to automatic decisions and returns the first match, latched.
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
> =>
  Effect.suspend(() => Events.next(kind("AutoResolution.next"), channel(target), accepts(filter), where)).pipe(
    Effect.withSpan("AutoResolution.next")
  )

/**
 * Subscribes to automatic decisions and emits every match from now on.
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
> => Effect.suspend(() => Events.stream(kind("AutoResolution.stream"), channel(target), accepts(filter), where))

/**
 * Reads the automatic decisions a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.Page | UserContext.UserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<AutoResolution>, Subscription.SubscriptionError> =>
  Effect.suspend(() => Events.history(kind("AutoResolution.history"), channel(target), accepts(filter)))
