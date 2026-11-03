import { CurrentSession, Segment } from "@usestrider/browser/cli"
import { Effect, Schema } from "effect"
import { describe, expect, it } from "tstyche"

describe("Segment.make", () => {
  it("gives the callback decoded arguments and preserves its result, error and services", () => {
    const schema = Schema.Struct({
      count: Schema.NumberFromString.check(Schema.isInt()),
      payload: Schema.Struct({ enabled: Schema.Boolean })
    })
    const segment = Segment.make(
      schema,
      Effect.fnUntraced(function*(args) {
        expect(args.count).type.toBe<number>()
        expect(args.payload.enabled).type.toBe<boolean>()
        yield* CurrentSession.CurrentSession
        if (args.count < 0) return yield* Effect.fail("negative" as const)
        return args.count
      })
    )
    expect(segment).type.toBe<Segment.Segment<typeof schema, number, "negative", CurrentSession.CurrentSession>>()
    expect(segment.run({ count: "2", payload: { enabled: true } })).type.toRaiseError()
  })
})
