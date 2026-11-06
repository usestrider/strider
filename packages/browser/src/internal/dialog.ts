/**
 * The dialogs a page opens (`Dialog`): the decisions a handler returns, the events, and the handler.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import type * as Declaration from "../Declaration.ts"
import type * as Dialog from "../Dialog.ts"
import type * as Page from "../Page.ts"
import type * as Target from "../Target.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as EventModule from "./eventModule.ts"
import type * as Events from "./events.ts"
import * as Filters from "./filters.ts"
import * as Handlers from "./handlers.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

const DecisionTypeId = "~@usestrider/browser/Dialog/Decision"

/** A decision, carrying what the adapter sends. */
interface DecisionImpl extends Dialog.Decision {
  readonly decision: Adapter.Decision
}

const decision = (decision: Adapter.Decision): Effect.Effect<Dialog.Decision> => {
  const made: DecisionImpl = { [DecisionTypeId]: DecisionTypeId, decision }
  return Effect.succeed(made)
}

const accepted = decision({ _tag: "Accept", promptText: Option.none() })
const dismissed = decision({ _tag: "Dismiss" })

const kinds: Record<Model.PromptEvent["kind"], Dialog.Kind> = {
  alert: "Alert",
  confirm: "Confirm",
  prompt: "Prompt",
  beforeunload: "BeforeUnload",
  unknown: "Unknown"
}

const toDialog = (prompt: Model.PromptEvent): Dialog.Dialog => {
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

const toPending = (prompt: Model.PromptEvent): Dialog.Pending => {
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

/** Whether a value is a dialog decision. */
export const isDecision = (u: unknown): u is Dialog.Decision => Predicate.hasProperty(u, DecisionTypeId)

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage,
  Dialog.Filter,
  Model.PromptEvent,
  Dialog.Dialog
>({
  name: "Dialog",
  noun: "a dialog",
  // A backend that reports no dialogs, as attached stock WebKit's inspector doesn't, refuses to wait for one
  prepare: (target, filter, operation) => {
    const behind = Handles.page(target)
    const wanted = filter?.kind === undefined ? undefined : new Set<Dialog.Kind>(
      typeof filter.kind === "string" ? [filter.kind] : filter.kind
    )
    return Filters.requires(behind.runtime, operation, "prompts").pipe(Effect.as({
      channel: behind.entry.events.dialog,
      accepts: (entry: Events.Entry<Model.PromptEvent>) => wanted === undefined || wanted.has(kinds[entry.value.kind]),
      deliver: toDialog
    }))
  }
})

export const handle = <E, R>(
  page: Page.Page,
  handler: (dialog: Dialog.Pending) => Effect.Effect<Dialog.Decision, E, R>
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
