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
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Frame from "../Frame.ts"
import type * as JSHandle from "../JSHandle.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Evaluation from "./evaluation.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as PageImpl from "./page.ts"
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

const frameError = (operation: string, reason: Frame.FrameErrorReason, id: Diagnostics.OperationId) =>
  new Frame.FrameError({ operation, reason, diagnostics: Operation.diagnostics(id) })

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

  /** The realm of a world in the frame's current document, following the frame to its next one if it ends. */
  const realm = (
    world: Adapter.World,
    id: Diagnostics.OperationId,
    at: MonotonicInstant.MonotonicInstant
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

  const driven: PageImpl.Driven<Frame.FrameError> = {
    runtime,
    entry,
    navigable: frame,
    ended,
    error: frameError,
    attributes: { "browser.page.id": entry.id, "browser.frame.id": frame },
    realm,
    noun: "frame"
  }

  const evaluation = <B, R>(
    operation: string,
    world: Adapter.World,
    fn: Function,
    args: ReadonlyArray<unknown>,
    result: "value" | "handle",
    then: (realm: Target.RealmId, value: Adapter.RemoteValue) => Effect.Effect<B, Evaluation.Failure, R>
  ) =>
    Effect.flatMap(
      Access.check(owner.grant),
      () => PageImpl.evaluateIn(driven, operation, world, fn, args, result, then)
    )

  /**
   * A document that ends before its readiness counts as reached, as for a page; one that ended with its frame
   * didn't get there.
   */
  const stillAttached = Effect.fnUntraced(
    function*(result: PageNavigation.PageNavigation, id: Diagnostics.OperationId) {
      if (result._tag !== "Committed") return
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
  )

  const goto = (url: string, options?: Page.GotoOptions | undefined) => {
    const operation = "Frame.goto"
    const parsed = HttpUrl.fromString(url)
    if (Result.isFailure(parsed)) {
      return Effect.fail(frameError(
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
      // A child frame's readiness is only waited for where the browser reports it
      if (frame !== entry.id && waitUntil !== "commit") {
        const capabilities = yield* SubscriptionRef.get(model.adapter.capabilities)
        const readiness = capabilities.entries.find((each) => each.name === "frames.readiness")
        if (readiness !== undefined && readiness.status !== "supported") {
          return yield* Effect.fail(frameError(
            operation,
            new Reason.Unsupported({
              capability: "frames.readiness",
              backend: runtime.backend,
              hint: `${
                readiness.limitations.join("; ") || `${runtime.backend} doesn't report a frame's readiness`
              }; wait until "commit" instead`
            }),
            Operation.idNow()
          ))
        }
      }
      return yield* PageImpl.navigateIn(
        driven,
        operation,
        Option.some(Urls.reported(href)),
        (id) =>
          Effect.map(model.adapter.navigate(frame, href, { referrer: Option.none() }), Option.some).pipe(
            Effect.mapError((error) => {
              const mapped = Operation.fromAdapter(error, id, runtime.backend)
              return mapped._tag !== "Reason" ? mapped.error : frameError(operation, mapped.reason, id)
            })
          ),
        waitUntil,
        options?.accept ?? [],
        stillAttached
      ).pipe(Effect.map(Option.getOrThrow))
    })
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
      ) as Effect.Effect<JSHandle.Serialized<A>, Frame.FrameError | Target.TargetGone | Deadline.Timeout>,
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
      ) as Effect.Effect<JSHandle.Serialized<A>, Frame.FrameError | Target.TargetGone | Deadline.Timeout>,
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
