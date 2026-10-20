import { assert, describe, it } from "@effect/vitest"
import { parse, parseRules } from "../src/Cddl.ts"

const remote = `
Command = { id: js-uint, CommandData, Extensible }
CommandData = ( ModCommand )
ModCommand = ( mod.Do // mod.Ping )
Extensible = (*text => any)
EmptyParams = { Extensible }
js-uint = 0..9007199254740991

mod.Do = ( method: "mod.do", params: mod.DoParameters )
mod.Ping = ( method: "mod.ping", params: EmptyParams )

mod.Base = ( id: mod.Thing, ? note: text )
mod.DoParameters = {
  mod.Base,
  ? origin: ("viewport" / "document") .default "viewport",
  ? size: (js-uint .ge 1),
  shape: mod.Shape,
  ? pair: [text, float],
  ? labels: {*text => text},
  (( at: float / null ) // ( error: text )),
  Extensible
}
mod.Shape = { type: "circle", radius: float } / { type: "box", width: float }
mod.Thing = text
mod.Kind = "a" / "b"
; a comment
`

const local = `
Message = ( CommandResponse / Event )
CommandResponse = { type: "success", id: js-uint, result: ResultData }
ResultData = ( ModResult )
ModResult = ( mod.DoResult / mod.PingResult )
EmptyResult = { Extensible }
Event = { type: "event", EventData }
EventData = ( ModEvent )
ModEvent = ( mod.Done )
Extensible = (*text => any)
js-uint = 0..9007199254740991

mod.DoResult = { items: [*mod.Thing], ? kind: mod.Kind }
mod.PingResult = EmptyResult
mod.Done = ( method: "mod.done", params: mod.DoResult )
mod.Shape = { type: "circle", radius: float } / { type: "box", width: float }
mod.Thing = text
mod.Kind = "a" / "b"
`

const model = parse("test", [
  { file: "remote.cddl", side: "remote", text: remote },
  { file: "local.cddl", side: "local", text: local }
])

describe("CDDL", () => {
  it("parses rules: groups, maps, choices, ranges, controls and comments", () => {
    const rules = parseRules(`a = ( b: text // c: float ) ; group\nd = 0.0..1.0 .default 0.5\n`, "x.cddl")
    assert.deepStrictEqual(rules.map(([name]) => name), ["a", "d"])
    assert.strictEqual(rules[0]![1].kind, "group")
    assert.deepStrictEqual(rules[1]![1], { kind: "range", integer: false })
  })

  it("makes commands and events of method groups, with each command's result by name", () => {
    assert.deepStrictEqual(model.shapes["mod#do"], {
      _tag: "Command",
      method: "mod.do",
      params: "mod#DoParameters",
      result: "mod#DoResult",
      traits: { status: "stable" }
    })
    const ping = model.shapes["mod#ping"]
    assert(ping?._tag === "Command")
    assert.isNull(ping.params, "EmptyParams")
    assert.isNull(ping.result, "EmptyResult")
    assert.deepInclude(model.shapes["mod#done"], { _tag: "Event", method: "mod.done", params: "mod#DoResult" })
  })

  it("flattens included groups, and makes a map with group choices a union of structs", () => {
    const params = model.shapes["mod#DoParameters"]
    assert(params?._tag === "Alias" && params.type._tag === "Union")
    const cases = params.type.members.map((member) => member._tag === "Ref" ? model.shapes[member.shape] : undefined)
    assert.lengthOf(cases, 2)
    for (const shape of cases) {
      assert(shape?._tag === "Struct")
      assert.isTrue(shape.traits.extensible)
      assert.deepStrictEqual(shape.members["id"]?.type, { _tag: "Ref", shape: "mod#Thing" })
      assert.isTrue(shape.members["note"]?.optional)
    }
    assert.deepStrictEqual(Object.keys(cases[0]!._tag === "Struct" ? cases[0]!.members : {}).includes("at"), true)
    assert.deepStrictEqual(Object.keys(cases[1]!._tag === "Struct" ? cases[1]!.members : {}).includes("error"), true)
  })

  it("keeps literals exact, opens enums, and types tuples, maps and nullables", () => {
    const params = model.shapes["mod#DoParameters"]
    assert(params?._tag === "Alias" && params.type._tag === "Union" && params.type.members[0]?._tag === "Ref")
    const first = model.shapes[params.type.members[0].shape]
    assert(first?._tag === "Struct")
    assert.deepStrictEqual(first.members["pair"]?.type, {
      _tag: "Tuple",
      items: [{ _tag: "Scalar", scalar: "string" }, { _tag: "Scalar", scalar: "number" }]
    })
    assert.deepStrictEqual(first.members["labels"]?.type, { _tag: "Map", values: { _tag: "Scalar", scalar: "string" } })
    assert.deepStrictEqual(first.members["at"]?.type, {
      _tag: "Union",
      members: [{ _tag: "Scalar", scalar: "number" }, { _tag: "Literal", value: null }]
    })
    assert.deepStrictEqual(first.members["size"]?.type, { _tag: "Scalar", scalar: "integer" })
    assert.deepInclude(model.shapes["mod#DoParameters.Case1.origin"], {
      _tag: "Enum",
      values: ["viewport", "document"]
    })
    assert.deepInclude(model.shapes["mod#Kind"], { _tag: "Enum", values: ["a", "b"] })
    const shape = model.shapes["mod#Shape"]
    assert(shape?._tag === "Alias" && shape.type._tag === "Union")
  })

  it("leaves the envelope to the wire", () => {
    for (
      const name of ["common#Command", "common#Message", "common#ModCommand", "common#ModEvent", "common#EmptyResult"]
    ) {
      assert.notProperty(model.shapes, name)
    }
  })

  it("fails on a name that isn't defined, and on syntax it doesn't know", () => {
    assert.throws(
      () => parse("t", [{ file: "r.cddl", side: "remote", text: "a.B = { c: a.Missing }" }]),
      /a\.Missing isn't defined/
    )
    assert.throws(() => parseRules("a = &b", "r.cddl"), /unexpected "&"/)
  })
})
