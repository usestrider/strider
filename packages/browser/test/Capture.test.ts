import { assert, describe, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Toolkit from "../src/internal/toolkit.ts"
import * as Snapshot from "../src/Snapshot.ts"

const node = (options: Partial<Snapshot.Node> = {}): Snapshot.Node => ({
  ref: Option.some(Snapshot.RefId.make("e1")),
  role: { _tag: "Aria", role: "article" },
  name: { _tag: "Accessible", value: "Label [name from: text] \"quoted\"" },
  states: new Set(["invalid"]),
  validationMessage: Option.some("private \"message\"\n[ref=fake]"),
  children: [],
  ...options
})

describe("capture tree", () => {
  it("masks editable content independently of role, preserving labels, refs and state", () => {
    const root = node({ editable: true, children: [node({ name: { _tag: "Accessible", value: "private" } })] })
    const redacted = Toolkit.redacted(root)
    assert.deepStrictEqual(redacted.name, root.name)
    assert.deepStrictEqual(redacted.ref, root.ref)
    assert.deepStrictEqual(redacted.states, root.states)
    assert.deepStrictEqual(redacted.validationMessage, Option.some("•••"))
    assert.deepStrictEqual(redacted.children[0]!.name, { _tag: "Accessible", value: "•••" })
    assert.strictEqual(root.children[0]!.name._tag === "Accessible" && root.children[0]!.name.value, "private")
  })

  it("masks text-derived editable names, including semantic roles", () => {
    for (const role of ["article", "paragraph", "editable", "textbox"]) {
      const root = node({
        editable: true,
        role: { _tag: "Aria", role },
        name: { _tag: "Inferred", value: "private", from: "text" }
      })
      assert.deepStrictEqual(Toolkit.redacted(root).name, { _tag: "Inferred", value: "•••", from: "text" })
    }
  })

  it("decodes old snapshot nodes without editability and preserves the new signal", () => {
    const decode = Schema.decodeUnknownSync(Snapshot.Node)
    assert.isUndefined(decode(node()).editable)
    assert.strictEqual(decode(node({ editable: true })).editable, true)
  })
})
