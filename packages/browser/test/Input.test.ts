/**
 * A page's input state after a release failed (QUIRKS.md, Q84): the next gesture sends that release again first,
 * and the page's input is known again once it gets through.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Input from "../src/internal/input.ts"
import * as Operation from "../src/internal/operation.ts"

const release: ReadonlyArray<Adapter.InputEvent> = [{
  _tag: "Mouse",
  type: "up",
  x: 10,
  y: 20,
  button: "left",
  clickCount: 1,
  modifiers: { alt: false, control: false, meta: false, shift: false },
  buttons: 0
}]

const broken = (): Input.State => {
  const state = Input.make()
  state.broken = Option.some({ description: "mouse.up: the page didn't answer", release })
  return state
}

describe("Input.recover", () => {
  it.effect("sends nothing when the page's input state is known", () =>
    Effect.gen(function*() {
      const sent: Array<ReadonlyArray<Adapter.InputEvent>> = []
      const unknown = yield* Input.recover(Input.make(), (events) => Effect.sync(() => void sent.push(events)))
      assert.isTrue(Option.isNone(unknown))
      assert.deepStrictEqual(sent, [])
    }))

  it.effect("sends the failed release again, and forgets the failure once it gets through", () =>
    Effect.gen(function*() {
      const state = broken()
      const sent: Array<ReadonlyArray<Adapter.InputEvent>> = []
      const unknown = yield* Input.recover(state, (events) => Effect.sync(() => void sent.push(events)))
      assert.isTrue(Option.isNone(unknown))
      assert.deepStrictEqual(sent, [release])
      assert.isTrue(Option.isNone(state.broken))
    }))

  for (const succeeds of [true, false]) {
    it.effect(`reports ${succeeds ? "completed" : "failed"} cleanup after retrying a held release`, () =>
      Effect.gen(function*() {
        const state = broken()
        const diagnostics = yield* Effect.gen(function*() {
          const unknown = yield* Input.recover(state, () => succeeds ? Effect.void : Effect.fail("refused"))
          assert.strictEqual(Option.isNone(unknown), succeeds)
          const record = yield* Operation.record
          return Operation.diagnostics(record.id)
        }).pipe(Operation.named("Locator.click"))
        assert.strictEqual(diagnostics.cleanup._tag, succeeds ? "Completed" : "Failed")
        if (diagnostics.cleanup._tag === "Failed") assert.isTrue(diagnostics.cleanup.cause.length > 0)
      }))
  }

  it.effect("keeps failed cleanup when later recovery succeeds, without changing earlier snapshots", () =>
    Effect.gen(function*() {
      yield* Effect.gen(function*() {
        const record = yield* Operation.record
        const before = record.diagnostics()
        yield* Input.recover(broken(), () => Effect.fail("release refused"))
        const failed = record.diagnostics()
        yield* Input.recover(broken(), () => Effect.void)
        assert.strictEqual(before.cleanup._tag, "NotNeeded")
        assert.strictEqual(failed.cleanup._tag, "Failed")
        assert.deepStrictEqual(record.diagnostics().cleanup, failed.cleanup)
      }).pipe(Operation.named("recover twice"))
    }))

  it.effect("says why the state is still unknown when the release fails again", () =>
    Effect.gen(function*() {
      const state = broken()
      const unknown = yield* Input.recover(state, () => Effect.fail("refused"))
      assert.deepStrictEqual(unknown, Option.some("mouse.up: the page didn't answer"))
      assert.isTrue(Option.isSome(state.broken))
    }))
})

describe("Input.singleClick", () => {
  const click = () => Input.click(Input.make(), { x: 10, y: 20 }, "left", 1)

  it("recognizes one move, press and release at the same point", () => {
    assert.isDefined(Input.singleClick(click()))
  })

  it("leaves held buttons, modifier transitions, double clicks and moved releases to the sequential path", () => {
    const held = Input.make()
    held.buttons.add("right")
    for (
      const gesture of [
        Input.click(held, { x: 10, y: 20 }, "left", 1),
        Input.click(Input.make(), { x: 10, y: 20 }, "left", 1, ["Shift"]),
        Input.click(Input.make(), { x: 10, y: 20 }, "left", 2),
        click().map((event, index) => index === 2 && event._tag === "Mouse" ? { ...event, x: 50 } : event)
      ]
    ) assert.isUndefined(Input.singleClick(gesture))
  })
})
