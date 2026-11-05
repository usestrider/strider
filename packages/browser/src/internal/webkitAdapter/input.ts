/**
 * Input, frames and file inputs on stock WebKit launched: its inspector has no Input domain, so Automation types and
 * points, and finds an iframe's frame, or an element, by what both its session and the inspector can read of it.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
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
    const page = yield* pageOf(state, id)
    // What Automation can't type is refused before anything is sent
    for (const event of events) {
      if (event._tag === "Touch") {
        return yield* Effect.fail(
          Kit.unsupported("input.touch", "WebKitGTK builds its Automation without touch (QUIRKS.md, Q214)")
        )
      }
      if (event._tag === "Key" && virtualKeys[event.key] === undefined && [...event.key].length !== 1) {
        return yield* Effect.fail(
          Kit.unsupported(
            "input.keyboardLayout",
            `stock WebKit's Automation types characters and named keys, not ${event.key}`
          )
        )
      }
    }
    const handle = yield* pageHandleOf(state, page)
    const process = yield* processOfContext(state, page.context)
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
// document, as a page's is by its own (QUIRKS.md, Q219)
const mainFrameHandle = "" as Automation.FrameHandle
const frameIdentity = "function() { return [performance.timeOrigin, location.href] }"

/** What the inspector says of a frame's current document: its time origin and URL, in the page's world. */
const identityOf = Effect.fnUntraced(function*(frame: FrameEntry) {
  const realm = pageWorldOf(frame)
  if (realm === undefined) return Option.none<string>()
  return yield* Runtime.evaluate({
    expression: `JSON.stringify((${frameIdentity})())`,
    contextId: realm.contextId as Runtime.ExecutionContextId,
    returnByValue: true,
    doNotPauseOnExceptionsAndMuteConsole: true
  }).pipe(
    Protocol.on(realm.session),
    Effect.map((reply) => reply.result.value as string),
    Effect.option
  )
})

/** What Automation says of a frame's document, by its handle. */
const automationIdentityOf = (
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle
) =>
  Automation.evaluateJavaScriptFunction({
    browsingContextHandle: handle,
    frameHandle,
    function: `function() { return JSON.stringify((${frameIdentity})()) }`,
    arguments: []
  }).pipe(
    Protocol.on(process.automation),
    Effect.map(({ result }) => resultOf(result) as Option.Option<string>),
    Effect.orElseSucceed(() => Option.none<string>())
  )

/** The page's world of a frame's current document. */
const pageWorldOf = (frame: FrameEntry) =>
  [...(frame.document?.realms ?? [])].find((each) =>
    each.world._tag === "Main" && !each.ended && each.contextId !== undefined
  )

/**
 * Whether Automation's frame is `candidate`: a mark Automation leaves on the frame's window, which the inspector
 * looks for in the candidate's, removed at once. For two frames whose documents began at the same moment at
 * the same URL.
 */
const isMarked = Effect.fnUntraced(function*(
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle,
  candidate: FrameEntry
) {
  const realm = pageWorldOf(candidate)
  if (realm === undefined) return false
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
    Effect.ensuring(inFrame(`delete window[${mark}]`).pipe(Effect.ignore))
  )
})

/** Which of `candidates` holds the document Automation's frame shows: the one alike, or the one marked. */
const matchFrame = Effect.fnUntraced(function*(
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle,
  candidates: ReadonlyArray<FrameEntry>
) {
  const theirs = yield* automationIdentityOf(process, handle, frameHandle)
  if (Option.isNone(theirs)) return Option.none<FrameEntry>()
  const alike: Array<FrameEntry> = []
  for (const candidate of candidates) {
    if (candidate.removed) continue
    const ours = yield* identityOf(candidate)
    if (Option.isSome(ours) && ours.value === theirs.value) alike.push(candidate)
  }
  if (alike.length <= 1) return Option.fromUndefinedOr(alike[0])
  for (const candidate of alike) {
    if (yield* isMarked(process, handle, frameHandle, candidate)) return Option.some(candidate)
  }
  return Option.none<FrameEntry>()
})

/** A frame's Automation handle, found by its parent's, from the main frame down. */
const frameHandleOf = (
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
    const ours = yield* identityOf(frame)
    if (Option.isNone(parent) || Option.isNone(ours)) return Option.none()
    // The parent's frames, as `window.frames` orders them, whose documents are alike
    const alike: Array<Automation.FrameHandle> = []
    for (let ordinal = 0; ordinal < 1000; ordinal++) {
      const child = yield* Automation.resolveChildFrameHandle({
        browsingContextHandle: handle,
        frameHandle: parent.value,
        ordinal
      }).pipe(Protocol.on(process.automation), Effect.map(({ result }) => result), answered)
      // Past the last frame, Automation answers with the main frame's handle (QUIRKS.md, Q227)
      if (Option.isNone(child) || child.value === mainFrameHandle) break
      const theirs = yield* automationIdentityOf(process, handle, child.value)
      if (Option.isSome(theirs) && theirs.value === ours.value) alike.push(child.value)
    }
    for (const child of alike) {
      if (alike.length === 1 || (yield* isMarked(process, handle, child, frame))) {
        state.frameHandles.set(frame, child)
        return Option.some(child)
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
  const { result } = yield* Kit.protocol(
    Runtime.callFunctionOn({
      objectId: node.binding as Runtime.RemoteObjectId,
      functionDeclaration:
        "function() { const steps = []; for (let e = this; e && e.parentElement; e = e.parentElement) { const same = [...e.parentElement.children].filter((c) => c.localName === e.localName); steps.unshift(e.localName + ':nth-of-type(' + (same.indexOf(e) + 1) + ')') } return ':root > ' + steps.join(' > ') }",
      returnByValue: true
    }).pipe(Protocol.on(target.session))
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
  if (reference === null || nodeHandle === undefined) {
    return yield* Effect.fail(Kit.gone({ _tag: "Document", id: node.document }, new L1Target.DocumentReplaced({})))
  }
  return {
    frame,
    handle,
    process,
    frameHandle: frameHandle.value,
    nodeHandle: nodeHandle as Automation.NodeHandle,
    reference
  }
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

/**
 * Replaces native files without accepting Automation's append behavior or silently ignored node handles.
 * The saved FileList permits rollback on refusal; clearing and native assignment remain separate browser turns.
 */
export const replaceFiles = Effect.fnUntraced(function*(
  process: WebKitAutomation.Process,
  handle: Automation.BrowsingContextHandle,
  frameHandle: Automation.FrameHandle,
  reference: Readonly<Record<string, string>>,
  files: ReadonlyArray<string>
) {
  const key = `__strider_files_${crypto.randomUUID().replaceAll("-", "")}`
  const evaluate = (fn: string, args: ReadonlyArray<unknown>) =>
    automationOf(
      process,
      Automation.evaluateJavaScriptFunction({
        browsingContextHandle: handle,
        frameHandle,
        function: fn,
        arguments: args.map((arg) => JSON.stringify(arg))
      })
    )
  const cleanup = (fn: string) =>
    Operation.detached(Effect.gen(function*() {
      const at = yield* BrowserClock.after(5000)
      return yield* evaluate(fn, [key]).pipe(
        Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at))
      )
    }))
  const restore = Effect.gen(function*() {
    const restored = yield* cleanup(`function(key) {
      const saved = globalThis[key];
      if (!saved) return true;
      const element = saved.element;
      if (!(element instanceof HTMLInputElement) || element.type !== "file") return false;
      element.files = saved.files;
      return true;
    }`)
    if (Option.getOrNull(resultOf(restored.result)) !== true) {
      return yield* Effect.fail(
        Kit.undecodable("Automation.evaluateJavaScriptFunction", "Could not restore the previous file selection")
      )
    }
  })
  const dispose = Effect.gen(function*() {
    const disposed = yield* cleanup(
      `function(key) {
        const saved = globalThis[key];
        if (saved) {
          saved.element.removeEventListener("input", saved.observe, true);
          globalThis.removeEventListener("input", saved.observe, true);
        }
        delete globalThis[key];
        return !Object.hasOwn(globalThis, key);
      }`
    )
    if (Option.getOrNull(resultOf(disposed.result)) !== true) {
      return yield* Effect.fail(
        Kit.undecodable("Automation.evaluateJavaScriptFunction", "Could not release the saved file selection")
      )
    }
  })
  yield* Effect.gen(function*() {
    const prepared = yield* evaluate(
      `function(element, key) {
      if (!(element instanceof HTMLInputElement) || element.type !== "file" || !element.isConnected) return false;
      const saved = { element, files: element.files, accepted: false, observe: null };
      saved.observe = (event) => {
        if (event.isTrusted && (event.target === element || event.composedPath().includes(element))) saved.accepted = true;
      };
      Object.defineProperty(globalThis, key, { value: saved, configurable: true });
      element.addEventListener("input", saved.observe, true);
      globalThis.addEventListener("input", saved.observe, true);
      // Replacing the FileList preserves the saved object; value = "" clears that object in place.
      element.files = new DataTransfer().files;
      return true;
    }`,
      [reference, key]
    )
    if (Option.getOrNull(resultOf(prepared.result)) !== true) {
      return yield* Effect.fail(Kit.undecodable("Automation.evaluateJavaScriptFunction", "No replacement file input"))
    }
    if (files.length > 0) {
      yield* automationOf(
        process,
        Automation.setFilesForInputFileUpload({
          browsingContextHandle: handle,
          frameHandle,
          nodeHandle: Object.values(reference)[0] as Automation.NodeHandle,
          filenames: [...files]
        })
      )
    }
    const confirmed = yield* evaluate(
      `function(key, count) {
      const saved = globalThis[key];
      if (!saved) return false;
      // Native delivery proves assignment even when a handler resets or removes the input.
      if (saved.accepted) return true;
      const element = saved.element;
      if (!element.isConnected || element.type !== "file" || element.files.length !== count) return false;
      if (count === 0) {
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }`,
      [key, files.length]
    )
    // Automation can acknowledge an invalid node handle without setting anything. Restore rather than accept it.
    if (Option.getOrNull(resultOf(confirmed.result)) !== true) {
      return yield* Effect.fail(
        Kit.undecodable("Automation.setFilesForInputFileUpload", "The replacement file selection was not populated")
      )
    }
  }).pipe(
    Effect.onError((cause) =>
      restore.pipe(
        Effect.orDie,
        Effect.catchCause((rollback) => Effect.failCause(Cause.combine(cause, rollback))),
        Effect.orDie
      )
    ),
    Effect.ensuring(
      dispose.pipe(
        Effect.catch((error) => Effect.logWarning("WebKit saved file selection cleanup failed", error))
      )
    )
  )
})

/** Replaces a file input's files, restoring its saved selection when the native command refuses. */
export const setInputFilesLaunched = Effect.fnUntraced(function*(
  state: State,
  node: Adapter.NodeBinding,
  files: ReadonlyArray<string>
) {
  const { frameHandle, handle, reference, process } = yield* nodeHandleOf(state, node)
  yield* replaceFiles(process, handle, frameHandle, reference, files)
})
