/**
 * Failure reasons that more than one module's error can carry.
 *
 * Every module has one error, and what went wrong is its `reason`. Reasons that belong to one module are declared
 * there, such as `Locator.StrictViolation` or `PageNavigation.NavigationFailed`. The ones here are shared: a bad
 * argument, missing access, a capability the backend lacks, a protocol failure and the two ways an evaluated
 * function can fail. Match them with `Effect.catchReason`; each carries a one-line `hint`, which its `message`
 * includes.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
// oxlint-disable-next-line no-unused-vars -- resolves a {@link} in the JSDoc
import type * as Capability from "./Capability.ts"
// oxlint-disable-next-line no-unused-vars -- resolves a {@link} in the JSDoc
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
export class InvalidInput extends Schema.Error<InvalidInput>("@usestrider/browser/Reason/InvalidInput")({
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
export class NotPermitted extends Schema.Error<NotPermitted>("@usestrider/browser/Reason/NotPermitted")({
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
 * The hint says what is missing, such as which backends do have the capability. Nothing is emulated in its
 * place.
 *
 * @see {@link Capability.Capability} for features reached through a typed handle
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Unsupported extends Schema.Error<Unsupported>("@usestrider/browser/Reason/Unsupported")({
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
 * is imported, and the modules every backend shares never have to know them. Its keys are optional, and its index
 * admits `undefined`, so the declarations type-check with `exactOptionalPropertyTypes` on or off.
 *
 * @stability unstable
 * @category configuration
 * @since 0.1.0
 */
export interface BackendMetadata {
  readonly [key: string]: Metadata[string] | undefined
}

/**
 * Reason for a protocol command the browser rejected, or answered in a shape the backend didn't expect.
 *
 * **Details**
 *
 * `method` is the protocol command, such as `Input.dispatchMouseEvent`. A failure the browser reported carries
 * its `ProtocolError` as `cause`, with the browser's own code and message. `metadata` is where a backend can add
 * detail under its own key; none does yet, so it's empty.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BackendFailure extends Schema.Error<BackendFailure>("@usestrider/browser/Reason/BackendFailure")({
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
export class EvaluationThrown extends Schema.Error<EvaluationThrown>("@usestrider/browser/Reason/EvaluationThrown")({
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
 * Reason for an evaluation's argument or result that can't cross by value.
 *
 * **Details**
 *
 * `path` locates the offending value, such as `args[0]` or `result.items[3].element`. The types catch DOM nodes
 * in a result; this covers what only shows at run time, such as an argument that refers to itself or a handle
 * from another realm.
 *
 * @see {@link JSHandle.Serialized} for what does cross
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class NotSerializable extends Schema.Error<NotSerializable>("@usestrider/browser/Reason/NotSerializable")({
  _tag: Schema.tag("NotSerializable"),
  path: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `Not serializable at ${this.path} (${this.hint})`
  }
}

/**
 * Reason for an operation on a page that a dialog blocks, when nothing will decide the dialog.
 *
 * **Details**
 *
 * A dialog pauses its page: on some backends every evaluation waits for it, and on all of them the input that
 * opened it does. When a handler or the context's `dialogs` policy will decide the dialog, the operation waits
 * for it within its deadline. This reason is for a dialog nothing will decide: the context's policy is
 * `"leaveOpen"` and no `Dialog.handle` was registered when it opened, so the operation fails at once rather than
 * at its deadline. `text` is the dialog's message, empty for a `beforeunload`.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class PromptBlocking extends Schema.Error<PromptBlocking>("@usestrider/browser/Reason/PromptBlocking")({
  _tag: Schema.tag("PromptBlocking"),
  kind: Schema.Literals(["alert", "confirm", "prompt", "beforeunload", "unknown"]),
  text: Schema.String,
  hint: Schema.String
}) {
  override get message(): string {
    return `An open ${this.kind}${this.text === "" ? "" : ` "${this.text}"`} blocks the page (${this.hint})`
  }
}
