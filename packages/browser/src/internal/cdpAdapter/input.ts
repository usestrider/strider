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
  type PointerTarget,
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

/** Where pointer input that names no frame goes, and the out-of-process frame whose element its point hit, if any. */
interface Aimed extends PointerTarget {
  readonly frame?: FrameEntry | undefined
}

/**
 * The session pointer input that names no frame goes on at a point in the page's coordinates, and its origin. It
 * follows the rule of `pointerSession`: on a page with an out-of-process frame, each session from the page's down
 * that owns one has its frame elements' boxes read (`frameBoxes`), once in an operation, and a point outside all of
 * them goes on that session. A point inside one is hit-tested there (`DOM.getNodeForLocation`, which descends into
 * frames of the same session, so an element drawn over the frame keeps the point), and where it lands on the
 * element of a frame another session owns (`DOM.describeNode`), input goes on that session, from the element's
 * content box (`DOM.getBoxModel`). A session that owns no out-of-process frame of the page is read no further, so a
 * page without one costs no call, a point outside its out-of-process frames one call in an operation, and a point
 * inside three more for each level. A point that hits nothing ends the search where it is. While every
 * out-of-process frame of the page has been drawn (`painted`), Chromium's own routing reaches each, and input goes on
 * the page's session with no call.
 */
const framelessSession = Effect.fnUntraced(function*(state: State, page: PageEntry, x: number, y: number) {
  let sent: Aimed = { target: page.target, x: 0, y: 0 }
  const drawn = [...state.frames.values()].every((each) =>
    each.page !== page || each.parent === undefined || each.owner.targetId === each.parent.owner.targetId ||
    each.document?.painted === true
  )
  if (drawn) return sent
  while (true) {
    const target = sent.target
    // Whether this session owns an out-of-process frame is read from a state that holds every event received
    // before the last reply, on any session: the protocol client hands over a reply only once those are folded, a
    // nested frame's attachment on its parent frame's session included
    // Sessions are told apart by target id: a frame's owner and its page's target needn't be one entry
    const ownsRemote = [...state.frames.values()].some((each) =>
      each.page === page && each.owner.targetId !== target.targetId && each.parent?.owner.targetId === target.targetId
    )
    if (!ownsRemote) return sent
    const boxes = yield* frameBoxes(state, page, target)
    // Boxes are padded by a pixel, as the hit test takes the pixel a point is in
    const within = (box: Box) =>
      x - sent.x >= box[0] - 1 && x - sent.x <= box[2] + 1 && y - sent.y >= box[1] - 1 && y - sent.y <= box[3] + 1
    if (boxes !== undefined && !boxes.some(within)) return sent
    const on = Protocol.on(target.session)
    const found = yield* Kit.protocol(
      Effect.gen(function*() {
        // A point the session's document doesn't cover hits no node
        // It takes whole CSS pixels: the pixel the point is in
        const hit = yield* DOM.getNodeForLocation({
          x: Math.floor(x - sent.x),
          y: Math.floor(y - sent.y),
          includeUserAgentShadowDOM: true,
          ignorePointerEventsNone: false
        }).pipe(on, Effect.catchIf((error) => error.reason._tag === "Rejected", () => Effect.succeed(undefined)))
        if (hit === undefined) return undefined
        const described = yield* DOM.describeNode({ backendNodeId: hit.backendNodeId }).pipe(on)
        const child = frameOf(state, described.node.frameId)
        if (child === undefined || child.page !== page || child.owner.targetId === target.targetId) return undefined
        const box = yield* DOM.getBoxModel({ backendNodeId: hit.backendNodeId }).pipe(on)
        return {
          target: child.owner,
          x: sent.x + box.model.content[0]!,
          y: sent.y + box.model.content[1]!,
          frame: child
        }
      })
    )
    if (found === undefined) return sent
    sent = found
  }
})

/** A frame element's bounds in its document's viewport: left, top, right and bottom. */
type Box = readonly [number, number, number, number]

/**
 * The boxes of the frame elements each session's document holds, read once in an operation, by page and by the
 * session's target id. A session whose boxes couldn't be read holds `undefined`, and its points are hit-tested.
 * The boxes are those of the operation's start: a frame that moves, grows or appears while an operation's events
 * are sent, as one its own input scrolls or a page's handler inserts, is where it was, so a point that has come
 * into the frame since goes on the session above it. Chromium routes that input by its own hit-test data, which
 * reaches the frame once it has been drawn, so only a frame not yet drawn misses it.
 */
const operationBoxes = new WeakMap<
  Operation.Record,
  WeakMap<PageEntry, Map<string, ReadonlyArray<Box> | undefined>>
>()

/**
 * Reads the bounds of every frame element in a session's document, open shadow roots included, and the number
 * that hold a window. A nested frame is drawn within its element, so a point outside every box is outside every
 * frame the session holds, at any depth.
 */
const frameBoxesExpression = "(()=>{const b=[];let n=0;const walk=(r)=>{for(const e of r.querySelectorAll('*')){" +
  "if(e.shadowRoot!==null)walk(e.shadowRoot);const l=e.localName;" +
  "if(l==='iframe'||l==='frame'||l==='object'||l==='embed'){if(e.contentWindow!=null)n++;" +
  "const c=e.getBoundingClientRect();b.push(c.left,c.top,c.right,c.bottom)}}};walk(document);return [n,b]})()"

/**
 * The boxes of the frame elements in the document of a session's frame, in that session's viewport, read in Strider's
 * own world and kept for the operation (`operationBoxes`). Where they can't be trusted, it returns `undefined`: a
 * session whose frames have no single root, a document not yet known, a failed read, or fewer frame elements with a
 * window than the root frame has child frames, as when a closed shadow root hides one from the page's scripts.
 */
const frameBoxes = Effect.fnUntraced(function*(state: State, page: PageEntry, target: TargetEntry) {
  const record = Option.getOrUndefined(yield* Operation.current)
  let pages = record === undefined ? undefined : operationBoxes.get(record)
  if (record !== undefined && pages === undefined) operationBoxes.set(record, pages = new WeakMap())
  let sessions = pages?.get(page)
  if (pages !== undefined && sessions === undefined) pages.set(page, sessions = new Map())
  if (sessions?.has(target.targetId) === true) return sessions.get(target.targetId)
  const read = Effect.gen(function*() {
    const roots = [...state.frames.values()].filter((each) =>
      each.page === page && each.owner.targetId === target.targetId &&
      each.parent?.owner.targetId !== target.targetId
    )
    const root = roots.length === 1 ? roots[0]! : undefined
    if (root?.document === undefined) return undefined
    const children = [...state.frames.values()].filter((each) => each.parent === root).length
    const realm = yield* realmOf(state, yield* Evaluation.realm(state, root.document.id, dragWorld))
    const { result } = yield* Kit.protocol(
      Runtime.evaluate({
        expression: frameBoxesExpression,
        contextId: realm.contextId as Runtime.ExecutionContextId,
        returnByValue: true
      }).pipe(Protocol.on(realm.target.session))
    )
    const value: unknown = result.value
    if (!Array.isArray(value) || typeof value[0] !== "number" || !Array.isArray(value[1])) return undefined
    const [count, flat] = value as [number, Array<unknown>]
    if (count < children || flat.length % 4 !== 0 || flat.some((each) => typeof each !== "number")) return undefined
    const boxes: Array<Box> = []
    for (let i = 0; i < flat.length; i += 4) {
      boxes.push([flat[i] as number, flat[i + 1] as number, flat[i + 2] as number, flat[i + 3] as number])
    }
    return boxes as ReadonlyArray<Box>
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
  const boxes = yield* read
  sessions?.set(target.targetId, boxes)
  return boxes
})

/** Where a page's held press went, while its session is still attached (`captured`). */
const pressTarget = (state: State, page: L1Target.NavigableId): PointerTarget | undefined =>
  captured(state, state.pressedOn, page)

/**
 * Where a page's held input went, while its session is still attached. A session that ends while it holds the
 * pointer, as a frame's does when the frame is removed or navigates to another process, ends the capture, and the
 * input after goes by its point again.
 */
const captured = (
  state: State,
  capture: Map<L1Target.NavigableId, PointerTarget>,
  page: L1Target.NavigableId
): PointerTarget | undefined => {
  const held = capture.get(page)
  if (held === undefined) return undefined
  if (state.targets.get(held.target.session) === held.target) return held
  capture.delete(page)
  return undefined
}

/**
 * Input in the page's coordinates goes on the page's session; pages with child frames keep sequential
 * acknowledgments. Pointer input aimed into frames of one out-of-process session goes on that session, in its own
 * coordinates (`pointerSession`). Pointer input that names no frame goes on the session under each event's point
 (`framelessSession`); from a press until every button is up, or from a touch's start until its end, it goes where
 the press or the start went, a release outside that frame included, as a pointer's input stays with the element
 it pressed.
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
    let sent = yield* pointerSession(page, frame, landed)
    // Input that names neither a frame nor where its points land, as the page's devices send it; a locator names
    // both, having checked what its points hit
    const frameless = frame === undefined && lands === undefined
    let aimed: { readonly x: number; readonly y: number; readonly sent: Aimed } | undefined
    // The session under a point for input that names no frame, once for consecutive events at one point
    const aim = (x: number, y: number) =>
      aimed !== undefined && aimed.x === x && aimed.y === y
        ? Effect.succeed(aimed.sent)
        : framelessSession(state, page, x, y).pipe(
          // A lookup before the call's first event is written fails with nothing sent
          Effect.mapError((error) => written ? error : Adapter.unsent(error)),
          Effect.map((found) => {
            aimed = { x, y, sent: found }
            return found
          })
        )
    const on = <M extends string, P, A>(command: Protocol.Command<M, P, A>) => Protocol.on(command, sent.target.session)
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
    let written = false
    for (const event of events) {
      written ||= event !== events[0]
      switch (event._tag) {
        case "Mouse": {
          // A held press keeps input that names no frame, as one that names its frame keeps it below; an
          // intercepted drag's events go by their points, as the gesture's points land
          const holder = frameless && !state.drags.has(page.id) ? pressTarget(state, page.id) : undefined
          let hit: FrameEntry | undefined
          if (holder !== undefined) sent = holder
          else if (frameless) {
            const found = yield* aim(event.x, event.y)
            hit = found.frame
            sent = found
          }
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
          if (event.type === "down" && frameless) {
            // The frame the lookup found takes the press, as a frame the press names does; a press on the page's
            // own session lands in no frame it knows, so any of the page's documents may start its drag
            if (holder === undefined) {
              state.pressedIn.set(page.id, hit === undefined ? [] : [hit])
              state.pressedOn.set(page.id, sent)
            }
          } else if (event.type === "down") {
            const pressedFrame = frame === undefined ? undefined : landed.find((each) => each.id === frame.frame)
            // The frame the press itself went to, not the gesture's destination
            state.pressedIn.set(page.id, pressedFrame === undefined ? landed : [pressedFrame])
            // A real mouse is captured by the frame its press went to, until every button is released; Chromium
            // routes input sent on the page's session by its point alone, so a held move or a release out of an
            // out-of-process frame that got the press goes on that frame's session, in its coordinates
            const into = frame === undefined ? undefined : landed.find((each) => each.id === frame.frame)
            state.pressedOn.set(page.id, into === undefined ? sent : yield* pointerSession(page, frame, [into]))
          }
          const captured = pressTarget(state, page.id) ?? sent
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
          // A wheel goes to what is under its point, a button held or not
          if (frameless) sent = yield* aim(event.x, event.y)
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
          if (frameless) {
            const first = event.points[0]
            sent = captured(state, state.touchCapture, page.id) ??
              (first === undefined ? { target: page.target, x: 0, y: 0 } : yield* aim(first.x, first.y))
            if (event.type === "end" || event.type === "cancel") state.touchCapture.delete(page.id)
            else state.touchCapture.set(page.id, sent)
          }
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
