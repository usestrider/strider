/**
 * Input, frames and file inputs on stock WebKit launched: its inspector has no Input domain, so Automation types and
 * points, and finds an iframe's frame, or an element, by what both its session and the inspector can read of it.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type * as WebKitAutomation from "../webkitAutomation.ts"
import { automationOf, pageHandleOf, processOfContext, resultOf, settleDialog } from "./automation.ts"
import { answered, documentOf, type FrameEntry, pageOf, type State, targetOf } from "./state.ts"

// ── Input ─────────────────────────────────────────────────────────────────────────────────────────────────

const virtualKeys: Readonly<Record<string, Automation.VirtualKey>> = {
  Shift: "Shift",
  Control: "Control",
  Alt: "Alternate",
  Meta: "Meta",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Escape: "Escape",
  ArrowLeft: "LeftArrow",
  ArrowRight: "RightArrow",
  ArrowUp: "UpArrow",
  ArrowDown: "DownArrow",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Delete: "Delete",
  Insert: "Insert",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `Function${index + 1}`]))
} as Readonly<Record<string, Automation.VirtualKey>>
const heldKeys = (modifiers: Adapter.Modifiers): Array<Automation.VirtualKey> => [
  ...(modifiers.shift ? ["Shift" as const] : []),
  ...(modifiers.control ? ["Control" as const] : []),
  ...(modifiers.alt ? ["Alternate" as const] : []),
  ...(modifiers.meta ? ["Meta" as const] : [])
]
const capitalized = (button: string) => (button.charAt(0).toUpperCase() + button.slice(1)) as Automation.MouseButton
const heldButton = (buttons: number): Automation.MouseButton | undefined =>
  buttons & 1
    ? "Left"
    : buttons & 2
    ? "Right"
    : buttons & 4
    ? "Middle"
    : buttons & 8
    ? "Back"
    : buttons & 16
    ? "Forward"
    : undefined
// Only sources WebKitGTK builds: touch isn't, and a touch source asserts (QUIRKS.md, Q214)
const source = (kind: "Mouse" | "Keyboard" | "Wheel") =>
  ({ sourceId: kind.toLowerCase(), sourceType: kind }) as unknown as Automation.InputSource
/**
 * Input as Automation simulates it: each event a step of the input sources' states, trusted. A session's wheel
 * scrolls by the difference between its states, which outlive a sequence: each process's wheel state so far
 * (QUIRKS.md, Q223).
 */
export const dispatchInputLaunched = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, events: ReadonlyArray<Adapter.InputEvent>) {
    // Whatever fails before the first sequence is written sent nothing
    const page = yield* pageOf(state, id).pipe(Effect.mapError(Adapter.unsent))
    // What Automation can't type is refused before anything is sent
    for (const event of events) {
      if (event._tag === "Touch") {
        return yield* Effect.fail(Adapter.unsent(
          Kit.unsupported("input.touch", "WebKitGTK builds its Automation without touch (QUIRKS.md, Q214)")
        ))
      }
      if (event._tag === "Key" && virtualKeys[event.key] === undefined && [...event.key].length !== 1) {
        return yield* Effect.fail(Adapter.unsent(
          Kit.unsupported(
            "input.keyboardLayout",
            `stock WebKit's Automation types characters and named keys, not ${event.key}`
          )
        ))
      }
    }
    const handle = yield* pageHandleOf(state, page).pipe(Effect.mapError(Adapter.unsent))
    const process = yield* processOfContext(state, page.context).pipe(Effect.mapError(Adapter.unsent))
    let wheel = state.wheelStates.get(process.key)
    if (wheel === undefined) state.wheelStates.set(process.key, wheel = { width: 0, height: 0 })
    // The events up to text to insert, as one sequence: a sequence's end forgets a click, so a second click
    // in another is never a double click (QUIRKS.md, Q223)
    let steps: Array<ReadonlyArray<Record<string, unknown>>> = []
    const flush = Effect.suspend(() => {
      if (steps.length === 0) return Effect.void
      const sent = steps
      steps = []
      return automationOf(
        process,
        Automation.performInteractionSequence({
          handle,
          inputSources: (["Keyboard", "Mouse", "Wheel"] as const).map(source),
          steps: sent.map((states) => ({ states: states as unknown as Array<Automation.InputSourceState> }))
        })
      ).pipe(Effect.andThen(settleDialog(state, page, handle, process)))
    })
    const insert = (interactions: ReadonlyArray<Automation.KeyboardInteraction>) =>
      automationOf(process, Automation.performKeyboardInteractions({ handle, interactions: [...interactions] }))
        .pipe(Effect.andThen(settleDialog(state, page, handle, process)))
    for (const event of events) {
      switch (event._tag) {
        case "Mouse": {
          // A state makes an event only when it names its interaction; the button is the one it moves
          const button = event.button === "none" ? heldButton(event.buttons) : capitalized(event.button)
          steps.push([
            { sourceId: "keyboard", pressedVirtualKeys: heldKeys(event.modifiers) },
            {
              sourceId: "mouse",
              origin: "Viewport",
              location: { x: Math.round(event.x), y: Math.round(event.y) },
              mouseInteraction: event.type === "move" ? "Move" : event.type === "down" ? "Down" : "Up",
              ...(button === undefined ? {} : { pressedButton: button })
            }
          ])
          break
        }
        case "Wheel":
          wheel.width += Math.round(event.deltaX)
          wheel.height += Math.round(event.deltaY)
          steps.push([
            { sourceId: "keyboard", pressedVirtualKeys: heldKeys(event.modifiers) },
            {
              sourceId: "wheel",
              origin: "Viewport",
              location: { x: Math.round(event.x), y: Math.round(event.y) },
              delta: { width: wheel.width, height: wheel.height }
            }
          ])
          break
        case "Key": {
          const named = virtualKeys[event.key]
          const held = heldKeys(event.modifiers)
          const pressed = event.type === "down"
          steps.push([{
            sourceId: "keyboard",
            pressedVirtualKeys: pressed && named !== undefined && !held.includes(named) ? [...held, named] : held,
            ...(pressed && named === undefined ? { pressedCharKey: event.key } : {})
          }])
          break
        }
        case "InsertText": {
          yield* flush
          // WebKitGTK types no newline: each is pressed as Enter (QUIRKS.md, Q223)
          const lines = event.text.split(/\r\n|\r|\n/)
          yield* insert(lines.flatMap((line, index): Array<Automation.KeyboardInteraction> => [
            ...(index === 0 ? [] : [{ type: "InsertByKey", key: "Enter" } as Automation.KeyboardInteraction]),
            ...(line === "" ? [] : [{ type: "InsertByKey", text: line } as Automation.KeyboardInteraction])
          ]))
          break
        }
      }
    }
    yield* flush
  }
)

// ── Frames and nodes ──────────────────────────────────────────────────────────────────────────────────────

// A frame's Automation handle: the main frame's is "", a child's found among its parent's children by its
// window mark (QUIRKS.md, Q228); page pairing remains separate (Q219)
const mainFrameHandle = "" as Automation.FrameHandle
/** The page's world of a frame's current document. */
const pageWorldOf = (frame: FrameEntry) =>
  [...(frame.document?.realms ?? [])].find((each) =>
    each.world._tag === "Main" && !each.ended && each.contextId !== undefined
  )

/**
 * Whether Automation's frame is `candidate`: a mark Automation leaves on the frame's window, which the inspector
 * looks for in the candidate's, removed at once. Every new child-frame pairing is confirmed this way.
 */
const isMarked = Effect.fnUntraced(function*(
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle,
  candidate: FrameEntry
) {
  const document = candidate.document
  const realm = pageWorldOf(candidate)
  if (candidate.removed || realm === undefined) return false
  const mark = JSON.stringify(`__strider_frame_${crypto.randomUUID().replaceAll("-", "")}`)
  const inFrame = (body: string) =>
    Automation.evaluateJavaScriptFunction({
      browsingContextHandle: handle,
      frameHandle,
      function: `function() { ${body} }`,
      arguments: []
    }).pipe(Protocol.on(process.automation))
  return yield* inFrame(`Object.defineProperty(window, ${mark}, { value: true, configurable: true })`).pipe(
    Effect.andThen(
      Runtime.evaluate({
        expression: `Object.hasOwn(window, ${mark})`,
        contextId: realm.contextId as Runtime.ExecutionContextId,
        returnByValue: true,
        doNotPauseOnExceptionsAndMuteConsole: true
      }).pipe(Protocol.on(realm.session))
    ),
    Effect.map((reply) => reply.result.value === true),
    Effect.orElseSucceed(() => false),
    Effect.ensuring(inFrame(`delete window[${mark}]`).pipe(Effect.ignore)),
    Effect.map((confirmed) => confirmed && !candidate.removed && candidate.document === document && !realm.ended)
  )
})

/** Which of `candidates` is Automation's frame, confirmed by a temporary mark on its window. */
export const matchFrame = Effect.fnUntraced(function*(
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle,
  candidates: ReadonlyArray<FrameEntry>
) {
  for (const candidate of candidates) {
    if (yield* isMarked(process, handle, frameHandle, candidate)) return Option.some(candidate)
  }
  return Option.none<FrameEntry>()
})

/** A frame's Automation handle, found by its parent's, from the main frame down. */
export const frameHandleOf = (
  state: State,
  frame: FrameEntry,
  handle: Automation.BrowsingContextHandle,
  process: WebKitAutomation.Process
): Effect.Effect<Option.Option<Automation.FrameHandle>, Adapter.AdapterError> =>
  Effect.gen(function*() {
    if (frame.parent === undefined) return Option.some(mainFrameHandle)
    const known = state.frameHandles.get(frame)
    if (known !== undefined) return Option.some(known)
    const parent = yield* frameHandleOf(state, frame.parent, handle, process)
    if (Option.isNone(parent)) return Option.none()
    // Confirm each child window in the parent's frame order; document fingerprints are not identity.
    for (let ordinal = 0; ordinal < 1000; ordinal++) {
      const child = yield* Automation.resolveChildFrameHandle({
        browsingContextHandle: handle,
        frameHandle: parent.value,
        ordinal
      }).pipe(Protocol.on(process.automation), Effect.map(({ result }) => result), answered)
      // Past the last frame, Automation answers with the main frame's handle (QUIRKS.md, Q227)
      if (Option.isNone(child) || child.value === mainFrameHandle) break
      if (yield* isMarked(process, handle, child.value, frame)) {
        state.frameHandles.set(frame, child.value)
        return Option.some(child.value)
      }
    }
    return Option.none()
  })

/** An element as Automation's node handle in its frame, found by its path from the inspector's object. */
const nodeHandleOf = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding) {
  const document = yield* documentOf(state, node.document)
  const frame = document.frame
  const target = yield* targetOf(frame.page)
  const handle = yield* pageHandleOf(state, frame.page)
  const process = yield* processOfContext(state, frame.page.context)
  const frameHandle = yield* frameHandleOf(state, frame, handle, process)
  if (Option.isNone(frameHandle)) {
    return yield* Effect.fail(Kit.gone({ _tag: "Document", id: node.document }, new L1Target.DocumentReplaced({})))
  }
  // WebKit's binding is the element's object id, in the page's world
  const { result } = yield* (
    Runtime.callFunctionOn({
      objectId: node.binding as Runtime.RemoteObjectId,
      functionDeclaration:
        "function() { const steps = []; for (let e = this; e && e.parentElement; e = e.parentElement) { const same = [...e.parentElement.children].filter((c) => c.localName === e.localName); steps.unshift(e.localName + ':nth-of-type(' + (same.indexOf(e) + 1) + ')') } return ':root > ' + steps.join(' > ') }",
      returnByValue: true
    }).pipe(
      Protocol.on(target.session),
      Effect.mapError((error) =>
        error.reason._tag === "Rejected" && error.reason.reason === "NoSuchObject"
          ? Kit.gone({ _tag: "Document", id: node.document }, new L1Target.DocumentReplaced({}))
          : Kit.protocolError(error)
      )
    )
  )
  const found = yield* automationOf(
    process,
    Automation.evaluateJavaScriptFunction({
      browsingContextHandle: handle,
      frameHandle: frameHandle.value,
      function: "function(path) { return document.querySelector(path) }",
      arguments: [JSON.stringify(result.value)]
    })
  )
  const reference = Option.getOrNull(resultOf(found.result)) as Record<string, string> | null
  const nodeHandle = reference === null ? undefined : Object.values(reference)[0]
  // An element its document no longer holds
  if (nodeHandle === undefined) {
    return yield* Effect.fail(Kit.gone({ _tag: "Document", id: node.document }, new L1Target.DocumentReplaced({})))
  }
  return { frame, handle, process, frameHandle: frameHandle.value, nodeHandle: nodeHandle as Automation.NodeHandle }
})

/** The frame an iframe holds, as Automation resolves it, then the inspector's frame showing the same document. */
export const contentFrameLaunched = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding) {
  const { frame, frameHandle, handle, nodeHandle, process } = yield* nodeHandleOf(state, node)
  const child = yield* Automation.resolveChildFrameHandle({
    browsingContextHandle: handle,
    frameHandle,
    nodeHandle
  })
    .pipe(Protocol.on(process.automation), Effect.map(({ result }) => result), answered)
  // An element that holds no frame, or one whose document hasn't loaded yet; the main frame's handle is
  // Automation's answer for no frame at all (QUIRKS.md, Q227)
  if (Option.isNone(child) || child.value === mainFrameHandle) return Option.none<L1Target.NavigableId>()
  const matched = yield* matchFrame(process, handle, child.value, [...frame.children])
  if (Option.isNone(matched)) return Option.none<L1Target.NavigableId>()
  state.frameHandles.set(matched.value, child.value)
  return Option.some(matched.value.id)
})

/** A file input's files, through the element Automation finds by its path: nothing is clicked or marked. */
export const setInputFilesLaunched = Effect.fnUntraced(function*(
  state: State,
  node: Adapter.NodeBinding,
  files: ReadonlyArray<string>
) {
  const { frameHandle, handle, nodeHandle, process } = yield* nodeHandleOf(state, node)
  yield* automationOf(
    process,
    Automation.setFilesForInputFileUpload({
      browsingContextHandle: handle,
      frameHandle,
      nodeHandle,
      filenames: [...files]
    })
  )
})
