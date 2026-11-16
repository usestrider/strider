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
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import { buttons, keyValue } from "./mapping.ts"
import { documentOf, navigableById, type NavigableEntry, navigableOf, type State } from "./state.ts"

/** A context pointer input goes on, the origin of its viewport in the page's coordinates, and its size. */
export interface PointerTarget {
  readonly navigable: NavigableEntry
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The context pointer input that names no frame goes on at a point in the page's coordinates, and its origin.
 * Firefox delivers page coordinates into a frame of the page's origin but not into one of another, so in a context
 * holding a frame whose origin isn't its parent's (`crossesOrigin`) the point is hit-tested in a sandbox, one call a
 * level, through open shadow roots, and where it lands on a frame's element, input goes to that frame's context,
 * from the element's content box. A context holding none costs no call; a point that hits no frame element ends the
 * search where it is.
 */
const framelessContext = Effect.fnUntraced(function*(state: State, page: NavigableEntry, x: number, y: number) {
  let sent: PointerTarget = { navigable: page, x: 0, y: 0, width: Infinity, height: Infinity }
  while (crossesOrigin(sent.navigable)) {
    const reply = yield* Kit.protocol(state.send(Script.callFunction({
      functionDeclaration: hitFrame,
      target: { context: sent.navigable.bidi, sandbox: "__strider_utility__" },
      arguments: [{ type: "number", value: x - sent.x }, { type: "number", value: y - sent.y }],
      awaitPromise: false,
      resultOwnership: "none"
    })))
    const value = reply.type === "success" && reply.result.type === "array" ? reply.result.value : undefined
    const [window, ...box] = value ?? []
    const numbers = box.map((each) => each.type === "number" && typeof each.value === "number" ? each.value : NaN)
    const child = window?.type === "window" ? navigableOf(state, window.value.context) : undefined
    if (child === undefined || child.page !== page || numbers.length !== 4 || numbers.some(Number.isNaN)) return sent
    sent = {
      navigable: child,
      x: sent.x + numbers[0]!,
      y: sent.y + numbers[1]!,
      width: numbers[2]!,
      height: numbers[3]!
    }
  }
  return sent
})

/** The origin of a context's document; one at `about:` has its parent's, as `about:blank` and `srcdoc` do. */
const originOf = (navigable: NavigableEntry): string | undefined => {
  const url = navigable.document?.url
  if (url === undefined || url.startsWith("about:")) {
    return navigable.parent === undefined ? undefined : originOf(navigable.parent)
  }
  return URL.parse(url)?.origin
}

/**
 * Whether a context holds, at any depth, a frame whose origin isn't its parent's. Origin is narrower than site, so
 * this also holds for a frame of the same site and another origin, which costs a call it didn't need.
 */
const crossesOrigin = (navigable: NavigableEntry): boolean =>
  [...navigable.children].some((child) => originOf(child) !== originOf(navigable) || crossesOrigin(child))

/**
 * The window of the frame element at a point, through open shadow roots, and its content box: left, top, width and
 * height.
 */
const hitFrame = `(x, y) => {
  let element = document.elementFromPoint(x, y)
  while (element !== null && element.shadowRoot !== null) {
    const inner = element.shadowRoot.elementFromPoint(x, y)
    if (inner === null || inner === element) break
    element = inner
  }
  if (element === null || (element.localName !== "iframe" && element.localName !== "frame") || element.contentWindow === null) return null
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  const left = rect.left + element.clientLeft + parseFloat(style.paddingLeft)
  const top = rect.top + element.clientTop + parseFloat(style.paddingTop)
  const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  return [element.contentWindow, left, top, width, height]
}`

/**
 * Where a page's held input went, while the context it went to is still there. A context destroyed while it holds
 * the pointer ends the capture, and the input after goes by its point again.
 */
const captured = (
  state: State,
  capture: Map<L1Target.NavigableId, PointerTarget>,
  page: L1Target.NavigableId
): PointerTarget | undefined => {
  const held = capture.get(page)
  if (held === undefined) return undefined
  if (!held.navigable.removed && state.navigablesById.get(held.navigable.id) === held.navigable) return held
  capture.delete(page)
  return undefined
}

/** A source of actions as it is built, its actions added in order. */
type Building =
  | {
    readonly context: BrowsingContext
    readonly type: "pointer"
    readonly id: "strider-mouse" | "strider-touch"
    readonly parameters: Input.PointerParameters
    readonly actions: Array<Input.PointerSourceAction>
  }
  | {
    readonly context: BrowsingContext
    readonly type: "wheel"
    readonly id: "strider-wheel"
    readonly actions: Array<Input.WheelSourceAction>
  }
  | {
    readonly context: BrowsingContext
    readonly type: "key"
    readonly id: "strider-keyboard"
    readonly actions: Array<Input.KeySourceAction>
  }

type BrowsingContext = NavigableEntry["bidi"]

export const dispatchInput = Effect.fnUntraced(
  function*(
    state: State,
    id: L1Target.NavigableId,
    events: ReadonlyArray<Adapter.InputEvent>,
    frame?: { readonly frame: L1Target.NavigableId; readonly origin: { readonly x: number; readonly y: number } },
    lands?: ReadonlyArray<L1Target.NavigableId>
  ) {
    // Input that names neither a frame nor where its points land, as the page's devices send it; a locator names
    // both, having checked what its points hit
    const frameless = frame === undefined && lands === undefined
    // Whatever fails before the actions are written sent nothing
    const navigable = yield* navigableById(state, id).pipe(Effect.mapError(Adapter.unsent))
    // Firefox doesn't deliver page coordinates into a frame of another origin, so input aimed inside a frame goes to
    // the frame's own context, in its own coordinates
    const target = frame === undefined ? undefined : state.navigablesById.get(frame.frame)
    const named: PointerTarget = {
      navigable: target ?? navigable.page,
      x: target === undefined || frame === undefined ? 0 : frame.origin.x,
      y: target === undefined || frame === undefined ? 0 : frame.origin.y,
      width: Infinity,
      height: Infinity
    }
    let sent = named
    let aimed: { readonly x: number; readonly y: number; readonly sent: PointerTarget } | undefined
    // Pointer input that names no frame goes to the context under each event's point, once for consecutive events
    // at one point; from a press until every button is up, or from a touch's start until its end, it goes where the
    // press or the start went
    const aim = Effect.fnUntraced(function*(
      x: number,
      y: number,
      capture?: Map<L1Target.NavigableId, PointerTarget>
    ) {
      if (!frameless) return named
      const held = capture === undefined ? undefined : captured(state, capture, navigable.page.id)
      if (held !== undefined) return held
      if (aimed === undefined || aimed.x !== x || aimed.y !== y) {
        // Every action is written after the loop, so a lookup fails with nothing sent
        aimed = {
          x,
          y,
          sent: yield* framelessContext(state, navigable.page, x, y).pipe(Effect.mapError(Adapter.unsent))
        }
      }
      return aimed.sent
    })
    // Firefox refuses a point outside the viewport of the context it is sent to. A pointer held in a frame and
    // moved outside it stays at its last point in the frame, and its release is sent there, so the frame that got
    // the press gets the release
    const inside = (x: number, y: number) =>
      x - sent.x >= 0 && y - sent.y >= 0 && x - sent.x < sent.width && y - sent.y < sent.height
    const dx = () => sent.x
    const dy = () => sent.y
    // Consecutive events of one kind to one context go in one source of actions, in order
    const sources: Array<Building> = []
    const pointer = (id: "strider-mouse" | "strider-touch") => {
      const last = sources.at(-1)
      if (last?.type === "pointer" && last.id === id && last.context === sent.navigable.bidi) return last.actions
      const actions: Array<Input.PointerSourceAction> = []
      sources.push({
        context: sent.navigable.bidi,
        type: "pointer",
        id,
        parameters: { pointerType: id === "strider-mouse" ? "mouse" : "touch" },
        actions
      })
      return actions
    }
    const wheel = () => {
      const last = sources.at(-1)
      if (last?.type === "wheel" && last.context === sent.navigable.bidi) return last.actions
      const actions: Array<Input.WheelSourceAction> = []
      sources.push({ context: sent.navigable.bidi, type: "wheel", id: "strider-wheel", actions })
      return actions
    }
    const key = () => {
      const last = sources.at(-1)
      if (last?.type === "key") return last.actions
      const actions: Array<Input.KeySourceAction> = []
      sources.push({ context: named.navigable.bidi, type: "key", id: "strider-keyboard", actions })
      return actions
    }
    for (const event of events) {
      switch (event._tag) {
        case "Mouse": {
          sent = yield* aim(event.x, event.y, state.mouseCapture)
          if (frameless) {
            if (event.buttons === 0) state.mouseCapture.delete(navigable.page.id)
            else state.mouseCapture.set(navigable.page.id, sent)
          }
          const actions = pointer("strider-mouse")
          const button = buttons[event.button] ?? 0
          if (inside(event.x, event.y)) actions.push({ type: "pointerMove", x: event.x - dx(), y: event.y - dy() })
          if (event.type !== "move") actions.push({ type: event.type === "down" ? "pointerDown" : "pointerUp", button })
          break
        }
        case "Wheel":
          // A wheel goes to what is under its point, a button held or not
          sent = yield* aim(event.x, event.y)
          wheel().push({
            type: "scroll",
            x: Math.round(event.x - dx()),
            y: Math.round(event.y - dy()),
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
          const first = event.points[0]
          sent = first === undefined
            ? captured(state, state.touchCapture, navigable.page.id) ?? named
            : yield* aim(first.x, first.y, state.touchCapture)
          if (frameless) {
            if (event.type === "end" || event.type === "cancel") state.touchCapture.delete(navigable.page.id)
            else state.touchCapture.set(navigable.page.id, sent)
          }
          const actions = pointer("strider-touch")
          for (const point of event.points) {
            if ((event.type === "move" || event.type === "start") && inside(point.x, point.y)) {
              actions.push({ type: "pointerMove", x: point.x - dx(), y: point.y - dy() })
            }
            if (event.type === "start") actions.push({ type: "pointerDown", button: 0 })
            if (event.type === "end" || event.type === "cancel") actions.push({ type: "pointerUp", button: 0 })
          }
          break
        }
      }
    }
    for (const source of sources) {
      const { context, ...action } = source
      if (action.actions.length === 0) continue
      yield* Kit.protocol(state.send(Input.performActions({ context, actions: [action] })))
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
