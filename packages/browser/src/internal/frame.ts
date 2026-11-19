/**
 * Frame handles: one frame of a page, by its navigable id. Everything a handle reads, the page's frame entries and
 * each document's state, is the model's already, so a page whose frames no one holds does no more work.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as HttpUrl from "effect/http/Url"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Frame from "../Frame.ts"
import type * as JSHandle from "../JSHandle.ts"
import * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Evaluation from "./evaluation.ts"
import * as FunctionSource from "./functionSource.ts"
import type * as Model from "./model.ts"
import * as Navigated from "./navigated.ts"
import * as Navigation from "./navigation.ts"
import * as Operation from "./operation.ts"
import type { Readable } from "./readable.ts"
import * as Runtime from "./runtime.ts"
import * as Urls from "./urls.ts"
import * as Watchable from "./watchable.ts"

/** What a frame handle is made from: the page's runtime and entry, its grant, and the frame's id. */
export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly page: Model.PageEntry
  readonly grant: Option.Option<Access.Grant>
  readonly id: Target.NavigableId
}

/** The frame as the model has it now: its URL and current document, or `None` once it has left its page. */
interface View {
  readonly page: Model.PageState
  readonly frame: Option.Option<{ readonly url: Url.Url; readonly document: Option.Option<Target.DocumentId> }>
  readonly document: Option.Option<Model.DocumentState>
}

const frameIn = (owner: Owner, state: Model.PageState): View["frame"] => {
  if (owner.id === owner.page.id) {
    return state.status._tag === "Open"
      ? Option.some({ url: state.status.url, document: Option.some(state.status.document.id) })
      : Option.none()
  }
  const entry = state.frames.find((frame) => frame.id === owner.id)
  return entry === undefined ? Option.none() : Option.some({ url: entry.url, document: entry.document })
}

/** The page's state and the frame's current document's, together: a read of state the model already keeps. */
const view = (owner: Owner): Readable<View> => {
  const model = owner.runtime.model
  const documentOf = (frame: View["frame"]) =>
    Option.flatMap(frame, (each) => Option.flatMap(each.document, model.document))
  const make = (page: Model.PageState, document: Option.Option<Model.DocumentState>): View => ({
    page,
    frame: frameIn(owner, page),
    document
  })
  const getUnsafe = () => {
    const page = owner.page.state.getUnsafe()
    return make(page, Option.map(documentOf(frameIn(owner, page)), (entry) => entry.state.getUnsafe()))
  }
  return {
    get: Effect.sync(getUnsafe),
    getUnsafe,
    changes: owner.page.state.changes.pipe(
      Stream.switchMap((page) => {
        const document = documentOf(frameIn(owner, page))
        return Option.isNone(document)
          ? Stream.make(make(page, Option.none()))
          : Stream.map(document.value.state.changes, (state) => make(page, Option.some(state)))
      })
    )
  }
}

const project = (state: View): Option.Option<Frame.Status> => {
  if (state.page.status._tag === "Opening") return Option.none()
  if (Option.isNone(state.frame)) return Option.some({ _tag: "Detached" })
  const frame = state.frame.value
  const document = Option.flatMap(
    frame.document,
    (id) =>
      Option.map(state.document, (document): Page.DocumentStatus => ({
        id,
        readiness: document.readiness,
        lifecycle: "active"
      }))
  )
  return Option.some({
    _tag: "Attached",
    url: Option.match(state.document, { onNone: () => frame.url, onSome: (document) => document.url }),
    document
  })
}

const pageEnded = ({ page }: View): Option.Option<Target.CloseReason> =>
  page.status._tag === "Closed" ? Option.some(page.status.reason) : Option.none()

const pageError = (operation: string, reason: Page.PageErrorReason, id: Diagnostics.OperationId) =>
  new Page.PageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** A handle on one frame of a page, at the access the page was reached with. */
export const make = (owner: Owner): Frame.Frame => {
  const { runtime, page: entry, id: frame } = owner
  const model = runtime.model
  const state = view(owner)
  const target: Target.Description = { _tag: "Frame", id: frame }

  /** The frame leaving its page, or the page closing: either fails what runs against it. */
  const ended = Effect.flatMap(
    state.changes.pipe(
      Stream.filter((each) => Option.isNone(each.frame) || Option.isSome(pageEnded(each))),
      Stream.runHead
    ),
    (each) =>
      Effect.flatMap(Operation.currentDiagnostics, (diagnostics) =>
        Effect.fail(
          new Target.TargetGone({
            target,
            reason: Option.getOrElse(
              Option.flatMap(each, pageEnded),
              (): Target.CloseReason => new Target.FrameDetached({})
            ),
            diagnostics
          })
        ))
  )

  const failure = (operation: string, id: Diagnostics.OperationId, error: Adapter.AdapterError | Deadline.Timeout) => {
    const mapped = Operation.fromAdapter(error, id, runtime.backend)
    return mapped._tag !== "Reason" ? mapped.error : pageError(operation, mapped.reason, id)
  }

  /** The realm of a world in the frame's current document, following the frame to its next one if it ends. */
  const realm = (
    world: Adapter.World,
    id: Diagnostics.OperationId,
    at: Parameters<typeof BrowserClock.left>[0]
  ): Effect.Effect<Target.RealmId, Evaluation.Failure> =>
    Effect.gen(function*() {
      while (true) {
        if ((yield* BrowserClock.left(at)) <= 0) return yield* Effect.fail<Evaluation.Failure>({ _tag: "Deadline" })
        const current = yield* state.changes.pipe(
          Stream.filter((each) =>
            Option.isNone(each.frame) || Option.isSome(pageEnded(each)) ||
            Option.isSome(Option.flatMap(each.frame, (frame) => frame.document))
          ),
          Stream.runHead,
          BrowserClock.until(at),
          Effect.map(Option.flatten)
        )
        if (Option.isNone(current)) return yield* Effect.fail<Evaluation.Failure>({ _tag: "Deadline" })
        const document = Option.flatMap(current.value.frame, (each) => each.document)
        if (Option.isNone(document)) {
          return yield* Effect.flip(ended).pipe(
            Effect.flatMap((error) => Effect.fail<Evaluation.Failure>({ _tag: "Gone", error }))
          )
        }
        const found = yield* Evaluation.documentRealm(runtime, document.value, world, id).pipe(
          Effect.map(Option.some),
          Effect.catch((failure) =>
            failure._tag === "Gone" ? Effect.succeed(Option.none<Target.RealmId>()) : Effect.fail(failure)
          )
        )
        if (Option.isSome(found)) return found.value
      }
    })

  const evaluation = <B, R>(
    operation: string,
    world: Adapter.World,
    fn: Function,
    args: ReadonlyArray<unknown>,
    result: "value" | "handle",
    then: (realm: Target.RealmId, value: Adapter.RemoteValue) => Effect.Effect<B, Evaluation.Failure, R>
  ): Effect.Effect<B, Page.PageError | Target.TargetGone | Deadline.Timeout, R> =>
    Effect.gen(function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const id = record.id
      const at = record.budget.at
      const gesture = world._tag === "Main" && (yield* Effect.service(Page.UserGesture))
      return yield* Effect.gen(function*() {
        const found = yield* realm(world, id, at)
        const values = yield* Evaluation.toLocal(args, found)
        const group = yield* Evaluation.groupFor(runtime, found, result)
        const value = yield* Evaluation.call(runtime, {
          dispatch: record,
          realm: found,
          functionDeclaration: FunctionSource.declaration(fn),
          arguments: values,
          result,
          group,
          userActivation: gesture,
          page: Option.some(entry),
          at,
          id
        })
        return yield* then(found, value)
      }).pipe(
        Effect.mapError((failure) =>
          failure._tag === "Gone"
            ? failure.error
            : failure._tag === "Deadline"
            ? record.timeout(Option.some(
              record.dispatch._tag === "MayHaveBeenSent"
                ? "The frame didn't answer before the deadline; the function may still be running"
                : "The frame had no document to evaluate in before the deadline"
            ))
            : pageError(operation, failure.reason, id)
        )
      )
    }).pipe(
      Operation.named(operation, {
        attributes: {
          "browser.page.id": entry.id,
          "browser.frame.id": frame,
          "browser.evaluation.world": world._tag === "Main" ? "main" : world.name
        }
      })
    )

  const goto = (url: string, options?: Page.GotoOptions | undefined) => {
    const operation = "Frame.goto"
    const parsed = HttpUrl.fromString(url)
    if (Result.isFailure(parsed)) {
      return Effect.fail(pageError(
        operation,
        new Reason.InvalidInput({
          input: "url",
          expected: "an absolute URL",
          hint: `${JSON.stringify(url)} doesn't parse`
        }),
        Operation.idNow()
      ))
    }
    const href = parsed.success.href
    const waitUntil = options?.waitUntil ?? "commit"
    return Effect.gen(function*() {
      yield* Access.check(owner.grant)
      const record = yield* Operation.record
      const id = record.id
      record.markSent()
      const started = yield* record.bound(
        model.adapter.navigate(frame, href, { referrer: Option.none() }).pipe(
          Effect.mapError((error) => failure(operation, id, error))
        ),
        () => Option.some("The browser didn't answer the navigation before the deadline; it may have started")
      )
      record.markConfirmed()
      const navigation = yield* model.navigation(started)
      const outcome = yield* record.bound(
        Deferred.await(navigation.outcome),
        () => Option.some("The navigation had no outcome before the deadline")
      ).pipe(Effect.ensuring(model.forget(started)))
      const document = "document" in outcome ? model.document(outcome.document) : Option.none()
      const at = Option.isSome(document) ? (yield* document.value.state.get).url : Urls.reported(href)
      const result = yield* Navigation.settle(
        model,
        operation,
        started,
        frame,
        Option.some(Urls.reported(href)),
        at,
        outcome,
        id,
        options?.accept ?? []
      )
      if (!(yield* Navigated.reached(model, result, waitUntil, Option.some(record.budget.at)))) {
        return yield* Effect.fail(record.timeout(Option.some(`The document committed but didn't reach ${waitUntil}`)))
      }
      // A document that ends before its readiness counts as reached, as for a page; one that ended with its frame
      // didn't get there
      if (result._tag === "Committed") {
        const committed = model.document(result.document)
        const why = Option.isSome(committed) ? yield* Deferred.poll(committed.value.ended) : Option.none()
        const detached = Option.isSome(why)
          ? (yield* why.value)._tag === "FrameDetached"
          : Option.isNone((yield* state.get).frame)
        if (detached) {
          return yield* Effect.fail(
            new Target.TargetGone({
              target,
              reason: new Target.FrameDetached({}),
              diagnostics: Operation.diagnostics(id)
            })
          )
        }
      }
      return result
    }).pipe(
      Effect.raceFirst(ended),
      Operation.named(operation, {
        attributes: {
          "browser.page.id": entry.id,
          "browser.frame.id": frame,
          "browser.navigation.wait_until": waitUntil,
          "url.full": href
        }
      })
    ) as Effect.Effect<PageNavigation.PageNavigation, Page.PageError | Target.TargetGone | Deadline.Timeout>
  }

  return {
    id: frame,
    page: runtime.observed(entry),
    status: Watchable.make({
      ref: state,
      project,
      ended: pageEnded,
      final: (each) => Option.isNone(each.frame),
      target,
      operation: "Frame.status.waitFor"
    }),
    evaluate: <Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args) =>
      evaluation(
        "Frame.evaluate",
        Evaluation.isolatedWorld,
        fn,
        args,
        "value",
        (_realm, value) => Evaluation.fromRemote(value)
      ) as Effect.Effect<JSHandle.Serialized<A>, Page.PageError | Target.TargetGone | Deadline.Timeout>,
    evaluateInMainWorld: <Args extends ReadonlyArray<unknown>, A>(
      fn: (...args: Args) => A | Promise<A>,
      ...args: Args
    ) =>
      evaluation(
        "Frame.evaluateInMainWorld",
        { _tag: "Main" },
        fn,
        args,
        "value",
        (_realm, value) => Evaluation.fromRemote(value)
      ) as Effect.Effect<JSHandle.Serialized<A>, Page.PageError | Target.TargetGone | Deadline.Timeout>,
    evaluateHandle: <Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args) =>
      evaluation(
        "Frame.evaluateHandle",
        Evaluation.isolatedWorld,
        fn,
        args,
        "handle",
        (found, value) => Evaluation.own<Awaited<A>>(runtime, found, value, Option.some(entry))
      ),
    goto,
    toString: () => `Frame(${frame})`
  } as Frame.Frame
}

/** `page.frameById(id)`: a handle when the page has a frame with that id now. */
export const byId = (
  owner: Omit<Owner, "id">,
  id: Target.NavigableId
): Effect.Effect<Frame.Frame, Page.PageError> =>
  Effect.gen(function*() {
    const record = yield* Operation.record
    const known = owner.page.id === id ||
      (yield* owner.page.state.get).frames.some((frame) => frame.id === id)
    if (!known) {
      return yield* Effect.fail(pageError(
        "Page.frameById",
        new Reason.InvalidInput({
          input: "id",
          expected: "the id of a frame in page.frames",
          hint: `The page has no frame ${JSON.stringify(id)} now`
        }),
        record.id
      ))
    }
    return make({ ...owner, id })
  }).pipe(Operation.named("Page.frameById", { attributes: { "browser.page.id": owner.page.id } }))
