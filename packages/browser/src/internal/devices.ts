/**
 * A page's keyboard and mouse (review 16, candidate 8): input to whatever has focus, and pointer input by
 * coordinates, with no element to check. Both build their events from the page's input state (`input.ts`) under
 * its input permit, as actions do, and hold keys and buttons as scoped acquisitions, released in the scope's
 * finalizer, so a failed step never leaves Shift held down.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Keyboard from "../Keyboard.ts"
import * as Mouse from "../Mouse.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Input from "./input.ts"
import * as Keys from "./keys.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

type Failure = Reason.InvalidInput | Reason.Unsupported | Reason.BackendFailure

interface Owner {
  readonly runtime: Runtime.Runtime
  readonly page: Model.PageEntry
}

/** Sends a gesture under the page's input permit and the deadline in force, mapping failures through `fail`. */
const sending = <E>(
  owner: Owner,
  operation: string,
  fail: (reason: Failure, id: Diagnostics.OperationId) => E,
  build: (state: Input.State) => ReadonlyArray<Adapter.InputEvent> | Failure,
  after: (state: Input.State) => void = () => {}
): Effect.Effect<void, E | Target.TargetGone | Deadline.Timeout> =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const budget = yield* Operation.budget
    const timedOut = () =>
      Operation.timeout({
        operation,
        id,
        phase: "dispatchedUnconfirmed",
        budget: budget.budget,
        history: [],
        hint: Option.some(
          "The browser hadn't confirmed the input by the deadline; a dialog it opened may still be deciding"
        ),
        dispatch: { _tag: "MayHaveBeenSent" }
      })
    const sent = yield* owner.page.input.withPermit(Effect.gen(function*() {
      const state = owner.page.inputState
      if (Option.isSome(state.broken)) {
        return yield* Effect.fail(fail(
          new Reason.BackendFailure({
            kind: "Rejected",
            method: "input",
            metadata: {},
            hint: `A held input's release failed (${state.broken.value}), so the page's input state is unknown`
          }),
          id
        ))
      }
      const events = build(state)
      if (!Array.isArray(events)) return yield* Effect.fail(fail(events as Failure, id))
      yield* owner.runtime.model.adapter.dispatchInput(owner.page.id, events as ReadonlyArray<Adapter.InputEvent>).pipe(
        Effect.catch((error) => {
          const mapped = Operation.fromAdapter(error, id, owner.runtime.backend)
          return Effect.fail(mapped._tag === "Gone" ? mapped.error : fail(mapped.reason, id))
        })
      )
      after(state)
    })).pipe(Effect.timeoutOption(Operation.millisLeft(budget.at)))
    if (Option.isNone(sent)) return yield* Effect.fail(timedOut())
  }).pipe(Effect.withSpan(operation, { attributes: { "browser.page.id": owner.page.id } }))

/** Whether the backend reports a capability as unsupported, with its limitations. */
const unsupported = (owner: Owner, capability: string) =>
  Effect.map(SubscriptionRef.get(owner.runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === capability)
    return entry === undefined || entry.status !== "unsupported"
      ? Option.none<Reason.Unsupported>()
      : Option.some(
        new Reason.Unsupported({
          capability,
          backend: owner.runtime.backend,
          hint: entry.limitations.join("; ") || `${owner.runtime.backend} can't do this`
        })
      )
  })

/** Releases a held input in its scope's finalizer; a release that fails on a live page breaks its input state. */
const releasing = (
  owner: Owner,
  describe: string,
  events: (state: Input.State) => ReadonlyArray<Adapter.InputEvent>,
  forget: (state: Input.State) => void
) => {
  let released = false
  const release = Effect.suspend(() => {
    if (released) return Effect.void
    released = true
    return owner.page.input.withPermit(Effect.suspend(() => {
      const state = owner.page.inputState
      const sent = events(state)
      forget(state)
      return owner.runtime.model.adapter.dispatchInput(owner.page.id, sent).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            // A page that is gone took its input with it
            if (error.reason._tag !== "Gone") state.broken = Option.some(`${describe}: ${error.message}`)
          })
        )
      )
    }))
  })
  return release
}

const keyboardError = (operation: string) => (reason: Failure, id: Diagnostics.OperationId) =>
  new Keyboard.KeyboardError({ operation, reason, diagnostics: Operation.diagnostics(id) })

const mouseError = (operation: string) => (reason: Failure, id: Diagnostics.OperationId) =>
  new Mouse.MouseError({ operation, reason, diagnostics: Operation.diagnostics(id) })

const unknownKey = (key: string) =>
  new Reason.InvalidInput({
    input: "key",
    expected: "a UI Events key value, such as \"Enter\" or \"a\", or one character",
    hint: `${JSON.stringify(key)} isn't a key`
  })

export const keyboard = (owner: Owner): Keyboard.Keyboard => ({
  press: (key, options) =>
    sending(owner, "Keyboard.press", keyboardError("Keyboard.press"), (state) => {
      const definition = Keys.definition(key)
      return definition === undefined ? unknownKey(key) : Input.press(state, definition, options?.modifiers ?? [])
    }),
  pressSequentially: (text, options) => {
    const characters = Array.from(Redacted.isRedacted(text) ? Redacted.value(text) : text)
    const delay = options?.delay === undefined ? Duration.zero : Duration.fromInputUnsafe(options.delay)
    return Effect.forEach(characters, (character, index) =>
      Effect.andThen(
        index > 0 && Duration.isGreaterThan(delay, Duration.zero) ? Effect.sleep(delay) : Effect.void,
        sending(
          owner,
          "Keyboard.pressSequentially",
          keyboardError("Keyboard.pressSequentially"),
          (state) => Input.press(state, Keys.forCharacter(character))
        )
      ), { discard: true }).pipe(
        Effect.withSpan("Keyboard.pressSequentially", {
          attributes: { "browser.page.id": owner.page.id, "browser.action.redacted": Redacted.isRedacted(text) }
        })
      )
  },
  insertText: (text) =>
    sending(owner, "Keyboard.insertText", keyboardError("Keyboard.insertText"), () => [{
      _tag: "InsertText",
      text: Redacted.isRedacted(text) ? Redacted.value(text) : text
    }]),
  hold: Effect.fnUntraced(function*(key: Keyboard.Key | string) {
    const definition = Keys.definition(key)
    if (definition === undefined) {
      return yield* Effect.fail(keyboardError("Keyboard.hold")(unknownKey(key), Operation.operationId()))
    }
    yield* sending(
      owner,
      "Keyboard.hold",
      keyboardError("Keyboard.hold"),
      (state) => [Input.keyDown(state, definition)],
      (state) => state.keys.push(definition)
    )
    const release = releasing(owner, `the ${key} key`, (state) => [Input.keyUp(state, definition)], (state) => {
      const index = state.keys.indexOf(definition)
      if (index >= 0) state.keys.splice(index, 1)
    })
    yield* Effect.addFinalizer(() => release)
    return { release } satisfies Keyboard.HeldKey
  })
})

export const mouse = (owner: Owner): Mouse.Mouse => ({
  position: Effect.sync(() => owner.page.inputState.position),
  move: (to, options) =>
    sending(
      owner,
      "Mouse.move",
      mouseError("Mouse.move"),
      (state) => Input.move(state, { x: to.x, y: to.y }, options?.steps ?? 1),
      (state) => {
        state.position = { x: to.x, y: to.y }
      }
    ),
  click: Effect.fnUntraced(function*(at: Mouse.Point, options?: Mouse.ClickOptions) {
    const modifiers = options?.modifiers ?? []
    if (Input.anyModifier(owner.page.inputState, modifiers)) {
      const missing = yield* unsupported(owner, "input.pointerModifiers")
      if (Option.isSome(missing)) {
        return yield* Effect.fail(mouseError("Mouse.click")(missing.value, Operation.operationId()))
      }
    }
    yield* sending(
      owner,
      "Mouse.click",
      mouseError("Mouse.click"),
      (state) =>
        Input.click(state, { x: at.x, y: at.y }, options?.button ?? "left", options?.clickCount ?? 1, modifiers),
      (state) => {
        state.position = { x: at.x, y: at.y }
      }
    )
  }),
  hold: Effect.fnUntraced(function*(button: Mouse.Button) {
    yield* sending(
      owner,
      "Mouse.hold",
      mouseError("Mouse.hold"),
      (state) => [Input.buttonDown(state, button)],
      (state) => state.buttons.add(button)
    )
    const release = releasing(owner, `the ${button} button`, (state) => [Input.buttonUp(state, button)], (state) => {
      state.buttons.delete(button)
    })
    yield* Effect.addFinalizer(() => release)
    return { release } satisfies Mouse.HeldButton
  }),
  wheel: (delta) =>
    sending(
      owner,
      "Mouse.wheel",
      mouseError("Mouse.wheel"),
      (state) => [Input.wheel(state, { x: delta.x, y: delta.y })]
    )
})
