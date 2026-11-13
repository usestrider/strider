/**
 * The messages that a page or its workers write to the console.
 *
 * A message is reported to its page and its context: a dedicated worker's messages reach its page, and a shared or
 * service worker's only its context. Each backend's `console` capability says what it reports from workers.
 *
 * A message's `text` is the page's content, so a capture policy applies to it before it leaves the process, as to
 * everything from the page that an agent or an exported trace receives.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as ConsoleMessageImpl from "./internal/consoleMessage.ts"
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
 * `text` has the call's format specifiers, such as `%s`, `%d`, and `%f`, applied as the Console Standard's formatter
 * applies them: Strider applies it to what Chromium and WebKit report, and Firefox applies its own, which writes
 * `%f` as printf does (`1.250000`). An object reads as its browser describes it, such as `Object`.
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
 * Subscribes to console messages and returns the wait: an effect that gives the first match, the same each time
 * it runs.
 *
 * **Example** (Waiting for the app to log that it's ready)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const openApp = Effect.fn("openApp")(function*(page: Page.Page) {
 *   const ready = yield* ConsoleMessage.next(page, { text: "App ready" })
 *   yield* page.goto("https://app.example.com")
 *   return yield* ready
 * })
 * ```
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
> => ConsoleMessageImpl.next(target, filter, where)

/**
 * Subscribes to console messages and emits every match from now on.
 *
 * **Example** (Echoing a context's errors, workers' included)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, UserContext } from "@usestrider/browser"
 * import { Console, Effect, Stream } from "effect"
 *
 * const echoErrors = Effect.fn("echoErrors")(
 *   function*(context: UserContext.ObservedUserContext) {
 *     const errors = yield* ConsoleMessage.stream(context, { level: "error" })
 *     yield* errors.pipe(
 *       Stream.runForEach((message) => Console.error(message.text)),
 *       Effect.forkScoped
 *     )
 *   }
 * )
 * ```
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
> => ConsoleMessageImpl.stream(target, filter, where)

/**
 * Reads the console messages still in the event log; never waits.
 *
 * **Example** (The errors logged so far)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loggedErrors = Effect.fn("loggedErrors")(function*(page: Page.ObservedPage) {
 *   const errors = yield* ConsoleMessage.history(page, { level: "error" })
 *   return errors.entries.map((message) => message.text)
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<ConsoleMessage>, Subscription.SubscriptionError> =>
  ConsoleMessageImpl.history(target, filter)
