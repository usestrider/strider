/** BiDi teardown: bounded independently of the failed operation, preserving its primary outcome. */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
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

/** A failed teardown is diagnostic, never a replacement for the failure that triggered it. */
export const report = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
  effect.pipe(Effect.catch((error) => {
    const protocol = error instanceof Adapter.AdapterError && error.reason._tag === "Protocol"
      ? error.reason.error
      : error
    if (protocol instanceof Protocol.ProtocolError && protocol.reason._tag === "SessionEnded") return Effect.void
    return Effect.gen(function*() {
      ;(yield* DeclarationCleanup.Unconfirmed)()
      yield* Effect.logWarning(message, error)
    })
  }))
