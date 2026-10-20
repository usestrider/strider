/**
 * Failure reasons that more than one module's error can carry.
 *
 * Every module has one error, and its detail lives in a `reason` (principle 10). Reasons that belong to one
 * module are declared there, such as `Locator.StrictViolation` or `Page.NavigationFailed`. The reasons in
 * this module are shared: a bad argument, missing access, an unsupported capability, a protocol failure, and
 * the two ways an evaluated function can fail. Match them with `Effect.catchReason`; each one carries a
 * one-line `hint` that its `message` includes.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import type * as Capability from "./Capability.ts"
import type * as JSHandle from "./JSHandle.ts"

/**
 * The fields every reason has, whichever module declares it.
 *
 * **Details**
 *
 * `hint` is the one-line fix shown in the rendered message, such as "call `.control` on this page".
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Reason {
  readonly _tag: string
  readonly hint: string
  readonly message: string
}

/**
 * Reason for an argument that can never succeed, such as a malformed selector or URL pattern.
 *
 * **Details**
 *
 * An invalid input fails at once, before anything is sent and without waiting for the deadline.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class InvalidInput extends Schema.Error<InvalidInput>("effect-browser/Reason/InvalidInput")({
  _tag: Schema.tag("InvalidInput"),
  input: Schema.String,
  expected: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Invalid ${this.input}: expected ${this.expected} (${this.hint})`
  }
}

/**
 * Reason for an operation that needs more access than the caller holds.
 *
 * **Details**
 *
 * Access is a grant held by a `Scope`, so the hint names the upgrade, such as `.inspect` or `.control`. The
 * types already rule out most of these; the rest come from grants that ended.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NotPermitted extends Schema.Error<NotPermitted>("effect-browser/Reason/NotPermitted")({
  _tag: Schema.tag("NotPermitted"),
  required: Schema.Literals(["inspect", "control", "browserWide"]),
  hint: Schema.String
}) {
  override get message(): string {
    return `Needs ${this.required} access (${this.hint})`
  }
}

/**
 * Reason for a capability the connected backend doesn't offer.
 *
 * **Details**
 *
 * The hint lists the backends that do support it, such as "supported on: chromium (CDP)". Nothing is
 * emulated in its place.
 *
 * @see {@link Capability.Capability} for features reached through a typed handle
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Unsupported extends Schema.Error<Unsupported>("effect-browser/Reason/Unsupported")({
  _tag: Schema.tag("Unsupported"),
  capability: Schema.String,
  backend: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `${this.capability} is unsupported on ${this.backend} (${this.hint})`
  }
}

/**
 * Backend-specific detail for a `BackendFailure`, keyed by backend name.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Metadata = Schema.Record(Schema.String, Schema.NullOr(Schema.MutableJson))

/**
 * Type of the backend-specific detail attached to a `BackendFailure`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Metadata = typeof Metadata.Type

/**
 * The detail each backend attaches to a `BackendFailure`, extended by module augmentation.
 *
 * **Details**
 *
 * A backend declares its key with `declare module`, so CDP error codes are typed where the Chromium backend
 * is imported, and the ergonomic layer never has to know them.
 *
 * @stability unstable
 * @category configuration
 * @since 0.1.0
 */
export interface BackendMetadata extends Metadata {}

/**
 * Reason for a protocol command the browser rejected, or answered in a shape the backend didn't expect.
 *
 * **Details**
 *
 * `method` is the protocol command, such as `Input.dispatchMouseEvent`. Backend detail, such as a CDP error
 * code, is in `metadata` under the backend's key.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BackendFailure extends Schema.Error<BackendFailure>("effect-browser/Reason/BackendFailure")({
  _tag: Schema.tag("BackendFailure"),
  kind: Schema.Literals(["Rejected", "IncompatibleResponse"]),
  method: Schema.String,
  metadata: Metadata as unknown as Schema.Codec<BackendMetadata, Metadata>,
  hint: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {
  override get message(): string {
    return `${this.method}: ${this.kind} (${this.hint})`
  }
}

/**
 * Reason for an evaluated function that threw, or returned a promise that rejected.
 *
 * **Gotchas**
 *
 * Functions are serialized and run in the page, so they must be self-contained. A `ReferenceError` for a
 * name from the surrounding module is the usual sign, and its hint says so.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class EvaluationThrown extends Schema.Error<EvaluationThrown>("effect-browser/Reason/EvaluationThrown")({
  _tag: Schema.tag("EvaluationThrown"),
  exception: Schema.Struct({
    name: Schema.String,
    message: Schema.String,
    stack: Schema.Option(Schema.String)
  }),
  hint: Schema.String
}) {
  override get message(): string {
    return `${this.exception.name}: ${this.exception.message} (${this.hint})`
  }
}

/**
 * Reason for an evaluation result that can't cross back by value.
 *
 * **Details**
 *
 * `path` locates the offending value inside the result, such as `$.items[3].element`. The types catch DOM
 * nodes and functions; this covers what only shows at run time, such as a cycle through a getter.
 *
 * @see {@link JSHandle.Serialized} for what does cross
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NotSerializable extends Schema.Error<NotSerializable>("effect-browser/Reason/NotSerializable")({
  _tag: Schema.tag("NotSerializable"),
  path: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Not serializable at ${this.path} (${this.hint})`
  }
}
