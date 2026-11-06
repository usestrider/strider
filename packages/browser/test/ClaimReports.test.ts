import { assert, describe, it } from "@effect/vitest"
import { Browser, UserContext } from "@usestrider/browser/experimental"
import * as Schema from "effect/Schema"

describe("claim reports", () => {
  it("discriminates unknown state from observed dialog state across Schema round trips", () => {
    const roundTrip = (value: Browser.Found) =>
      Schema.decodeUnknownSync(Browser.Found)(
        JSON.parse(JSON.stringify(Schema.encodeSync(Browser.Found)(value)))
      )
    assert.deepStrictEqual(roundTrip({ _tag: "Unknown" }), { _tag: "Unknown" })
    const found = roundTrip({ _tag: "Observed", dialogs: [{ kind: "alert", message: "hello" }] })
    assert.strictEqual(found._tag, "Observed")
    if (found._tag === "Observed") assert.strictEqual(found.dialogs[0]?.kind, "alert")
    assert.isFalse(Schema.is(Browser.Found)({ dialogs: [] }))
    assert.isFalse(Schema.is(Browser.Found)({ _tag: "Observed", dialogs: [{ kind: "invented", message: "" }] }))
    assert.deepStrictEqual(Schema.decodeUnknownSync(UserContext.Found)({ pages: [] }), { pages: [] })
  })
  it("round-trips confirmed handoff events separately from current observations", () => {
    const snapshot: Browser.LastKnown = {
      _tag: "LastKnown",
      claim: "saved claim",
      dialogs: [{ kind: "confirm", message: "Continue?" }],
      handoff: { _tag: "Complete", events: [{ _tag: "DialogDismissed", kind: "confirm", message: "Continue?" }] }
    }
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(Browser.LastKnown)(JSON.parse(JSON.stringify(
        Schema.encodeSync(Browser.LastKnown)(snapshot)
      ))),
      snapshot
    )
    assert.deepStrictEqual(Schema.decodeUnknownSync(Browser.Handoff)({ _tag: "Unknown", events: [] }), {
      _tag: "Unknown",
      events: []
    })
  })
})
