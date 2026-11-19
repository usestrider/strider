/**
 * Recording overlays, `Capability.Overlay`: elements the engine draws over a page's main document, under a closed
 * shadow root its queries leave out. The library keeps the overlays a page shows and sends them whole to the
 * document after each change, and again to each document the main frame commits. Nothing is installed or watched
 * on a page until the capability is acquired, and the watch ends when the last acquisition's scope closes.
 */
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Capability from "../Capability.ts"
import * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import * as Access from "./access.ts"
import * as BrowserClock from "./browserClock.ts"
import * as DurationInput from "./durationInput.ts"
import type * as Engine from "./engine.ts"
import * as Execution from "./execution.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"

/** How long a chapter's card takes to fade out, as its style sets it. */
const fadeMillis = 200

/** A page's overlays, shared by every acquisition on it until the last one's scope closes. */
interface State {
  readonly items: Array<Engine.OverlayItem>
  hidden: boolean
  holders: number
  next: number
  /** Holds the navigation watch. */
  readonly scope: Scope.Closeable
  /** The settings of each open `actions` call, oldest first: the latest applies. */
  readonly actions: Array<Actions>
}

/** How a page shows its actions. */
interface Actions {
  readonly millis: number
  readonly position: Capability.OverlayControl.Position
  readonly cursor: "pointer" | "none"
  readonly point: string | null
  readonly highlight: string | null
  readonly title: string
}

const positions: ReadonlySet<string> = new Set([
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right"
])
const cursorId = "cursor"

const states = new WeakMap<Model.PageEntry, State>()

/** Whether the page has an acquired overlay capability, and so a watch on its main frame's navigations. */
export const listening = (page: Model.PageEntry): boolean => states.has(page)

type Failure = Capability.CapabilityError | Target.TargetGone | Deadline.Timeout

const capabilityError = (reason: Capability.CapabilityErrorReason, id: Diagnostics.OperationId) =>
  new Capability.CapabilityError({ capability: "Overlay", reason, diagnostics: Operation.diagnostics(id) })

/** A duration option in milliseconds, failing with `InvalidInput` for one that isn't finite and at least zero. */
const millisOf = (
  input: Duration.Input,
  name: string,
  id: Diagnostics.OperationId
): Effect.Effect<number, Capability.CapabilityError> =>
  Option.match(Option.filter(DurationInput.toFiniteMillis(input), (millis) => millis >= 0), {
    onNone: () =>
      Effect.fail(capabilityError(
        new Reason.InvalidInput({ input: String(input), expected: "a finite duration of zero or more", hint: name }),
        id
      )),
    onSome: Effect.succeed
  })

/** Sends the page's overlays as they now are to its main frame's current document. */
const draw = (runtime: Runtime.Runtime, page: Model.PageEntry, state: State): Effect.Effect<void, Failure> =>
  Effect.gen(function*() {
    const record = yield* Operation.record
    const request: Engine.Request = { op: "overlay", overlays: [...state.items], hidden: state.hidden }
    yield* Runtime.send(runtime, page, request, record.id, record.budget.at).pipe(
      Effect.mapError((failure) =>
        failure._tag === "Gone"
          ? failure.error
          : failure._tag === "Reason"
          ? capabilityError(failure.reason, record.id)
          : record.timeout(Option.fromUndefinedOr(failure.hint))
      )
    )
  })

/** Removes the overlay `id` and draws what is left, apart from any caller's deadline; a closed page has none. */
const remove = (runtime: Runtime.Runtime, page: Model.PageEntry, state: State, id: string) =>
  Effect.suspend(() => {
    const at = state.items.findIndex((each) => each.id === id)
    if (at < 0) return Effect.void
    state.items.splice(at, 1)
    return draw(runtime, page, state).pipe(
      Operation.apart("Capability.Overlay.remove", Duration.seconds(5)),
      Effect.ignore
    )
  })

/**
 * Moves the cursor to `point`, in the top-level page, drawing it there; it glides from where it was. Annotation
 * moves it to each action's point, and any later input can move it too.
 */
export const moveCursor = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  point: { readonly x: number; readonly y: number }
): Effect.Effect<void, Failure> =>
  Effect.suspend(() => {
    const state = states.get(page)
    if (state === undefined) return Effect.void
    const cursor: Engine.OverlayItem = { _tag: "Cursor", id: cursorId, x: point.x, y: point.y }
    const at = state.items.findIndex((each) => each.id === cursorId)
    if (at < 0) state.items.unshift(cursor)
    else state.items[at] = cursor
    return draw(runtime, page, state)
  })

/** The annotation of the page's actions under `state`'s latest `actions` settings. */
const annotation = (runtime: Runtime.Runtime, page: Model.PageEntry, state: State): Execution.Annotate => (action) =>
  Effect.gen(function*() {
    const settings = state.actions.at(-1)
    if (settings === undefined) return
    const box = settings.highlight === null ? Option.none() : yield* action.box
    const id = `action-${state.next++}`
    state.items.push({
      _tag: "Action",
      id,
      title: action.title,
      position: settings.position,
      titleStyle: settings.title,
      point: action.point,
      pointStyle: settings.point,
      box: Option.getOrNull(box),
      highlightStyle: settings.highlight
    })
    yield* Effect.ignore(
      settings.cursor === "pointer" && action.point !== null
        ? moveCursor(runtime, page, action.point)
        : draw(runtime, page, state)
    )
    // The wait is the action's: it ends by the action's deadline, which the action's next check then reports
    yield* BrowserClock.sleep(Math.min(settings.millis, Math.max(0, action.left)))
    yield* remove(runtime, page, state, id).pipe(Operation.detached, Effect.forkIn(state.scope))
  })

/** The overlay capability of a page, for the caller's scope. */
export const acquire = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, page: Model.PageEntry, grant: Option.Option<Access.Grant>) {
    const { id } = yield* Operation.record
    if (Option.isSome(grant) && grant.value.level !== "control") {
      return yield* Effect.fail(capabilityError(
        new Reason.NotPermitted({ required: "control", hint: "Acquire page.control before drawing overlays" }),
        id
      ))
    }
    yield* Access.check(grant)
    let state = states.get(page)
    if (state === undefined) {
      const created: State = { items: [], hidden: false, holders: 0, next: 0, scope: yield* Scope.make(), actions: [] }
      state = created
      states.set(page, created)
      // A committed main-frame document starts without the overlays: it gets them again once it is current
      yield* page.state.changes.pipe(
        Stream.filterMap(
          Filter.fromPredicateOption((each: Model.PageState) =>
            each.status._tag === "Open" ? Option.some(each.status.document.id) : Option.none()
          )
        ),
        Stream.changes,
        Stream.drop(1),
        Stream.runForEach(() =>
          created.items.length === 0 ? Effect.void : draw(runtime, page, created).pipe(
            Operation.apart("Capability.Overlay.redraw", Duration.seconds(5)),
            Effect.ignore
          )
        ),
        Operation.detached,
        Effect.forkIn(created.scope)
      )
    }
    const shared = state
    shared.holders++
    // The last holder's scope removes every overlay and ends the watch
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        if (--shared.holders > 0) return Effect.void
        states.delete(page)
        shared.actions.length = 0
        Execution.annotateWith(page, undefined)
        const drawn = shared.items.length > 0 || shared.hidden
        shared.items.length = 0
        return Scope.close(shared.scope, Exit.void).pipe(
          Effect.andThen(
            drawn
              ? draw(runtime, page, shared).pipe(Operation.apart("Capability.Overlay.release", Duration.seconds(5)))
              : Effect.void
          ),
          Effect.ignore
        )
      })
    )
    const attributes = { "browser.page.id": page.id, "browser.capability": "Overlay" }
    const control: Capability.OverlayControl = {
      add: Effect.fnUntraced(
        function*(html: string, options?: Capability.OverlayControl.AddOptions | undefined) {
          const { id } = yield* Operation.record
          const millis = options?.duration === undefined
            ? Option.none<number>()
            : Option.some(yield* millisOf(options.duration, "duration", id))
          const overlay = `overlay-${shared.next++}`
          shared.items.push({ _tag: "Html", id: overlay, html })
          yield* Effect.addFinalizer(() => remove(runtime, page, shared, overlay))
          yield* draw(runtime, page, shared).pipe(Effect.onError(() => remove(runtime, page, shared, overlay)))
          if (Option.isSome(millis)) {
            yield* BrowserClock.sleep(millis.value).pipe(
              Effect.andThen(remove(runtime, page, shared, overlay)),
              Operation.detached,
              Effect.forkIn(shared.scope)
            )
          }
        },
        Operation.named("Capability.Overlay.add", { attributes })
      ),
      chapter: Effect.fnUntraced(
        function*(title: string, options?: Capability.OverlayControl.ChapterOptions | undefined) {
          const { id } = yield* Operation.record
          const millis = yield* millisOf(options?.duration ?? Duration.seconds(2), "duration", id)
          const chapter = `chapter-${shared.next++}`
          const item = {
            _tag: "Chapter" as const,
            id: chapter,
            title,
            description: options?.description ?? null,
            leaving: false
          }
          shared.items.push(item)
          yield* Effect.gen(function*() {
            yield* draw(runtime, page, shared)
            yield* BrowserClock.sleep(millis)
            const at = shared.items.indexOf(item)
            if (at >= 0) shared.items[at] = { ...item, leaving: true }
            yield* draw(runtime, page, shared)
            yield* BrowserClock.sleep(fadeMillis)
          }).pipe(Effect.ensuring(remove(runtime, page, shared, chapter)))
        },
        Operation.named("Capability.Overlay.chapter", { attributes })
      ),
      actions: Effect.fnUntraced(
        function*(options?: Capability.OverlayControl.ActionsOptions | undefined) {
          const { id } = yield* Operation.record
          const millis = yield* millisOf(options?.duration ?? Duration.millis(500), "duration", id)
          const position = options?.position ?? "top-right"
          const cursor = options?.cursor ?? "pointer"
          if (!positions.has(position) || (cursor !== "pointer" && cursor !== "none")) {
            return yield* Effect.fail(capabilityError(
              new Reason.InvalidInput({
                input: String(positions.has(position) ? cursor : position),
                expected: positions.has(position) ? `"pointer" or "none"` : [...positions].join(", "),
                hint: positions.has(position) ? "cursor" : "position"
              }),
              id
            ))
          }
          const settings: Actions = {
            millis,
            position,
            cursor,
            point: options?.style?.point ?? null,
            highlight: options?.style?.highlight ?? null,
            title: options?.style?.title ?? ""
          }
          shared.actions.push(settings)
          Execution.annotateWith(page, annotation(runtime, page, shared))
          yield* Effect.addFinalizer(() =>
            Effect.suspend(() => {
              const at = shared.actions.indexOf(settings)
              if (at >= 0) shared.actions.splice(at, 1)
              if (shared.actions.length > 0 || states.get(page) !== shared) return Effect.void
              Execution.annotateWith(page, undefined)
              return remove(runtime, page, shared, cursorId)
            })
          )
        },
        Operation.named("Capability.Overlay.actions", { attributes })
      ),
      hide: Effect.suspend(() => {
        shared.hidden = true
        return draw(runtime, page, shared)
      }).pipe(Operation.named("Capability.Overlay.hide", { attributes })),
      show: Effect.suspend(() => {
        shared.hidden = false
        return draw(runtime, page, shared)
      }).pipe(Operation.named("Capability.Overlay.show", { attributes }))
    }
    return control
  }
)
