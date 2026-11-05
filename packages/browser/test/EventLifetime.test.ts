import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Events from "../src/internal/events.ts"

describe("event subscription lifetime", () => {
  it.live("interrupts the returned wait when its scope closes immediately after registration", () =>
    Effect.gen(function*() {
      const channel = Events.make<string>({ _tag: "Browser" }, () => 10)
      const wait = yield* Effect.scoped(Events.next<string, string, never, never>(
        { operation: "test.next", noun: "an event", deliver: (value: string) => value },
        channel,
        () => true,
        undefined
      ))
      assert.strictEqual(channel.subscribers.size, 0)
      const result = yield* Effect.exit(wait).pipe(Effect.timeoutOption("1 second"))
      assert(Option.isSome(result), "closing the subscription scope must complete its returned wait")
      assert(Exit.isFailure(result.value) && result.value.cause.reasons.some(Cause.isInterruptReason))
    }))
})
