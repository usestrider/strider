/**
 * Each page's input state (CONCEPTS.md §5): the keys and buttons held, and where the
 * pointer is. Every gesture is built from it, and every event carries what is held, so the adapters keep no
 * state of their own: the CDP adapter never sent the buttons held, and WebKit's forgot them between calls.
 *
 * Modifiers are keys. A gesture with modifiers presses the ones not already held before it and releases them
 * after, in the same dispatch, and also sets the events' flags, which Firefox ignores.
 *
 * Callers hold the page's input permit while they build and send, so the state matches what was sent.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Keyboard from "../Keyboard.ts"
import type * as Mouse from "../Mouse.ts"
import type * as Adapter from "./adapter.ts"
import * as Keys from "./keys.ts"
import * as Operation from "./operation.ts"

export interface State {
  /** The keys held, in the order they were pressed. */
  readonly keys: Array<Keys.Definition>
  readonly buttons: Set<Mouse.Button>
  position: { readonly x: number; readonly y: number }
  /**
   * A held input whose release failed, so the page may still have it down, and the release that failed. The
   * next gesture sends that release again first, and fails if it fails again (CONCEPTS.md §5, Compensation;
   * QUIRKS.md, Q84).
   */
  broken: Option.Option<Broken>
}

/** A release that failed: what it was, and its events. */
export interface Broken {
  readonly description: string
  readonly release: ReadonlyArray<Adapter.InputEvent>
}

export const make = (): State => ({ keys: [], buttons: new Set(), position: { x: 0, y: 0 }, broken: Option.none() })

/**
 * Before a gesture: on a page whose release failed, sends that release again, and forgets the failure if it gets
 * through, so the page's input is known again. `Some` says why the state is still unknown.
 */
export const recover = <E>(
  state: State,
  dispatch: (events: ReadonlyArray<Adapter.InputEvent>) => Effect.Effect<void, E>
): Effect.Effect<Option.Option<string>> =>
  Effect.suspend(() => {
    if (Option.isNone(state.broken)) return Effect.succeed(Option.none())
    const broken = state.broken.value
    return Effect.flatMap(Operation.current, (current) =>
      dispatch(broken.release).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Option.isSome(current)) {
              current.value.noteCleanup(
                exit._tag === "Success"
                  ? { _tag: "Completed" }
                  : { _tag: "Failed", cause: Cause.pretty(exit.cause) }
              )
            }
          })
        ),
        Effect.andThen(Effect.sync(() => {
          state.broken = Option.none()
          return Option.none<string>()
        })),
        Effect.orElseSucceed(() => Option.some(broken.description))
      ))
  })

/**
 * After a gesture's dispatch failed: records the release of what it may have left pressed, the buttons and keys
 * its events press that weren't already held, so the next gesture sends it first. `buttons` and `keys` stay as
 * observed: this is protocol uncertainty, not input seen held. Keeps an earlier failure's release, which comes first.
 */
export const uncertain = (state: State, description: string, events: ReadonlyArray<Adapter.InputEvent>): void => {
  const release: Array<Adapter.InputEvent> = []
  const held: ReadonlySet<string> = state.buttons
  const buttonsSeen = new Set<string>()
  const keysSeen = new Set<string>()
  for (const event of events) {
    if (event._tag === "Mouse" && event.type === "down" && event.button !== "none") {
      if (held.has(event.button) || buttonsSeen.has(event.button)) continue
      buttonsSeen.add(event.button)
      release.push({ ...event, type: "up", buttons: buttons(state) })
    } else if (event._tag === "Key" && event.type === "down") {
      if (state.keys.some((held) => held.code === event.code) || keysSeen.has(event.code)) continue
      keysSeen.add(event.code)
      release.push({ ...event, type: "up", text: Option.none() })
    }
  }
  if (release.length === 0) return
  const earlier = Option.isSome(state.broken) ? state.broken.value.release : []
  state.broken = Option.some({
    description: Option.isSome(state.broken) ? state.broken.value.description : description,
    release: [...earlier, ...release.reverse()]
  })
}

const bits: Readonly<Record<Mouse.Button, number>> = { left: 1, right: 2, middle: 4 }

/** One move, press and release at the same point, with no other buttons held or modifier transitions. */
export const singleClick = (events: ReadonlyArray<Adapter.InputEvent>) => {
  const [move, down, up] = events
  if (
    events.length !== 3 || move?._tag !== "Mouse" || down?._tag !== "Mouse" || up?._tag !== "Mouse" ||
    move.type !== "move" || move.buttons !== 0 || move.button !== "none" || move.clickCount !== 0 ||
    down.type !== "down" || (down.button !== "left" && down.button !== "middle" && down.button !== "right") ||
    down.buttons !== bits[down.button] || down.clickCount !== 1 ||
    up.type !== "up" || up.button !== down.button || up.buttons !== 0 || up.clickCount !== 1 ||
    move.x !== down.x || move.y !== down.y || up.x !== down.x || up.y !== down.y ||
    [move, up].some((event) =>
      event.modifiers.alt !== down.modifiers.alt || event.modifiers.control !== down.modifiers.control ||
      event.modifiers.meta !== down.modifiers.meta || event.modifiers.shift !== down.modifiers.shift
    )
  ) return undefined
  return [move, down, up] as const
}

/** The modifier flags of what is held, with `extra`. */
export const modifiers = (
  state: State,
  extra: ReadonlyArray<Keyboard.Modifier> = []
): Adapter.Modifiers => {
  const held = new Set<Keyboard.Modifier>(extra)
  for (const key of state.keys) {
    const modifier = Keys.modifierOf(key.key)
    if (modifier !== undefined) held.add(modifier)
  }
  return { alt: held.has("Alt"), control: held.has("Control"), meta: held.has("Meta"), shift: held.has("Shift") }
}

/** The buttons held, as `MouseEvent.buttons` counts them, with `extra`. */
export const buttons = (state: State, extra?: Mouse.Button): number => {
  let mask = 0
  for (const button of state.buttons) mask |= bits[button]
  return extra === undefined ? mask : mask | bits[extra]
}

/** Whether any modifier is held, or asked for: what a backend without `input.pointerModifiers` can't carry. */
export const anyModifier = (state: State, extra: ReadonlyArray<Keyboard.Modifier> = []): boolean => {
  const flags = modifiers(state, extra)
  return flags.alt || flags.control || flags.meta || flags.shift
}

const key = (
  type: "down" | "up",
  definition: Keys.Definition,
  flags: Adapter.Modifiers,
  text?: string
): Adapter.InputEvent => ({
  _tag: "Key",
  type,
  key: definition.key,
  code: definition.code,
  text: type === "down" && text !== undefined ? Option.some(text) : Option.none(),
  modifiers: flags,
  autoRepeat: false
})

/** Presses the modifiers asked for that aren't held: the events to send before a gesture, and after it. */
const withModifiers = (state: State, wanted: ReadonlyArray<Keyboard.Modifier>) => {
  const added = wanted.filter((modifier) => !state.keys.some((held) => held.key === modifier))
  const before: Array<Adapter.InputEvent> = []
  const after: Array<Adapter.InputEvent> = []
  for (const [index, modifier] of added.entries()) {
    before.push(key("down", Keys.modifier(modifier), modifiers(state, added.slice(0, index + 1))))
  }
  for (const [index, modifier] of [...added].reverse().entries()) {
    after.push(key("up", Keys.modifier(modifier), modifiers(state, [...added].reverse().slice(index + 1))))
  }
  return { before, after, flags: modifiers(state, wanted) }
}

/** The text a key inserts: none with Control, Alt or Meta, which make it a shortcut. */
const textOf = (definition: Keys.Definition, flags: Adapter.Modifiers) =>
  flags.control || flags.alt || flags.meta ? undefined : definition.text

/** One key pressed and released, with modifiers; Shift turns `a` into `A` on the layout. */
export const press = (
  state: State,
  definition: Keys.Definition,
  wanted: ReadonlyArray<Keyboard.Modifier> = [],
  layout: Keyboard.Layout = "us"
): Array<Adapter.InputEvent> => {
  const { after, before, flags } = withModifiers(state, wanted)
  const pressed = flags.shift ? Keys.withShift(definition, layout) : definition
  return [...before, key("down", pressed, flags, textOf(pressed, flags)), key("up", pressed, flags), ...after]
}

/**
 * A key or a character typed on a layout: each stroke with the Shift its layout holds for it, and
 * AltGr pressed around it as a key of its own, with the caller's modifiers; `undefined` for what isn't a key.
 */
export const type = (
  state: State,
  typed: string,
  layout: Keyboard.Layout,
  wanted: ReadonlyArray<Keyboard.Modifier> = []
): Array<Adapter.InputEvent> | undefined => {
  const strokes = Keys.strokes(typed, layout)
  if (strokes === undefined) return undefined
  return strokes.flatMap((stroke) => {
    const all: ReadonlyArray<Keyboard.Modifier> = stroke.shift && !wanted.includes("Shift")
      ? [...wanted, "Shift"]
      : wanted
    const { after, before, flags } = withModifiers(state, all)
    // A layout's own Shift already made the character: the caller's turns an unshifted one, as `press` does
    const pressed = flags.shift && !stroke.shift ? Keys.withShift(stroke.definition, layout) : stroke.definition
    return [
      ...before,
      ...(stroke.altGraph ? [key("down", Keys.altGraph, flags)] : []),
      key("down", pressed, flags, textOf(pressed, flags)),
      key("up", pressed, flags),
      ...(stroke.altGraph ? [key("up", Keys.altGraph, flags)] : []),
      ...after
    ]
  })
}

/** A key held down, for `keyboard.hold`. */
export const keyDown = (state: State, definition: Keys.Definition): Adapter.InputEvent =>
  key(
    "down",
    definition,
    modifiers(state, Keys.modifierOf(definition.key) === undefined ? [] : [Keys.modifierOf(definition.key)!]),
    textOf(definition, modifiers(state))
  )

/** A held key released. */
export const keyUp = (state: State, definition: Keys.Definition): Adapter.InputEvent =>
  key("up", definition, modifiers({ ...state, keys: state.keys.filter((held) => held !== definition) }))

type Point = { readonly x: number; readonly y: number }

const mouse = (
  type: "move" | "down" | "up",
  point: Point,
  button: "none" | Mouse.Button,
  clickCount: number,
  flags: Adapter.Modifiers,
  held: number
): Adapter.InputEvent => ({
  _tag: "Mouse",
  type,
  x: point.x,
  y: point.y,
  button,
  clickCount,
  modifiers: flags,
  buttons: held
})

/** Moves from the pointer's position to `to`, in `steps` events, the last at `to`. */
const path = (from: Point, to: Point, steps: number): Array<Point> =>
  Array.from({ length: Math.max(1, steps) }, (_, index) => {
    const share = (index + 1) / Math.max(1, steps)
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share }
  })

export const move = (
  state: State,
  to: Point,
  steps: number,
  wanted: ReadonlyArray<Keyboard.Modifier> = []
): Array<Adapter.InputEvent> => {
  const flags = modifiers(state, wanted)
  return path(state.position, to, steps).map((point) => mouse("move", point, "none", 0, flags, buttons(state)))
}

/** A move to `point`, then `clickCount` clicks there, the n-th with `clickCount: n`. */
export const click = (
  state: State,
  point: Point,
  button: Mouse.Button,
  clickCount: number,
  wanted: ReadonlyArray<Keyboard.Modifier> = []
): Array<Adapter.InputEvent> => {
  const { after, before, flags } = withModifiers(state, wanted)
  const events = [...before, mouse("move", point, "none", 0, flags, buttons(state))]
  for (let count = 1; count <= clickCount; count++) {
    events.push(mouse("down", point, button, count, flags, buttons(state, button)))
    events.push(mouse("up", point, button, count, flags, buttons(state)))
  }
  return [...events, ...after]
}

/** A press at `from`, `steps` moves with the button held, and the release at `to`, in one dispatch. */
export const drag = (
  state: State,
  from: Point,
  to: Point,
  steps: number,
  wanted: ReadonlyArray<Keyboard.Modifier> = []
): Array<Adapter.InputEvent> => {
  const { after, before, flags } = withModifiers(state, wanted)
  const held = buttons(state, "left")
  return [
    ...before,
    mouse("move", from, "none", 0, flags, buttons(state)),
    mouse("down", from, "left", 1, flags, held),
    ...path(from, to, steps).map((point) => mouse("move", point, "none", 0, flags, held)),
    mouse("up", to, "left", 1, flags, buttons(state)),
    ...after
  ]
}

/** A touch at `point`: start and end. */
export const tap = (
  state: State,
  point: Point,
  wanted: ReadonlyArray<Keyboard.Modifier> = []
): Array<Adapter.InputEvent> => {
  const { after, before, flags } = withModifiers(state, wanted)
  const points = [{ x: point.x, y: point.y, id: 1 }]
  return [
    ...before,
    { _tag: "Touch", type: "start", points, modifiers: flags },
    { _tag: "Touch", type: "end", points, modifiers: flags },
    ...after
  ]
}

/** A button pressed at the pointer and held. */
export const buttonDown = (state: State, button: Mouse.Button): Adapter.InputEvent =>
  mouse("down", state.position, button, 1, modifiers(state), buttons(state, button))

/** A held button released at the pointer. */
export const buttonUp = (state: State, button: Mouse.Button): Adapter.InputEvent => {
  const rest = new Set(state.buttons)
  rest.delete(button)
  return mouse("up", state.position, button, 1, modifiers(state), buttons({ ...state, buttons: rest }))
}

/** A wheel at the pointer. */
export const wheel = (state: State, delta: Point): Adapter.InputEvent => ({
  _tag: "Wheel",
  x: state.position.x,
  y: state.position.y,
  deltaX: delta.x,
  deltaY: delta.y,
  modifiers: modifiers(state)
})
