/**
 * What the public objects of one connection share: the model, the backend's name for errors, and a channel to
 * the engine in a page's current document.
 *
 * A request goes to the engine in the utility world of the page's active document, or of a frame's, which a
 * locator's frame boundaries lead to: each iframe on the way is found by the engine of
 * the document it is in, and the adapter names the frame it holds. The engine is installed in a document on first
 * use; when a document on the way changes under a request (a navigation committed, the realm went), the request
 * goes again from the page's document, within the operation's deadline. Nothing the engine does dispatches input,
 * so sending a request again is always safe. A frame that isn't there yet is a request that matches nothing.
 *
 * A dialog pauses its page, and on some backends every evaluation with it. A request waits for
 * a dialog that a handler or the policy is deciding, within its deadline, and fails at once with
 * `PromptBlocking` when the page has one nothing will decide.
 */
import * as Cache from "effect/Cache"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as FileSystem from "effect/FileSystem"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import type * as Path from "effect/Path"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as BrowserWorker from "../BrowserWorker.ts"
import * as Deadline from "../Deadline.ts"
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
import * as BrowserClock from "./browserClock.ts"
import type * as Clock from "./clock.ts"
import * as Engine from "./engine.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

/** The utility world the engine runs in. */
export const utilityWorld: Adapter.World = { _tag: "Isolated", name: "__strider_utility__" }

/** Whether the backend makes no worlds, as stock WebKit's inspector doesn't (QUIRKS.md, Q194). */
const makesNoWorlds = (runtime: { readonly model: Model.Model }): Effect.Effect<boolean> =>
  Effect.map(
    SubscriptionRef.get(runtime.model.adapter.capabilities),
    (capabilities) =>
      capabilities.entries.some((entry) => entry.name === "isolatedWorlds" && entry.status === "unsupported")
  )

/** The world the engine runs in: its own, or the page's where the backend makes no worlds. */
export const engineWorld = (runtime: { readonly model: Model.Model }): Effect.Effect<Adapter.World> =>
  Effect.map(makesNoWorlds(runtime), (none): Adapter.World => none ? { _tag: "Main" } : utilityWorld)

/**
 * The world the library's own reads run in, such as storage's: `world`, or the page's where the backend makes no
 * worlds. A caller's function never moves there: `evaluate` fails with `Unsupported` instead.
 */
export const ownWorld = (runtime: Runtime, world: Adapter.World): Effect.Effect<Adapter.World> =>
  Effect.map(makesNoWorlds(runtime), (none): Adapter.World => none ? { _tag: "Main" } : world)

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
   * each time.
   */
  readonly observed: (entry: Model.PageEntry) => Page.ObservedPage
  /** The connection's handle for a download, the same each time. */
  readonly download: (entry: Model.DownloadEntry) => Download.Download
  /** The connection's handle for a worker, the same each time. */
  readonly worker: (entry: Model.WorkerEntry) => BrowserWorker.BrowserWorker
  /** The connection's handle for a WebSocket or EventSource, the same each time. */
  readonly connection: (entry: Model.ConnectionEntry) => NetworkConnection.NetworkConnection
  /** The program's file system, which a launched browser shares: a download is copied out with it. */
  readonly fileSystem: Option.Option<FileSystem.FileSystem>
  /** Effect's `Path`, which a relative local file path is resolved with. */
  readonly path: Option.Option<Path.Path>
  /** Where the engine is installed, per document (`makeEngineRealms`). */
  readonly engineRealms: EngineRealms
  /** The page clocks installed, by the page or context that owns each. */
  readonly timelines: Clock.Timelines
  /**
   * A navigation's outcome as `goto` reports it (`navigation.ts`), for `PageNavigation`, which can't import `Page`
   * without a load cycle.
   */
  readonly settle: (
    operation: string,
    navigation: PageNavigation.Id,
    frame: Target.NavigableId,
    url: Option.Option<Url.Url>,
    at: Url.Url,
    outcome: Adapter.NavigationOutcome,
    id: Diagnostics.OperationId
  ) => Effect.Effect<PageNavigation.PageNavigation, Page.PageError>
}

/**
 * How long a round of checks in the page may wait for its condition: a second at most, and in the operation's last
 * second half of what's left, so the round's answer, with what it saw, comes back before the deadline does.
 */
export const roundCap = (left: number): number => Math.max(0, left > 1000 ? 1000 : left / 2)

/** Why a request to the engine didn't get an answer. */
export type SendFailure =
  | Exclude<Operation.Failure, { readonly _tag: "Timeout" }>
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
  page.state.changes.pipe(
    Stream.filterMap(
      Filter.fromPredicateOption(({ status }) => status._tag === "Open" ? status.undecided : Option.none())
    ),
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
  page.state.changes.pipe(
    Stream.map((state) => state.status),
    Stream.filter((status) => status._tag !== "Opening"),
    Stream.runHead,
    Effect.flatMap((state): Effect.Effect<Extract<Model.PageStatus, { _tag: "Open" }>, SendFailure> => {
      if (Option.isNone(state)) {
        return Effect.fail(gone({ _tag: "Page", id: page.id }, new Target.Vanished({}), id))
      }
      const value = state.value
      return value._tag === "Open"
        ? Effect.succeed(value)
        : Effect.fail(
          gone(
            { _tag: "Page", id: page.id },
            value._tag === "Closed" ? value.reason : new Target.Vanished({}),
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
  args: ReadonlyArray<Adapter.LocalValue>,
  releaseResult?: boolean
) =>
  runtime.model.adapter.evaluate(realm, {
    functionDeclaration,
    arguments: args,
    awaitPromise: true,
    result: "value",
    ...(releaseResult === true ? { releaseResult: true } : {}),
    userActivation: false
  })

/** The most documents whose engine's realm is remembered at once; a document forgotten installs it again, once. */
const maxEngineRealms = 1000

/** The realm of each document's engine world, the engine installed in it once, however many ask at once. */
export type EngineRealms = Cache.Cache<Target.DocumentId, Target.RealmId, Adapter.AdapterError | Deadline.Timeout>

/**
 * The runtime's memo of where the engine is installed, a `Cache`, so concurrent requests to one document share one
 * install. The install runs apart from the operation that asked first, so another's deadline isn't the first's,
 * and each caller waits for it until its own (`engineRealm`). A failed install isn't kept: the next request tries
 * again. An entry that goes stale, its realm gone or its engine missing, is invalidated by the request that finds
 * it so, which installs again.
 */
export const makeEngineRealms = (model: Model.Model): Effect.Effect<EngineRealms> =>
  Cache.makeWith(
    Effect.fnUntraced(function*(document: Target.DocumentId) {
      const realm = yield* model.adapter.realm(document, yield* engineWorld({ model }))
      const installed = yield* model.adapter.evaluate(realm, {
        functionDeclaration: Engine.install,
        arguments: [],
        awaitPromise: true,
        result: "value",
        userActivation: false
      })
      if (installed._tag === "Exception") {
        return yield* Effect.die(new Error(`The engine didn't install: ${installed.text}`))
      }
      return realm
    }, Operation.detached),
    { capacity: maxEngineRealms, timeToLive: (exit) => Exit.isSuccess(exit) ? Duration.infinity : Duration.zero }
  )

/** The realm of a document's engine, with the engine installed, waited for until the operation's deadline. */
const engineRealm = (runtime: Runtime, document: Target.DocumentId) =>
  Effect.flatMap(Operation.current, (record) => {
    const installed = Cache.get(runtime.engineRealms, document)
    return Option.isNone(record)
      ? installed
      : record.value.bound(installed, () => Option.some("The engine wasn't installed in the page before the deadline"))
  })

/** One iframe on the way to a frame's document. */
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
 * A ref resolved in another document than the one that gave it: stale, since a ref never
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

const isMoved = (error: Adapter.AdapterError | Deadline.Timeout) =>
  !Deadline.isTimeout(error) && error.reason._tag === "Gone" &&
  (error.reason.target._tag === "Document" || error.reason.target._tag === "Realm")

/** An adapter's failure, as a request's: a call the browser didn't answer before the deadline is `Deadline`. */
export const fromAdapter = (
  error: Adapter.AdapterError | Deadline.Timeout,
  id: Diagnostics.OperationId,
  backend: string
): SendFailure => {
  const mapped = Operation.fromAdapter(error, id, backend)
  return mapped._tag === "Timeout" ? { _tag: "Deadline" } : mapped
}

/**
 * The engine's realm in a document, and a call to it; `None` when the document or its realm went, or the realm
 * lost its engine, so the caller goes again.
 */
const callEngine = (
  runtime: Runtime,
  document: Target.DocumentId,
  functionDeclaration: string,
  request: string | Effect.Effect<string>,
  id: Diagnostics.OperationId,
  releaseResult?: boolean
): Effect.Effect<Option.Option<Adapter.RemoteValue>, SendFailure> =>
  engineRealm(runtime, document).pipe(
    Effect.flatMap((realm) =>
      Effect.flatMap(
        typeof request === "string" ? Effect.succeed(request) : request,
        (encoded) => call(runtime, realm, functionDeclaration, [string(encoded)], releaseResult)
      )
    ),
    Effect.map(Option.some),
    Effect.catch((error: Adapter.AdapterError | Deadline.Timeout) => {
      if (isMoved(error)) {
        return Effect.as(Cache.invalidate(runtime.engineRealms, document), Option.none<Adapter.RemoteResult>())
      }
      return Effect.fail(fromAdapter(error, id, runtime.backend))
    }),
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeed(Option.none<Adapter.RemoteValue>()),
      onSome: (result): Effect.Effect<Option.Option<Adapter.RemoteValue>> => {
        if (result._tag === "Exception") return Effect.die(new Error(`The engine threw: ${result.text}`))
        if (result.value.type === "string" && result.value.value === Engine.missing) {
          // A realm that lost its engine, as a reused realm can: install again
          return Effect.as(Cache.invalidate(runtime.engineRealms, document), Option.none())
        }
        return Effect.succeed(Option.some(result.value))
      }
    }))
  )

/**
 * The engine's answer, decoded. One that isn't an answer the engine gives fails as `IncompatibleResponse`: where
 * the engine shares the page's world (stock WebKit), a page's script can call back in its place.
 */
const decode = (text: string): Effect.Effect<Engine.Response, SendFailure> =>
  Engine.decodeResponse(text).pipe(
    Effect.mapError((error): SendFailure => ({
      _tag: "Reason",
      reason: new Reason.BackendFailure({
        kind: "IncompatibleResponse",
        method: "engine",
        hint:
          `The query engine's answer isn't one it gives, so a page script may have answered in its place: ${error.message}`,
        cause: error
      })
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
  frame: { readonly scroll: boolean; readonly validationSteps?: ReadonlyArray<Engine.Step> } | null,
  id: Diagnostics.OperationId
): Effect.Effect<Option.Option<Element>, SendFailure> =>
  callEngine(
    runtime,
    document,
    Engine.element,
    JSON.stringify({
      steps,
      frame: frame !== null,
      scroll: frame?.scroll ?? false,
      ...(frame?.validationSteps === undefined ? {} : { validationSteps: frame.validationSteps })
    }),
    id
  ).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (value) => {
        if (value.type === "node" && value.node !== undefined) {
          return Effect.succeed(Option.some<Element>({ _tag: "Found", node: value.node }))
        }
        if (value.type === "string") {
          return Effect.map(
            decode(value.value),
            (response) => Option.some<Element>({ _tag: "Response", response })
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
  id: Diagnostics.OperationId,
  validationSteps: ReadonlyArray<Engine.Step>
): Effect.Effect<Option.Option<Route>, SendFailure> =>
  Effect.gen(function*() {
    let document = top
    const hops: Array<Hop> = []
    for (const steps of frames) {
      const stale = replaced(document, steps)
      if (Option.isSome(stale)) {
        return Option.some<Route>({ _tag: "Answer", routed: { document, hops }, response: stale.value })
      }
      const found = yield* elementIn(runtime, document, steps, {
        scroll,
        ...(hops.length === 0 ? { validationSteps } : {})
      }, id)
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
            : Effect.fail(fromAdapter(error, id, runtime.backend))
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
      if ((yield* BrowserClock.left(at)) <= 0) return yield* Effect.fail<SendFailure>({ _tag: "Deadline" })
      const open = yield* openState(page, id).pipe(
        BrowserClock.until(at),
        Effect.flatMap(Option.match({
          onNone: () =>
            Effect.fail<SendFailure>({
              _tag: "Deadline",
              hint:
                "The page reported no document before the deadline; a page attached while a dialog is open reports none until the dialog closes"
            }),
          onSome: Effect.succeed
        }))
      )
      const routed = yield* route(runtime, open.document.id, frames, scroll, id, steps)
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
    routing(
      runtime,
      page,
      stepsOf(request),
      request.op === "act",
      id,
      at,
      Effect.fnUntraced(function*(route: Route, last: ReadonlyArray<Engine.Step>) {
        if (route._tag === "Answer") return Option.some({ response: route.response, routed: route.routed })
        const routed = route.routed
        const stale = replaced(routed.document, last)
        if (route._tag === "Entered" && Option.isSome(stale)) return Option.some({ response: stale.value, routed })
        let clip: Engine.Clip | undefined
        if (
          route._tag === "Entered" && request.op === "act" &&
          ((request.action._tag === "Point" && request.action.position === null) || request.checks.receivesPointer)
        ) {
          // Read each ancestor in its own document: this also works across origin and process boundaries.
          for (const hop of routed.hops) {
            const answer = yield* sendToDocument(runtime, page, hop.document, {
              op: "frame",
              steps: hop.steps,
              scroll: request.checks.inViewport,
              point: null,
              ...(clip === undefined ? {} : { clip })
            }, id)
            if (Option.isNone(answer)) return Option.none()
            if (answer.value._tag === "NoMatch") {
              return Option.some({
                routed,
                response: {
                  _tag: "NotReady" as const,
                  reason: { _tag: "NoMatch" as const },
                  history: [{ _tag: "NoMatch" as const }],
                  scrolled: false,
                  checked: true
                }
              })
            }
            if (answer.value._tag !== "Frame") return Option.some({ response: answer.value, routed })
            if (answer.value.scrolled) {
              return Option.some({
                routed,
                response: {
                  _tag: "NotReady" as const,
                  reason: { _tag: "OutsideViewport" as const },
                  history: [{ _tag: "OutsideViewport" as const }],
                  scrolled: true,
                  checked: true
                }
              })
            }
            clip = answer.value.viewport
          }
        }
        return yield* callEngine(
          runtime,
          routed.document,
          Engine.run,
          Effect.gen(function*() {
            // Recompute after every route and install, including a stale realm's replacement.
            const current = request.op === "expect"
              ? { ...request, cap: Math.min(request.cap, roundCap(yield* BrowserClock.left(at))) }
              : request
            return JSON.stringify(
              retarget(
                current.op === "act" && clip !== undefined ? { ...current, clip } : current,
                last,
                route._tag === "Missing"
              )
            )
          }),
          id
        ).pipe(
          Effect.flatMap(Option.match({
            onNone: () => Effect.succeedNone,
            onSome: (value) =>
              value.type === "string"
                ? Effect.map(decode(value.value), (response) => Option.some({ response, routed }))
                : Effect.die(new Error("The engine answered with something other than text"))
          }))
        )
      })
    ),
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
      Option.isSome(runtime.model.document(document))
        ? callEngine(runtime, document, Engine.run, JSON.stringify(request), id).pipe(
          Effect.flatMap((value) =>
            Option.isSome(value) && value.value.type === "string"
              ? Effect.asSome(decode(value.value.value))
              : Effect.succeedNone
          )
        )
        : Effect.succeedNone
    ),
    promptBlocked(page)
  )

/**
 * Idempotent engine cleanup in its original document, including while a dialog is open. Unlike a read, release
 * must remain queued until the document can execute it. Run apart in an owning scope; never wait for it in a
 * caller's uninterruptible finalizer. A gone document needs no release.
 */
export const releaseInDocument = (
  runtime: Runtime,
  document: Target.DocumentId,
  request: Extract<Engine.Request, { readonly op: "validationStop" }>,
  id: Diagnostics.OperationId
): Effect.Effect<void, SendFailure> =>
  Effect.suspend(() =>
    Option.isSome(runtime.model.document(document))
      ? Effect.asVoid(callEngine(runtime, document, Engine.run, JSON.stringify(request), id))
      : Effect.void
  )

/** The one match, by its node binding and where it is, or the engine's answer for why there is none. */
export type Found =
  | { readonly _tag: "Found"; readonly node: Adapter.NodeBinding; readonly routed: Routed }
  | { readonly _tag: "Response"; readonly response: Engine.Response; readonly routed: Routed }

/**
 * The one match of `steps`, now, by value from the engine, so its node binding comes with it: what the adapter's
 * `setInputFiles` takes, and what `Locator.evaluate` passes.
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

type FoundElements =
  | { readonly _tag: "Found"; readonly nodes: ReadonlyArray<Adapter.NodeBinding>; readonly routed: Routed }
  | { readonly _tag: "Response"; readonly response: Engine.Response; readonly routed: Routed }

/** All matches resolved together in the final document; node bindings carry no retained array handle. */
export const elements = (
  runtime: Runtime,
  page: Model.PageEntry,
  steps: ReadonlyArray<Engine.Step>,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<
  FoundElements,
  SendFailure
> =>
  Effect.raceFirst(
    routing(
      runtime,
      page,
      steps,
      false,
      id,
      at,
      Effect.fnUntraced(
        function*(
          route: Route,
          last: ReadonlyArray<Engine.Step>
        ): Effect.fn.Return<Option.Option<FoundElements>, SendFailure> {
          const routed = route.routed
          if (route._tag === "Answer") {
            return Option.some({ _tag: "Response" as const, response: route.response, routed })
          }
          if (route._tag === "Missing") {
            return Option.some({ _tag: "Found" as const, nodes: [], routed })
          }
          const stale = replaced(routed.document, last)
          if (Option.isSome(stale)) return Option.some({ _tag: "Response" as const, response: stale.value, routed })
          const result = yield* callEngine(
            runtime,
            routed.document,
            Engine.element,
            JSON.stringify({ steps: last, all: true }),
            id,
            true
          )
          if (Option.isNone(result)) return Option.none()
          const value = result.value
          if (value.type === "string") {
            return Option.some({ _tag: "Response" as const, response: yield* decode(value.value), routed })
          }
          if (value.type !== "array" || value.value === undefined) {
            return yield* Effect.die(new Error("The engine's matches came back without an array"))
          }
          const nodes: Array<Adapter.NodeBinding> = []
          for (const member of value.value) {
            if (member.type !== "node" || member.node === undefined) {
              return yield* Effect.die(new Error("The engine's match came back without a node binding"))
            }
            nodes.push(member.node)
          }
          return Option.some({ _tag: "Found" as const, nodes, routed })
        }
      )
    ),
    promptBlocked(page)
  )

/** Waits for a page to end, as a failure: raced against an operation, it ends the operation with `TargetGone`. */
export const pageEnded = (page: Model.PageEntry) =>
  Effect.flatMap(
    Deferred.await(page.closed),
    (reason) =>
      Effect.flatMap(Operation.currentDiagnostics, (diagnostics) =>
        Effect.fail(new Target.TargetGone({ target: { _tag: "Page", id: page.id }, reason, diagnostics })))
  )
