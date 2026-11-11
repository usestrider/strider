/**
 * Failure reasons that more than one module's error can carry.
 *
 * Every module has one error, and what went wrong is its `reason`. Reasons that belong to one module are declared
 * there, such as `Locator.StrictViolation` or `PageNavigation.NavigationFailed`. The ones here are shared: a bad
 * argument, missing access, a capability the backend lacks, a protocol failure, the two ways an evaluated
 * function can fail, and a dialog that blocks the page. Match them with `Effect.catchReason`; each carries a
 * one-line `hint`, which its `message` includes.
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
 * An invalid input fails at once, without waiting for the deadline.
 *
 * **Example** (Reporting a date the field refuses)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const setDeliveryDate = Effect.fn("setDeliveryDate")(
 *   function*(page: Page.Page, date: string) {
 *     yield* page.getByLabel("Delivery date").fill(date).pipe(
 *       Effect.catchReason(
 *         "LocatorError",
 *         "InvalidInput",
 *         (invalid) => Effect.logWarning(invalid.hint)
 *       )
 *     )
 *   }
 * )
 * ```
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
 * Access is a grant held by a `Scope`, and the hint names the call that gains it. The types rule out most of
 * these. Most others come from a page in a context Strider didn't create: its `page.context` refuses what needs
 * control until `page.context.control` gains it.
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
 * `capability` names what is missing, and the hint says why, such as which backends have it. Nothing is
 * emulated in its place.
 *
 * **Example** (Skipping dark mode where the browser can't emulate it)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const darkMode = Effect.fn("darkMode")(function*(page: Page.Page) {
 *   yield* page.emulate({ media: { colorScheme: "dark" } }).pipe(
 *     Effect.catchReason(
 *       "DeclarationError",
 *       "Unsupported",
 *       (unsupported) => Effect.logInfo(`No dark mode on ${unsupported.backend}`)
 *     )
 *   )
 * })
 * ```
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
 * Reason for a protocol command the browser rejected, or answered in a shape the backend didn't expect.
 *
 * **Details**
 *
 * `method` is the protocol command, such as `Input.dispatchMouseEvent`. A failure the browser reported carries
 * its `ProtocolError` as `cause`, with the browser's own code and message.
 *
 * **Example** (Logging the browser's own message)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Protocol } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const printInvoice = Effect.fn("printInvoice")(function*(page: Page.ReadonlyPage) {
 *   return yield* page.pdf().pipe(
 *     Effect.catchReason(
 *       "PageError",
 *       "BackendFailure",
 *       (failure, error) =>
 *         Effect.logError(
 *           Protocol.isProtocolError(failure.cause) ? failure.cause.message : failure.hint
 *         ).pipe(
 *           Effect.andThen(Effect.fail(error))
 *         )
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class BackendFailure extends Schema.Error<BackendFailure>("@usestrider/browser/Reason/BackendFailure")({
  _tag: Schema.tag("BackendFailure"),
  kind: Schema.Literals(["Rejected", "IncompatibleResponse"]),
  method: Schema.String,
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
 * **Example** (Treating unreadable saved state as none)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Option } from "effect"
 *
 * const savedCart = Effect.fn("savedCart")(function*(page: Page.ReadonlyPage) {
 *   const read = page.evaluate(() =>
 *     JSON.parse(localStorage.getItem("cart") ?? "") as { items: number }
 *   )
 *   return yield* read.pipe(
 *     Effect.map(Option.some),
 *     Effect.catchReason(
 *       "PageError",
 *       "EvaluationThrown",
 *       (thrown, error) =>
 *         thrown.exception.name === "SyntaxError"
 *           ? Effect.succeedNone
 *           : Effect.fail(error)
 *     )
 *   )
 * })
 * ```
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
 * A dialog pauses its page: the input that opened it waits for it, and on some backends so does every
 * evaluation. When a handler or the context's `dialogs` policy will decide the dialog, the operation waits within
 * its deadline. When nothing will (the policy is `"leaveOpen"` and no `Dialog.handle` was registered when it
 * opened), the operation fails at once with this reason. `text` is the dialog's message, empty for a
 * `beforeunload`.
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

/**
 * Reason for a viewport that did not match the requested CSS dimensions within the confirmation limit.
 *
 * **Details**
 *
 * Stock WebKit confirms dimensions immediately and on resize events for up to five seconds, capped by the
 * operation deadline. This records the last measurement; it does not establish permanent lack of support.
 * A failed-change rollback failure is reported separately and must not be treated as a restored viewport.
 * Ordinary scope release logs restoration failures without failing teardown; gone pages need no restoration.
 *
 * **Example** (Reading the measured size)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const resize = (page: Page.Page) =>
 *   page.emulate({ viewport: { width: 1440, height: 1000 } }).pipe(
 *     Effect.catchReason(
 *       "DeclarationError",
 *       "ViewportMismatch",
 *       (reason) => Effect.logWarning(reason.actual)
 *     )
 *   )
 * ```
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class ViewportMismatch extends Schema.Error<ViewportMismatch>("@usestrider/browser/Reason/ViewportMismatch")({
  _tag: Schema.tag("ViewportMismatch"),
  requested: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  actual: Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  hint: Schema.String
}) {
  override get message(): string {
    return `Viewport ${this.requested.width}x${this.requested.height} was not confirmed; measured ${this.actual.width}x${this.actual.height} (${this.hint})`
  }
}
