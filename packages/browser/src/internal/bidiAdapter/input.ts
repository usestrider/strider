/**
 * Input on BiDi: WebDriver actions, consecutive events of one kind in one batch; files set on an input; and the
 * frame an iframe element holds.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Input from "../../bidi-protocol/Input.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import type * as L1Target from "../../Target.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { buttons, keyValue } from "./mapping.ts"
import { documentOf, navigableById, navigableOf, type State } from "./state.ts"

/** A source of actions as it is built, its actions added in order. */
type Building =
  | {
    readonly type: "pointer"
    readonly id: "strider-mouse" | "strider-touch"
    readonly parameters: Input.PointerParameters
    readonly actions: Array<Input.PointerSourceAction>
  }
  | { readonly type: "wheel"; readonly id: "strider-wheel"; readonly actions: Array<Input.WheelSourceAction> }
  | { readonly type: "key"; readonly id: "strider-keyboard"; readonly actions: Array<Input.KeySourceAction> }

export const dispatchInput = Effect.fnUntraced(
  function*(
    state: State,
    id: L1Target.NavigableId,
    events: ReadonlyArray<Adapter.InputEvent>,
    frame?: { readonly frame: L1Target.NavigableId; readonly origin: { readonly x: number; readonly y: number } }
  ) {
    const navigable = yield* navigableById(state, id)
    // Firefox doesn't deliver page coordinates into a cross-site frame, so input aimed inside a frame goes to
    // the frame's own context, in its own coordinates
    const target = frame === undefined ? undefined : state.navigablesById.get(frame.frame)
    const context = (target ?? navigable.page).bidi
    const dx = target === undefined || frame === undefined ? 0 : frame.origin.x
    const dy = target === undefined || frame === undefined ? 0 : frame.origin.y
    // Consecutive events of one kind go in one source of actions, in order
    const sources: Array<Building> = []
    const pointer = (id: "strider-mouse" | "strider-touch") => {
      const last = sources.at(-1)
      if (last?.type === "pointer" && last.id === id) return last.actions
      const actions: Array<Input.PointerSourceAction> = []
      sources.push({
        type: "pointer",
        id,
        parameters: { pointerType: id === "strider-mouse" ? "mouse" : "touch" },
        actions
      })
      return actions
    }
    const wheel = () => {
      const last = sources.at(-1)
      if (last?.type === "wheel") return last.actions
      const actions: Array<Input.WheelSourceAction> = []
      sources.push({ type: "wheel", id: "strider-wheel", actions })
      return actions
    }
    const key = () => {
      const last = sources.at(-1)
      if (last?.type === "key") return last.actions
      const actions: Array<Input.KeySourceAction> = []
      sources.push({ type: "key", id: "strider-keyboard", actions })
      return actions
    }
    for (const event of events) {
      switch (event._tag) {
        case "Mouse": {
          const actions = pointer("strider-mouse")
          const button = buttons[event.button] ?? 0
          actions.push({ type: "pointerMove", x: Math.round(event.x - dx), y: Math.round(event.y - dy) })
          if (event.type !== "move") actions.push({ type: event.type === "down" ? "pointerDown" : "pointerUp", button })
          break
        }
        case "Wheel":
          wheel().push({
            type: "scroll",
            x: Math.round(event.x - dx),
            y: Math.round(event.y - dy),
            deltaX: Math.round(event.deltaX),
            deltaY: Math.round(event.deltaY)
          })
          break
        case "Key":
          // WebDriver BiDi sends a key as its value alone: it has no AltGr or dead key, and the character a
          // layout's strokes type is sent as itself
          if (event.key === "AltGraph" || event.key === "Dead") break
          key().push({
            type: event.type === "down" ? "keyDown" : "keyUp",
            value: Redacted.make(keyValue(event.key))
          })
          break
        case "InsertText":
          for (const character of event.text) {
            key().push(
              { type: "keyDown", value: Redacted.make(character) },
              { type: "keyUp", value: Redacted.make(character) }
            )
          }
          break
        case "Touch": {
          const actions = pointer("strider-touch")
          for (const point of event.points) {
            if (event.type === "move" || event.type === "start") {
              actions.push({ type: "pointerMove", x: Math.round(point.x - dx), y: Math.round(point.y - dy) })
            }
            if (event.type === "start") actions.push({ type: "pointerDown", button: 0 })
            if (event.type === "end" || event.type === "cancel") actions.push({ type: "pointerUp", button: 0 })
          }
          break
        }
      }
    }
    for (const source of sources) {
      yield* Kit.protocol(state.send(Input.performActions({ context, actions: [source] })))
    }
  }
)

export const setInputFiles = Effect.fnUntraced(
  function*(state: State, node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
    const document = yield* documentOf(state, node.document)
    yield* Kit.protocol(state.send(Input.setFiles({
      context: document.navigable.bidi,
      element: { sharedId: node.binding as Script.SharedId },
      files: [...files]
    })))
  }
)

/** An iframe's window proxy names its browsing context, which is the frame. */
export const contentFrame = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding) {
  const document = yield* documentOf(state, node.document)
  const reply = yield* Kit.protocol(state.send(Script.callFunction({
    functionDeclaration: "(element) => element.contentWindow",
    target: { context: document.navigable.bidi, sandbox: "__strider_utility__" },
    arguments: [{ sharedId: node.binding as Script.SharedId }],
    awaitPromise: false,
    resultOwnership: "none"
  })))
  const context = reply.type === "success" && reply.result.type === "window" ? reply.result.value.context : undefined
  return Option.fromUndefinedOr(navigableOf(state, context)?.id)
})
