/**
 * The `Browser` service and the contexts it creates (API.md, Entry points; review 12, candidate 7), and the
 * layer every backend builds: launch, connect the adapter, fold its facts into the model, provide `Browser`.
 *
 * Built: `info`, `capabilities`, `newContext`, `newPage`, and a context's `newPage`, `pages`, `closed` and
 * `control`. What a context or page owns is released when the scope that acquired it closes, and a page's
 * popups with it (review 13). The other members fail as `NotBuilt`.
 *
 * Each page has one handle per connection, made on first use from its model entry (`Runtime.page`), so
 * `newPage`, a context's `pages` and `Popup` hand out the same `Page`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Inspectable from "effect/Inspectable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import type * as Scope from "effect/Scope"
import * as Browser from "../Browser.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import * as Handles from "./handles.ts"
import * as Model from "./model.ts"
import * as NotBuilt from "./notBuilt.ts"
import * as Operation from "./operation.ts"
import * as PageImpl from "./page.ts"
import type * as Runtime from "./runtime.ts"
import * as Watchable from "./watchable.ts"

const BrowserTypeId = "~@usestrider/browser/Browser"
const UserContextTypeId = "~@usestrider/browser/UserContext"

const contextError = (operation: string, reason: UserContext.UserContextErrorReason, id: Diagnostics.OperationId) =>
  new UserContext.UserContextError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** The options a context can be created with so far; the others aren't built. */
const unbuiltOption = (options: UserContext.Options | undefined): Option.Option<string> => {
  if (options === undefined) return Option.none()
  if (options.storageState !== undefined) return Option.some("UserContext.Options.storageState")
  if (options.emulation !== undefined) return Option.some("UserContext.Options.emulation")
  if (options.permissions !== undefined) return Option.some("UserContext.Options.permissions")
  if (options.focus === "emulated") return Option.some("UserContext.Options.focus: emulated")
  return Option.none()
}

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
    workers: NotBuilt.watchable("UserContext.workers"),
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
    cookies: {
      list: NotBuilt.effect("UserContext.cookies"),
      listFor: NotBuilt.fn("UserContext.cookies"),
      set: NotBuilt.fn("UserContext.cookies"),
      remove: NotBuilt.fn("UserContext.cookies"),
      clear: NotBuilt.effect("UserContext.cookies")
    },
    exportStorageState: NotBuilt.effect("UserContext.exportStorageState"),
    clock: {
      install: NotBuilt.fn("UserContext.clock.install"),
      adjust: NotBuilt.fn("UserContext.clock.adjust"),
      setTime: NotBuilt.fn("UserContext.clock.setTime"),
      resume: NotBuilt.effect("UserContext.clock.resume")
    },
    route: NotBuilt.fn("UserContext.route") as UserContext.UserContext["route"],
    addInitScript: NotBuilt.fn("UserContext.addInitScript"),
    emulate: NotBuilt.fn("UserContext.emulate"),
    grant: NotBuilt.fn("UserContext.grant"),
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
const makeDefaultContext = (entry: Model.ContextEntry): UserContext.ObservedUserContext => ({
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
})

/** The `Browser` service over a model. */
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
    }
  }

  const newContext = (
    options?: UserContext.Options
  ): Effect.Effect<UserContext.UserContext, UserContext.UserContextError, Scope.Scope> =>
    Effect.gen(function*() {
      const unbuilt = unbuiltOption(options)
      if (Option.isSome(unbuilt)) return yield* NotBuilt.effect(unbuilt.value)
      const id = Operation.operationId()
      const created = yield* Effect.acquireRelease(
        adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false }).pipe(
          Effect.catch((error) => {
            const mapped = Operation.fromAdapter(error, id, runtime.backend)
            // The browser itself ended: every operation on it ends with the connection, a defect here
            return mapped._tag === "Gone"
              ? Effect.die(mapped.error)
              : Effect.fail(contextError("Browser.newContext", mapped.reason, id))
          })
        ),
        (context) =>
          adapter.removeUserContext(context).pipe(
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => contexts.delete(context)))
          )
      )
      const entry = yield* model.context(created)
      // Owned contexts decide dialogs no handler claims at once (CONCEPTS.md §5)
      entry.policy = Option.some(options?.dialogs ?? "dismiss")
      entry.eventLog = options?.eventLog ?? entry.eventLog
      const context = makeContext(runtime, entry)
      contexts.set(created, context)
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
    defaultContext: makeDefaultContext(defaultEntry)
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
