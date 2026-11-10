/**
 * The `Browser` service and the contexts it creates (API.md, Entry points), and the
 * layer every backend builds: launch, connect the adapter, fold its facts into the model, provide `Browser`.
 *
 * Built: `info`, `capabilities`, `newContext`, `newPage`, and a context's `newPage`, `pages`, `workers`,
 * `closed` and `control`. What a context or page owns is released when the scope that acquired it closes, and
 * a page's popups with it. The other members fail as `NotBuilt`.
 *
 * A context the library creates allows downloads into a temporary directory it owns, made before the context
 * and removed after it, and has its file choosers reported and decided.
 *
 * Each page, download, worker and connection has one handle per connection, made on first use from its model
 * entry (`Runtime`), so `newPage`, a context's `pages` and `Popup` hand out the same `Page`, and every event
 * module the same `Download`, `BrowserWorker` or `NetworkConnection`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Path from "effect/Path"
import { pipeArguments } from "effect/Pipeable"
import * as Redacted from "effect/Redacted"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Browser from "../Browser.ts"
import * as CookieJar from "../CookieJar.ts"
import * as Deadline from "../Deadline.ts"
import * as Declaration from "../Declaration.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Ledger from "../Ledger.ts"
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
import * as BrowserService from "./browserService.ts"
import * as ClaimHooks from "./claimHooks.ts"
import * as Clock from "./clock.ts"
import * as ConnectionImpl from "./connection.ts"
import * as Cleanup from "./declarationCleanup.ts"
import * as DownloadImpl from "./download.ts"
import * as Emulation from "./emulation.ts"
import * as Evaluation from "./evaluation.ts"
import * as Grants from "./grants.ts"
import * as Guarded from "./guarded.ts"
import * as Handles from "./handles.ts"
import * as Handoff from "./handoff.ts"
import * as InitScripts from "./initScripts.ts"
import * as Model from "./model.ts"
import * as Navigation from "./navigation.ts"
import * as Operation from "./operation.ts"
import * as PageImpl from "./page.ts"
import * as Proxy from "./proxy.ts"
import * as Routes from "./routes.ts"
import * as Runtime from "./runtime.ts"
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
    (reason._tag === "BackendFailure" || reason._tag === "ViewportMismatch")
    ? reason
    : new Reason.BackendFailure({ kind: "Rejected", method: "Browser.newContext", hint: reason.message })

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

/** How a context handle reaches its pages and gains control. */
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
  /** Where the context's declarations apply. */
  const declared: Adapter.DeclarationScope = { _tag: "UserContext", context: entry.id }
  const context: UserContext.UserContext = {
    [UserContextTypeId]: UserContextTypeId,
    id: entry.id,
    pages: Watchable.make({
      ref: entry.state,
      project: (state) => Option.some(state.pages.map(access.page)),
      ended: (state) => state.closed,
      target: { _tag: "UserContext" },
      operation: "UserContext.pages.waitFor"
    }),
    workers: Watchable.make({
      ref: entry.state,
      project: (state) => Option.some(state.workers.map(runtime.worker)),
      ended: () => Option.none(),
      target: { _tag: "UserContext" },
      operation: "UserContext.workers.waitFor"
    }),
    closed: Deferred.await(entry.closed),
    control: access.control,
    newPage: Effect.gen(function*() {
      const { id } = yield* Operation.record
      const scope = yield* Effect.scope
      const created = yield* Effect.acquireRelease(
        adapter.createPage(entry.id).pipe(Effect.mapError((error) => {
          const mapped = Operation.fromViewportAdapter(error, id, runtime.backend)
          return mapped._tag === "Timeout"
            ? mapped.error
            : mapped._tag === "Gone"
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
        // Owned teardown: no beforeunload; a page that already closed, or was transferred, needs nothing
        (page) => runtime.model.release(page, scope)
      )
      const pageEntry = runtime.model.page(created)
      if (Option.isNone(pageEntry)) return yield* Effect.die(new Error(`${created} was created but never added`))
      // Owned by the caller's scope, which releases its popups too (CONCEPTS.md §3)
      yield* runtime.model.own(pageEntry.value, scope)
      return Option.getOrThrow(runtime.page(pageEntry.value))
    }).pipe(Operation.named("UserContext.newPage", { attributes: { "browser.context.id": entry.id } })),
    cookies: Storage.cookieJar(runtime, entry.id),
    exportStorageState: StorageStates.exportState(runtime, entry.id),
    clock: Clock.make({
      runtime,
      scope: declared,
      pages: () => entry.state.getUnsafe().pages,
      name: "UserContext.clock",
      // One timeline covers a page
      conflicting: () =>
        entry.state.getUnsafe().pages.some((page) => Clock.isInstalled(runtime.timelines, page))
          ? Option.some("Page.clock")
          : Option.none()
    }, entry),
    route: (<E, R, P extends Route.Phase = "request">(
      pattern: Url.Pattern | string,
      handler: Route.Handler<E, R, P>,
      options?: Route.Options<P>
    ) =>
      Routes.register(
        {
          runtime,
          scope: declared,
          routes: entry,
          target: { _tag: "UserContext" },
          operation: "UserContext.route"
        },
        pattern,
        handler,
        (options?.phase ?? "request") as P
      )) as UserContext.UserContext["route"],
    addInitScript: (script, options) =>
      InitScripts.add({ runtime, scope: declared, operation: "UserContext.addInitScript" }, entry.id, script, options),
    emulate: (settings) => Emulation.emulate({ runtime, scope: declared, operation: "UserContext.emulate" }, settings),
    grant: (permissions, options) => Grants.grant(runtime, entry, "UserContext.grant", permissions, options),
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
      project: (state) => Option.some(state.pages.map(runtime.observed)),
      ended: (state) => state.closed,
      target: { _tag: "UserContext" },
      operation: "UserContext.pages.waitFor"
    }),
    workers: Watchable.make({
      ref: entry.state,
      project: (state) => Option.some(state.workers.map(runtime.worker)),
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
 * The context of a page whose context the caller doesn't control: what needs control fails with `NotPermitted`,
 * and `control` gains it.
 */
const makeDeniedContext = (
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  control: Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope>
): UserContext.UserContext => {
  const id = () => Operation.idNow()
  const notPermitted = (member: string) =>
    new Reason.NotPermitted({
      required: "control",
      hint:
        `${member} needs control of the page's context, which this page's access doesn't give; gain it with page.context.control`
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
  // The handle of each page controlled for its life, and of each page only observed
  const handles = new WeakMap<Model.PageEntry, Page.Page>()
  const observedHandles = new WeakMap<Model.PageEntry, Page.ObservedPage>()
  const denied = new WeakMap<Model.ContextEntry, UserContext.UserContext>()

  /** Whether the connection controls a page for its whole life: it created the page, or the page's context. */
  const lifelong = (entry: Model.PageEntry) =>
    contexts.has(entry.context) || Option.isSome(entry.state.getUnsafe().owner)

  /** A page's context handle: the context, when the connection created it; otherwise one that refuses control. */
  const contextOf = (entry: Model.PageEntry): UserContext.UserContext => {
    const created = contexts.get(entry.context)
    if (created !== undefined) return created
    const contextEntry = entry.contextEntry
    const known = denied.get(contextEntry)
    if (known !== undefined) return known
    const context = makeDeniedContext(runtime, contextEntry, upgradeContext(contextEntry))
    denied.set(contextEntry, context)
    return context
  }

  /**
   * `inspect` and `control` of a page: the page itself when it is controlled for life, or a handle under a grant
   * for the caller's scope. `inspect` installs the isolated world first, and changes nothing the page shows; where
   * the backend makes no worlds, it waits for the page's own instead.
   */
  const upgradePage = (entry: Model.PageEntry) => (level: "inspect" | "control") =>
    Effect.gen(function*() {
      const known = runtime.page(entry)
      if (Option.isSome(known)) return known.value
      const grant = yield* Access.acquire(level, { _tag: "Page", id: entry.id })
      if (level === "inspect") {
        const id = Operation.idNow()
        const budget = yield* Operation.budget
        yield* Evaluation.pageRealm(
          runtime,
          entry,
          yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
          id,
          budget.at
        ).pipe(
          Effect.mapError((failure) =>
            new Page.PageError({
              operation: "Page.inspect",
              reason: new Page.InitializationFailed({
                step: "install the isolated world",
                hint: failure._tag === "Deadline"
                  ? "The page had no document to install it in before the deadline; a page attached with a dialog open reports none until it closes"
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
    }).pipe(Operation.named(`Page.${level}`, { attributes: { "browser.page.id": entry.id } }))

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
    }).pipe(Operation.named("UserContext.control", { attributes: { "browser.context.id": entry.id } }))

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
    // A launched browser's layer has both; one it connects to may not
    fileSystem: yield* Effect.serviceOption(FileSystem.FileSystem),
    path: yield* Effect.serviceOption(Path.Path),
    engineRealms: yield* Runtime.makeEngineRealms(model),
    timelines: Clock.makeTimelines(),
    settle: (operation, navigation, frame, url, at, outcome, id) =>
      Navigation.settle(model, operation, navigation, frame, url, at, outcome, id)
  }

  const setupContext = (
    options?: UserContext.Options,
    mode?: { readonly reclaimable: true } | {
      readonly context: UserContext.Id
      readonly ownership: { committed: boolean }
      readonly adopt?: boolean
    }
  ): Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Scope.Scope> =>
    Effect.gen(function*() {
      const operation = mode !== undefined && "context" in mode ? "UserContext.reclaim" : "Browser.newContext"
      const { id } = yield* Operation.record
      const proxy = options?.proxy === undefined ? Option.none<Adapter.ProxyOptions>() : Option.some(
        yield* Proxy.normalize(options.proxy, adapter.info.product).pipe(
          Effect.mapError((reason) => contextError(operation, reason, id))
        )
      )
      if (Option.isSome(proxy) && mode !== undefined && "context" in mode) {
        return yield* Effect.fail(
          contextError(
            operation,
            new Reason.Unsupported({
              capability: "userContexts.proxy",
              backend: adapter.info.product,
              hint: "A proxy can only be set when creating a context"
            }),
            id
          )
        )
      }
      if (options?.requestTiming && mode !== undefined && "context" in mode) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.Unsupported({
            capability: "network.timing",
            backend: adapter.info.product,
            hint: "Request timings must be enabled when creating a new context"
          }),
          id
        ))
      }
      if (options?.requestSizes && mode !== undefined && "context" in mode) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.Unsupported({
            capability: "network.sizes",
            backend: adapter.info.product,
            hint: "Request sizes must be enabled when creating a new context"
          }),
          id
        ))
      }
      if (options?.acceptInsecureCerts !== undefined && mode !== undefined && "context" in mode) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.Unsupported({
            capability: "acceptInsecureCerts",
            backend: adapter.info.product,
            hint: "Certificate acceptance can only be set when creating a context"
          }),
          id
        ))
      }
      const credentials = options?.httpCredentials
      if (
        credentials !== undefined && (typeof credentials.username !== "string" ||
          !Redacted.isRedacted(credentials.password) || typeof Redacted.value(credentials.password) !== "string")
      ) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.InvalidInput({
            input: "httpCredentials",
            expected: "a username and a Redacted string password",
            hint: "Supply website credentials separately from proxy credentials"
          }),
          id
        ))
      }
      let credentialOrigin: string | undefined
      if (credentials?.origin !== undefined) {
        const url = URL.parse(credentials.origin)
        if (
          url === null || !["http:", "https:"].includes(url.protocol) || url.username !== "" ||
          url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== ""
        ) {
          return yield* Effect.fail(contextError(
            operation,
            new Reason.InvalidInput({
              input: "httpCredentials.origin",
              expected: "an HTTP(S) origin (scheme://host:port)",
              hint: "Supply an origin without credentials, path, query or fragment"
            }),
            id
          ))
        }
        credentialOrigin = url.origin
      }
      const ownerScope = yield* Effect.scope
      const reclaimable = mode !== undefined
      const adopt = mode !== undefined && "context" in mode && mode.adopt === true
      const ownership = mode !== undefined && "context" in mode ? mode.ownership : undefined
      const committed = () => ownership === undefined || ownership.committed
      let handle: UserContext.UserContext | undefined
      let previous: UserContext.UserContext | undefined
      // A partition the backend can't set fails the context before it exists: nothing is applied partly
      if (options?.storageState !== undefined) {
        const partitions = yield* StorageStates.unsupportedPartitions(runtime, options.storageState)
        if (partitions.length > 0) {
          return yield* Effect.fail(contextError(
            operation,
            new StorageState.Incompatible({
              partitions,
              hint: `${runtime.backend} can't set a partitioned cookie (cookies.partitioned)`
            }),
            id
          ))
        }
      }
      const failed = (
        error: Adapter.AdapterError | Deadline.Timeout
      ): Effect.Effect<never, UserContext.UserContextError | Deadline.Timeout> => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        // The browser itself ended: every operation on it ends with the connection, a defect here
        return mapped._tag === "Gone"
          ? Effect.die(mapped.error)
          : mapped._tag === "Timeout"
          ? Effect.fail(mapped.error)
          : Effect.fail(contextError(operation, mapped.reason, id))
      }
      // A directory the context owns for its downloads, made first so it is removed after the context;
      // or the caller's, or none
      // A backend that reports no downloads, such as stock WebKit, gets none by default; asked for,
      // they fail as the adapter refuses them (QUIRKS.md, Q220)
      const capabilities = (yield* SubscriptionRef.get(model.adapter.capabilities)).entries
      const reports = (name: string) =>
        capabilities.every((entry) => entry.name !== name || entry.status !== "unsupported")
      if (credentials !== undefined && !reports("interception.auth")) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.Unsupported({
            capability: "interception.auth",
            backend: runtime.backend,
            hint: "This backend cannot answer website authentication challenges"
          }),
          id
        ))
      }
      const reportsDownloads = reports("downloads")
      const asked = options?.downloads ?? (!adopt && reportsDownloads ? "temporary" : "none")
      if (typeof asked === "object" && !/^(\/|[A-Za-z]:[\\/])/.test(asked.directory)) {
        return yield* Effect.fail(contextError(
          operation,
          new Reason.InvalidInput({
            input: "downloads",
            expected: "an absolute directory, which the browser writes to",
            hint: `${asked.directory} isn't one`
          }),
          id
        ))
      }
      // A temporary one is in the ledger while it exists, forgotten after it is removed
      const ledger = yield* Ledger.CurrentLedger
      let made: string | undefined
      yield* Effect.addFinalizer(() =>
        made === undefined ? Effect.void : ledger.remove({ _tag: "Directory", path: made })
      )
      const downloads = asked === "deny" || asked === "none"
        ? Option.none<string>()
        : typeof asked === "object"
        ? Option.some(asked.directory)
        : Option.isNone(runtime.fileSystem)
        ? Option.none<string>()
        : Option.some(
          yield* runtime.fileSystem.value.makeTempDirectoryScoped({ prefix: "strider-downloads-" }).pipe(
            Effect.mapError((error) =>
              contextError(
                operation,
                new Reason.BackendFailure({
                  kind: "Rejected",
                  method: "FileSystem.makeTempDirectoryScoped",
                  hint: `Couldn't create the context's download directory: ${error.message}`
                }),
                id
              )
            )
          )
        )
      if (asked === "temporary" && Option.isSome(downloads)) {
        made = downloads.value
        yield* ledger.add({ _tag: "Directory", path: downloads.value })
      }
      // Removed when the scope closes, waiting for its end under a budget of its own (`Model.remove`)
      const entry = yield* Effect.acquireRelease(
        (mode !== undefined && "context" in mode
          ? Effect.succeed(mode.context)
          : adapter.createUserContext({
            proxy,
            acceptInsecureCerts: options?.acceptInsecureCerts ?? false,
            reclaimable,
            requestTiming: options?.requestTiming,
            requestSizes: options?.requestSizes
          })).pipe(
            Effect.catch(failed),
            Effect.flatMap(model.context)
          ),
        (entry) =>
          (!committed() || (reclaimable && Handoff.leavesOpen(ownerScope)) ? Effect.void : model.remove(entry)).pipe(
            Effect.ensuring(Effect.sync(() => {
              if (handle === undefined || contexts.get(entry.id) !== handle) return
              if (!committed() && previous !== undefined) contexts.set(entry.id, previous)
              else contexts.delete(entry.id)
            }))
          )
      )
      const created = entry.id
      // Owned contexts decide dialogs no handler claims at once, and cancel file choosers no handler answers
      // (CONCEPTS.md §5)
      const settings = (yield* entry.state.get).settings
      if (ownership !== undefined) {
        yield* Effect.addFinalizer(() => committed() ? Effect.void : model.configure(entry, settings))
      }
      yield* model.configure(entry, {
        owned: true,
        reclaimable,
        policy: adopt ? Option.none() : Option.some(options?.dialogs ?? "dismiss"),
        eventLog: options?.eventLog ?? settings.eventLog,
        keyboardLayout: options?.keyboardLayout ?? settings.keyboardLayout
      })
      const scope: Adapter.DeclarationScope = { _tag: "UserContext", context: created }
      // Where file choosers aren't reported, as on stock WebKit, the browser cancels them itself
      if (!adopt && reports("fileChooser")) {
        yield* adapter.declare(scope, { _tag: "FileChooser" }).pipe(Effect.catch(failed))
      }
      if (credentials !== undefined) {
        yield* model.route(entry, {
          phase: "auth",
          matches: () => true,
          ask: (_obligation, paused) =>
            Effect.succeed({
              _tag: "Decided",
              decision: paused.authSource === "server" &&
                  (credentialOrigin === undefined || URL.parse(paused.request.url)?.origin === credentialOrigin)
                ? {
                  _tag: "ProvideCredentials",
                  username: credentials.username,
                  password: Redacted.value(credentials.password),
                  once: true
                }
                : { _tag: "CancelAuth" }
            })
        })
        yield* adapter.declare(scope, { _tag: "Intercept", patterns: ["*"], phases: ["auth"] }).pipe(
          Effect.catch(failed)
        )
      }
      // A challenge no route answers gets the server's response, never the browser's prompt, which nothing answers
      // headless, wherever the backend can pause one (QUIRKS.md, Q95 and Q252)
      if (!adopt && reports("network.challenges")) {
        yield* adapter.declare(scope, { _tag: "Challenges" }).pipe(Effect.catch(failed))
      }
      if (asked === "deny") {
        yield* adapter.declare(scope, { _tag: "Downloads", behavior: { _tag: "Deny" } }).pipe(Effect.catch(failed))
        yield* Effect.annotateCurrentSpan("browser.context.downloads", "deny")
      } else if (Option.isSome(downloads)) {
        yield* adapter.declare(scope, { _tag: "Downloads", behavior: { _tag: "Allow", directory: downloads.value } })
          .pipe(Effect.catch(failed))
        yield* Effect.annotateCurrentSpan("browser.context.downloads", downloads.value)
      }
      // The options that are declarations, held for the context's life, before its first page
      if (options?.emulation !== undefined || options?.focus === "emulated") {
        const fields = Emulation.fields(options.emulation ?? {})
        if (!Array.isArray(fields)) {
          return yield* Effect.fail(contextError(operation, fields as Reason.InvalidInput, id))
        }
        yield* Emulation.declare(
          { runtime, scope, operation },
          options.focus === "emulated"
            ? [...fields, { capability: "emulation.focus", override: { _tag: "FocusEmulation", enabled: true } }]
            : fields,
          id
        ).pipe(Effect.mapError((error) =>
          Deadline.isTimeout(error)
            ? error
            : contextError(operation, asContextReason(Target.isTargetGone(error) ? error : error.reason), id)
        ))
      }
      if (options?.permissions !== undefined) {
        yield* Grants.grant(runtime, entry, operation, options.permissions, undefined).pipe(
          Effect.mapError((error) =>
            Deadline.isTimeout(error)
              ? error
              : contextError(
                operation,
                asContextReason(Target.isTargetGone(error) ? error : error.reason),
                id
              )
          )
        )
      }
      const context: UserContext.UserContext = makeContext(runtime, entry, {
        grant: Option.none(),
        page: (pageEntry) => Option.getOrThrow(runtime.page(pageEntry)),
        control: Effect.sync(() => context)
      })
      previous = contexts.get(created)
      handle = context
      contexts.set(created, context)
      // A new context is removed when saved storage fails; a borrowed context must survive failed setup.
      if (options?.storageState !== undefined) {
        yield* StorageStates.applyState(runtime, context, options.storageState, id).pipe(
          Effect.onError(() =>
            ownership === undefined ? adapter.removeUserContext(created).pipe(Effect.ignore) : Effect.void
          )
        )
      }
      if (ownership === undefined) Handoff.ownContext(entry, ownerScope)
      return context
    }).pipe(Operation.named(mode !== undefined && "context" in mode ? "UserContext.reclaim" : "Browser.newContext"))

  // Setup is interruptible; ownership, registrations and delivery share a single commit region.
  const recover = <A>(
    options: UserContext.Options | undefined,
    id: UserContext.Id,
    adopt: boolean,
    complete: (context: UserContext.UserContext, scope: Scope.Scope) => Effect.Effect<A>
  ) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function*() {
        const scope = yield* Scope.fork(yield* Effect.scope)
        const ownership = { committed: false }
        const context = yield* restore(
          setupContext(options, { context: id, ownership, adopt }).pipe(Scope.provide(scope))
        ).pipe(Effect.onError(() => Scope.close(scope, Exit.void).pipe(Effect.provideService(Cleanup.Confirm, true))))
        const entry = yield* model.context(id)
        // Existing pages need release steps before the context's declarations are torn down, too.
        for (const page of entry.state.getUnsafe().pages) yield* model.transfer(page.id, scope)
        Handoff.ownContext(entry, scope)
        Handoff.allow(scope)
        ownership.committed = true
        return yield* complete(context, scope)
      })
    )
  const newContext = Effect.fnUntraced(function*(
    options?: UserContext.Options,
    mode?: { readonly reclaimable: true } | { readonly context: UserContext.Id }
  ) {
    if (mode !== undefined && "context" in mode) {
      return yield* recover(options, mode.context, false, (context) => Effect.succeed(context))
    }
    const context = yield* setupContext(options, mode)
    if (mode !== undefined) Handoff.allow(yield* Effect.scope)
    return context
  })

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
    newPage: Operation.fn("Browser.newPage")(function*(options?: UserContext.Options) {
      const context = yield* newContext(options).pipe(
        Effect.mapError((error) =>
          Deadline.isTimeout(error) ? error : new Page.PageError({
            operation: "Browser.newPage",
            reason: error.reason._tag === "Incompatible"
              ? new Page.InitializationFailed({ step: "create the context", hint: error.reason.message })
              : error.reason,
            diagnostics: error.diagnostics
          })
        )
      )
      return yield* context.newPage
    }),
    pages: Watchable.make({
      ref: model.pages,
      project: (pages) => Option.some(pages.map(runtime.observed)),
      ended: () => Option.none(),
      target: { _tag: "Browser" },
      operation: "Browser.pages.waitFor"
    }),
    defaultContext: makeObservedContext(runtime, defaultEntry, upgradeContext(defaultEntry))
  }
  ClaimHooks.register(browser, { runtime, context: newContext, recover })
  return browser
})

/**
 * The layer a backend builds: `connect` launches its browser and connects its adapter with the model's sink,
 * for the layer's scope.
 */
export const layer = <E, R>(
  connect: (sink: Adapter.Sink) => Effect.Effect<Adapter.AdapterConnection, E, R>
): Layer.Layer<Browser.Browser, E, Exclude<R, Scope.Scope>> =>
  Layer.effect(BrowserService.Browser)(Effect.gen(function*() {
    const { sink, attach } = yield* Model.make()
    const adapter = yield* connect(sink)
    const model = yield* attach(adapter)
    return yield* make(model)
  }))
