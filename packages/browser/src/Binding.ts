/**
 * Bindings: host functions a page's scripts call as `window[name](...)`.
 *
 * A binding is a declaration: it needs a `Scope`, and removing it, or closing its scope, deletes the function from
 * the documents that have it. Its arguments and result cross by value, as `evaluateInMainWorld`'s do, decoded and encoded by the schemas it is
 * registered with, and its handler is told which page and frame called it.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Declaration from "./Declaration.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import * as Target from "./Target.ts"

/**
 * Schema for the caller of a binding: the page and the frame whose document called it.
 *
 * **Example** (Logging which frame called)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const logCaller = Effect.fn("logCaller")(function*(page: Page.Page) {
 *   yield* page.exposeBinding(
 *     "ping",
 *     { arguments: Schema.Tuple([]), result: Schema.Boolean },
 *     (_, source: Binding.Source) =>
 *       Effect.log(Schema.encodeSync(Binding.Source)(source)).pipe(Effect.as(true))
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Source = Schema.Struct({ page: Target.NavigableId, frame: Target.NavigableId })
/**
 * The page and frame whose document called a binding. The frame is the page itself for its top document.
 *
 * **Example** (Reading the frame from a caller)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const isTopDocument = (source: Binding.Source) => source.frame === source.page
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Source = typeof Source.Type

/**
 * The schemas a binding decodes its arguments with and encodes its result with.
 *
 * **Details**
 *
 * `arguments` decodes the array of arguments the page passed, after they cross by value, so it is usually a
 * `Schema.Tuple`. `result` encodes the handler's value, which crosses back the same way. A value that can't cross rejects the call.
 *
 * **Example** (Schemas for two numbers and their sum)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const sum: Binding.Schemas<readonly [number, number], number> = {
 *   arguments: Schema.Tuple([Schema.Number, Schema.Number]),
 *   result: Schema.Number
 * }
 *
 * const exposeSum = Effect.fn("exposeSum")(function*(page: Page.Page) {
 *   yield* page.exposeBinding("sum", sum, ([a, b]) => Effect.succeed(a + b))
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Schemas<A extends ReadonlyArray<unknown>, B> {
  readonly arguments: Schema.Codec<A, unknown>
  readonly result: Schema.Codec<B, unknown>
}

/**
 * The function that answers a binding's calls, with the decoded arguments and the caller.
 *
 * **Details**
 *
 * The value it succeeds with resolves the page's promise. A failure rejects it with an `Error` carrying the
 * failure's message; a defect or an interruption rejects it with a fixed message and is logged.
 *
 * **Example** (A handler shared by two pages)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const greet: Binding.Handler<readonly [string], string, never, never> = ([who]) =>
 *   Effect.succeed(`Hello, ${who}`)
 *
 * const exposeGreeting = Effect.fn("exposeGreeting")(function*(page: Page.Page) {
 *   yield* page.exposeBinding(
 *     "greet",
 *     { arguments: Schema.Tuple([Schema.String]), result: Schema.String },
 *     greet
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Handler<A extends ReadonlyArray<unknown>, B, E, R> = (
  args: A,
  source: Source
) => Effect.Effect<B, E, R>

/**
 * The handle a binding returns; `remove` deletes the function from the documents that have it and rejects the
 * calls still waiting for their answer.
 *
 * **Example** (Removing a binding early)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const exposeOnce = Effect.fn("exposeOnce")(function*(page: Page.Page) {
 *   const binding: Binding.Registration = yield* page.exposeBinding(
 *     "token",
 *     { arguments: Schema.Tuple([]), result: Schema.String },
 *     () => Effect.succeed("abc123")
 *   )
 *   yield* binding.remove
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration extends Declaration.Registration {}

/**
 * Failure to expose a name the page or its context already exposes.
 *
 * **Example** (Telling a taken name apart)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const isTaken = (error: Binding.BindingError) =>
 *   error.reason instanceof Binding.NameTaken
 * ```
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NameTaken extends Schema.Error<NameTaken>("@usestrider/browser/Binding/NameTaken")({
  _tag: Schema.tag("NameTaken"),
  name: Schema.String,
  by: Schema.Literals(["page", "context"])
}) {
  override get message(): string {
    return `"${this.name}" is already exposed on the ${this.by}`
  }
}

/**
 * Schema for a binding's failure.
 *
 * **Example** (Decoding a reason)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const describe = (reason: Binding.BindingErrorReason) =>
 *   Schema.is(Binding.NameTaken)(reason) ? `taken by the ${reason.by}` : reason.message
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const BindingErrorReason = Schema.Union([
  NameTaken,
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])
/**
 * The reasons exposing a binding can fail.
 *
 * **Example** (Naming the reason)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const reasonTag = (reason: Binding.BindingErrorReason): string => reason._tag
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BindingErrorReason = typeof BindingErrorReason.Type
const ErrorTypeId = "~@usestrider/browser/Binding/BindingError"

/**
 * Error for exposing a binding.
 *
 * **Example** (Recovering from a taken name)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const exposeOrKeep = Effect.fn("exposeOrKeep")(function*(page: Page.Page) {
 *   yield* page.exposeBinding(
 *     "now",
 *     { arguments: Schema.Tuple([]), result: Schema.Number },
 *     () => Effect.succeed(Date.now())
 *   ).pipe(
 *     Effect.catchTag(
 *       "BindingError",
 *       (error) => error.reason._tag === "NameTaken" ? Effect.void : Effect.fail(error)
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class BindingError extends Schema.TaggedError<BindingError>("@usestrider/browser/Binding/BindingError")(
  "BindingError",
  { name: Schema.String, reason: BindingErrorReason, diagnostics: Diagnostics.Diagnostics }
) {
  readonly [ErrorTypeId] = ErrorTypeId
  override get message(): string {
    return this.reason.message
  }
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
  }
}
/**
 * Checks whether a value is a binding error.
 *
 * **Example** (Checking an unknown failure)
 *
 * ```ts import.meta.vitest
 * import { Binding, Page } from "@usestrider/browser"
 * import { Effect, Schema } from "effect"
 *
 * const nameOf = (failure: unknown) =>
 *   Binding.isBindingError(failure) ? failure.name : undefined
 * ```
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBindingError = (value: unknown): value is BindingError => Predicate.hasProperty(value, ErrorTypeId)
