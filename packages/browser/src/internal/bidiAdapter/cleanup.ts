/** BiDi teardown: bounded independently of the failed operation, preserving its primary outcome. */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Adapter from "../adapter.ts"
import * as BrowserClock from "../browserClock.ts"
import * as DeclarationCleanup from "../declarationCleanup.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"

/** Each target's teardown has its own five-second budget on the browser's clock. */
export const millis = 5000

export const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Operation.detached(Effect.uninterruptible(Effect.gen(function*() {
    const at = yield* BrowserClock.after(millis)
    const result = yield* effect.pipe(
      Effect.interruptible,
      Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at)),
      BrowserClock.until(at)
    )
    return Option.isSome(result) ? result.value : yield* Effect.fail(
      new Protocol.ProtocolError({
        reason: new Protocol.NoReply({ method: "BiDi cleanup", timeout: Duration.millis(millis) })
      })
    )
  })))

/**
 * Runs `each` over the items under one shared five-second budget, so a stalled browser holds teardown for that
 * budget in total, not once per item. An item unfinished when it ends fails with the same no-reply error.
 */
export const boundedEach = <T, A, E, R>(items: ReadonlyArray<T>, each: (item: T) => Effect.Effect<A, E, R>) =>
  Operation.detached(Effect.uninterruptible(Effect.gen(function*() {
    const at = yield* BrowserClock.after(millis)
    const exits: Array<Exit.Exit<A, E | Protocol.ProtocolError>> = []
    for (const item of items) {
      const result = yield* each(item).pipe(
        Effect.interruptible,
        Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at)),
        BrowserClock.until(at),
        Effect.exit
      )
      exits.push(
        Exit.isFailure(result) ?
          Exit.failCause(result.cause) :
          Option.isSome(result.value) ?
          Exit.succeed(result.value.value) :
          Exit.fail(
            new Protocol.ProtocolError({
              reason: new Protocol.NoReply({ method: "BiDi cleanup", timeout: Duration.millis(millis) })
            })
          )
      )
    }
    return exits
  })))

/** An ended transport cannot accept restoration, and is already the caller's failure. */
export const sessionEnded = (error: unknown): boolean => {
  const protocol = error instanceof Adapter.AdapterError && error.reason._tag === "Protocol"
    ? error.reason.error
    : error
  return protocol instanceof Protocol.ProtocolError && protocol.reason._tag === "SessionEnded"
}

/** A failed teardown is diagnostic, never a replacement for the failure that triggered it. */
export const report = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
  effect.pipe(Effect.catch((error) => {
    if (sessionEnded(error)) return Effect.void
    return Effect.gen(function*() {
      ;(yield* DeclarationCleanup.Unconfirmed)()
      yield* Effect.logWarning(message, error)
    })
  }))

/** Owns recovery on the connection while bounding only the caller's wait by its operation. */
export const owned = Effect.fnUntraced(function*<A>(effect: Effect.Effect<A>, scope: Scope.Scope) {
  const caller = yield* Operation.current
  const confirm = yield* DeclarationCleanup.Confirm
  const unconfirmed = yield* DeclarationCleanup.Unconfirmed
  if (scope.state._tag === "Closed") return yield* effect
  const fiber = yield* effect.pipe(Effect.interruptible, Effect.forkIn(scope))
  const joined = Fiber.join(fiber)
  if (confirm || Option.isNone(caller)) return yield* joined
  return yield* caller.value.bound(joined.pipe(Effect.interruptible)).pipe(
    Effect.catchTag("Timeout", () => Effect.sync(unconfirmed))
  )
})
