/**
 * Dialogs: `alert`, `confirm`, `prompt` and `beforeunload`.
 *
 * A dialog blocks its page until something decides it. Events report and handlers decide: `next` and
 * `stream` only observe, and `handle` registers the scoped handler that answers. Each dialog shape offers
 * only the decisions valid for it, so a handler can't dismiss an alert. A dialog no handler claims is
 * decided by the context's policy (`UserContext.Options.dialogs`), and the decision is reported as an
 * `AutoResolution`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import type * as Declaration from "./Declaration.ts"
import type * as Deferred from "./Deferred.ts"
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
 * How a dialog is answered.
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
 * A dialog, offering the decisions valid for its kind.
 *
 * **Details**
 *
 * A `Prompt`'s `accept` answers with `defaultValue`; `respond(text)` answers with other text. A
 * `BeforeUnload` dialog asks whether to leave the page.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Dialog =
  | { readonly _tag: "Alert"; readonly message: string; readonly accept: Decision }
  | { readonly _tag: "Confirm"; readonly message: string; readonly accept: Decision; readonly dismiss: Decision }
  | {
    readonly _tag: "Prompt"
    readonly message: string
    readonly defaultValue: string
    readonly accept: Decision
    respond(text: string): Decision
    readonly dismiss: Decision
  }
  | { readonly _tag: "BeforeUnload"; readonly leave: Decision; readonly stay: Decision }

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
   * Match dialogs of these kinds.
   *
   * @default any kind
   */
  readonly kind?: Kind | ReadonlyArray<Kind> | undefined
}

/**
 * Subscribes to dialogs and returns the first match, latched. Observing doesn't decide it.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const next: <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<Dialog, PE, PR> | undefined
) => Effect.Effect<
  Deferred.ReadonlyDeferred<Dialog, PE | Target.TargetGone | Deadline.Timeout>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Subscribes to dialogs and emits every match from now on. Observing doesn't decide them.
 *
 * @stability unstable
 * @category subscriptions
 * @since 0.1.0
 */
export declare const stream: <PE = never, PR = never>(
  target: Page.ObservedPage,
  filter?: Filter | undefined,
  where?: Subscription.Where<Dialog, PE, PR> | undefined
) => Effect.Effect<
  Stream.Stream<Dialog, PE | Subscription.EventOverflow | Target.TargetGone>,
  Subscription.SubscriptionError,
  Scope.Scope | PR
>

/**
 * Reads the dialogs a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export declare const history: (
  target: Page.ObservedPage,
  filter?: Filter | undefined
) => Effect.Effect<Subscription.History<Dialog>>

/**
 * Registers a handler that decides the page's dialogs while its scope lives.
 *
 * **Gotchas**
 *
 * A dialog blocks its page, so register the handler before the action that opens one. A handler that fails
 * leaves the dialog to the context's policy.
 *
 * **Example** (Confirming a deletion)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Dialog, Page } from "@usestrider/browser"
 *
 * const deleteAccount = Effect.fn("deleteAccount")(function*(page: Page.Page) {
 *   yield* Dialog.handle(page, (dialog) =>
 *     dialog._tag === "Confirm" ? Effect.succeed(dialog.accept) : Dialog.dismissAll(dialog))
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
export declare const handle: <E, R>(
  page: Page.Page,
  handler: (dialog: Dialog) => Effect.Effect<Decision, E, R>
) => Effect.Effect<Declaration.HandlerRegistration, Declaration.DeclarationError, Scope.Scope | R>

/**
 * A handler that accepts every dialog: accept for `Alert`, `Confirm` and `Prompt` (with its default value),
 * leave for `BeforeUnload`.
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export declare const acceptAll: (dialog: Dialog) => Effect.Effect<Decision>

/**
 * A handler that declines every dialog: dismiss for `Confirm` and `Prompt`, accept for `Alert` (its only
 * decision), stay for `BeforeUnload`.
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export declare const dismissAll: (dialog: Dialog) => Effect.Effect<Decision>
