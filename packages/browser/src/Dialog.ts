/**
 * The dialogs a page opens: `alert`, `confirm`, `prompt`, and `beforeunload`.
 *
 * A dialog blocks its page until something decides it. `next`, `stream`, and `history` report a `Dialog`, which is
 * data; `handle` registers a scoped handler that decides each one, given as `Pending` with only the decisions valid
 * for its kind. A dialog no handler decides is decided by the context's policy (`UserContext.Options.dialogs`) and
 * reported as an `AutoResolution`. On WebKit every dialog is `Unknown`, because WebKit doesn't say which kind is
 * open (`prompts.kind`).
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Declaration from "./Declaration.ts"
import * as DialogImpl from "./internal/dialog.ts"
import type * as Page from "./Page.ts"
import type * as Subscription from "./Subscription.ts"
import type * as Target from "./Target.ts"

/**
 * Schema for the id of a user prompt, shared with `Page.Status`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PromptId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Dialog/PromptId"))

/**
 * Id of a user prompt.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PromptId = typeof PromptId.Type

const DecisionTypeId = "~@usestrider/browser/Dialog/Decision"

/**
 * How a dialog is answered: the value produced by the Effect a handler returns.
 *
 * **Details**
 *
 * A `Pending` dialog offers Effects that produce these decisions. Return one directly from a handler,
 * or use `return yield*` after other work in a generator.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Decision {
  readonly [DecisionTypeId]: typeof DecisionTypeId
}

/**
 * Checks whether a value is a dialog `Decision`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isDecision = (u: unknown): u is Decision => Predicate.hasProperty(u, DecisionTypeId)

/**
 * Schema for a dialog, as events report it: which kind, what it says, and its `PromptId`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Dialog = Schema.Union([
  Schema.TaggedStruct("Alert", { id: PromptId, message: Schema.String }),
  Schema.TaggedStruct("Confirm", { id: PromptId, message: Schema.String }),
  Schema.TaggedStruct("Prompt", { id: PromptId, message: Schema.String, defaultValue: Schema.String }),
  Schema.TaggedStruct("BeforeUnload", { id: PromptId }),
  Schema.TaggedStruct("Unknown", { id: PromptId, message: Schema.String })
])

/**
 * A dialog, as events report it.
 *
 * **Details**
 *
 * It is data, so a history of dialogs can be encoded with `Subscription.History`. `id` is the `PromptId` that
 * `Page.Status` shows while the dialog is open. `Unknown` is a dialog whose kind the browser doesn't report, as
 * WebKit doesn't. Seeing a dialog doesn't decide it; a handler does, and receives it as a `Pending` dialog.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Dialog = typeof Dialog.Type

/**
 * A dialog a handler is asked to decide, offering the decisions valid for its kind.
 *
 * **Details**
 *
 * - `Prompt`: `accept` answers with `defaultValue`, and `respond(text)` with other text.
 * - `BeforeUnload`: asks whether to `leave` the page or `stay` on it.
 * - `Unknown`: a dialog whose kind the browser doesn't report, as WebKit doesn't. `accept` answers as its OK
 *   button would, a prompt with its default value; `dismiss` as its Cancel button. `respond(text)` answers a
 *   prompt with `text`; any other dialog refuses it, and the context's `dialogs` policy decides, as when a handler
 *   fails.
 *
 * Each decision is an Effect: return it directly from a handler, or use `return yield*` after other work in a
 * generator. Its result is the decision the handler machinery sends to the browser.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Pending =
  | Extract<Dialog, { readonly _tag: "Alert" }> & { readonly accept: Effect.Effect<Decision> }
  | Extract<Dialog, { readonly _tag: "Confirm" }> & {
    readonly accept: Effect.Effect<Decision>
    readonly dismiss: Effect.Effect<Decision>
  }
  | Extract<Dialog, { readonly _tag: "Prompt" }> & {
    readonly accept: Effect.Effect<Decision>
    respond(text: string): Effect.Effect<Decision>
    readonly dismiss: Effect.Effect<Decision>
  }
  | Extract<Dialog, { readonly _tag: "BeforeUnload" }> & {
    readonly leave: Effect.Effect<Decision>
    readonly stay: Effect.Effect<Decision>
  }
  | Extract<Dialog, { readonly _tag: "Unknown" }> & {
    readonly accept: Effect.Effect<Decision>
    respond(text: string): Effect.Effect<Decision>
    readonly dismiss: Effect.Effect<Decision>
  }

/**
 * Which kind of dialog.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Kind = Dialog["_tag"]

/**
 * Which dialogs to match.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Filter {
  /**
   * Match dialogs of these kinds. On WebKit every dialog is `Unknown`.
   *
   * @default any kind
   */
  readonly kind?: Kind | ReadonlyArray<Kind> | undefined
}

/**
 * Subscribes to dialogs and returns the wait: an effect that gives the first match, the same each time it runs.
 * Waiting for a dialog doesn't decide it.
 *
 * **Gotchas**
 *
 * On a backend without the `prompts` capability, such as attached WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Reading the alert a form shows)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const submitEmpty = Effect.fn("submitEmpty")(function*(page: Page.Page) {
 *   const alerts = yield* Dialog.next(page, { kind: "Alert" })
 *   yield* page.getByRole("button", { name: "Sign in" }).click()
 *   const alert = yield* alerts
 *   return alert._tag === "Alert" ? alert.message : undefined
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const next = <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<Dialog, PE, PR> | undefined
): Effect.Effect<
  Effect.Effect<Dialog, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => DialogImpl.next(target, filter, where)

/**
 * Subscribes to dialogs and emits every match from now on. Seeing a dialog doesn't decide it.
 *
 * **Gotchas**
 *
 * On a backend without the `prompts` capability, such as attached WebKit, it fails at once with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (Logging every dialog)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page } from "@usestrider/browser"
 * import { Effect, Stream } from "effect"
 *
 * const logDialogs = Effect.fn("logDialogs")(function*(page: Page.ObservedPage) {
 *   const dialogs = yield* Dialog.stream(page)
 *   yield* dialogs.pipe(
 *     Stream.runForEach((dialog) => Effect.log(`${dialog._tag} dialog`)),
 *     Effect.forkScoped
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export const stream = <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<Dialog, PE, PR> | undefined
): Effect.Effect<
  Stream.Stream<Dialog, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
> => DialogImpl.stream(target, filter, where)

/**
 * Reads the dialogs still in the page's event log; never waits.
 *
 * **Gotchas**
 *
 * On a backend without the `prompts` capability, such as attached WebKit, it fails with `SubscriptionError`,
 * reason `Unsupported`.
 *
 * **Example** (The messages of the dialogs so far)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const dialogMessages = Effect.fn("dialogMessages")(function*(page: Page.ObservedPage) {
 *   const dialogs = yield* Dialog.history(page)
 *   return dialogs.entries.flatMap((dialog) =>
 *     dialog._tag === "BeforeUnload" ? [] : [dialog.message]
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<Dialog>, Subscription.SubscriptionError> => DialogImpl.history(target, filter)

/**
 * Registers a handler that decides the page's dialogs while its scope lives.
 *
 * **Details**
 *
 * Each dialog goes to the page's most recent handler at the moment the dialog opens. Removing a handler, or
 * closing its scope, leaves later dialogs to the handler registered before it. A handler has
 * `Deadline.DefaultBudget`, read when `handle` is called, to decide each dialog. `handled` counts the dialogs it
 * has decided.
 *
 * **Gotchas**
 *
 * A dialog blocks its page, so register the handler before the action that opens one. A handler that fails,
 * is interrupted, or runs out of time leaves the dialog to the context's policy, and its failure is logged at
 * Effect's `References.UnhandledLogLevel`. On a backend without the `prompts` capability, such as attached WebKit,
 * it fails at once with `DeclarationError`, reason `Unsupported`: no dialog would reach the handler.
 *
 * **Example** (Confirming a deletion)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const deleteAccount = Effect.fn("deleteAccount")(function*(page: Page.Page) {
 *   yield* Dialog.handle(
 *     page,
 *     (dialog) =>
 *       dialog._tag === "Confirm"
 *         ? dialog.accept
 *         : Dialog.dismissAll(dialog)
 *   )
 *   yield* page.getByRole("button", { name: "Delete account" }).click()
 * })
 * ```
 *
 * @see {@link acceptAll}
 * @see {@link dismissAll}
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const handle = <E, R>(
  page: Page.Page,
  handler: (dialog: Pending) => Effect.Effect<Decision, E, R>
): Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError | Target.TargetGone, Scope.Scope | R> =>
  DialogImpl.handle(page, handler)

/**
 * A handler that accepts every dialog: accept for `Alert`, `Confirm`, `Prompt` (with its default value), and
 * `Unknown`; leave for `BeforeUnload`.
 *
 * **Example** (Confirming a bulk delete)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const clearCart = Effect.fn("clearCart")(function*(page: Page.Page) {
 *   yield* Dialog.handle(page, Dialog.acceptAll)
 *   yield* page.getByRole("button", { name: "Remove all items" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const acceptAll = (dialog: Pending): Effect.Effect<Decision> =>
  dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept

/**
 * A handler that declines every dialog: dismiss for `Confirm`, `Prompt`, and `Unknown`; accept for `Alert` (its
 * only decision); stay for `BeforeUnload`.
 *
 * **Example** (Staying on a page with unsaved changes)
 *
 * ```ts import.meta.vitest
 * import { Dialog, Expect, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const keepDraft = Effect.fn("keepDraft")(function*(page: Page.Page) {
 *   yield* Dialog.handle(page, Dialog.dismissAll)
 *   yield* page.getByRole("link", { name: "Home" }).click()
 *   yield* page.getByRole("textbox", { name: "Draft" }).pipe(Expect.toBeVisible)
 * })
 * ```
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const dismissAll = (dialog: Pending): Effect.Effect<Decision> =>
  dialog._tag === "BeforeUnload" ? dialog.stay : dialog._tag === "Alert" ? dialog.accept : dialog.dismiss
