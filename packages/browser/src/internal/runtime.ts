/**
 * What the public objects of one connection share: the model, the backend's name for errors, and a channel to
 * the engine in a page's current document (review 12, candidate 3).
 *
 * A request goes to the engine in the utility world of the page's active document, or of a frame's, which a
 * locator's frame boundaries lead to (review 18, candidate 2): each iframe on the way is found by the engine of
 * the document it is in, and the adapter names the frame it holds. The engine is installed in a document on first
 * use; when a document on the way changes under a request (a navigation committed, the realm went), the request
 * goes again from the page's document, within the operation's deadline. Nothing the engine does dispatches input,
 * so sending a request again is always safe. A frame that isn't there yet is a request that matches nothing.
 *
 * A dialog pauses its page, and on some backends every evaluation with it (review 13, P2). A request waits for
 * a dialog that a handler or the policy is deciding, within its deadline, and fails at once with
 * `PromptBlocking` when the page has one nothing will decide.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as BrowserWorker from "../BrowserWorker.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Download from "../Download.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as NetworkConnection from "../NetworkConnection.ts"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import * as Engine from "./engine.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

/** The utility world the engine runs in. */
export const utilityWorld: Adapter.World = { _tag: "Isolated", name: "__strider_utility__" }

export interface Runtime {
  readonly model: Model.Model
  /** The backend, as errors name it: the browser's product. */
  readonly backend: string
  /**
   * The connection's handle for a page it controls for its life, the same each time, made on first use and kept as
   * long as the page's entry is: one it created, or one in a context it created; `None` for any other page.
   */
  readonly page: (entry: Model.PageEntry) => Option.Option<Page.Page>
  /**
   * The connection's handle for any page: the `Page`, for one it controls for life, or an observed handle, the same
   * each time (review 19, candidate 2).
   */
  readonly observed: (entry: Model.PageEntry) => Page.ObservedPage
  /** The connection's handle for a download, the same each time (review 14, candidate 8). */
  readonly download: (entry: Model.DownloadEntry) => Download.Download
  /** The connection's handle for a worker, the same each time (review 14, candidate 10). */
  readonly worker: (entry: Model.WorkerEntry) => BrowserWorker.BrowserWorker
  /** The connection's handle for a WebSocket or EventSource, the same each time (review 14, candidate 11). */
  readonly connection: (entry: Model.ConnectionEntry) => NetworkConnection.NetworkConnection
  /** The program's file system, which a launched browser shares: a download is copied out with it. */
  readonly fileSystem: Option.Option<FileSystem.FileSystem>
  /** Effect's `Path`, which a relative local file path is resolved with. */
  readonly path: Option.Option<Path.Path>
  /**
   * A navigation's outcome as `goto` reports it (`navigation.ts`), for `PageNavigation`, which can't import `Page`
   * without a load cycle.
   */
  readonly settle: (
    operation: string,
    navigation: PageNavigation.Id,
    url: Option.Option<Url.Url>,
    at: string,
    outcome: Adapter.NavigationOutcome,
    id: Diagnostics.OperationId
  ) => Effect.Effect<PageNavigation.PageNavigation, Page.PageError>
}

/** Why a request to the engine didn't get an answer. */
export type SendFailure =
  | Operation.Failure
  | { readonly _tag: "Reason"; readonly reason: Reason.PromptBlocking }
  /** The deadline passed; `hint` says why when the page never had a document to send to. */
  | { readonly _tag: "Deadline"; readonly hint?: string | undefined }

/** The reason for an operation on a page whose open dialog nothing will decide. */
export const promptBlocking = (prompt: Model.UndecidedPrompt, dispatched: boolean): Reason.PromptBlocking =>
  new Reason.PromptBlocking({
    kind: prompt.kind,
    text: prompt.text,
    hint: `${
      dispatched ? "The input reached the page and opened it. " : ""
    }The context's dialogs policy is "leaveOpen" and no handler was registered when it opened; register Dialog.handle before the action that opens it`
  })

/**
 * Fails when the page has an open dialog nothing will decide, now or later: raced against an operation, it
 * ends the operation at once rather than at its deadline.
 */
export const promptBlocked = (page: Model.PageEntry, dispatched = false) =>
  SubscriptionRef.changes(page.state).pipe(
    Stream.filterMap(Filter.fromPredicateOption((state) => state._tag === "Open" ? state.undecided : Option.none())),
    Stream.runHead,
    Effect.flatMap(Option.match({
      onNone: () => Effect.never,
      onSome: (prompt) => Effect.fail<SendFailure>({ _tag: "Reason", reason: promptBlocking(prompt, dispatched) })
    }))
  )

const gone = (target: Target.Description, reason: Target.CloseReason, id: Diagnostics.OperationId): SendFailure => ({
  _tag: "Gone",
  error: new Target.TargetGone({ target, reason, diagnostics: Operation.diagnostics(id) })
})

/** A page's open state, waiting while it is still opening; a closed page is gone. */
export const openState = (page: Model.PageEntry, id: Diagnostics.OperationId) =>
  SubscriptionRef.changes(page.state).pipe(
    Stream.filter((state) => state._tag !== "Opening"),
    Stream.runHead,
    Effect.flatMap((state): Effect.Effect<Extract<Model.PageState, { _tag: "Open" }>, SendFailure> => {
      if (Option.isNone(state)) {
        return Effect.fail(gone({ _tag: "Page", id: page.id }, { _tag: "PageClosed", by: "browser" }, id))
      }
      const value = state.value
      return value._tag === "Open"
        ? Effect.succeed(value)
        : Effect.fail(
          gone(
            { _tag: "Page", id: page.id },
            value._tag === "Closed" ? value.reason : { _tag: "PageClosed", by: "browser" },
            id
          )
        )
    })
  )

const string = (value: string): Adapter.LocalValue => ({ _tag: "Value", value: { type: "string", value } })

const call = (
  runtime: Runtime,
  realm: Target.RealmId,
  functionDeclaration: string,
  args: ReadonlyArray<Adapter.LocalValue>
) =>
  runtime.model.adapter.evaluate(realm, {
    functionDeclaration,
    arguments: args,
    awaitPromise: true,
    result: "value",
    userActivation: false
  })

/** The realm of a document's utility world, with the engine installed. */
const engineRealm = Effect.fnUntraced(function*(runtime: Runtime, document: Target.DocumentId) {
  const known = runtime.model.engineRealms.get(document)
  if (known !== undefined) return known
  const realm = yield* runtime.model.adapter.realm(document, utilityWorld)
  const installed = yield* call(runtime, realm, Engine.install, [])
  if (installed._tag === "Exception") {
    return yield* Effect.die(new Error(`The engine didn't install: ${installed.text}`))
  }
  runtime.model.engineRealms.set(document, realm)
  return realm
})

/** One iframe on the way to a frame's document (review 18, candidate 2). */
export interface Hop {
  /** The document the iframe is in. */
  readonly document: Target.DocumentId
  /** The iframe's steps in that document. */
  readonly steps: ReadonlyArray<Engine.Step>
  /** The frame the iframe holds. */
  readonly frame: Target.NavigableId
}

/** Where a request went: its document, and the iframes entered on the way, outermost first. */
export interface Routed {
  readonly document: Target.DocumentId
  readonly hops: ReadonlyArray<Hop>
}

/** A locator's steps split at each frame boundary: each iframe's steps, outermost first, then the rest. */
export const split = (steps: ReadonlyArray<Engine.Step>) => {
  const frames: Array<ReadonlyArray<Engine.Step>> = []
  let current: Array<Engine.Step> = []
  for (const step of steps) {
    if (step._tag === "Frame") {
      frames.push(current)
      current = []
    } else {
      current.push(step)
    }
  }
  return { frames, last: current }
}

/** A request's steps; none for a request about the document itself. */
const stepsOf = (request: Engine.Request): ReadonlyArray<Engine.Step> =>
  "steps" in request && request.steps !== null ? request.steps : []

/**
 * A ref resolved in another document than the one that gave it (review 18, candidate 3): stale, since a ref never
 * rebinds. Its node and the engine's table are the engine's to check.
 */
const replaced = (document: Target.DocumentId, steps: ReadonlyArray<Engine.Step>): Option.Option<Engine.Response> => {
  const first = steps[0]
  return first !== undefined && first._tag === "Ref" && first.document !== document
    ? Option.some({ _tag: "StaleRef", why: "Replaced" })
    : Option.none()
}

/** Steps no element matches: what a request in a frame that isn't there yet resolves. */
const nothing: ReadonlyArray<Engine.Step> = [{ _tag: "Css", selector: ":not(*)" }]

/** A round in a frame that isn't there yet ends soon, so the next one looks for the frame again. */
const missingCap = 100

/** The request with its steps in the document it goes to; one with no steps goes as it is. */
const retarget = (request: Engine.Request, steps: ReadonlyArray<Engine.Step>, missing: boolean): Engine.Request => {
  if (!("steps" in request) || request.steps === null) return request
  const at = missing ? nothing : steps
  switch (request.op) {
    case "act":
    case "expect":
      return { ...request, steps: at, cap: missing ? Math.min(request.cap, missingCap) : request.cap }
    default:
      return { ...request, steps: at }
  }
}

const isMoved = (error: Adapter.AdapterError) =>
  error.reason._tag === "Gone" && (error.reason.target._tag === "Document" || error.reason.target._tag === "Realm")

/**
 * The engine's realm in a document, and a call to it; `None` when the document or its realm went, or the realm
 * lost its engine, so the caller goes again.
 */
const callEngine = (
  runtime: Runtime,
  document: Target.DocumentId,
  functionDeclaration: string,
  request: string,
  id: Diagnostics.OperationId
): Effect.Effect<Option.Option<Adapter.RemoteValue>, SendFailure> =>
  engineRealm(runtime, document).pipe(
    Effect.flatMap((realm) => call(runtime, realm, functionDeclaration, [string(request)])),
    Effect.map(Option.some),
    Effect.catch((error: Adapter.AdapterError) => {
      if (isMoved(error)) {
        runtime.model.engineRealms.delete(document)
        return Effect.succeed(Option.none<Adapter.RemoteResult>())
      }
      return Effect.fail<SendFailure>(Operation.fromAdapter(error, id, runtime.backend))
    }),
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeed(Option.none<Adapter.RemoteValue>()),
      onSome: (result): Effect.Effect<Option.Option<Adapter.RemoteValue>> => {
        if (result._tag === "Exception") return Effect.die(new Error(`The engine threw: ${result.text}`))
        if (result.value.type === "string" && result.value.value === Engine.missing) {
          // A realm that lost its engine, as a reused realm can: install again
          runtime.model.engineRealms.delete(document)
          return Effect.succeedNone
        }
        return Effect.succeed(Option.some(result.value))
      }
    }))
  )

/** The one match in a document, by its node binding, or the engine's answer for why there is none. */
type Element =
  | { readonly _tag: "Found"; readonly node: Adapter.NodeBinding }
  | { readonly _tag: "Response"; readonly response: Engine.Response }

const elementIn = (
  runtime: Runtime,
  document: Target.DocumentId,
  steps: ReadonlyArray<Engine.Step>,
  frame: { readonly scroll: boolean } | null,
  id: Diagnostics.OperationId
): Effect.Effect<Option.Option<Element>, SendFailure> =>
  callEngine(
    runtime,
    document,
    Engine.element,
    JSON.stringify({ steps, frame: frame !== null, scroll: frame?.scroll ?? false }),
    id
  ).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (value) => {
        if (value.type === "node" && value.node !== undefined) {
          return Effect.succeed(Option.some<Element>({ _tag: "Found", node: value.node }))
        }
        if (value.type === "string") {
          return Effect.succeed(
            Option.some<Element>({ _tag: "Response", response: JSON.parse(value.value) as Engine.Response })
          )
        }
        return Effect.die(new Error("The engine's element came back without a node binding"))
      }
    }))
  )

/** Where a locator's frames lead now: the document of its last frame, or why it can't be reached yet. */
type Route =
  | { readonly _tag: "Entered"; readonly routed: Routed }
  /** A frame on the way isn't there: its iframe doesn't match, holds no frame yet, or has no document yet. */
  | { readonly _tag: "Missing"; readonly routed: Routed }
  /** The engine's answer for an iframe that isn't one match, or isn't an iframe. */
  | { readonly _tag: "Answer"; readonly routed: Routed; readonly response: Engine.Response }

const route = (
  runtime: Runtime,
  top: Target.DocumentId,
  frames: ReadonlyArray<ReadonlyArray<Engine.Step>>,
  scroll: boolean,
  id: Diagnostics.OperationId
): Effect.Effect<Option.Option<Route>, SendFailure> =>
  Effect.gen(function*() {
    let document = top
    const hops: Array<Hop> = []
    for (const steps of frames) {
      const stale = replaced(document, steps)
      if (Option.isSome(stale)) {
        return Option.some<Route>({ _tag: "Answer", routed: { document, hops }, response: stale.value })
      }
      const found = yield* elementIn(runtime, document, steps, { scroll }, id)
      if (Option.isNone(found)) {
        return Option.none()
      }
      const routed = { document, hops }
      if (found.value._tag === "Response") {
        const response = found.value.response
        return Option.some<Route>(
          response._tag === "NoMatch" ? { _tag: "Missing", routed } : { _tag: "Answer", routed, response }
        )
      }
      const frame = yield* runtime.model.adapter.contentFrame(found.value.node).pipe(
        Effect.map(Option.some),
        Effect.catch((error) =>
          isMoved(error)
            ? Effect.succeed(Option.none<Option.Option<Target.NavigableId>>())
            : Effect.fail<SendFailure>(Operation.fromAdapter(error, id, runtime.backend))
        )
      )
      if (Option.isNone(frame)) return Option.none()
      if (Option.isNone(frame.value)) return Option.some<Route>({ _tag: "Missing", routed })
      const next = yield* runtime.model.documentOf(frame.value.value)
      if (Option.isNone(next)) return Option.some<Route>({ _tag: "Missing", routed })
      hops.push({ document, steps, frame: frame.value.value })
      document = next.value
    }
    return Option.some<Route>({ _tag: "Entered", routed: { document, hops } })
  })

/**
 * Goes where a locator's steps lead, again whenever a document on the way ends, until `at`: `answer` is given
 * the route and returns `None` to go again.
 */
const routing = <A>(
  runtime: Runtime,
  page: Model.PageEntry,
  steps: ReadonlyArray<Engine.Step>,
  scroll: boolean,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant,
  answer: (route: Route, last: ReadonlyArray<Engine.Step>) => Effect.Effect<Option.Option<A>, SendFailure>
): Effect.Effect<A, SendFailure> =>
  Effect.gen(function*() {
    const { frames, last } = split(steps)
    while (true) {
      if (Operation.millisLeft(at) <= 0) return yield* Effect.fail<SendFailure>({ _tag: "Deadline" })
      const open = yield* openState(page, id).pipe(
        Effect.timeoutOption(Operation.millisLeft(at)),
        Effect.flatMap(Option.match({
          onNone: () =>
            Effect.fail<SendFailure>({
              _tag: "Deadline",
              hint:
                "The page reported no document before the deadline; a page attached while a dialog is open reports none until the dialog closes (QUIRKS.md)"
            }),
          onSome: Effect.succeed
        }))
      )
      const routed = yield* route(runtime, open.document.id, frames, scroll, id)
      if (Option.isNone(routed)) continue
      const answered = yield* answer(routed.value, last)
      if (Option.isSome(answered)) return answered.value
    }
  })

/** What the engine answered, and where. */
export interface Answer {
  readonly response: Engine.Response
  readonly routed: Routed
}

/**
 * Sends the engine a request in the document its steps lead to (the page's current document, or a frame's) and
 * returns its answer, going again when a document on the way ends, until `at`.
 */
export const sendRouted = (
  runtime: Runtime,
  page: Model.PageEntry,
  request: Engine.Request,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Answer, SendFailure> =>
  Effect.raceFirst(
    // An action's frames are scrolled into view on its way, so they render (QUIRKS.md, Q110)
    routing(runtime, page, stepsOf(request), request.op === "act", id, at, (route, last) => {
      if (route._tag === "Answer") return Effect.succeedSome({ response: route.response, routed: route.routed })
      const routed = route.routed
      const stale = replaced(routed.document, last)
      if (route._tag === "Entered" && Option.isSome(stale)) return Effect.succeedSome({ response: stale.value, routed })
      return callEngine(
        runtime,
        routed.document,
        Engine.run,
        JSON.stringify(retarget(request, last, route._tag === "Missing")),
        id
      ).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (value) =>
            value.type === "string"
              ? Effect.succeedSome({ response: JSON.parse(value.value) as Engine.Response, routed })
              : Effect.die(new Error("The engine answered with something other than text"))
        }))
      )
    }),
    promptBlocked(page)
  )

/** `sendRouted`'s answer alone. */
export const send = (
  runtime: Runtime,
  page: Model.PageEntry,
  request: Engine.Request,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Engine.Response, SendFailure> =>
  Effect.map(sendRouted(runtime, page, request, id, at), (answer) => answer.response)

/**
 * Sends a request to one document of a page's, such as the guard's `disarm` to the document it was armed in:
 * `None` when the document has ended. A dialog nothing will decide fails it at once, as it does `send`.
 */
export const sendToDocument = (
  runtime: Runtime,
  page: Model.PageEntry,
  document: Target.DocumentId,
  request: Engine.Request,
  id: Diagnostics.OperationId
): Effect.Effect<Option.Option<Engine.Response>, SendFailure> =>
  Effect.raceFirst(
    Effect.suspend(() =>
      runtime.model.documents.has(document)
        ? callEngine(runtime, document, Engine.run, JSON.stringify(request), id).pipe(
          Effect.map(
            Option.flatMap((value) =>
              value.type === "string" ? Option.some(JSON.parse(value.value) as Engine.Response) : Option.none()
            )
          )
        )
        : Effect.succeedNone
    ),
    promptBlocked(page)
  )

/** The one match, by its node binding and where it is, or the engine's answer for why there is none. */
export type Found =
  | { readonly _tag: "Found"; readonly node: Adapter.NodeBinding; readonly routed: Routed }
  | { readonly _tag: "Response"; readonly response: Engine.Response; readonly routed: Routed }

/**
 * The one match of `steps`, now, by value from the engine, so its node binding comes with it: what the adapter's
 * `setInputFiles` takes (review 16, P7), and what `Locator.evaluate` passes (review 18, candidate 1).
 */
export const element = (
  runtime: Runtime,
  page: Model.PageEntry,
  steps: ReadonlyArray<Engine.Step>,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Found, SendFailure> =>
  Effect.raceFirst(
    routing(runtime, page, steps, false, id, at, (route, last): Effect.Effect<Option.Option<Found>, SendFailure> => {
      if (route._tag === "Answer") {
        return Effect.succeedSome({ _tag: "Response", response: route.response, routed: route.routed })
      }
      if (route._tag === "Missing") {
        return Effect.succeedSome({ _tag: "Response", response: { _tag: "NoMatch" }, routed: route.routed })
      }
      const stale = replaced(route.routed.document, last)
      if (Option.isSome(stale)) {
        return Effect.succeedSome({ _tag: "Response", response: stale.value, routed: route.routed })
      }
      return elementIn(runtime, route.routed.document, last, null, id).pipe(
        Effect.map(Option.map((found): Found => ({ ...found, routed: route.routed })))
      )
    }),
    promptBlocked(page)
  )

/** Waits for a page to end, as a failure: raced against an operation, it ends the operation with `TargetGone`. */
export const pageEnded = (page: Model.PageEntry, id: Diagnostics.OperationId) =>
  Effect.flatMap(Deferred.await(page.closed), (reason) =>
    Effect.fail(
      new Target.TargetGone({
        target: { _tag: "Page", id: page.id },
        reason,
        diagnostics: Operation.diagnostics(id)
      })
    ))
