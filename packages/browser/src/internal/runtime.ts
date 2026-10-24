/**
 * What the public objects of one connection share: the model, the backend's name for errors, and a channel to
 * the engine in a page's current document (review 12, candidate 3).
 *
 * A request goes to the engine in the utility world of the page's active document. The engine is installed
 * there on first use; when the document changes under a request (a navigation committed, the realm went), the
 * request goes again to the new document, within the operation's deadline. Nothing the engine does dispatches
 * input, so sending a request again is always safe.
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
   * The connection's handle for a page, the same each time, made on first use and kept as long as the page's
   * entry is; `None` for a page outside the contexts the connection created.
   */
  readonly page: (entry: Model.PageEntry) => Option.Option<Page.Page>
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
  | { readonly _tag: "Deadline" }

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
const openState = (page: Model.PageEntry, id: Diagnostics.OperationId) =>
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

/**
 * Sends the engine a request in the page's current document and returns its answer, going again to a new
 * document when the one it was sent to ends, until `at`.
 */
export const send = (
  runtime: Runtime,
  page: Model.PageEntry,
  request: Engine.Request,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Engine.Response, SendFailure> =>
  Effect.raceFirst(sendTo(runtime, page, request, id, at), promptBlocked(page))

const sendTo = Effect.fnUntraced(function*(
  runtime: Runtime,
  page: Model.PageEntry,
  request: Engine.Request,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
) {
  while (true) {
    if (Operation.millisLeft(at) <= 0) return yield* Effect.fail<SendFailure>({ _tag: "Deadline" })
    const open = yield* openState(page, id).pipe(
      Effect.timeoutOption(Operation.millisLeft(at)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail<SendFailure>({ _tag: "Deadline" }),
        onSome: Effect.succeed
      }))
    )
    const document = open.document.id
    const answer = yield* engineRealm(runtime, document).pipe(
      Effect.flatMap((realm) => call(runtime, realm, Engine.run, [string(JSON.stringify(request))])),
      Effect.map(Option.some),
      Effect.catch((error: Adapter.AdapterError) => {
        const reason = error.reason
        // The document or its realm went while the request was on its way: go again to the new one
        if (reason._tag === "Gone" && (reason.target._tag === "Document" || reason.target._tag === "Realm")) {
          runtime.model.engineRealms.delete(document)
          return Effect.succeed(Option.none())
        }
        return Effect.fail<SendFailure>(Operation.fromAdapter(error, id, runtime.backend))
      })
    )
    if (Option.isNone(answer)) continue
    const result = answer.value
    if (result._tag === "Exception") {
      return yield* Effect.die(new Error(`The engine threw: ${result.text}`))
    }
    if (result.value.type !== "string") {
      return yield* Effect.die(new Error("The engine answered with something other than text"))
    }
    if (result.value.value === Engine.missing) {
      // A realm that lost its engine, as a reused realm can: install again
      runtime.model.engineRealms.delete(document)
      continue
    }
    return JSON.parse(result.value.value) as Engine.Response
  }
})

/**
 * The one match of `steps`, by value from the engine, so its node binding comes with it: what the adapter's
 * `setInputFiles` takes (review 16, P7). `None` when there is no one match, or the browser gave no binding.
 */
export const element = Effect.fnUntraced(function*(
  runtime: Runtime,
  page: Model.PageEntry,
  steps: ReadonlyArray<Engine.Step>,
  id: Diagnostics.OperationId
) {
  const open = yield* openState(page, id)
  const realm = yield* engineRealm(runtime, open.document.id).pipe(
    Effect.mapError((error): SendFailure => Operation.fromAdapter(error, id, runtime.backend))
  )
  const result = yield* call(runtime, realm, Engine.element, [string(JSON.stringify({ steps }))]).pipe(
    Effect.mapError((error): SendFailure => Operation.fromAdapter(error, id, runtime.backend))
  )
  return result._tag === "Value" && result.value.type === "node" && result.value.node !== undefined
    ? Option.some(result.value.node)
    : Option.none<Adapter.NodeBinding>()
})

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
