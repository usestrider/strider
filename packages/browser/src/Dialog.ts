/**
 * Dialogs: `alert`, `confirm`, `prompt` and `beforeunload`.
 *
 * A dialog blocks its page until something decides it. Events report and handlers decide: `next`, `stream`
 * and `history` report a `Dialog`, which is data, and `handle` registers the scoped handler that answers a
 * `Pending` dialog, which adds the decisions valid for its kind, so a handler can't dismiss an alert. A
 * dialog no handler decides is decided by the context's policy (`UserContext.Options.dialogs`), and the
 * decision is reported as an `AutoResolution`.
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
import * as Handlers from "./internal/handlers.ts"
import * as Handles from "./internal/handles.ts"
import type * as Model from "./internal/model.ts"
import * as Spans from "./internal/spans.ts"
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
  Schema.TaggedStruct("BeforeUnload", { id: PromptId })
])

/**
 * A dialog, as events report it.
 *
 * **Details**
 *
 * It is data, so a dialog's history encodes like other data events'. `id` is the `PromptId` that
 * `Page.Status` shows while the dialog is open. Observing a dialog doesn't decide it; a handler does, and
 * receives it as a `Pending` dialog.
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
 * A `Prompt`'s `accept` answers with `defaultValue`; `respond(text)` answers with other text. A
 * `BeforeUnload` dialog asks whether to leave the page.
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
  beforeunload: "BeforeUnload"
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
  }
}

const accepts = (filter: Filter | undefined) => {
  const wanted = filter?.kind === undefined ? undefined : new Set<Kind>(
    typeof filter.kind === "string" ? [filter.kind] : filter.kind
  )
  return (entry: Events.Entry<Model.PromptEvent>) => wanted === undefined || wanted.has(kinds[entry.value.kind])
}

const kind = (operation: string): Events.Kind<Model.PromptEvent, Dialog> => ({
  operation,
  noun: "a dialog",
  deliver: toDialog
})

/**
 * Subscribes to dialogs and returns the first match, latched. Observing doesn't decide it.
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
  Effect.suspend(() =>
    Events.next(kind("Dialog.next"), Handles.page(target).entry.events.dialog, accepts(filter), where)
  ).pipe(Spans.operation("Dialog.next"))

/**
 * Subscribes to dialogs and emits every match from now on. Observing doesn't decide them.
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
  Effect.suspend(() =>
    Events.stream(kind("Dialog.stream"), Handles.page(target).entry.events.dialog, accepts(filter), where)
  )

/**
 * Reads the dialogs a page's log retained; never waits.
 *
 * @stability unstable
 * @category getters
 * @since 0.1.0
 */
export const history = (
  target: Page.ObservedPage,
  filter?: Filter | undefined
): Effect.Effect<Subscription.History<Dialog>, Subscription.SubscriptionError> =>
  Effect.suspend(() =>
    Events.history(kind("Dialog.history"), Handles.page(target).entry.events.dialog, accepts(filter))
  )

/**
 * Registers a handler that decides the page's dialogs while its scope lives.
 *
 * **Details**
 *
 * The page's latest handler decides each dialog, chosen when the dialog opens; removing it, or closing its
 * scope, leaves the dialogs that open after to the one before. A handler has `Deadline.DefaultBudget`, as it
 * is when `handle` is called, to decide each dialog. `handled` counts the dialogs it decided.
 *
 * **Gotchas**
 *
 * A dialog blocks its page, so register the handler before the action that opens one. A handler that fails,
 * is interrupted or runs out of time leaves the dialog to the context's policy, and its failure is logged at
 * Effect's `References.UnhandledLogLevel`.
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
export const handle = <E, R>(
  page: Page.Page,
  handler: (dialog: Pending) => Effect.Effect<Decision, E, R>
): Effect.Effect<Declaration.HandlerRegistration, Target.TargetGone, Scope.Scope | R> =>
  Effect.suspend(() => {
    const { entry, grant } = Handles.page(page)
    return Access.check(grant).pipe(
      Effect.andThen(Handlers.register({
        page: entry,
        handlers: entry.promptHandlers,
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
 * A handler that accepts every dialog: accept for `Alert`, `Confirm` and `Prompt` (with its default value),
 * leave for `BeforeUnload`.
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const acceptAll = (dialog: Pending): Effect.Effect<Decision> =>
  Effect.succeed(dialog._tag === "BeforeUnload" ? dialog.leave : dialog.accept)

/**
 * A handler that declines every dialog: dismiss for `Confirm` and `Prompt`, accept for `Alert` (its only
 * decision), stay for `BeforeUnload`.
 *
 * @stability unstable
 * @category handlers
 * @since 0.1.0
 */
export const dismissAll = (dialog: Pending): Effect.Effect<Decision> =>
  Effect.succeed(
    dialog._tag === "BeforeUnload" ? dialog.stay : dialog._tag === "Alert" ? dialog.accept : dialog.dismiss
  )
