/**
 * An operation's record can be written only inside an operation: `markSent`, `observe` and `bound` require
 * `Operation.Current`, which only `Operation.fn` and `Operation.named` provide.
 */
import { Deadline, Operation } from "@usestrider/browser"
import { Effect } from "effect"
import { describe, expect, it } from "tstyche"

describe("recording", () => {
  it("requires an operation", () => {
    expect<Effect.Services<typeof Operation.markSent>>().type.toBe<Operation.Current>()
    expect<Effect.Services<ReturnType<typeof Operation.observe>>>().type.toBe<Operation.Current>()
    expect(Effect.runPromise(Operation.markSent)).type.toRaiseError()
  })

  it("bounds a wait with the operation's Timeout", () => {
    const bounded = Operation.bound(Effect.fail("unavailable" as const))
    expect<Effect.Services<typeof bounded>>().type.toBe<Operation.Current>()
    expect<Effect.Error<typeof bounded>>().type.toBe<"unavailable" | Deadline.Timeout>()
  })
})

describe("an operation", () => {
  it("provides the operation, and keeps what else its body needs and fails with", () => {
    const named = Operation.markSent.pipe(Effect.andThen(Effect.fail("refused" as const)), Operation.named("send"))
    expect<Effect.Services<typeof named>>().type.toBe<never>()
    expect<Effect.Error<typeof named>>().type.toBe<"refused">()
  })

  it("is Effect.fn's shape, with pipeables given the call's arguments", () => {
    const pay = Operation.fn("pay")(
      function*(amount: number) {
        yield* Operation.markSent
        return amount
      },
      Deadline.within("5 seconds"),
      (effect, amount) => Effect.map(effect, (paid) => paid === amount)
    )
    expect(pay).type.toBe<(amount: number) => Effect.Effect<boolean>>()
  })
})
