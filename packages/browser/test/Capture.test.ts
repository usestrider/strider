import { assert, describe, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Toolkit from "../src/internal/toolkit.ts"
import * as MonotonicInstant from "../src/MonotonicInstant.ts"
import * as Snapshot from "../src/Snapshot.ts"
import * as Target from "../src/Target.ts"
import * as UncaughtException from "../src/UncaughtException.ts"

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

  it("redacts all exception details, keeping event time and preserving full diagnostics", () => {
    const exception = new UncaughtException.UncaughtException({
      kind: "thrown",
      name: "private-name",
      message: "private-message",
      stack: Option.some("private-stack"),
      origin: { _tag: "Page", page: Target.NavigableId.make("private-origin") },
      at: MonotonicInstant.MonotonicInstant.make(123456789)
    })
    assert.strictEqual(Toolkit.exceptionLine(exception, true), "uncaught exception at 123456789")
    assert.strictEqual(Toolkit.exceptionLine(exception, false), "private-name: private-message")
  })

  it("keeps quoted labels and masks validation text on every role", () => {
    for (const role of ["textbox", "combobox", "button"]) {
      const root = node({ role: { _tag: "Aria", role } })
      const redacted = Toolkit.redacted(root)
      assert.deepStrictEqual(redacted.name, root.name)
      assert.deepStrictEqual(redacted.validationMessage, Option.some("•••"))
    }
    const ordinary = node({
      role: { _tag: "Aria", role: "text" },
      name: { _tag: "Accessible", value: "[validationMessage=\"ordinary text\"]" }
    })
    assert.deepStrictEqual(Toolkit.redacted(ordinary).name, ordinary.name)
  })

  it("masks accessible names taken from editable content without masking labels", () => {
    const root = node({ editable: true, name: { _tag: "Accessible", value: "private", from: "text" } })
    assert.deepStrictEqual(Toolkit.redacted(root).name, { _tag: "Accessible", value: "•••", from: "text" })
  })

  it("decodes old snapshot nodes without editability and preserves the new signal", () => {
    const decode = Schema.decodeUnknownSync(Snapshot.Node)
    assert.isUndefined(decode(node()).editable)
    assert.strictEqual(decode(node({ editable: true })).editable, true)
  })
})
