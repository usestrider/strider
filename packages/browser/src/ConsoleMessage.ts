/**
 * Messages a page or its workers write to the console.
 *
 * A message's `text` is raw page content. Capture policy applies before it leaves the process, as it does for
 * every page-derived value an agent or an exported trace receives.
 *
 * A message is reported to its page and its context. A dedicated worker's messages reach its page, and a shared
 * or service worker's only its context; what each backend reports from workers is in its `console` capability.
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
import * as Spans from "./internal/spans.ts"
import * as MonotonicInstant from "./MonotonicInstant.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import * as Target from "./Target.ts"
import * as Url from "./Url.ts"
import type * as UserContext from "./UserContext.ts"

/**
 * Schema for a console message's level.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Level = Schema.Literals(["debug", "log", "info", "warning", "error"])

/**
 * A console message's level.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Level = typeof Level.Type

/**
 * Schema for where in a script a message was written.
 *
 * **Details**
 *
 * `line` and `column` are 1-based, as stack traces print them. The column is where the browser places the
 * call, which differs between engines by a few characters.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const SourceLocation = Schema.Struct({
  url: Url.Url,
  line: Schema.Int,
  column: Schema.Int
})

/**
 * Where in a script a message was written.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type SourceLocation = typeof SourceLocation.Type

/**
 * One message written to the console.
 *
 * **Details**
 *
 * `text` is what the browser reports, not reformatted: Firefox applies format specifiers such as `%s` and the
 * others don't, and every browser renders an object as its class name, such as `Object`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class ConsoleMessage extends Schema.Class<ConsoleMessage>("@usestrider/browser/ConsoleMessage")({
  level: Level,
  text: Schema.String,
  location: Schema.Option(SourceLocation),
  origin: Target.EventOrigin,
  at: MonotonicInstant.MonotonicInstant
}) {}

/**
 * Which console messages to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match messages at these levels.
   *
   * @default any level
   */
  readonly level?: Level | ReadonlyArray<Level> | undefined
  /**
   * Match messages whose text contains this string or matches this expression.
   *
   * @default any text
   */
  readonly text?: string | RegExp | undefined
}

// ── Implementation ──

const kind = (operation: string): Events.Kind<ConsoleMessage, ConsoleMessage> => ({
  operation,
  noun: "a console message",
  deliver: (message) => message
})

const subscription = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter: Filter | undefined,
  operation: string
) =>
  Effect.sync(() => {
    const level = Filters.among(filter?.level)
    const text = Filters.text(filter?.text)
    return {
      kind: kind(operation),
      channel: Handles.target(target).behind.entry.events.console,
      accepts: (entry: Events.Entry<ConsoleMessage>) => level(entry.value.level) && text(entry.value.text)
    }
  })

/**
 * Subscribes to console messages and returns the first match, latched.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<ConsoleMessage, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "ConsoleMessage.next"),
    ({ accepts, channel, kind }) => Events.next(kind, channel, accepts, where)
  ).pipe(Spans.operation("ConsoleMessage.next"))

/**
 * Subscribes to console messages and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<ConsoleMessage, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> =>
  Effect.flatMap(
    subscription(target, filter, "ConsoleMessage.stream"),
    ({ accepts, channel, kind }) => Events.stream(kind, channel, accepts, where)
  )

/**
 * Reads the console messages a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<ConsoleMessage>, Subscription.SubscriptionError> =>
  Effect.flatMap(
    subscription(target, filter, "ConsoleMessage.history"),
    ({ accepts, channel, kind }) => Events.history(kind, channel, accepts)
  )
