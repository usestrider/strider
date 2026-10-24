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
import type * as Declaration from "../Declaration.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import type * as Route from "../Route.ts"
import * as StorageState from "../StorageState.ts"
import type * as Url from "../Url.ts"
import * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as Clock from "./clock.ts"
import * as ConnectionImpl from "./connection.ts"
import * as DownloadImpl from "./download.ts"
import * as Emulation from "./emulation.ts"
import * as Grants from "./grants.ts"
import * as Handles from "./handles.ts"
import * as InitScripts from "./initScripts.ts"
import * as Model from "./model.ts"
import * as Navigation from "./navigation.ts"
import * as NotBuilt from "./notBuilt.ts"
import * as Operation from "./operation.ts"
import * as PageImpl from "./page.ts"
import * as Routes from "./routes.ts"
import type * as Runtime from "./runtime.ts"
import * as Storage from "./storage.ts"
import * as StorageStates from "./storageState.ts"
import * as Watchable from "./watchable.ts"
import * as WorkerImpl from "./worker.ts"

const BrowserTypeId = "~@usestrider/browser/Browser"
const UserContextTypeId = "~@usestrider/browser/UserContext"

const contextError = (operation: string, reason: UserContext.UserContextErrorReason, id: Diagnostics.OperationId) =>
  new UserContext.UserContextError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** A declaration's failure, as a context's: the reasons a context has, else a backend failure. */
const asContextReason = (reason: Declaration.DeclarationErrorReason): UserContext.UserContextErrorReason =>
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

/** A context the caller owns. */
const makeContext = (runtime: Runtime.Runtime, entry: Model.ContextEntry): UserContext.UserContext => {
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
            Option.toArray(Option.flatMap(Option.fromNullishOr(runtime.model.pages.get(id)), runtime.page))
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
    control: Effect.sync(() => context),
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
        (page) => adapter.closePage(page, { runBeforeUnload: false }).pipe(Effect.ignore)
      )
      const pageEntry = runtime.model.pages.get(created)
      if (pageEntry === undefined) return yield* Effect.die(new Error(`${created} was created but never added`))
      // Owned by the caller's scope, which releases its popups too (CONCEPTS.md §3)
      pageEntry.owner = Option.some(scope)
      return Option.getOrThrow(runtime.page(pageEntry))
    }).pipe(Effect.withSpan("UserContext.newPage", { attributes: { "browser.context.id": entry.id } })),
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
  Handles.registerContext(context, { runtime, entry })
  return context
}

/** The browser's default context, observed: it exists for the whole connection. */
const makeDefaultContext = (runtime: Runtime.Runtime, entry: Model.ContextEntry): UserContext.ObservedUserContext => {
  const context: UserContext.ObservedUserContext = {
    [UserContextTypeId]: UserContextTypeId,
    id: entry.id,
    pages: NotBuilt.watchable("Browser.defaultContext.pages"),
    workers: NotBuilt.watchable("Browser.defaultContext.workers"),
    closed: Deferred.await(entry.closed),
    control: NotBuilt.effect("Browser.defaultContext.control"),
    [Equal.symbol](that: unknown) {
      return UserContext.isUserContext(that) && that.id === entry.id
    },
    [Hash.symbol]() {
      return Hash.string(entry.id)
    },
    ...objectMembers("UserContext", entry.id)
  }
  // Its events are data events, which modules that take an observed context read
  Handles.registerContext(context, { runtime, entry })
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
  // The contexts this connection created, whose pages get handles
  const contexts = new Map<UserContext.Id, UserContext.UserContext>()
  const handles = new WeakMap<Model.PageEntry, Page.Page>()
  const runtime: Runtime.Runtime = {
    model,
    backend: adapter.info.product,
    page: (entry) => {
      const known = handles.get(entry)
      if (known !== undefined) return Option.some(known)
      const context = contexts.get(entry.context)
      if (context === undefined) return Option.none()
      const page = PageImpl.make({ runtime, entry, context })
      handles.set(entry, page)
      return Option.some(page)
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
        ).pipe(Effect.mapError((error) => contextError("Browser.newContext", asContextReason(error.reason), id)))
      }
      if (options?.permissions !== undefined) {
        yield* Grants.grant(runtime, created, "Browser.newContext", options.permissions, undefined).pipe(
          Effect.mapError((error) => contextError("Browser.newContext", asContextReason(error.reason), id))
        )
      }
      const context = makeContext(runtime, entry)
      contexts.set(created, context)
      // The saved storage, before the context's first page; a context it can't be written into isn't kept
      if (options?.storageState !== undefined) {
        yield* StorageStates.applyState(runtime, context, options.storageState, id).pipe(
          Effect.onError(() => adapter.removeUserContext(created).pipe(Effect.ignore))
        )
      }
      return context
    }).pipe(Effect.withSpan("Browser.newContext"))

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
    newPage: Effect.fn("Browser.newPage")(function*(options?: UserContext.Options) {
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
    pages: NotBuilt.watchable("Browser.pages"),
    defaultContext: makeDefaultContext(runtime, defaultEntry)
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
