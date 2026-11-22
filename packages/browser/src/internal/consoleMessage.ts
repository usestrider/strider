/**
 * The console messages of a page or a context (`ConsoleMessage`): which entries a filter takes.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Page from "../Page.ts"
import * as Subscription from "../Subscription.ts"
import type * as UserContext from "../UserContext.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as ConsoleArguments from "./consoleArguments.ts"
import * as Evaluation from "./evaluation.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import * as Operation from "./operation.ts"

/** The messages a filter takes. */
const accepts = (filter: ConsoleMessage.Filter | undefined) => {
  const level = Filters.among(filter?.level)
  const text = Filters.text(filter?.text)
  return (message: ConsoleMessage.ConsoleMessage) => level(message.level) && text(message.text)
}

export const { history, next, nextIn, stream } = EventModule.make<
  Page.ObservedPage | UserContext.ObservedUserContext,
  ConsoleMessage.Filter,
  ConsoleMessage.ConsoleMessage,
  ConsoleMessage.ConsoleMessage
>({
  name: "ConsoleMessage",
  noun: "a console message",
  prepare: (target, filter) => {
    const takes = accepts(filter)
    return Effect.succeed({
      channel: Handles.target(target).behind.entry.events.console,
      accepts: (entry) => takes(entry.value),
      deliver: (message) => message
    })
  }
})

/** A message as a call, its arguments owned by the subscription's scope. */
const callOf = (
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  claimant: ConsoleArguments.Claimant,
  scope: Scope.Scope,
  message: ConsoleMessage.ConsoleMessage
): Effect.Effect<ConsoleMessage.Call> =>
  Effect.suspend(() => {
    const entry = ConsoleArguments.take(claimant, message)
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

/**
 * Subscribes to calls for the subscription's scope: refused where the target's grant was released or the backend
 * keeps no console arguments, else it declares that the target's console messages keep theirs, and claims each one
 * its filter takes.
 */
const subscribe = Effect.fnUntraced(function*(
  operation: string,
  target: Page.Page | UserContext.UserContext,
  filter: ConsoleMessage.Filter | undefined
) {
  const behind = Handles.target(target)
  // The handles a call gives can evaluate in the main world, which only control allows
  yield* Access.check(behind.behind.grant)
  const runtime = behind.behind.runtime
  const capabilities = yield* SubscriptionRef.get(runtime.model.adapter.capabilities)
  const status = capabilities.entries.find((entry) => entry.name === "console.arguments")?.status
  if (status === undefined || status === "unsupported") {
    return yield* Effect.fail(
      Filters.unsupported(operation, "console.arguments", runtime.backend, "This backend keeps no console arguments")
    )
  }
  const declared: Adapter.DeclarationScope = behind._tag === "Page"
    ? { _tag: "Page", page: behind.behind.entry.id }
    : { _tag: "UserContext", context: behind.behind.entry.id }
  yield* runtime.model.adapter.declare(declared, { _tag: "ConsoleArguments" }).pipe(
    Effect.catch((error) => {
      const mapped = Operation.fromAdapter(error, Operation.idNow(), runtime.backend)
      return Effect.fail(
        mapped._tag === "Reason"
          ? new Subscription.SubscriptionError({
            operation,
            reason: mapped.reason,
            diagnostics: Operation.diagnosticsNow()
          })
          : mapped.error
      )
    })
  )
  return yield* ConsoleArguments.claimant(
    runtime.model.consoleArguments,
    behind.behind.entry.events.console,
    accepts(filter)
  )
})

/** The user's `where`, after which a message it rejects is passed on. */
const claiming = <PE, PR>(
  claimant: ConsoleArguments.Claimant,
  where: Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> | undefined,
  matched: boolean
): Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> =>
(message) =>
  Effect.flatMap(where === undefined ? Effect.succeed(true) : where(message), (taken) =>
    taken
      ? Effect.as(matched ? ConsoleArguments.matched(claimant, message) : Effect.void, true)
      : Effect.as(ConsoleArguments.pass(claimant, message), false)).pipe(
      // A failed `where` ends the subscription
      Effect.onError(() => ConsoleArguments.abandoned(claimant))
    )

/**
 * Runs `settle`'s bookkeeping as a subscriber tells it, synchronously, that it ended before its scope did, and the
 * release of what it frees apart, in the browser's model scope with the subscribing fiber's services, as the fold
 * releases arguments nobody claims.
 */
const settling = Effect.fnUntraced(function*<A extends ReadonlyArray<unknown>>(
  target: Page.ObservedPage | UserContext.ObservedUserContext,
  settle: (...args: A) => Effect.Effect<void>
) {
  const services = yield* Effect.context<never>()
  const scope = Handles.target(target).behind.runtime.model.scope
  return (...args: A) => {
    Effect.runForkWith(services)(Effect.forkIn(settle(...args), scope))
  }
})

export const nextCall = Effect.fnUntraced(
  function*<PE, PR>(
    target: Page.Page | UserContext.UserContext,
    filter?: ConsoleMessage.Filter | undefined,
    where?: Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> | undefined
  ) {
    const operation = "ConsoleMessage.nextCall"
    const scope = yield* Effect.scope
    const claimant = yield* subscribe(operation, target, filter)
    // A wait that failed, timed out or saw its target end takes nothing; one that matched keeps its message's claim
    const settled = yield* settling(target, () => ConsoleArguments.abandonedNow(claimant))
    const wait = yield* nextIn(operation, target, filter, claiming(claimant, where, true), (failed) => {
      if (failed) settled()
    })
    return yield* Effect.cached(Effect.flatMap(wait, (message) => callOf(target, claimant, scope, message)))
  },
  Operation.named("ConsoleMessage.nextCall")
)

export const streamCalls = Effect.fnUntraced(function*<PE, PR>(
  target: Page.Page | UserContext.UserContext,
  filter?: ConsoleMessage.Filter | undefined,
  where?: Subscription.Where<ConsoleMessage.ConsoleMessage, PE, PR> | undefined
) {
  const scope = yield* Effect.scope
  const claimant = yield* subscribe("ConsoleMessage.streamCalls", target, filter)
  // A stream that overflowed or saw its target end still delivers what it queued, with its arguments
  const closed = yield* settling(
    target,
    (overflowed: ConsoleMessage.ConsoleMessage | undefined) => ConsoleArguments.closed(claimant, overflowed)
  )
  const messages = yield* stream(target, filter, claiming(claimant, where, false), closed)
  return Stream.mapEffect(messages, (message) => callOf(target, claimant, scope, message))
})
