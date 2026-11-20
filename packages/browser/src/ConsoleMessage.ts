/**
 * The messages on a page's console: what the page or its workers write to it, and what the browser writes there
 * itself, such as a Content Security Policy violation, a request blocked by CORS, or a resource that failed to load.
 *
 * The browser's own messages are reported as its developer tools console shows them, one message for each entry, so
 * one failure can be one message on one browser and several on another. On Firefox they arrive as uncaught
 * exceptions instead, as Firefox sends them as script errors. Stock WebKit's "Fetch API cannot load … due to access
 * control checks" arrives as an uncaught exception too: WebKit sends it on its `javascript` channel at level `error`,
 * which is how Strider reads an uncaught exception on WebKit. Each backend's `console.source` capability says which
 * of the browser's own messages it reports.
 *
 * A message's `source` says whether the page wrote it, with a `console` call, or the browser did, and for the
 * browser's own what it is about, such as `security` for a CSP violation or `network` for a failed load.
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
import type * as JSHandle from "./JSHandle.ts"
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
 * Schema for what a message the browser wrote to the console is about.
 *
 * **Details**
 *
 * One set serves every browser, and a browser's own name for what it sends isn't kept; what maps to none of these is
 * `other`:
 *
 * - `network`: a failed or blocked load, on Chromium and WebKit.
 * - `security`: a Content Security Policy violation or a request CORS blocked, on Chromium and WebKit.
 * - `deprecation`, `intervention` and `violation`: a deprecated feature, a request the browser changed or refused
 *   to protect the user, and a slow handler or forced layout, on Chromium.
 * - `rendering`: what rendering reports, on Chromium and WebKit.
 * - `storage`: what storage reports, on Chromium and WebKit. Chromium's application cache messages are `storage`.
 * - `other`: everything else, such as Chromium's `xml` and `recommendation` messages and WebKit's `css`, `media`
 *   and `content-blocker` ones.
 *
 * **Example** (Counting the browser's messages by category)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const countByCategory = Effect.fn("countByCategory")(
 *   function*(page: Page.ObservedPage) {
 *     const messages = yield* ConsoleMessage.history(page)
 *     const counts = new Map<ConsoleMessage.Category, number>()
 *     for (const message of messages.entries) {
 *       if (message.source._tag === "Browser") {
 *         const category = message.source.category
 *         counts.set(category, (counts.get(category) ?? 0) + 1)
 *       }
 *     }
 *     return counts
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Category = Schema.Literals([
  "network",
  "security",
  "deprecation",
  "intervention",
  "violation",
  "rendering",
  "storage",
  "other"
])

/**
 * What a message the browser wrote to the console is about.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Category = typeof Category.Type

/**
 * Schema for who wrote a console message: the page, with a `console` call in a page or worker, or the browser,
 * with its `category`.
 *
 * **Gotchas**
 *
 * Firefox sends the browser's own messages as script errors, so they arrive as uncaught exceptions and every
 * console message on Firefox is `Page`. Stock WebKit sends "Fetch API cannot load … due to access control checks"
 * the same way. The `console.source` capability says so.
 *
 * **Example** (The CSP violations a page caused)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const securityMessages = Effect.fn("securityMessages")(
 *   function*(page: Page.ObservedPage) {
 *     const messages = yield* ConsoleMessage.history(page)
 *     return messages.entries.filter((message) =>
 *       message.source._tag === "Browser" && message.source.category === "security"
 *     )
 *   }
 * )
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Source = Schema.Union([
  Schema.TaggedStruct("Page", {}),
  Schema.TaggedStruct("Browser", { category: Category })
])

/**
 * Who wrote a console message: the page, or the browser with what its message is about.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Source = typeof Source.Type

/**
 * One message written to the console.
 *
 * **Details**
 *
 * `text` has the call's format specifiers, such as `%s`, `%d`, and `%f`, applied as the Console Standard's formatter
 * applies them: Strider applies it to what Chromium and WebKit report, and Firefox applies its own, which writes
 * `%f` as printf does (`1.250000`). An object reads as a preview of its value, as the browser's developer tools
 * print it: `console.log([1, 2, 3], {a: 1}, window)` reads `[1, 2, 3] {a: 1} Window`. A preview shows an object's
 * first five properties and an array's first hundred items, with `…` for the rest; inside it, a string is quoted
 * and an object reads as its class (`{b: Object}`). An `Error` reads as its browser describes it, which on Chromium
 * includes its stack. The `console` capability says where a backend's previews differ. `source` says whether the
 * page or the browser wrote it.
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
  source: Source,
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
 * **Details**
 *
 * An operation returns only after the events the browser sent before answering it have been handled, so the
 * messages an evaluation logged are here once it returns, unless the log has since dropped them for newer ones.
 * The exception is a target whose state is still being read, as when it has just attached or its events
 * overflowed: its events reach the log once that read completes.
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

/**
 * A console message with handles to the values the page passed the console.
 *
 * **Details**
 *
 * The handles belong to the subscription that delivered the call: they end with its scope, or earlier with each
 * handle's `release`. Two subscriptions that receive the same call each get their own handles, and one releasing its
 * handles leaves the other's working. `args` is empty for a message the browser wrote itself.
 *
 * **Example** (Counting the arguments of a page's warnings)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const argumentCount = (call: ConsoleMessage.Call) => call.args.length
 *
 * const nextWarning = Effect.fn("nextWarning")(function*(page: Page.Page) {
 *   const warned = yield* ConsoleMessage.nextCall(page, { level: "warning" })
 *   return argumentCount(yield* warned)
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Call {
  /** The message, as `next` and `stream` give it. */
  readonly message: ConsoleMessage
  /** The values passed to the console, in order. */
  readonly args: ReadonlyArray<JSHandle.JSHandle>
}

/**
 * Subscribes to console calls, each message with handles to its arguments, and returns the wait: an effect that
 * gives the first match, the same each time it runs.
 *
 * **When to use**
 *
 * Use when a test reads the values a page logged, not only their text. A page or context keeps console arguments
 * only while it has a subscription to calls; `next` and `stream` keep none.
 *
 * **Gotchas**
 *
 * - The arguments are what the browser reports, which differs from what the page passed when the first argument is
 *   a format string: Chromium sends a `%s` argument as the string it formats to, and Firefox sends what it made of
 *   the format. The `console.arguments` capability says how each backend's arguments are held.
 * - Messages logged before the subscription have no arguments.
 *
 * **Example** (Reading the object a page logged)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loggedUser = Effect.fn("loggedUser")(function*(page: Page.Page) {
 *   const logged = yield* ConsoleMessage.nextCall(page, { text: "user" })
 *   yield* page.evaluateInMainWorld(() => console.log("user", { name: "Ada" }))
 *   const call = yield* logged
 *   return yield* call.args[1]!.read
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const nextCall: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
) => Effect.Effect<
  Effect.Effect<Call, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> = ConsoleMessageImpl.nextCall

/**
 * Subscribes to console calls and emits every match from now on, each message with handles to its arguments.
 *
 * **Gotchas**
 *
 * - The arguments are what the browser reports, which differs from what the page passed when the first argument is
 *   a format string: Chromium sends a `%s` argument as the string it formats to, and Firefox sends what it made of
 *   the format. The `console.arguments` capability says how each backend's arguments are held.
 * - Every call's handles last until the subscription's scope closes, so release the ones a long stream is done with.
 *
 * **Example** (Collecting the objects a page logs)
 *
 * ```ts import.meta.vitest
 * import { ConsoleMessage, Page } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const loggedValues = Effect.fn("loggedValues")(function*(page: Page.Page) {
 *   const calls = yield* ConsoleMessage.streamCalls(page)
 *   return yield* calls.pipe(
 *     Stream.take(3),
 *     Stream.mapEffect((call) => Effect.forEach(call.args, (arg) => arg.read)),
 *     Stream.runCollect
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const streamCalls: <PE = never, PR = never>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: Filter | undefined,
  where?: Subscription.Where<ConsoleMessage, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<Call, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> = ConsoleMessageImpl.streamCalls
