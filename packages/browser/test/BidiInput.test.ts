/**
 * The BiDi input translation: what a pointer gesture sends to Firefox.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import type * as Adapter from "../src/internal/adapter.ts"
import { dispatchInput } from "../src/internal/bidiAdapter/input.ts"
import type { State } from "../src/internal/bidiAdapter/state.ts"
import type * as L1Target from "../src/Target.ts"

/** Just enough state to resolve one page and record each command sent. */
const recording = () => {
  const sent: Array<unknown> = []
  const id = "page-1" as L1Target.NavigableId
  const state = {
    ids: {},
    endedPages: new Set(),
    navigablesById: new Map([[id, { removed: false, page: { bidi: "context-1" } }]]),
    send: (command: { readonly params: unknown }) => Effect.sync(() => void sent.push(command.params))
  } as unknown as State
  return { id, sent, state }
}

describe("BiDi input", () => {
  it.effect("sends a pointer move at the exact point chosen, fractions included", () =>
    Effect.gen(function*() {
      const { id, sent, state } = recording()
      const events = [
        { _tag: "Mouse", type: "move", x: 27, y: 119.5, button: "left" },
        { _tag: "Mouse", type: "down", x: 27, y: 119.5, button: "left" }
      ] as unknown as ReadonlyArray<Adapter.InputEvent>
      yield* dispatchInput(state, id, events)
      const moves = JSON.stringify(sent).match(/"type":"pointerMove","x":[^,]+,"y":[^}]+/g)
      assert.deepStrictEqual(moves, [
        "\"type\":\"pointerMove\",\"x\":27,\"y\":119.5",
        "\"type\":\"pointerMove\",\"x\":27,\"y\":119.5"
      ])
    }))
})
