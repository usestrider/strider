/**
 * The dialogs a page opens: `alert`, `confirm`, `prompt` and `beforeunload`.
 *
 * A dialog blocks its page until something decides it. `next`, `stream` and `history` report a `Dialog`, which is
 * data; `handle` registers a scoped handler that decides each one, given as `Pending` with only the decisions valid
 * for its kind. A dialog no handler decides is decided by the context's policy (`UserContext.Options.dialogs`) and
 * reported as an `AutoResolution`. On WebKit every dialog is `Unknown`, because WebKit doesn't say which kind is
 * open (`prompts.kind`).
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import type * as Deadline from "./Deadline.ts"
import * as Declaration from "./Declaration.ts"
import * as Access from "./internal/access.ts"
import type * as Adapter from "./internal/adapter.ts"
import * as Events from "./internal/events.ts"
import * as Filters from "./internal/filters.ts"
import * as Handlers from "./internal/handlers.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Operation from "./internal/operation.ts"
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
 * How a dialog is answered: one of a `Pending` dialog's decisions, which a handler returns.
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
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Pending =
  | Extract<Dialog, { readonly _tag: "Alert" }> & { readonly accept: Decision }
  | Extract<Dialog, { readonly _tag: "Confirm" }> & { readonly accept: Decision; readonly dismiss: Decision }
  | Extract<Dialog, { readonly _tag: "Prompt" }> & {
    readonly accept: Decision
    respond(text: string): Decision
    readonly dismiss: Decision
  }
  | Extract<Dialog, { readonly _tag: "BeforeUnload" }> & { readonly leave: Decision; readonly stay: Decision }
  | Extract<Dialog, { readonly _tag: "Unknown" }> & {
    readonly accept: Decision
    respond(text: string): Decision
    readonly dismiss: Decision
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

// ── Implementation ──

/** A decision, carrying what the adapter sends. */
interface DecisionImpl extends Decision {
  readonly decision: Adapter.Decision
}

const decision = (decision: Adapter.Decision): Decision => {
  const made: DecisionImpl = { [DecisionTypeId]: DecisionTypeId, decision }
  return made
}

const accepted = decision({ _tag: "Accept", promptText: Option.none() })
const dismissed = decision({ _tag: "Dismiss" })

const kinds: Record<Model.PromptEvent["kind"], Kind> = {
  alert: "Alert",
  confirm: "Confirm",
  prompt: "Prompt",
  beforeunload: "BeforeUnload",
  unknown: "Unknown"
}

const toDialog = (prompt: Model.PromptEvent): Dialog => {
  const id = prompt.prompt
  switch (prompt.kind) {
    case "alert":
      return { _tag: "Alert", id, message: prompt.message }
    case "confirm":
      return { _tag: "Confirm", id, message: prompt.message }
    case "prompt":
      return { _tag: "Prompt", id, message: prompt.message, defaultValue: prompt.defaultValue }
    case "beforeunload":
      return { _tag: "BeforeUnload", id }
    case "unknown":
      return { _tag: "Unknown", id, message: prompt.message }
  }
}

const toPending = (prompt: Model.PromptEvent): Pending => {
  const dialog = toDialog(prompt)
  switch (dialog._tag) {
    case "Alert":
      return { ...dialog, accept: accepted }
    case "Confirm":
      return { ...dialog, accept: accepted, dismiss: dismissed }
    case "Prompt":
      return {
        ...dialog,
        accept: accepted,
        respond: (text) => decision({ _tag: "Accept", promptText: Option.some(text) }),
        dismiss: dismissed
      }
    case "BeforeUnload":
      return { ...dialog, leave: accepted, stay: dismissed }
    case "Unknown":
      return {
        ...dialog,
        accept: accepted,
        respond: (text) => decision({ _tag: "Accept", promptText: Option.some(text) }),
        dismiss: dismissed
      }
  }
}

const accepts = (filter: Filter | undefined) => {
  const wanted = filter?.kind === undefined ? undefined : new Set<Kind>(
    typeof filter.kind === "string" ? [filter.kind] : filter.kind
  )
  return (entry: Events.Entry<Model.PromptEvent>) => wanted === undefined || wanted.has(kinds[entry.value.kind])
}

// A backend that reports no dialogs, as attached stock WebKit's inspector doesn't, refuses to wait for one
const subscribe = <A, E, R>(
  target: Page.ObservedPage,
  operation: string,
  subscribe: (events: Events.Channel<Model.PromptEvent>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | Subscription.SubscriptionError, R> =>
  Effect.suspend(() => {
    const behind = Handles.page(target)
    return Filters.requires(behind.runtime, operation, "prompts").pipe(
      Effect.andThen(subscribe(behind.entry.events.dialog))
    )
  })

const kind = (operation: string): Events.Kind<Model.PromptEvent, Dialog> => ({
  operation,
  noun: "a dialog",
  deliver: toDialog
})

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
> =>
  subscribe(target, "Dialog.next", (events) => Events.next(kind("Dialog.next"), events, accepts(filter), where)).pipe(
    Operation.named("Dialog.next")
  )

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
> =>
  subscribe(target, "Dialog.stream", (events) => Events.stream(kind("Dialog.stream"), events, accepts(filter), where))

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
): Effect.Effect<Subscription.History<Dialog>, Subscription.SubscriptionError> =>
  subscribe(target, "Dialog.history", (events) => Events.history(kind("Dialog.history"), events, accepts(filter)))

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
 * is interrupted or runs out of time leaves the dialog to the context's policy, and its failure is logged at
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
 *         ? Effect.succeed(dialog.accept)
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
  Effect.suspend(() => {
    const { entry, grant, runtime } = Handles.page(page)
    return Access.check(grant).pipe(
      Effect.andThen(Handlers.requires(runtime, "Dialog.handle", "prompts")),
      Effect.andThen(Handlers.register({
        page: entry,
        add: (handler) => runtime.model.handlePrompts(entry, handler),
        handler,
        pending: toPending,
        decision: (chosen) =>
          isDecision(chosen) && "decision" in chosen
            ? Effect.succeed((chosen as DecisionImpl).decision)
            : Effect.die(new Error("Dialog.handle: the handler returned something that isn't a Dialog decision")),
        noun: (prompt) => prompt.kind,
        operation: "Dialog.handle.handled.waitFor",
        name: "Dialog.handle",
        fallback: "the context's policy"
      })),
      Effect.flatMap(Access.track(grant))
    )
  })

/**
 * A handler that accepts every dialog: accept for `Alert`, `Confirm`, `Prompt` (with its default value) and
 * `Unknown`, leave for `BeforeUnload`.
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
  Effect.succeed(dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept)

/**
 * A handler that declines every dialog: dismiss for `Confirm`, `Prompt` and `Unknown`, accept for `Alert` (its
 * only decision), stay for `BeforeUnload`.
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
  Effect.succeed(
    dialog._tag === "BeforeUnload" ? dialog.stay : dialog._tag === "Alert" ? dialog.accept : dialog.dismiss
  )
