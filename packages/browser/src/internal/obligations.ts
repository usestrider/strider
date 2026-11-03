/**
 * Deciding obligations (CONCEPTS.md §5): a dialog, a file chooser or a paused request, apart from the fold and from
 * any handler's fiber. The fold chooses who decides as it folds the obligation's opening, in order with the
 * registrations before it: the page's latest handler, or a request's routes, and the context's policy. A decider in
 * the model's scope asks them, delivers the decision through the adapter, and has the fold publish what it decided.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as References from "effect/References"
import * as Diagnostics from "../Diagnostics.ts"
import * as Adapter from "./adapter.ts"
import type * as Fold from "./fold.ts"
import * as Handoff from "./handoff.ts"
import type * as Model from "./model.ts"
import * as Spans from "./spans.ts"

/** An obligation that opened, with who decides it, as the fold chose when it opened. */
export type Obligation =
  | {
    readonly _tag: "Prompt"
    readonly obligation: Adapter.ObligationId
    readonly prompt: Model.PromptEvent
    readonly page: Option.Option<Model.PageEntry>
    /** The page's latest `Dialog.handle`. */
    readonly handler: Option.Option<Model.Handler<Model.PromptEvent>>
    readonly context: Option.Option<Model.ContextEntry>
    /** What decides when no handler does: the context's `dialogs` policy, if it has one. */
    readonly policy: Option.Option<Model.DialogPolicy>
  }
  | {
    readonly _tag: "FileChooser"
    readonly obligation: Adapter.ObligationId
    readonly chooser: Model.FileChooserEvent
    readonly page: Option.Option<Model.PageEntry>
    /** The page's latest `FileChooser.handle`. */
    readonly handler: Option.Option<Model.Handler<Model.FileChooserEvent>>
    readonly context: Option.Option<Model.ContextEntry>
    /** Whether the library created the context, so a chooser no handler answers is canceled. */
    readonly owned: boolean
  }
  | {
    readonly _tag: "PausedRequest"
    readonly obligation: Adapter.ObligationId
    readonly paused: Model.PausedRequestEvent
    readonly owner: Model.Owner
    /** The routes that match it, in the order they are asked: the page's, then the context's, the most recent first. */
    readonly routes: ReadonlyArray<Model.RouteEntry>
  }

/**
 * Decides each obligation the fold hands over, each in a fiber of its own in the model's scope, once the model has
 * its adapter.
 */
export const run = (options: {
  readonly fold: Fold.Fold
  readonly connected: Deferred.Deferred<Adapter.AdapterConnection>
}): Effect.Effect<never, never, never> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const { fold } = options
    return yield* Effect.forever(
      Effect.flatMap(Queue.take(fold.obligations), (obligation) =>
        Effect.flatMap(Deferred.await(options.connected), (adapter) =>
          decide(fold, adapter, obligation).pipe(Effect.forkIn(scope), Effect.asVoid)))
    )
  }).pipe(Effect.scoped) as Effect.Effect<never>

const decide = (fold: Fold.Fold, adapter: Adapter.AdapterConnection, obligation: Obligation): Effect.Effect<void> => {
  switch (obligation._tag) {
    case "Prompt":
      return decidePrompt(fold, adapter, obligation)
    case "FileChooser":
      return decideChooser(fold, adapter, obligation)
    case "PausedRequest":
      return decideRequest(fold, adapter, obligation)
  }
}

/** Sends a decision the policy or the default makes; an obligation that ended meanwhile needs none. */
const resolve = (adapter: Adapter.AdapterConnection, obligation: Adapter.ObligationId, decision: Adapter.Decision) =>
  Effect.ignore(adapter.resolve(obligation, decision))

/**
 * Why a handler's decision didn't apply, when it still needs one: `None` for an obligation that ended, which has
 * nothing left to decide; else the backend refused it, as text for a dialog that takes none, and it is still open.
 */
const refused = (exit: Exit.Exit<void, Adapter.AdapterError>): Option.Option<string> => {
  if (Exit.isSuccess(exit)) return Option.none()
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (failure === undefined || failure.error.reason._tag === "Gone" || failure.error.reason._tag === "Foreign") {
    return Option.none()
  }
  return Option.some(failure.error.message)
}

const logUnhandled = (message: string) =>
  Effect.flatMap(
    References.UnhandledLogLevel,
    (level) => level === undefined ? Effect.void : Effect.logWithLevel(level)(message)
  )

/**
 * A dialog: the handler the fold chose; else, or if it doesn't decide, the context's policy, reported as an
 * `AutoResolution`; else nothing, and operations on the page fail with `PromptBlocking`.
 */
const decidePrompt = Effect.fnUntraced(function*(
  fold: Fold.Fold,
  adapter: Adapter.AdapterConnection,
  { context, handler, obligation, page, policy, prompt }: Extract<Obligation, { readonly _tag: "Prompt" }>
) {
  if (Option.isSome(handler)) {
    const decision = yield* handler.value.decide(prompt)
    if (Option.isSome(decision)) {
      const sent = yield* Effect.exit(adapter.resolve(obligation, decision.value))
      if (Exit.isSuccess(sent)) {
        // A stay, which a `close` waiting on the prompt fails with
        if (prompt.kind === "beforeunload" && decision.value._tag === "Dismiss" && Option.isSome(page)) {
          yield* fold.stayed(page.value)
        }
        return
      }
      const why = refused(sent)
      if (Option.isNone(why)) return
      yield* logUnhandled(
        `Dialog.handle: the handler's decision for the ${prompt.kind} couldn't be applied, so the context's policy decides: ${why.value}`
      )
    }
  }
  if (Option.isNone(page)) return
  if (
    Option.isNone(context) || Option.isNone(policy) || policy.value === "leaveOpen" ||
    Option.exists((yield* page.value.state.get).owner, Handoff.leavesOpen)
  ) {
    return yield* fold.undecided(page.value, prompt)
  }
  // `beforeunload` is accepted under "dismiss", so closing never hangs (CONCEPTS.md §5)
  const accept = policy.value === "accept" || prompt.kind === "beforeunload"
  yield* fold.autoResolved({ page, context }, {
    _tag: "Dialog",
    prompt,
    decision: accept ? "accept" : "dismiss",
    policy: policy.value,
    at: Adapter.now()
  })
  yield* resolve(adapter, obligation, accept ? { _tag: "Accept", promptText: Option.none() } : { _tag: "Dismiss" })
})

/**
 * A file chooser, as a dialog is decided: the handler the fold chose, else cancel, reported as an `AutoResolution`,
 * in a context the library created. A chooser in another context is left as the browser has it.
 */
const decideChooser = Effect.fnUntraced(function*(
  fold: Fold.Fold,
  adapter: Adapter.AdapterConnection,
  { chooser, context, handler, obligation, owned, page }: Extract<Obligation, { readonly _tag: "FileChooser" }>
) {
  if (Option.isSome(handler)) {
    const decision = yield* handler.value.decide(chooser)
    if (Option.isSome(decision)) return yield* resolve(adapter, obligation, decision.value)
  }
  if (Option.isNone(page) || Option.isNone(context) || !owned) return
  yield* fold.autoResolved({ page, context }, { _tag: "FileChooser", chooser, decision: "cancel", at: Adapter.now() })
  yield* resolve(adapter, obligation, { _tag: "Cancel" })
})

/**
 * A paused request: the routes the fold chose, in order, until one decides. The default, continue, applies when
 * none matches; when every one that matched fell through or failed, or the backend refused a decision, it is also
 * published as an `AutoResolution`.
 */
const decideRequest = Effect.fnUntraced(function*(
  fold: Fold.Fold,
  adapter: Adapter.AdapterConnection,
  { obligation, owner, paused, routes }: Extract<Obligation, { readonly _tag: "PausedRequest" }>
) {
  // Never the browser's own prompt at a challenge: headless, it waits forever
  const fallback: Adapter.Decision = paused.phase === "auth"
    ? { _tag: "CancelAuth" }
    : { _tag: "Continue", overrides: Option.none() }
  if (routes.length === 0) return yield* resolve(adapter, obligation, fallback)
  for (const route of routes) {
    const answer = yield* route.ask(obligation, paused)
    if (answer._tag === "Fallthrough") continue
    if (answer._tag === "Decided") {
      const sent = yield* Effect.exit(adapter.resolve(obligation, answer.decision))
      if (Exit.isSuccess(sent)) return
      // A request that ended has nothing left to decide; one the backend refused a decision for still waits for
      // one, so it gets the default
      const why = refused(sent)
      if (Option.isNone(why)) return
      // The URL as the diagnostics preset shows it
      const shown = Spans.redactUrl(paused.request.url, yield* Diagnostics.CurrentPreset)
      yield* logUnhandled(`A route's decision for ${shown} couldn't be applied, so it continues: ${why.value}`)
    }
    break
  }
  yield* fold.autoResolved(owner, {
    _tag: "PausedRequest",
    request: paused.request,
    decision: "continue",
    at: Adapter.now()
  })
  yield* resolve(adapter, obligation, fallback)
})
