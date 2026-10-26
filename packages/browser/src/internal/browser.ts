/**
 * The `Browser` service and the contexts it creates (API.md, Entry points; review 12, candidate 7), and the
 * layer every backend builds: launch, connect the adapter, fold its facts into the model, provide `Browser`.
 *
 * Built: `info`, `capabilities`, `newContext`, `newPage`, and a context's `newPage`, `pages`, `workers`,
 * `closed` and `control`. What a context or page owns is released when the scope that acquired it closes, and
 * a page's popups with it (review 13). The other members fail as `NotBuilt`.
 *
 * A context the library creates allows downloads into a temporary directory it owns, made before the context
 * and removed after it, and has its file choosers reported and decided (review 14, candidates 8 and 9).
 *
 * Each page, download, worker and connection has one handle per connection, made on first use from its model
 * entry (`Runtime`), so `newPage`, a context's `pages` and `Popup` hand out the same `Page`, and every event
 * module the same `Download`, `BrowserWorker` or `NetworkConnection`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as FileSystem from "effect/FileSystem"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { pipeArguments } from "effect/Pipeable"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import * as CookieJar from "../CookieJar.ts"
import * as Declaration from "../Declaration.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as PageClock from "../PageClock.ts"
import * as Reason from "../Reason.ts"
import * as Route from "../Route.ts"
import * as StorageState from "../StorageState.ts"
import * as Target from "../Target.ts"
import * as Url from "../Url.ts"
import * as UserContext from "../UserContext.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as Clock from "./clock.ts"
import * as ConnectionImpl from "./connection.ts"
import * as DownloadImpl from "./download.ts"
import * as Emulation from "./emulation.ts"
import * as Evaluation from "./evaluation.ts"
import * as Grants from "./grants.ts"
import * as Guarded from "./guarded.ts"
import * as Handles from "./handles.ts"
import * as InitScripts from "./initScripts.ts"
import * as Model from "./model.ts"
import * as Navigation from "./navigation.ts"
import * as Operation from "./operation.ts"
import * as PageImpl from "./page.ts"
import * as Routes from "./routes.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"
import * as Storage from "./storage.ts"
import * as StorageStates from "./storageState.ts"
import * as Watchable from "./watchable.ts"
import * as WorkerImpl from "./worker.ts"

const BrowserTypeId = "~@usestrider/browser/Browser"
const UserContextTypeId = "~@usestrider/browser/UserContext"

const contextError = (operation: string, reason: UserContext.UserContextErrorReason, id: Diagnostics.OperationId) =>
  new UserContext.UserContextError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** A declaration's failure, as a context's: the reasons a context has, else a backend failure. */
// A context's own setup failing: a target that went is the setup's failure too, as BackendFailure
const asContextReason = (
  reason: Declaration.DeclarationErrorReason | Target.TargetGone
): UserContext.UserContextErrorReason =>
  reason._tag === "InvalidInput" || reason._tag === "NotPermitted" || reason._tag === "Unsupported" ||
    reason._tag === "BackendFailure"
    ? reason
    : new Reason.BackendFailure({ kind: "Rejected", method: "Browser.newContext", metadata: {}, hint: reason.message })

const objectMembers = (name: string, id: string) => ({
  pipe() {
    return pipeArguments(this, arguments)
  },
  toString() {
    return `${name}(${id})`
  },
  toJSON() {
    return { _id: name, id }
  },
  [Inspectable.NodeInspectSymbol]() {
    return { _id: name, id }
  }
})

/** How a context handle reaches its pages and gains control (review 19, candidate 2). */
interface ContextAccess {
  /** `None` for a context the connection created, controlled for its whole life. */
  readonly grant: Option.Option<Access.Grant>
  /** The handle of one of its pages, under this access. */
  readonly page: (entry: Model.PageEntry) => Page.Page
  /** `control`: the context itself, when it is controlled for life; otherwise a grant for the caller's scope. */
  readonly control: Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope>
}

/** A context the caller controls: one it created, or one it was granted for a scope. */
const makeContext = (
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  access: ContextAccess
): UserContext.UserContext => {
  const adapter = runtime.model.adapter
  /** Where the context's declarations apply (review 17). */
  const declared: Adapter.DeclarationScope = { _tag: "UserContext", context: entry.id }
  const context: UserContext.UserContext = {
    [UserContextTypeId]: UserContextTypeId,
    id: entry.id,
    pages: Watchable.make({
      ref: entry.state,
      project: (state) =>
        Option.some(
          state.pages.flatMap((id) =>
            Option.toArray(Option.map(Option.fromNullishOr(runtime.model.pages.get(id)), access.page))
          )
        ),
      ended: (state) => state.closed,
      target: { _tag: "UserContext" },
      operation: "UserContext.pages.waitFor"
    }),
    workers: Watchable.make({
      ref: entry.workers,
      project: (workers) => Option.some(workers.map(runtime.worker)),
      ended: () => Option.none(),
      target: { _tag: "UserContext" },
      operation: "UserContext.workers.waitFor"
    }),
    closed: Deferred.await(entry.closed),
    control: access.control,
    newPage: Effect.gen(function*() {
      const id = Operation.operationId()
      const scope = yield* Effect.scope
      const created = yield* Effect.acquireRelease(
        adapter.createPage(entry.id).pipe(Effect.mapError((error) => {
          const mapped = Operation.fromAdapter(error, id, runtime.backend)
          return mapped._tag === "Gone"
            ? new Page.PageError({
              operation: "UserContext.newPage",
              reason: new Page.InitializationFailed({ step: "create the page", hint: mapped.error.message }),
              diagnostics: Operation.diagnostics(id)
            })
            : new Page.PageError({
              operation: "UserContext.newPage",
              reason: mapped.reason,
              diagnostics: Operation.diagnostics(id)
            })
        })),
        // Owned teardown: no beforeunload; a page that already closed needs nothing
        (page) => runtime.model.release(page)
      )
      const pageEntry = runtime.model.pages.get(created)
      if (pageEntry === undefined) return yield* Effect.die(new Error(`${created} was created but never added`))
      // Owned by the caller's scope, which releases its popups too (CONCEPTS.md §3)
      pageEntry.owner = Option.some(scope)
      return Option.getOrThrow(runtime.page(pageEntry))
    }).pipe(Spans.operation("UserContext.newPage", { attributes: { "browser.context.id": entry.id } })),
    cookies: Storage.cookieJar(runtime, entry.id),
    exportStorageState: StorageStates.exportState(runtime, entry.id),
    clock: Clock.make({
      runtime,
      scope: declared,
      pages: () => [...runtime.model.pages.values()].filter((page) => page.context === entry.id),
      name: "UserContext.clock",
      // One timeline covers a page (review 17, candidate 7)
      conflicting: () =>
        [...runtime.model.pages.values()].some((page) => page.context === entry.id && Clock.isInstalled(page))
          ? Option.some("Page.clock")
          : Option.none()
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
          target: { _tag: "UserContext" },
          operation: "UserContext.route"
        },
        pattern,
        handler,
        (options?.phase ?? "request") as P
      ),
    addInitScript: (script, options) =>
      InitScripts.add({ runtime, scope: declared, operation: "UserContext.addInitScript" }, entry.id, script, options),
    emulate: (settings) => Emulation.emulate({ runtime, scope: declared, operation: "UserContext.emulate" }, settings),
    grant: (permissions, options) => Grants.grant(runtime, entry.id, "UserContext.grant", permissions, options),
    [Equal.symbol](that: unknown) {
      return UserContext.isUserContext(that) && that.id === entry.id
    },
    [Hash.symbol]() {
      return Hash.string(entry.id)
    },
    ...objectMembers("UserContext", entry.id)
  }
  // A context granted for a scope fails above observe once the grant is released, and its declarations go with it
  const handle = Option.isSome(access.grant)
    ? Access.guard(context, access.grant.value, Guarded.context)
    : context
  Handles.registerContext(handle, { runtime, entry, grant: access.grant })
  return handle
}

/** A context the connection observes, such as the default context: its pages, workers and end, and `control`. */
const makeObservedContext = (
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  control: Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope>
): UserContext.ObservedUserContext => {
  const context: UserContext.ObservedUserContext = {
    [UserContextTypeId]: UserContextTypeId,
    id: entry.id,
    pages: Watchable.make({
      ref: entry.state,
      project: (state) =>
        Option.some(
          state.pages.flatMap((id) =>
            Option.toArray(Option.map(Option.fromNullishOr(runtime.model.pages.get(id)), runtime.observed))
          )
        ),
      ended: (state) => state.closed,
      target: { _tag: "UserContext" },
      operation: "UserContext.pages.waitFor"
    }),
    workers: Watchable.make({
      ref: entry.workers,
      project: (workers) => Option.some(workers.map(runtime.worker)),
      ended: () => Option.none(),
      target: { _tag: "UserContext" },
      operation: "UserContext.workers.waitFor"
    }),
    closed: Deferred.await(entry.closed),
    control,
    [Equal.symbol](that: unknown) {
      return UserContext.isUserContext(that) && that.id === entry.id
    },
    [Hash.symbol]() {
      return Hash.string(entry.id)
    },
    ...objectMembers("UserContext", entry.id)
  }
  // Its events are data events, which modules that take an observed context read
  Handles.registerContext(context, { runtime, entry, grant: Option.none() })
  return context
}

/**
 * The context of a page whose context the caller doesn't control: what needs control fails with `NotPermitted`
 * (review 19, candidate 2), and `control` gains it.
 */
const makeDeniedContext = (
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  control: Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope>
): UserContext.UserContext => {
  const id = () => Operation.operationId()
  const notPermitted = (member: string) =>
    new Reason.NotPermitted({
      required: "control",
      hint:
        `${member} needs control of the page's context, which this page's access doesn't give; gain it with page.context.control (QUIRKS.md, Q144)`
    })
  const declaration = (member: string) =>
    Effect.fail(
      new Declaration.DeclarationError({
        declaration: member,
        reason: notPermitted(member),
        diagnostics: Operation.diagnostics(id())
      })
    )
  const cookie = (member: string) =>
    Effect.fail(
      new CookieJar.CookieJarError({
        operation: member,
        reason: notPermitted(member),
        diagnostics: Operation.diagnostics(id())
      })
    )
  const notInstalled = (member: string) =>
    Effect.fail(
      new PageClock.PageClockError({
        operation: member,
        reason: new PageClock.NotInstalled({ hint: "No clock can be installed without control of the context" }),
        diagnostics: Operation.diagnostics(id())
      })
    )
  const observed = makeObservedContext(runtime, entry, control)
  const context = {
    ...observed,
    newPage: Effect.suspend(() =>
      Effect.fail(
        new Page.PageError({
          operation: "UserContext.newPage",
          reason: notPermitted("UserContext.newPage"),
          diagnostics: Operation.diagnostics(id())
        })
      )
    ),
    cookies: {
      list: Effect.suspend(() => cookie("CookieJar.list")),
      listFor: () => cookie("CookieJar.listFor"),
      set: () => cookie("CookieJar.set"),
      remove: () => cookie("CookieJar.remove"),
      clear: Effect.suspend(() => cookie("CookieJar.clear"))
    },
    exportStorageState: Effect.suspend(() =>
      Effect.fail(
        new UserContext.UserContextError({
          operation: "UserContext.exportStorageState",
          reason: notPermitted("UserContext.exportStorageState"),
          diagnostics: Operation.diagnostics(id())
        })
      )
    ),
    clock: {
      install: () => declaration("UserContext.clock"),
      adjust: () => notInstalled("PageClock.adjust"),
      setTime: () => notInstalled("PageClock.setTime"),
      resume: Effect.suspend(() => notInstalled("PageClock.resume"))
    },
    route: (pattern: Url.Pattern | string) =>
      Effect.fail(
        new Route.RouteError({
          pattern: Url.Pattern.make(String(pattern)),
          reason: notPermitted("UserContext.route"),
          diagnostics: Operation.diagnostics(id())
        })
      ),
    addInitScript: () => declaration("UserContext.addInitScript"),
    emulate: () => declaration("UserContext.emulate"),
    grant: () => declaration("UserContext.grant")
  } as unknown as UserContext.UserContext
  Handles.registerContext(context, { runtime, entry, grant: Option.none() })
  return context
}

/** The `Browser` service over a model. */
/** One handle per entry, made on first use and kept as long as the entry is. */
const cached = <E extends object, H>(make: (entry: E) => H) => {
  const handles = new WeakMap<E, H>()
  return (entry: E): H => {
    const known = handles.get(entry)
    if (known !== undefined) return known
    const handle = make(entry)
    handles.set(entry, handle)
    return handle
  }
}

export const make = Effect.fnUntraced(function*(model: Model.Model) {
  const adapter = model.adapter
  // The contexts this connection created, controlled for their whole lives, with their pages
  const contexts = new Map<UserContext.Id, UserContext.UserContext>()
  // The handle of each page controlled for its life, and of each page only observed (review 19, candidate 2)
  const handles = new WeakMap<Model.PageEntry, Page.Page>()
  const observedHandles = new WeakMap<Model.PageEntry, Page.ObservedPage>()
  const denied = new WeakMap<Model.ContextEntry, UserContext.UserContext>()

  /** Whether the connection controls a page for its whole life: it created the page, or the page's context. */
  const lifelong = (entry: Model.PageEntry) => contexts.has(entry.context) || Option.isSome(entry.owner)

  /** A page's context handle: the context, when the connection created it; otherwise one that refuses control. */
  const contextOf = (entry: Model.PageEntry): UserContext.UserContext => {
    const created = contexts.get(entry.context)
    if (created !== undefined) return created
    const contextEntry = model.contexts.get(entry.context)!
    const known = denied.get(contextEntry)
    if (known !== undefined) return known
    const context = makeDeniedContext(runtime, contextEntry, upgradeContext(contextEntry))
    denied.set(contextEntry, context)
    return context
  }

  /**
   * `inspect` and `control` of a page: the page itself when it is controlled for life, or a handle under a grant
   * for the caller's scope. `inspect` installs the isolated world first, and changes nothing the page shows.
   */
  const upgradePage = (entry: Model.PageEntry) => (level: "inspect" | "control") =>
    Effect.gen(function*() {
      const known = runtime.page(entry)
      if (Option.isSome(known)) return known.value
      const grant = yield* Access.acquire(level, { _tag: "Page", id: entry.id })
      if (level === "inspect") {
        const id = Operation.operationId()
        const budget = yield* Operation.budget
        yield* Evaluation.pageRealm(runtime, entry, Evaluation.isolatedWorld, id, budget.at).pipe(
          Effect.mapError((failure) =>
            new Page.PageError({
              operation: "Page.inspect",
              reason: new Page.InitializationFailed({
                step: "install the isolated world",
                hint: failure._tag === "Deadline"
                  ? "The page had no document to install it in before the deadline; a page attached with a dialog open reports none until it closes (QUIRKS.md)"
                  : failure._tag === "Gone"
                  ? failure.error.message
                  : failure.reason.message
              }),
              diagnostics: Operation.diagnostics(id)
            })
          )
        )
      }
      return PageImpl.make({
        runtime,
        entry,
        context: contextOf(entry),
        grant: Option.some(grant),
        upgrade: upgradePage(entry)
      })
    }).pipe(Spans.operation(`Page.${level}`, { attributes: { "browser.page.id": entry.id } }))

  /** `control` of a context the connection didn't create: a handle under a grant for the caller's scope. */
  const upgradeContext = (
    entry: Model.ContextEntry
  ): Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope> =>
    Effect.gen(function*() {
      const created = contexts.get(entry.id)
      if (created !== undefined) return created
      const grant = yield* Access.acquire("control", { _tag: "UserContext" })
      const pages = new WeakMap<Model.PageEntry, Page.Page>()
      const context: UserContext.UserContext = makeContext(runtime, entry, {
        grant: Option.some(grant),
        // Its pages are controlled under the same grant, unless the connection controls them for life
        page: (pageEntry) => {
          const lifelong = runtime.page(pageEntry)
          if (Option.isSome(lifelong)) return lifelong.value
          const known = pages.get(pageEntry)
          if (known !== undefined) return known
          const page = PageImpl.make({
            runtime,
            entry: pageEntry,
            context,
            grant: Option.some(grant),
            upgrade: upgradePage(pageEntry)
          })
          pages.set(pageEntry, page)
          return page
        },
        control: upgradeContext(entry)
      })
      return context
    }).pipe(Spans.operation("UserContext.control", { attributes: { "browser.context.id": entry.id } }))

  const runtime: Runtime.Runtime = {
    model,
    backend: adapter.info.product,
    page: (entry) => {
      const known = handles.get(entry)
      if (known !== undefined) return Option.some(known)
      if (!lifelong(entry)) return Option.none()
      const page = PageImpl.make({
        runtime,
        entry,
        context: contextOf(entry),
        grant: Option.none(),
        upgrade: upgradePage(entry)
      })
      handles.set(entry, page)
      return Option.some(page)
    },
    observed: (entry) => {
      const controlled = runtime.page(entry)
      if (Option.isSome(controlled)) return controlled.value
      const known = observedHandles.get(entry)
      if (known !== undefined) return known
      const page = PageImpl.observed({ runtime, entry, upgrade: upgradePage(entry) })
      observedHandles.set(entry, page)
      return page
    },
    download: cached((entry: Model.DownloadEntry) => DownloadImpl.make(runtime, entry)),
    worker: cached((entry: Model.WorkerEntry) => WorkerImpl.make(runtime, entry)),
    connection: cached((entry: Model.ConnectionEntry) => ConnectionImpl.make(entry)),
    // A launched browser's layer has both; one it connects to may not (review 14, candidates 8 and 9)
    fileSystem: yield* Effect.serviceOption(FileSystem.FileSystem),
    path: yield* Effect.serviceOption(Path.Path),
    settle: (operation, navigation, url, at, outcome, id) =>
      Navigation.settle(model, operation, navigation, url, at, outcome, id)
  }

  const newContext = (
    options?: UserContext.Options
  ): Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope> =>
    Effect.gen(function*() {
      const id = Operation.operationId()
      // A partition the backend can't set fails the context before it exists: nothing is applied partly
      if (options?.storageState !== undefined) {
        const partitions = yield* StorageStates.unsupportedPartitions(runtime, options.storageState)
        if (partitions.length > 0) {
          return yield* Effect.fail(contextError(
            "Browser.newContext",
            new StorageState.Incompatible({
              partitions,
              hint: `${runtime.backend} can't set a partitioned cookie (cookies.partitioned)`
            }),
            id
          ))
        }
      }
      const failed = (error: Adapter.AdapterError) => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        // The browser itself ended: every operation on it ends with the connection, a defect here
        return mapped._tag === "Gone"
          ? Effect.die(mapped.error)
          : Effect.fail(contextError("Browser.newContext", mapped.reason, id))
      }
      // A directory the context owns for its downloads, made first so it is removed after the context
      // (review 14, candidate 8)
      const downloads = Option.isNone(runtime.fileSystem) ? Option.none<string>() : Option.some(
        yield* runtime.fileSystem.value.makeTempDirectoryScoped({ prefix: "strider-downloads-" }).pipe(
          Effect.mapError((error) =>
            contextError(
              "Browser.newContext",
              new Reason.BackendFailure({
                kind: "Rejected",
                method: "FileSystem.makeTempDirectoryScoped",
                metadata: {},
                hint: `Couldn't create the context's download directory: ${error.message}`
              }),
              id
            )
          )
        )
      )
      const created = yield* Effect.acquireRelease(
        adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false }).pipe(Effect.catch(failed)),
        (context) =>
          adapter.removeUserContext(context).pipe(
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => contexts.delete(context)))
          )
      )
      const entry = yield* model.context(created)
      // Owned contexts decide dialogs no handler claims at once, and cancel file choosers no handler answers
      // (CONCEPTS.md §5)
      entry.owned = true
      entry.policy = Option.some(options?.dialogs ?? "dismiss")
      entry.eventLog = options?.eventLog ?? entry.eventLog
      const scope: Adapter.DeclarationScope = { _tag: "UserContext", context: created }
      yield* adapter.declare(scope, { _tag: "FileChooser" }).pipe(Effect.catch(failed))
      if (Option.isSome(downloads)) {
        yield* adapter.declare(scope, { _tag: "Downloads", behavior: { _tag: "Allow", directory: downloads.value } })
          .pipe(Effect.catch(failed))
        yield* Effect.annotateCurrentSpan("browser.context.downloads", downloads.value)
      }
      // The options that are declarations, held for the context's life, before its first page (review 17)
      if (options?.emulation !== undefined || options?.focus === "emulated") {
        const fields = Emulation.fields(options.emulation ?? {})
        if (!Array.isArray(fields)) {
          return yield* Effect.fail(contextError("Browser.newContext", fields as Reason.InvalidInput, id))
        }
        yield* Emulation.declare(
          { runtime, scope, operation: "Browser.newContext" },
          options.focus === "emulated"
            ? [...fields, { capability: "emulation.focus", override: { _tag: "FocusEmulation", enabled: true } }]
            : fields,
          id
        ).pipe(Effect.mapError((error) =>
          contextError("Browser.newContext", asContextReason(Target.isTargetGone(error) ? error : error.reason), id)
        ))
      }
      if (options?.permissions !== undefined) {
        yield* Grants.grant(runtime, created, "Browser.newContext", options.permissions, undefined).pipe(
          Effect.mapError((error) =>
            contextError("Browser.newContext", asContextReason(Target.isTargetGone(error) ? error : error.reason), id)
          )
        )
      }
      const context: UserContext.UserContext = makeContext(runtime, entry, {
        grant: Option.none(),
        page: (pageEntry) =>
          Option.getOrThrow(runtime.page(pageEntry)),
        control: Effect.sync(() => context)
      })
      contexts.set(created, context)
      // The saved storage, before the context's first page; a context it can't be written into isn't kept
      if (options?.storageState !== undefined) {
        yield* StorageStates.applyState(runtime, context, options.storageState, id).pipe(
          Effect.onError(() => adapter.removeUserContext(created).pipe(Effect.ignore))
        )
      }
      return context
    }).pipe(Spans.operation("Browser.newContext"))

  const defaultEntry = yield* model.context(adapter.defaultContext)
  const browser: Browser.Browser = {
    [BrowserTypeId]: BrowserTypeId,
    info: adapter.info,
    capabilities: Watchable.make({
      ref: adapter.capabilities,
      project: Option.some,
      ended: () => Option.none(),
      target: { _tag: "Browser" },
      operation: "Browser.capabilities.waitFor"
    }),
    newContext,
    newPage: Spans.fn("Browser.newPage")(function*(options?: UserContext.Options) {
      const context = yield* newContext(options).pipe(Effect.mapError((error) =>
        new Page.PageError({
          operation: "Browser.newPage",
          reason: error.reason._tag === "Incompatible"
            ? new Page.InitializationFailed({ step: "create the context", hint: error.reason.message })
            : error.reason,
          diagnostics: error.diagnostics
        })
      ))
      return yield* context.newPage
    }),
    pages: Watchable.make({
      ref: model.pageList,
      project: (ids) =>
        Option.some(
          ids.flatMap((id) => Option.toArray(Option.map(Option.fromNullishOr(model.pages.get(id)), runtime.observed)))
        ),
      ended: () => Option.none(),
      target: { _tag: "Browser" },
      operation: "Browser.pages.waitFor"
    }),
    defaultContext: makeObservedContext(runtime, defaultEntry, upgradeContext(defaultEntry))
  }
  return browser
})

/**
 * The layer a backend builds: `connect` launches its browser and connects its adapter with the model's sink,
 * for the layer's scope.
 */
export const layer = <E, R>(
  connect: (sink: Adapter.Sink) => Effect.Effect<Adapter.AdapterConnection, E, R>
): Layer.Layer<Browser.Browser, E, Exclude<R, Scope.Scope>> =>
  Layer.effect(Browser.Browser)(Effect.gen(function*() {
    const { sink, attach } = yield* Model.make()
    const adapter = yield* connect(sink)
    const model = yield* attach(adapter)
    return yield* make(model)
  }))
