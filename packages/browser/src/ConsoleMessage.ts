/**
 * Messages a page or its workers write to the console.
 *
 * A message's `text` is raw page content. Capture policy applies before it leaves the process, as it does for
 * every page-derived value an agent or an exported trace receives.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Deferred from "./Deferred.ts"
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

/**
 * Subscribes to console messages and returns the first match, latched.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<ConsoleMessage, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to console messages and emits every match from now on.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<ConsoleMessage, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the console messages a log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<ConsoleMessage>>
