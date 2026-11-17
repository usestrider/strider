/**
 * Bindings: host functions a page's scripts call as `window[name](...)`.
 *
 * A binding is a declaration: it needs a `Scope`, and removing it, or closing its scope, deletes the function from
 * the documents that have it. Its arguments and result cross as JSON, decoded and encoded by the schemas it is
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
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Source = Schema.Struct({ page: Target.NavigableId, frame: Target.NavigableId })
/**
 * The page and frame whose document called a binding. The frame is the page itself for its top document.
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
 * `arguments` decodes the array of arguments the page passed, after they cross as JSON, so it is usually a
 * `Schema.Tuple`. `result` encodes the handler's value, which crosses back as JSON.
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Registration extends Declaration.Registration {}

/**
 * Failure to expose a name the page or its context already exposes.
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type BindingErrorReason = typeof BindingErrorReason.Type
const ErrorTypeId = "~@usestrider/browser/Binding/BindingError"

/**
 * Error for exposing a binding.
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
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isBindingError = (value: unknown): value is BindingError => Predicate.hasProperty(value, ErrorTypeId)
