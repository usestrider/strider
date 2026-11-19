/**
 * Input on CDP: the `Input` domain's mouse, wheel, key, text and touch events, in the page's coordinates on its
 * session, or, aimed into an out-of-process frame, in that frame's on its own; HTML drags, intercepted so that
 * Strider finishes them with drag events, a held move that starts one known from the page's `dragstart`, and
 * Escape canceling one; and the elements input acts on by binding: an iframe's frame, a file input's files.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as DOM from "../../cdp/DOM.ts"
import * as Input from "../../cdp/Input.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Gestures from "../input.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import * as Evaluation from "./evaluation.ts"
import { heldButton, keyCode, keyLocation, modifierBits } from "./mapping.ts"
import {
  closingOf,
  type DocumentEntry,
  documentOf,
  type DragEntry,
  type Event,
  frameById,
  type FrameEntry,
  frameOf,
  type PageEntry,
  pageOf,
  realmOf,
  type State,
  type TargetEntry
} from "./state.ts"

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers.on(Input.dragIntercepted, (params, { state, target }) => {
    // Chromium hands an intercepted drag to the client, which finishes it with drag events
    if (target?.page !== undefined && !target.page.ended) {
      const stale = (state.heldButtons.get(target.page.id) ?? 0) === 0
      state.drags.set(target.page.id, { data: params.data, entered: false, at: undefined, stale })
    }
  })

const mouseCommand = (
  event: Extract<Adapter.InputEvent, { _tag: "Mouse" }>,
  origin: { readonly x: number; readonly y: number }
) =>
  Input.dispatchMouseEvent({
    type: event.type === "move" ? "mouseMoved" : event.type === "down" ? "mousePressed" : "mouseReleased",
    x: event.x - origin.x,
    y: event.y - origin.y,
    // Chromium starts an HTML drag only when the move names the button held.
    button: event.type === "move" ? heldButton(event.buttons) : event.button,
    buttons: event.buttons,
    clickCount: event.clickCount,
    modifiers: modifierBits(event.modifiers)
  })

/**
 * The drag events a mouse event of an intercepted drag sends. The move that starts the drag enters it, each later
 * move drags over, even to the same point, and the release drops it. Chromium's `drop` fires a `dragover` before the
 * `drop`, so the page sees the drag events a drag of Chromium's own fires, in the same number; only the first
 * `dragover` comes at the next move or the drop, where Chromium's own drag fires it with the `dragenter`.
 */
const dragEvents = Effect.fnUntraced(function*(
  state: State,
  page: PageEntry,
  drag: DragEntry,
  event: Extract<Adapter.InputEvent, { _tag: "Mouse" }>,
  sent: { readonly target: TargetEntry; readonly x: number; readonly y: number }
) {
  const dragEvent = (type: "dragEnter" | "dragOver" | "drop") =>
    Kit.protocol(
      Input.dispatchDragEvent({
        type,
        x: event.x - sent.x,
        y: event.y - sent.y,
        data: drag.data,
        modifiers: modifierBits(event.modifiers)
      }).pipe(Protocol.on(sent.target.session))
    )
  if (event.type === "up") {
    state.drags.delete(page.id)
    if (event.buttons === 0) releasePress(state, page)
  }
  drag.at = { target: sent.target, x: event.x - sent.x, y: event.y - sent.y }
  if (!drag.entered) {
    drag.entered = true
    yield* dragEvent("dragEnter")
    if (event.type !== "up") return
  }
  yield* dragEvent(event.type === "up" ? "drop" : "dragOver")
})

/** Forgets where a page's press went, once every button is released. */
export const releasePress = (state: State, page: PageEntry) => {
  state.pressedIn.delete(page.id)
  state.pressedOn.delete(page.id)
}

/**
 * The documents a held move's drag may start in: those the press and the move land in, or, where the gesture names
 * none, every document of the page.
 */
const dragDocuments = (
  state: State,
  page: PageEntry,
  pressed: ReadonlyArray<FrameEntry> | undefined,
  landed: ReadonlyArray<FrameEntry>
): ReadonlyArray<DocumentEntry> => {
  const frames = pressed === undefined || pressed.length === 0 || landed.length === 0
    ? [...state.frames.values()].filter((frame) => frame.page === page)
    : [...new Set([...pressed, ...landed])]
  return frames.flatMap((frame) => frame.document === undefined ? [] : [frame.document])
}

const dragWorld = { _tag: "Isolated", name: "__strider_utility__" } as const

/**
 * The document generation each realm of Strider's own world watches `dragstart` in: `document.open()` keeps the
 * realm but drops the window's listeners, so a new generation is watched again.
 */
const watching = new WeakMap<object, number>()

const dragCall = (functionDeclaration: string): Adapter.EvaluationCall => ({
  functionDeclaration,
  arguments: [],
  awaitPromise: false,
  result: "value",
  userActivation: false
})

/**
 * Watches a document for the trusted `dragstart` a held move fires, and its source, the event's first target before
 * an open shadow tree retargets it; a closed one shows the page only its host. Chromium abandons a drag whose `dragstart` removes or hides its source, or replaces
 * its document, and fires `dragend` on the source, which a source out of the document gets itself. A document that is gone, or
 * ends meanwhile, starts no drag, so it is left out.
 */
const watchDragStart = Effect.fnUntraced(
  function*(state: State, document: DocumentEntry) {
    const id = yield* Evaluation.realm(state, document.id, dragWorld)
    const realm = yield* realmOf(state, id)
    const generation = document.generation
    if (watching.get(realm) === generation) return
    yield* Evaluation.evaluate(
      state,
      id,
      dragCall(
        "function(){const w=globalThis.__striderDrag??={event:undefined,ended:false};w.event=undefined;" +
          "w.ended=false;if(w.listen!==undefined){removeEventListener('dragstart',w.listen,true);" +
          "removeEventListener('dragend',w.end,true)}" +
          "w.end=(e)=>{if(e.isTrusted)w.ended=true};w.listen=(e)=>{if(e.isTrusted){const s=e.composedPath()[0];" +
          "w.event=e;w.source=s;w.ended=false;s.addEventListener('dragend',w.end,{capture:true,once:true})}};" +
          "addEventListener('dragstart',w.listen,true);addEventListener('dragend',w.end,true)}"
      )
    )
    watching.set(realm, generation)
  },
  Effect.catchIf((error) => error.reason._tag === "Gone", () => Effect.void)
)

/**
 * Whether a watched document fired a `dragstart` since it was last asked whose drag is owed an interception: its
 * listeners didn't cancel it, no `dragend` reached its source, the source is still connected, and Chromium reports
 * that the source hosts no closed shadow root. A source inside a closed shadow root shows the page only its host,
 * so whether Chromium kept its drag can't be checked, and the move doesn't wait for it.
 */
const dragStarted = Effect.fnUntraced(
  function*(state: State, document: DocumentEntry) {
    const id = yield* Evaluation.realm(state, document.id, dragWorld)
    const realm = yield* realmOf(state, id)
    const on = Protocol.on(realm.target.session)
    // A context destroyed meanwhile is a realm that is gone, as an evaluation in it would report
    const failed = Effect.mapError(Kit.realmFailure(realm, closingOf(state, realm)))
    const { result } = yield* failed(
      Runtime.evaluate({
        expression: "(()=>{const w=globalThis.__striderDrag;const e=w?.event;const s=w?.source;" +
          "const ended=w?.ended===true||s?.isConnected!==true;if(w!==undefined){w.event=undefined;w.ended=false}" +
          "return e!==undefined&&!e.defaultPrevented&&!ended?s:null})()",
        contextId: realm.contextId as Runtime.ExecutionContextId,
        returnByValue: false
      }).pipe(on)
    )
    const objectId = result.objectId
    if (objectId === undefined) return false
    // The release is the connection's cleanup, forked into its scope, so the move never waits for its reply
    const release = Effect.suspend(() =>
      state.cleanupScope.state._tag === "Closed" ? Effect.void : Runtime.releaseObject({ objectId }).pipe(
        on,
        Effect.ignore,
        Operation.detached,
        Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
        Effect.interruptible,
        Effect.forkIn(state.cleanupScope, { startImmediately: true }),
        Effect.asVoid
      )
    )
    const described = yield* failed(DOM.describeNode({ objectId, pierce: true, depth: 1 }).pipe(on)).pipe(
      Effect.ensuring(release)
    )
    return !(described.node.shadowRoots ?? []).some((root) => root.shadowRootType === "closed")
  },
  Effect.catchIf((error) => error.reason._tag === "Gone", () => Effect.succeed(false))
)

/**
 * The session pointer input aimed into a frame goes on, and the origin of that session's viewport in the page's.
 * Chromium picks the target of input sent on the page's session from hit-test data that includes an out-of-process
 * frame only once the frame has been drawn; until then, input aimed into it reaches the parent's iframe element.
 * Input sent on the out-of-process frame's own session is hit-tested from that frame, and goes to it while the data
 * doesn't include it yet. So input whose points all land in frames of one out-of-process session goes on that
 * session, in the coordinates of its outermost frame; any other goes on the page's. Nothing hit-tests the parent
 * documents for the frame's own session: the caller checks that the element receives the pointer there first.
 */
const pointerSession = Effect.fnUntraced(function*(
  page: PageEntry,
  frame: Adapter.InputFrame | undefined,
  lands: ReadonlyArray<FrameEntry>
) {
  const onPage = { target: page.target, x: 0, y: 0 }
  if (frame === undefined || lands.length === 0) return onPage
  const owner = lands[0]!.owner
  if (owner === page.target || lands.some((each) => each.owner !== owner)) return onPage
  let root = lands[0]!
  while (root.parent !== undefined && root.parent.owner === owner) root = root.parent
  const origin = frame.path.find((each) => each.frame === root.id)?.origin
  return origin === undefined ? onPage : { target: owner, x: origin.x, y: origin.y }
})

/**
 * Input in the page's coordinates goes on the page's session; pages with child frames keep sequential
 * acknowledgments. Pointer input aimed into frames of one out-of-process session goes on that session, in its own
 * coordinates (`pointerSession`).
 */
export const dispatchInput = Effect.fnUntraced(
  function*(
    state: State,
    id: L1Target.NavigableId,
    events: ReadonlyArray<Adapter.InputEvent>,
    frame?: Adapter.InputFrame,
    lands?: ReadonlyArray<L1Target.NavigableId>
  ) {
    // Whatever fails before the first command is written sent nothing
    const page = yield* pageOf(state, id).pipe(Effect.mapError(Adapter.unsent))
    // Keys and text go to the focused element, with no hit testing
    const pointer = events.some((event) => event._tag !== "Key" && event._tag !== "InsertText")
    const landed = !pointer ? [] : yield* Effect.forEach(
      lands ?? (frame === undefined ? [] : [frame.frame]),
      (each) => frameById(state, each).pipe(Effect.mapError(Adapter.unsent))
    )
    const sent = yield* pointerSession(page, frame, landed)
    const on = Protocol.on(sent.target.session)
    const onPageSession = Protocol.on(page.target.session)
    const click = Gestures.singleClick(events)
    if (
      click !== undefined && state.navigables.get(page.id)?.children.size === 0 &&
      !state.interceptingDrags.has(page.id) && !state.drags.has(page.id) &&
      (state.heldButtons.get(page.id) ?? 0) === 0
    ) {
      // Move and press may overlap, but a modal mousedown handler can suspend the press while Chromium
      // acknowledges (and discards) a release. Wait for the press before sending the normal release.
      // Keep cleanup installed until the release write completes, including the boundary after the press.
      // The protocol marks that write before restoring interruption for replies: once written, cancellation
      // must only abandon the reply, since another release would deliver an extra mouseup to the page.
      let releaseWritten = false
      const release = Kit.protocol(sent.target.session.sendOrdered([mouseCommand(click[2], sent)], () => {
        releaseWritten = true
      }))
      yield* Effect.gen(function*() {
        yield* Kit.protocol(sent.target.session.sendOrdered(click.slice(0, 2).map((each) => mouseCommand(each, sent))))
        yield* release
      }).pipe(
        // The release is owed until the browser is known to have accepted one: the caller's accounting records it
        // as uncertain unless `settled` says so, and the next gesture sends it again first. A release already
        // written whose reply was lost or abandoned is uncertain too, and isn't sent again here.
        Effect.onError(() =>
          Effect.suspend(() => {
            Gestures.handOver(events)
            if (releaseWritten) {
              Gestures.finished(events)
              return Effect.void
            }
            // The release runs apart from the failed click, which keeps its error and its input permit: the next
            // gesture waits for it under its own deadline. It waits for its reply on the protocol's timeout, not
            // the passed deadline.
            return release.pipe(
              Effect.tap(() => Effect.sync(() => Gestures.settled(events))),
              Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
              Operation.detached,
              Effect.ignore,
              Effect.ensuring(Effect.sync(() => Gestures.finished(events))),
              Effect.forkDetach,
              Effect.asVoid
            )
          })
        )
      )
      return
    }
    for (const event of events) {
      switch (event._tag) {
        case "Mouse": {
          state.heldButtons.set(page.id, event.buttons)
          const announced = state.drags.get(page.id)
          if (announced?.stale === true) {
            // A drag Chromium announced after its gesture's release belongs to no gesture: it is canceled before
            // this one, which would otherwise continue it (QUIRKS.md, Q88)
            state.drags.delete(page.id)
            yield* Input.dispatchDragEvent({
              type: "dragCancel",
              x: event.x - sent.x,
              y: event.y - sent.y,
              data: announced.data
            }).pipe(
              on,
              Effect.ignore
            )
          }
          if (event.type === "down") {
            const pressedFrame = frame === undefined ? undefined : landed.find((each) => each.id === frame.frame)
            // The frame the press itself went to, not the gesture's destination
            state.pressedIn.set(page.id, pressedFrame === undefined ? landed : [pressedFrame])
            // A real mouse is captured by the frame its press went to, until every button is released; Chromium
            // routes input sent on the page's session by its point alone, so a held move or a release out of an
            // out-of-process frame that got the press goes on that frame's session, in its coordinates
            const into = frame === undefined ? undefined : landed.find((each) => each.id === frame.frame)
            state.pressedOn.set(page.id, into === undefined ? sent : yield* pointerSession(page, frame, [into]))
          }
          const captured = state.pressedOn.get(page.id) ?? sent
          const onCaptured = Protocol.on(captured.target.session)
          const drag = state.drags.get(page.id)
          if (drag !== undefined && event.type !== "down") {
            // An intercepted HTML drag: moves are drag events, and the release drops it
            yield* dragEvents(state, page, drag, event, sent)
            break
          }
          // A move with a button held may start an HTML drag, which an interception lets Strider finish. Chromium
          // offers a drag to the sessions of the tab's main frame alone, wherever in the tab it starts, so the
          // interception is the page's, and its drag events go where the gesture's mouse events go
          const held = event.type === "move" && event.buttons !== 0
          if (held && !state.interceptingDrags.has(page.id)) {
            state.interceptingDrags.add(page.id)
            yield* Kit.protocol(Input.setInterceptDrags({ enabled: true }).pipe(onPageSession))
          }
          if (!held) {
            if (event.type === "up" && event.buttons === 0) releasePress(state, page)
            const to = event.type === "down" ? sent : captured
            yield* Kit.protocol(mouseCommand(event, to).pipe(Protocol.on(to.target.session)))
            break
          }
          // Chromium announces the drag a held move starts after the move's reply, in no fixed order with it, but
          // has fired its `dragstart` before replying: the documents the press and the move land in say whether
          // the move started a drag, and one that started is owed its announcement before the next event
          const documents = dragDocuments(state, page, state.pressedIn.get(page.id), landed)
          yield* Effect.forEach(documents, (document) => watchDragStart(state, document), { concurrency: "unbounded" })
          yield* Kit.protocol(mouseCommand(event, captured).pipe(onCaptured))
          const started = yield* Effect.forEach(documents, (document) => dragStarted(state, document), {
            concurrency: "unbounded"
          })
          if (!started.includes(true)) break
          const owed = yield* state.buffer.waitFor(() => page.ended ? ("ended" as const) : state.drags.get(page.id))
          if (owed === "ended") break
          // The move that started the drag is its first drag event, at the move's own point
          yield* dragEvents(state, page, owed, event, sent)
          break
        }
        case "Wheel":
          yield* Kit.protocol(
            Input.dispatchMouseEvent({
              type: "mouseWheel",
              x: event.x - sent.x,
              y: event.y - sent.y,
              deltaX: event.deltaX,
              deltaY: event.deltaY,
              modifiers: modifierBits(event.modifiers)
            }).pipe(on)
          )
          break
        case "Key": {
          const drag = state.drags.get(page.id)
          if (event.key === "Escape" && event.type === "down" && drag !== undefined && drag.at !== undefined) {
            // Escape cancels an intercepted drag, which the page sees end without a drop, and like a drag of
            // Chromium's own, the page gets no key event while it lasts; the release after it is a mouse release.
            // Chromium's `dragCancel` leaves the target's document with the drag over it, so the next drag's enter
            // fired only `dragover`: a `dragOver` outside the viewport first takes it off the target, which sees
            // `dragleave`, and the source then sees `dragend`
            state.drags.delete(page.id)
            state.escapeCanceled.add(page.id)
            yield* Kit.protocol(
              Input.dispatchDragEvent({ type: "dragOver", x: -1, y: -1, data: drag.data }).pipe(
                Protocol.on(drag.at.target.session)
              )
            )
            yield* Kit.protocol(
              Input.dispatchDragEvent({ type: "dragCancel", x: drag.at.x, y: drag.at.y, data: drag.data }).pipe(
                Protocol.on(drag.at.target.session)
              )
            )
            break
          }
          if (event.key === "Escape" && event.type === "up" && state.escapeCanceled.delete(page.id)) break
          const text = Option.getOrUndefined(event.text)
          const code = keyCode(event.key)
          yield* Kit.protocol(
            Input.dispatchKeyEvent({
              type: event.type === "up" ? "keyUp" : text === undefined ? "rawKeyDown" : "keyDown",
              key: event.key,
              code: event.code,
              modifiers: modifierBits(event.modifiers),
              autoRepeat: event.autoRepeat,
              location: keyLocation(event.code),
              ...(text === undefined ? {} : { text: Redacted.make(text), unmodifiedText: Redacted.make(text) }),
              ...(code === undefined ? {} : { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code })
            }).pipe(onPageSession)
          )
          break
        }
        case "InsertText":
          yield* Kit.protocol(Input.insertText({ text: Redacted.make(event.text) }).pipe(onPageSession))
          break
        case "Touch":
          yield* Kit.protocol(
            Input.dispatchTouchEvent({
              type: event.type === "start"
                ? "touchStart"
                : event.type === "move"
                ? "touchMove"
                : event.type === "end"
                ? "touchEnd"
                : "touchCancel",
              touchPoints: event.points.map((point) => ({ x: point.x - sent.x, y: point.y - sent.y, id: point.id })),
              modifiers: modifierBits(event.modifiers)
            }).pipe(on)
          )
          break
      }
    }
  }
)

export const contentFrame = Effect.fnUntraced(function*(state: State, node: Adapter.NodeBinding) {
  const document = yield* documentOf(state, node.document)
  const described = yield* Kit.protocol(
    DOM.describeNode({ backendNodeId: Number(node.binding) as DOM.BackendNodeId }).pipe(
      Protocol.on(document.frame.owner.session)
    )
  )
  return Option.fromUndefinedOr(frameOf(state, described.node.frameId)?.id)
})

export const setInputFiles = Effect.fnUntraced(
  function*(state: State, node: Adapter.NodeBinding, files: ReadonlyArray<string>) {
    const document = yield* documentOf(state, node.document)
    yield* Kit.protocol(
      DOM.setFileInputFiles({
        files: [...files],
        backendNodeId: Number(node.binding) as DOM.BackendNodeId
      }).pipe(Protocol.on(document.frame.owner.session))
    )
  }
)
