/**
 * Input on CDP: the `Input` domain's mouse, wheel, key, text and touch events, in the page's coordinates on its
 * session, or, aimed into an out-of-process frame, in that frame's on its own; HTML drags, which headless Chromium starts none of, caught and finished with drag
 * events; and the elements input acts on by binding: an iframe's frame, a file input's files.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as DOM from "../../cdp/DOM.ts"
import * as Input from "../../cdp/Input.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Gestures from "../input.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { heldButton, keyCode, keyLocation, modifierBits } from "./mapping.ts"
import {
  documentOf,
  type Event,
  frameById,
  type FrameEntry,
  frameOf,
  type PageEntry,
  pageOf,
  type State
} from "./state.ts"

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers.on(Input.dragIntercepted, (params, { state, target }) => {
    // Headless Chromium starts no drag of its own; an intercepted one is finished with drag events
    if (target?.page !== undefined && !target.page.ended) {
      const stale = (state.heldButtons.get(target.page.id) ?? 0) === 0
      state.drags.set(target.page.id, { data: params.data, entered: false, stale })
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
          const drag = state.drags.get(page.id)
          if (drag !== undefined && event.type !== "down") {
            // An intercepted HTML drag: moves are drag events, and the release drops it
            const dragEvent = (type: "dragEnter" | "dragOver" | "drop") =>
              Kit.protocol(
                Input.dispatchDragEvent({
                  type,
                  x: event.x - sent.x,
                  y: event.y - sent.y,
                  data: drag.data,
                  modifiers: modifierBits(event.modifiers)
                }).pipe(on)
              )
            if (!drag.entered) {
              drag.entered = true
              yield* dragEvent("dragEnter")
            }
            if (event.type === "move") {
              yield* dragEvent("dragOver")
            } else {
              state.drags.delete(page.id)
              yield* dragEvent("dragOver")
              yield* dragEvent("drop")
            }
            break
          }
          // A move with a button held may start an HTML drag, which only an interception lets finish. Chromium
          // offers a drag to the sessions of the tab's main frame alone, wherever in the tab it starts, so the
          // interception is the page's, and its drag events go where the gesture's mouse events go
          if (event.type === "move" && event.buttons !== 0 && !state.interceptingDrags.has(page.id)) {
            state.interceptingDrags.add(page.id)
            yield* Kit.protocol(Input.setInterceptDrags({ enabled: true }).pipe(onPageSession))
          }
          yield* Kit.protocol(mouseCommand(event, sent).pipe(on))
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
