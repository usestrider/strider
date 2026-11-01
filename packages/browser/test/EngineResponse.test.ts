/**
 * The engine's answers are decoded, not cast: where the engine shares the page's world (stock WebKit), a page's
 * script can answer in its place, and what isn't an answer the engine gives fails rather than reaching L1.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Engine from "../src/internal/engine.ts"

describe("Engine.decodeResponse", () => {
  it.effect("decodes an answer the engine gives", () =>
    Effect.gen(function*() {
      const response = yield* Engine.decodeResponse(
        JSON.stringify({
          _tag: "NotReady",
          reason: { _tag: "Covered", by: "div.toast" },
          history: [],
          scrolled: false,
          checked: true
        })
      )
      assert.deepStrictEqual(response, {
        _tag: "NotReady",
        reason: { _tag: "Covered", by: "div.toast" },
        history: [],
        scrolled: false,
        checked: true
      })
    }))

  it.effect("fails on one it doesn't, and on text that isn't JSON", () =>
    Effect.gen(function*() {
      // A forged `Ready` without the action point's fields
      const forged = yield* Effect.exit(Engine.decodeResponse(JSON.stringify({ _tag: "Ready", element: "button" })))
      assert.isTrue(Exit.isFailure(forged))
      const unknown = yield* Effect.exit(Engine.decodeResponse(JSON.stringify({ _tag: "Clicked" })))
      assert.isTrue(Exit.isFailure(unknown))
      const text = yield* Effect.exit(Engine.decodeResponse("not json"))
      assert.isTrue(Exit.isFailure(text))
    }))
})
