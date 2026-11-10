/**
 * A page's input state after a release failed (QUIRKS.md, Q84): the next gesture sends that release again first,
 * and the page's input is known again once it gets through.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
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

describe("Input.uncertain", () => {
  const releases = (state: Input.State) =>
    Option.isSome(state.broken)
      ? state.broken.value.release.map((event) =>
        event._tag === "Mouse" || event._tag === "Key" ? event.type : event._tag
      )
      : []

  it("releases the button a double click pressed, once, and leaves the observed state alone", () => {
    const state = Input.make()
    Input.uncertain(state, "Mouse.click", Input.click(state, { x: 1, y: 2 }, "left", 2))
    assert.deepStrictEqual(releases(state), ["up"])
    assert.strictEqual(state.buttons.size, 0)
  })

  it("releases a drag's button and the modifiers it pressed, the button first", () => {
    const state = Input.make()
    Input.uncertain(state, "Mouse.drag", Input.drag(state, { x: 1, y: 2 }, { x: 5, y: 6 }, 3, ["Shift"]))
    assert.deepStrictEqual(releases(state), ["up", "up"])
    const [first, second] = Option.getOrThrow(state.broken).release
    assert.strictEqual(first?._tag, "Mouse")
    assert.strictEqual(second?._tag, "Key")
  })

  it("releases a pressed key, and not a button or key that was already held", () => {
    const state = Input.make()
    state.buttons.add("left")
    Input.uncertain(state, "Mouse.click", Input.click(state, { x: 1, y: 2 }, "left", 1))
    assert.isTrue(Option.isNone(state.broken))
    Input.uncertain(state, "Keyboard.press", Input.type(state, "a", "us")!)
    assert.deepStrictEqual(releases(state), ["up"])
  })

  it("records nothing for a gesture that presses nothing", () => {
    const state = Input.make()
    Input.uncertain(state, "Mouse.move", Input.move(state, { x: 3, y: 4 }, 2))
    assert.isTrue(Option.isNone(state.broken))
  })
})

describe("uncertain modifier releases", () => {
  it("clears the released modifier's flag", () => {
    const state = Input.make()
    const events = Input.type(state, "A", "us")!
    Input.uncertain(state, "Keyboard.press", events)
    const expected = events.filter((event) => event._tag === "Key" && event.type === "up")
    assert.deepStrictEqual(Option.getOrThrow(state.broken).release, expected)
  })
})

describe("Input handover settlement", () => {
  for (const before of [true, false]) {
    it(`keeps older pending releases when cleanup settles ${before ? "before" : "after"} accounting`, () => {
      const state = broken()
      const events = Input.click(state, { x: 3, y: 4 }, "left", 1)
      Input.handOver(events)
      if (before) {
        Input.settled(events)
        Input.finished(events)
      }
      Input.uncertain(state, "new click", events)
      if (!before) {
        Input.settled(events)
        Input.finished(events)
      }
      assert.deepStrictEqual(Option.getOrThrow(state.broken), {
        description: "mouse.up: the page didn't answer",
        release
      })
    })
  }

  it("does not clear a later gesture's release of the same button", () => {
    const state = Input.make()
    const first = Input.click(state, { x: 3, y: 4 }, "left", 1)
    Input.handOver(first)
    Input.uncertain(state, "first click", first)
    const second = Input.click(state, { x: 3, y: 4 }, "left", 1)
    Input.uncertain(state, "second click", second)
    const later = Option.getOrThrow(state.broken).release[0]!
    Input.settled(first)
    Input.finished(first)
    assert.deepStrictEqual(Option.getOrThrow(state.broken).release, [later])
    Input.settled(first)
    Input.finished(first)
    assert.deepStrictEqual(Option.getOrThrow(state.broken).release, [later])
  })
})

it.effect("keeps an in-flight cleanup when a recovery waiter is interrupted", () =>
  Effect.gen(function*() {
    const state = Input.make()
    const events = Input.click(state, { x: 3, y: 4 }, "left", 1)
    Input.handOver(events)
    Input.uncertain(state, "click", events)
    const first = yield* Input.recover(state, () => Effect.void).pipe(Effect.forkChild({ startImmediately: true }))
    assert.isUndefined(first.pollUnsafe())
    yield* Fiber.interrupt(first)
    const next = yield* Input.recover(state, () => Effect.void).pipe(Effect.forkChild({ startImmediately: true }))
    assert.isUndefined(next.pollUnsafe(), "the next gesture must still wait for the unfinished cleanup")
    Input.settled(events)
    Input.finished(events)
    yield* Fiber.join(next)
  }))

it.effect("records unfinished cleanup before waking recovery and reports the resend on its operation", () =>
  Effect.gen(function*() {
    const state = Input.make()
    const events = Input.click(state, { x: 3, y: 4 }, "left", 1)
    Input.handOver(events)
    Input.uncertain(state, "failed click", events)
    const sent: Array<Adapter.InputEvent> = []
    yield* Effect.gen(function*() {
      const operation = yield* Operation.record
      const waiting = yield* Input.recover(state, (release) =>
        Effect.sync(() => {
          sent.push(...release)
        })).pipe(
          Effect.forkChild({ startImmediately: true })
        )
      assert.isUndefined(waiting.pollUnsafe())
      Input.finished(events)
      yield* Fiber.join(waiting)
      assert.strictEqual(sent.length, 1)
      assert.deepStrictEqual(sent[0], { ...events[1], type: "up", buttons: 0 })
      assert.strictEqual(operation.diagnostics().cleanup._tag, "Completed")
      assert.isTrue(Option.isNone(state.broken))
      assert.strictEqual(state.cleanups.length, 0)
    }).pipe(Operation.named("Mouse.click"))
  }))
