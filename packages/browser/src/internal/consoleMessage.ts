/**
 * The console messages of a page or a context (`ConsoleMessage`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Page from "../Page.ts"
import type * as Subscription from "../Subscription.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as ConsoleArguments from "./consoleArguments.ts"
import * as Evaluation from "./evaluation.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  ConsoleMessage.Filter,
  ConsoleMessage.ConsoleMessage,
  ConsoleMessage.ConsoleMessage
>({
  name: "ConsoleMessage",
  noun: "a console message",
  prepare: (target, filter) => {
    const level = Filters.among(filter?.level)
    const text = Filters.text(filter?.text)
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.console,
      accepts: (entry) => level(entry.value.level) && text(entry.value.text),
      deliver: (message) => message
    })
  }
})

/** A message as a call, its arguments owned by the subscription's scope. */
const callOf = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  scope: Scope.Scope,
  message: ConsoleMessage.ConsoleMessage
): Effect.Effect<ConsoleMessage.Call> =>
  Effect.suspend(() => {
    const entry = ConsoleArguments.take(message)
    if (entry === undefined) return Effect.succeed({ message, args: [] })
    const behind = Handles.target(target)
    const page = behind._tag === "Page" ? Option.some(behind.behind.entry) : Option.none()
    const args = entry.args.map((arg) => {
      const handle = new Evaluation.HandleImpl(behind.behind.runtime, entry.realm, arg.value, page)
      handle.disown = ConsoleArguments.disown(entry, arg)
      return handle
    })
    return Scope.addFinalizer(scope, Effect.forEach(args, (handle) => handle.release, { discard: true })).pipe(
      Effect.as({ message, args })
    )
  })

/** Declares, for the subscription's scope, that the target's console messages keep their arguments. */
const declare = (target: Page.ObservedPage | UserContext.ObservedUserContext) =>
  Effect.suspend(() => {
    const behind = Handles.target(target)
    const scope: Adapter.DeclarationScope = behind._tag === "Page"
      ? { _tag: "Page", page: behind.behind.entry.id }
      : { _tag: "UserContext", context: behind.behind.entry.id }
    return ConsoleArguments.subscribed.pipe(
      Effect.andThen(behind.behind.runtime.model.adapter.declare(scope, { _tag: "ConsoleArguments" })),
      Effect.orDie
    )
  })

export const nextCall = Effect.fnUntraced(function*<PE, PR>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: ConsoleMessage.Filter | undefined,
  where?: Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> | undefined
) {
  const scope = yield* Effect.scope
  yield* declare(target)
  const wait = yield* next(target, filter, where)
  return yield* Effect.cached(Effect.flatMap(wait, (message) => callOf(target, scope, message)))
})

export const streamCalls = Effect.fnUntraced(function*<PE, PR>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  filter?: ConsoleMessage.Filter | undefined,
  where?: Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> | undefined
) {
  const scope = yield* Effect.scope
  yield* declare(target)
  const messages = yield* stream(target, filter, where)
  return Stream.mapEffect(messages, (message) => callOf(target, scope, message))
})
