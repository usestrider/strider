/**
 * Pages (API.md, Pages). Built: the state (`status`, `url`, `frames`, `workers`, `closed`), the
 * queries and `frame`, `goto`, `reload`, `back` and `forward`, `title`, `readHtml`, `snapshot`, `screenshot`, `pdf`,
 * origin storage, evaluation, the declarations, `activate`, `close`, the keyboard and mouse,
 * `inspect`, `control` and `capability`.
 *
 * Every handle for a page shares its observe members (`observeMembers`). A page the connection controls for its life
 * has one `Page`; any other page has an observed handle, and `inspect` and `control` make handles under a grant,
 * whose other members `Access.guard` checks.
 *
 * A navigation resolves at commit, with the outcome the adapter reports for the navigation it started, or with
 * the readiness `waitUntil` asks for of the document it committed, all under one deadline; a navigation with
 * no outcome by then is `Timeout{postcondition}` (CONCEPTS.md §4).
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import type * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as JSHandle from "../JSHandle.ts"
import type * as Locator from "../Locator.ts"
import * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Reason from "../Reason.ts"
import type * as Route from "../Route.ts"
import type * as Snapshot from "../Snapshot.ts"
import type * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as UserContext from "../UserContext.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as Capabilities from "./capabilities.ts"
import * as Captures from "./captures.ts"
import * as Clock from "./clock.ts"
import * as Devices from "./devices.ts"
import * as Emulation from "./emulation.ts"
import * as Evaluation from "./evaluation.ts"
import * as Guarded from "./guarded.ts"
import * as Handles from "./handles.ts"
import * as InitScripts from "./initScripts.ts"
import * as LocatorImpl from "./locator.ts"
import type * as Model from "./model.ts"
import * as Navigated from "./navigated.ts"
import * as Navigation from "./navigation.ts"
import * as Operation from "./operation.ts"
import * as Routes from "./routes.ts"
import * as Runtime from "./runtime.ts"
import * as Snapshots from "./snapshot.ts"
import * as Storage from "./storage.ts"
import * as Watchable from "./watchable.ts"

const PageTypeId = "~@usestrider/browser/Page"

const opened = (state: Model.PageState): Option.Option<Page.Status> =>
  state._tag === "Opening"
    ? Option.none()
    : Option.some(
      state._tag === "Open"
        ? { _tag: "Open", url: state.url as Url.Url, document: state.document, prompt: state.prompt }
        : { _tag: "Closed", reason: state.reason }
    )

const pageEnded = (state: Model.PageState): Option.Option<Target.CloseReason> =>
  state._tag === "Closed" ? Option.some(state.reason) : Option.none()

/** A page's frame tree, from the model's: each frame under its parent, in the order they were added. */
const frameTree = (page: Target.NavigableId, state: Model.FrameTreeState): Page.FrameTree => {
  const children = (parent: Target.NavigableId): ReadonlyArray<Page.FrameTree> =>
    state.frames.filter((frame) => frame.parent === parent).map((frame) => ({
      id: frame.id,
      url: frame.url as Url.Url,
      // No backend reports a frame's name, and `window.name` is its document's to read
      name: Option.none(),
      children: children(frame.id)
    }))
  return { id: page, url: state.url as Url.Url, name: Option.none(), children: children(page) }
}

const pageError = (operation: string, reason: Page.PageErrorReason, id: Diagnostics.OperationId) =>
  new Page.PageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** What any handle for a page is made from: its runtime and entry, and how it gains access. */
export interface ObservedOwner {
  readonly runtime: Runtime.Runtime
  readonly entry: Model.PageEntry
  /** `inspect` and `control`: a grant for the caller's scope, or the page itself when it is controlled for life. */
  readonly upgrade: (level: "inspect" | "control") => Effect.Effect<Page.Page, Page.PageError, Scope.Scope>
}

export interface PageOwner extends ObservedOwner {
  readonly context: UserContext.UserContext
  /** The grant the handle was made under; `None` for a page controlled for its whole life. */
  readonly grant: Option.Option<Access.Grant>
}

/** A page's observe members: its state and `closed`, `inspect` and `control`, and its identity. */
const observeMembers = (owner: ObservedOwner) => {
  const { entry, runtime } = owner
  return {
    [PageTypeId]: PageTypeId as typeof PageTypeId,
    id: entry.id,
    status: Watchable.make({
      ref: entry.state,
      project: opened,
      ended: pageEnded,
      target: { _tag: "Page", id: entry.id },
      operation: "Page.status.waitFor"
    }),
    url: Watchable.make({
      ref: entry.state,
      project: (state: Model.PageState) => state._tag === "Opening" ? Option.none() : Option.some(state.url as Url.Url),
      ended: pageEnded,
      target: { _tag: "Page", id: entry.id },
      operation: "Page.url.waitFor"
    }),
    frames: Watchable.make({
      ref: entry.tree,
      project: (state: Model.FrameTreeState) => Option.some(frameTree(entry.id, state)),
      ended: (state: Model.FrameTreeState) => state.closed,
      target: { _tag: "Page", id: entry.id },
      operation: "Page.frames.waitFor"
    }),
    workers: Watchable.make({
      ref: entry.workers,
      project: (workers: ReadonlyArray<Model.WorkerEntry>) => Option.some(workers.map(runtime.worker)),
      ended: () => Option.none(),
      target: { _tag: "Page", id: entry.id },
      operation: "Page.workers.waitFor"
    }),
    closed: Deferred.await(entry.closed),
    inspect: owner.upgrade("inspect") as Effect.Effect<Page.ReadonlyPage, Page.PageError, Scope.Scope>,
    control: owner.upgrade("control"),
    [Equal.symbol](that: unknown) {
      return Page.isPage(that) && that.id === entry.id
    },
    [Hash.symbol]() {
      return Hash.string(entry.id)
    },
    pipe() {
      return pipeArguments(this, arguments)
    },
    toString() {
      return `Page(${entry.id})`
    },
    toJSON() {
      return { _id: "Page", id: entry.id }
    },
    [Inspectable.NodeInspectSymbol]() {
      return { _id: "Page", id: entry.id }
    }
  }
}

/** A page the connection observes: its state, its events, and the upgrades. */
export const observed = (owner: ObservedOwner): Page.ObservedPage => {
  const page = observeMembers(owner) as unknown as Page.ObservedPage
  Handles.registerPage(page, { runtime: owner.runtime, entry: owner.entry, grant: Option.none() })
  return page
}

export const make = (owner: PageOwner): Page.Page => {
  const { runtime, entry } = owner
  const model = runtime.model
  const adapter = model.adapter
  const queries = LocatorImpl.pageQueries({ runtime, page: entry, grant: owner.grant })
  /** Where the page's declarations apply. */
  const declared: Adapter.DeclarationScope = { _tag: "Page", page: entry.id }

  /** A request to the engine that got no answer, as the page's errors say it. */
  const fromSend = (operation: string, record: Operation.Record) => (failure: Runtime.SendFailure) =>
    failure._tag === "Gone"
      ? failure.error
      : failure._tag === "Reason"
      ? pageError(operation, failure.reason, record.id)
      : record.timeout(Option.fromUndefinedOr(failure.hint))

  const failure = (operation: string, id: Diagnostics.OperationId, error: Adapter.AdapterError | Deadline.Timeout) => {
    const mapped = Operation.fromAdapter(error, id, runtime.backend)
    return mapped._tag !== "Reason" ? mapped.error : pageError(operation, mapped.reason, id)
  }

  /** Waits for a navigation the adapter started, then for `waitUntil` on the document it committed. */
  const navigate = (
    operation: string,
    url: Option.Option<Url.Url>,
    start: (
      id: Diagnostics.OperationId
    ) => Effect.Effect<Option.Option<PageNavigation.Id>, Target.TargetGone | Page.PageError | Deadline.Timeout>,
    waitUntil: PageNavigation.LoadState,
    accept: ReadonlyArray<"download" | "noContent"> = []
  ) =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      const id = record.id
      const budget = record.budget
      // The command that starts it is bounded too: a browser that never answers it can't keep the caller waiting
      record.markSent()
      const started = yield* record.bound(
        start(id),
        () => Option.some("The browser didn't answer the navigation before the deadline; it may have started")
      )
      if (Option.isNone(started)) return Option.none<PageNavigation.PageNavigation>()
      record.markConfirmed()
      const navigation = model.navigation(started.value)
      const outcome = yield* record.bound(
        Deferred.await(navigation.outcome),
        () => Option.some("The navigation had no outcome before the deadline")
      ).pipe(Effect.ensuring(Effect.sync(() => model.forget(started.value))))
      // Where it ended: the document's URL, which a same-document navigation set, or where it was going
      const document = "document" in outcome ? model.documents.get(outcome.document) : undefined
      const at = document?.url ?? Option.getOrElse(url, () => "")
      const result = yield* Navigation.settle(
        model,
        operation,
        started.value,
        entry.id,
        url,
        at,
        outcome,
        id,
        accept
      )
      if (!(yield* Navigated.reached(model, result, waitUntil, Option.some(budget.at)))) {
        return yield* Effect.fail(record.timeout(Option.some(`The document committed but didn't reach ${waitUntil}`)))
      }
      return Option.some(result)
    }).pipe(
      Effect.raceFirst(Runtime.pageEnded(entry, Operation.operationId())),
      Operation.named(operation, {
        attributes: {
          "browser.page.id": entry.id,
          "browser.navigation.wait_until": waitUntil,
          ...(Option.isSome(url) ? { "url.full": url.value } : {})
        }
      })
    )

  /**
   * Calls a function in a world of the page's current document: the caller's isolated
   * world, or the main world with user activation inside `Page.withUserGesture`.
   */
  const evaluation = <B, R>(
    operation: string,
    world: Adapter.World,
    fn: Function,
    args: ReadonlyArray<unknown>,
    result: "value" | "handle",
    then: (realm: Target.RealmId, value: Adapter.RemoteValue) => Effect.Effect<B, Evaluation.Failure, R>
  ): Effect.Effect<B, Page.PageError | Target.TargetGone | Deadline.Timeout, R> =>
    Effect.gen(function*() {
      const record = yield* Operation.record
      const id = record.id
      const budget = record.budget
      const gesture = world._tag === "Main" && (yield* Effect.service(Page.UserGesture))
      return yield* Effect.gen(function*() {
        const realm = yield* Evaluation.pageRealm(runtime, entry, world, id, budget.at)
        const values = yield* Evaluation.toLocal(args, realm)
        const group = yield* Evaluation.groupFor(runtime, realm, result)
        // The call is on its way: a deadline after it can't say the function didn't run
        record.markSent()
        const value = yield* Evaluation.call(runtime, {
          realm,
          functionDeclaration: fn.toString(),
          arguments: values,
          result,
          group,
          userActivation: gesture,
          page: Option.some(entry),
          at: budget.at,
          id
        })
        return yield* then(realm, value)
      }).pipe(
        Effect.mapError((failure) =>
          failure._tag === "Gone"
            ? failure.error
            : failure._tag === "Deadline"
            ? record.timeout(Option.some(
              record.dispatch._tag === "MayHaveBeenSent"
                ? "The page didn't answer before the deadline; the function may still be running"
                : "The page had no document to evaluate in before the deadline"
            ))
            : pageError(operation, failure.reason, id)
        ),
        Effect.annotateSpans({ "browser.evaluation.user_gesture": gesture })
      )
    }).pipe(
      Operation.named(operation, {
        attributes: {
          "browser.page.id": entry.id,
          "browser.evaluation.world": world._tag === "Main" ? "main" : world.name
        }
      })
    )

  const page: Page.Page = {
    ...observeMembers(owner),
    ...queries,
    frame: (iframe) => LocatorImpl.pageFrame({ runtime, page: entry, grant: owner.grant }, iframe),
    get title() {
      return Effect.gen(function*() {
        const record = yield* Operation.record
        const response = yield* Runtime.send(runtime, entry, { op: "title" }, record.id, record.budget.at).pipe(
          Effect.mapError(fromSend("Page.title", record))
        )
        return response._tag === "Title" ? response.title : yield* Effect.die(new Error(`Page.title: ${response._tag}`))
      }).pipe(Operation.named("Page.title", { attributes: { "browser.page.id": entry.id } }))
    },
    get readHtml() {
      return Effect.gen(function*() {
        const record = yield* Operation.record
        const response = yield* Runtime.send(runtime, entry, { op: "html" }, record.id, record.budget.at).pipe(
          Effect.mapError(fromSend("Page.readHtml", record))
        )
        return response._tag === "Read" && typeof response.value === "string"
          ? response.value
          : yield* Effect.die(new Error(`Page.readHtml: ${response._tag}`))
      }).pipe(Operation.named("Page.readHtml", { attributes: { "browser.page.id": entry.id } }))
    },
    snapshot: (options) =>
      Effect.gen(function*() {
        const record = yield* Operation.record
        const taken = yield* Snapshots.take(
          { runtime, page: entry, grant: owner.grant },
          null,
          options,
          record.id,
          record.budget.at
        ).pipe(Effect.mapError(fromSend("Page.snapshot", record)))
        return taken._tag === "Taken"
          ? taken.snapshot as Snapshot.Snapshot<Locator.Locator>
          : yield* Effect.die(new Error(`Page.snapshot: ${taken.response._tag}`))
      }).pipe(
        Operation.named("Page.snapshot", {
          attributes: {
            "browser.page.id": entry.id,
            "browser.snapshot.sources": options?.sources ?? "aria+interactivity"
          }
        })
      ),
    screenshot: (options) => Captures.screenshot(runtime, entry, options),
    pdf: (options) => Captures.pdf(runtime, entry, options),
    localStorage: Storage.originStorage(runtime, entry, "local"),
    sessionStorage: Storage.originStorage(runtime, entry, "session"),
    evaluate: <Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args) =>
      evaluation(
        "Page.evaluate",
        Evaluation.isolatedWorld,
        fn,
        args,
        "value",
        (_realm, value) => Evaluation.fromRemote(value)
      ) as Effect.Effect<
        JSHandle.Serialized<A>,
        Page.PageError | Target.TargetGone | Deadline.Timeout
      >,
    capability: (capability) => Capabilities.acquire(runtime, entry, capability),
    context: owner.context,
    goto: (url, options) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        return Effect.fail(pageError(
          "Page.goto",
          new Reason.InvalidInput({
            input: "url",
            expected: "an absolute URL",
            hint: `${JSON.stringify(url)} doesn't parse`
          }),
          Operation.operationId()
        ))
      }
      return navigate(
        "Page.goto",
        Option.some(parsed.href as Url.Url),
        (id) =>
          Effect.map(adapter.navigate(entry.id, parsed.href, { referrer: Option.none() }), Option.some).pipe(
            Effect.mapError((error) => failure("Page.goto", id, error))
          ),
        options?.waitUntil ?? "commit",
        options?.accept ?? []
      ).pipe(Effect.map(Option.getOrThrow))
    },
    reload: (options) =>
      navigate(
        "Page.reload",
        Option.none(),
        (id) =>
          Effect.map(adapter.reload(entry.id, { ignoreCache: options?.bypassCache ?? false }), Option.some).pipe(
            Effect.mapError((error) => failure("Page.reload", id, error))
          ),
        options?.waitUntil ?? "commit"
      ).pipe(Effect.map(Option.getOrThrow)),
    back: (options) =>
      navigate(
        "Page.back",
        Option.none(),
        (id) => adapter.traverse(entry.id, -1).pipe(Effect.mapError((error) => failure("Page.back", id, error))),
        options?.waitUntil ?? "commit"
      ),
    forward: (options) =>
      navigate(
        "Page.forward",
        Option.none(),
        (id) => adapter.traverse(entry.id, 1).pipe(Effect.mapError((error) => failure("Page.forward", id, error))),
        options?.waitUntil ?? "commit"
      ),
    evaluateInMainWorld: <Args extends ReadonlyArray<unknown>, A>(
      fn: (...args: Args) => A | Promise<A>,
      ...args: Args
    ) =>
      evaluation(
        "Page.evaluateInMainWorld",
        { _tag: "Main" },
        fn,
        args,
        "value",
        (_realm, value) => Evaluation.fromRemote(value)
      ) as Effect.Effect<
        JSHandle.Serialized<A>,
        Page.PageError | Target.TargetGone | Deadline.Timeout
      >,
    evaluateHandle: <Args extends ReadonlyArray<unknown>, A>(fn: (...args: Args) => A | Promise<A>, ...args: Args) =>
      evaluation(
        "Page.evaluateHandle",
        Evaluation.isolatedWorld,
        fn,
        args,
        "handle",
        (realm, value) => Evaluation.own<Awaited<A>>(runtime, realm, value, Option.some(entry))
      ),
    keyboard: Devices.keyboard({ runtime, page: entry }),
    mouse: Devices.mouse({ runtime, page: entry }),
    clock: Clock.make({
      runtime,
      scope: declared,
      pages: () => [entry],
      name: "Page.clock",
      // One timeline covers a page
      conflicting: () => {
        const context = runtime.model.contexts.get(entry.context)
        return context !== undefined && Clock.isInstalled(context) ? Option.some("UserContext.clock") : Option.none()
      }
    }, entry),
    route: <E, R, P extends Route.Phase = "request">(
      pattern: Url.Pattern | string,
      handler: Route.Handler<E, R, P>,
      options?: Route.Options<P>
    ) =>
      Routes.register(
        {
          runtime,
          scope: declared,
          routes: entry.routes,
          target: { _tag: "Page", id: entry.id },
          operation: "Page.route"
        },
        pattern,
        handler,
        (options?.phase ?? "request") as P
      ),
    addInitScript: (script, options) =>
      InitScripts.add({ runtime, scope: declared, operation: "Page.addInitScript" }, entry.context, script, options),
    emulate: (settings) => Emulation.emulate({ runtime, scope: declared, operation: "Page.emulate" }, settings),
    activate: Effect.gen(function*() {
      const { id } = yield* Operation.record
      yield* adapter.activatePage(entry.id).pipe(
        Effect.catch((error): Effect.Effect<never, Page.PageError | Target.TargetGone | Deadline.Timeout> => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          // A backend that can't bring a page forward says so, as attached stock WebKit does
          return mapped._tag === "Reason"
            ? Effect.fail(pageError("Page.activate", mapped.reason, id))
            : Effect.fail(mapped.error)
        })
      )
    }).pipe(Operation.named("Page.activate", { attributes: { "browser.page.id": entry.id } })),
    close: ((options?: { readonly runBeforeUnload: boolean }) => {
      const runBeforeUnload = options?.runBeforeUnload === true
      return Effect.gen(function*() {
        const record = yield* Operation.record
        const id = record.id
        if (Option.isSome(yield* Deferred.poll(entry.closed))) return
        // `runBeforeUnload`: the prompt is decided as any dialog is, and a handler's
        // stay ends the close with the page open
        const stayed = yield* Deferred.make<void>()
        const onStay = () => Deferred.doneUnsafe(stayed, Exit.void)
        if (runBeforeUnload) entry.stayed.add(onStay)
        record.markSent()
        const outcome = yield* Effect.gen(function*() {
          yield* adapter.closePage(entry.id, { runBeforeUnload }).pipe(Effect.catch((error): Effect.Effect<
            void,
            Page.PageError | Deadline.Timeout
          > => {
            const mapped = Operation.fromAdapter(error, id, runtime.backend)
            // A backend that can't ask the page refuses to, naming the capability (`close.runBeforeUnload`)
            return mapped._tag === "Gone"
              ? Effect.void
              : mapped._tag === "Timeout"
              ? Effect.fail(mapped.error)
              : Effect.fail(pageError("Page.close", mapped.reason, id))
          }))
          return yield* Deferred.await(entry.closed).pipe(
            Effect.as("closed" as const),
            Effect.raceFirst(Effect.as(Deferred.await(stayed), "stayed" as const))
          )
        }).pipe(
          (closing) =>
            record.bound(closing, () =>
              Option.some(
                runBeforeUnload
                  ? "The browser was asked to close the page, and hadn't confirmed it by the deadline; a " +
                    "beforeunload prompt nothing decided keeps it open"
                  : "The browser was asked to close the page, and hadn't confirmed it by the deadline"
              )),
          Effect.ensuring(Effect.sync(() => entry.stayed.delete(onStay)))
        )
        if (outcome === "stayed") {
          return yield* Effect.fail(pageError(
            "Page.close",
            new Page.CloseCanceled({ hint: "The page's beforeunload prompt was answered with stay" }),
            id
          ))
        }
      }).pipe(Operation.named("Page.close", {
        attributes: { "browser.page.id": entry.id, "browser.close.run_before_unload": runBeforeUnload }
      }))
    }) as Page.Page["close"]
  }
  // A handle made under a grant fails above observe once the grant is released, and its declarations go with it
  const handle = Option.isSome(owner.grant)
    ? Access.guard(page, owner.grant.value, Guarded.page)
    : page
  Handles.registerPage(handle, { runtime, entry, grant: owner.grant })
  return handle
}
