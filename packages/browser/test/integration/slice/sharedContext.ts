/**
 * One context for a suite's cases, checked after each. Stock WebKit starts a browser process for each context, which
 * took most of a case's time, so a suite whose cases keep nothing in their context opens their pages in one
 * (`newPage`) and registers its cases through `guard`.
 *
 * After each case, the context must hold no page, popup or worker; no route, grant, init script, emulation or other
 * declaration, its own or the browser's; and no cookie or storage. Cookies and storage are read from each of the
 * case's pages as it closes, because stock WebKit reports only what its open pages hold. Nor may any origin a
 * document of the context committed at, under the top-level origin that partitions it, hold `localStorage`, IndexedDB
 * or a service-worker registration: each is read from the live realms of the closing page and its frames, a top-level
 * origin none of them reads by navigating the page back to it (or, once the case's pages are gone, a page opened for
 * it), and registrations by asking the origin, since Firefox and stock WebKit don't list service workers among a
 * context's workers. A case that leaves anything fails, naming what it left, and the next case gets a new context, so
 * one case's leftovers don't fail the rest; so does one whose frame's partition no live realm could read, without
 * failing.
 */
import { assert, type Vitest } from "@effect/vitest"
import { Browser, Deadline, type Page, type StorageState, UserContext } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type { TestContext, TestOptions } from "vitest"
import type * as Adapter from "../../../src/internal/adapter.ts"
import type * as BoundedAdapter from "../../../src/internal/boundedAdapter.ts"
import * as BrowserClock from "../../../src/internal/browserClock.ts"
import * as Handles from "../../../src/internal/handles.ts"
import * as Operation from "../../../src/internal/operation.ts"
import type * as Target from "../../../src/Target.ts"
import { connection, type Record as TraceRecord } from "../failureTrace.ts"
import * as StorageLeft from "../storageLeft.ts"
import { Recycler } from "./recycledBrowser.ts"

/** A declaration in force, on a context or the whole browser. */
interface Declared {
  readonly on: string
  readonly what: string
}

const onBrowser = "the browser"

const describeDeclaration = (declaration: Adapter.Declaration): string =>
  declaration._tag === "Override" ? `a ${declaration.override._tag} override` : `a ${declaration._tag} declaration`

const behindOf = (context: UserContext.UserContext) => {
  const target = Handles.target(context)
  if (target._tag !== "UserContext") throw new Error("The shared context's handle is a page's")
  return target.behind
}

/**
 * Keeps the declarations in force, as the adapter is asked for them, each until its scope ends. Every declaration L1
 * makes, a route's intercept, an init script, an emulation or a clock, goes through the model's adapter.
 */
const watchDeclarations = (adapter: BoundedAdapter.Bounded, declared: Set<Declared>) => {
  const declare = adapter.declare
  ;(adapter as { declare: typeof declare }).declare = (scope, declaration) => {
    const on = scope._tag === "UserContext" ? scope.context : scope._tag === "Browser" ? onBrowser : undefined
    return declare(scope, declaration).pipe(
      Effect.tap(() =>
        on === undefined ? Effect.void : Effect.acquireRelease(
          Effect.sync(() => {
            const entry: Declared = { on, what: describeDeclaration(declaration) }
            declared.add(entry)
            return entry
          }),
          (entry) => Effect.sync(() => declared.delete(entry))
        )
      )
    )
  }
}

/** What a storage state holds: its cookies, and each origin's `localStorage` and IndexedDB. */
const stored = (state: StorageState.StorageState): ReadonlyArray<string> => [
  ...state.cookies.map((cookie) => `a cookie ${cookie.name} for ${cookie.domain}`),
  ...state.origins.flatMap((origin) => [
    ...(origin.localStorage.length > 0
      ? [`${origin.localStorage.length} localStorage item(s) on ${origin.origin}`]
      : []),
    ...(origin.indexedDb.length > 0 ? [`${origin.indexedDb.length} IndexedDB database(s) on ${origin.origin}`] : [])
  ])
]

interface Held {
  readonly context: UserContext.UserContext
  readonly scope: Scope.Closeable
  /** The declarations made with the context, which are its own for its life. */
  readonly baseline: ReadonlySet<Declared>
  /** Each http(s) partition a document of the context committed at and no read has covered since. */
  readonly committed: Map<string, StorageLeft.Partition>
}

/**
 * Reads, from a page about to close, the storage of the partitions its context committed documents at
 * (`StorageLeft.storageLeft`): from the live realms of the page and its frames, then each top-level origin none of
 * them read by navigating the page back to it. A partition read is no longer pending; one that couldn't be read stays.
 */
const readPage = Effect.fnUntraced(
  function*(held: Held, page: Page.Page) {
    const target = Handles.target(page)
    if (target._tag !== "Page") return []
    const { entry, runtime } = target.behind
    const { model } = runtime
    const pending = Array.from(held.committed.values())
    const realmOf = Effect.fnUntraced(function*(navigable: Target.NavigableId) {
      const document = yield* model.documentOf(navigable)
      if (Option.isNone(document)) return undefined
      return yield* model.adapter.realm(document.value, { _tag: "Main" }).pipe(Effect.orElseSucceed(() => undefined))
    })
    const state = yield* entry.state.get
    const realms: Array<{ readonly realm: Target.RealmId; readonly frame: boolean }> = []
    for (
      const { id, frame } of [{ id: entry.id, frame: false }, ...state.frames.map(({ id }) => ({ id, frame: true }))]
    ) {
      const realm = yield* realmOf(id)
      if (realm !== undefined) realms.push({ realm, frame })
    }
    const top = yield* page.url.pipe(
      Effect.map((url) => new URL(String(url)).origin),
      Effect.orElseSucceed(() => undefined)
    )
    const result = yield* StorageLeft.storageLeft({
      committed: pending,
      realms,
      top,
      read: (realm) => StorageLeft.readRealm(model.adapter.evaluate, realm),
      navigateBack: (origin) => Effect.andThen(page.goto(`${origin}/`, { waitUntil: "commit" }), realmOf(entry.id))
    })
    const unread = new Set(result.unread.map(StorageLeft.keyOf))
    for (const partition of pending) {
      const key = StorageLeft.keyOf(partition)
      if (!unread.has(key)) held.committed.delete(key)
    }
    return result.found
  },
  Deadline.within("5 seconds"),
  // A read that didn't finish leaves its partitions pending, so the context is replaced after the case
  Effect.orElseSucceed((): ReadonlyArray<string> => []),
  Operation.named("Test.sharedContextStorage"),
  Operation.detached
)

export class Shared extends Context.Service<Shared, {
  readonly current: Effect.Effect<UserContext.UserContext>
  /** Reads, from a case's page about to close, the storage its context's documents committed at, and notes it. */
  readonly read: (page: Page.Page) => Effect.Effect<void>
  /** The scope that lives as long as the suite: background work the harness still owns runs in it. */
  readonly owner: Scope.Scope
  /** Records what a case's page found in the context as it closed. */
  readonly note: (found: ReadonlyArray<string>) => Effect.Effect<void>
  /** What the last case left, after which the cases get a new context if it left anything. */
  readonly settle: Effect.Effect<ReadonlyArray<string>, unknown>
}>()("slice/Shared") {}

/** The shared context, over a backend the layer gives the cases too. */
export const layer = <E>(backend: Layer.Layer<Browser.Browser, E>) =>
  Layer.effect(
    Shared,
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const outer = yield* Effect.scope
      // Set when the suite runs over `recycling` (Firefox): its browser is replaced in `settle`, after the case's scope has closed, once it has opened 100 pages and nothing the harness owns is live (pages Firefox opens itself don't count).
      const recycler = yield* Effect.serviceOption(Recycler)
      const declared = new Set<Declared>()
      const watched = new WeakSet<object>()
      const open = Effect.gen(function*() {
        const scope = yield* Scope.fork(outer)
        const context = yield* browser.newContext().pipe(Scope.provide(scope))
        // A replaced browser has a new adapter: the declaration watch goes onto each one, once.
        const adapter = behindOf(context).runtime.model.adapter
        if (!watched.has(adapter)) {
          watchDeclarations(adapter, declared)
          watched.add(adapter)
        }
        // Every origin a document of the context commits at, under the top-level origin that partitions it
        const committed = new Map<string, StorageLeft.Partition>()
        yield* behindOf(context).runtime.model.observeStorageSources(behindOf(context).entry, (origins, cookieOnly) => {
          const origin = origins.at(-1)
          if (cookieOnly === true || origin === undefined || !StorageLeft.holdsStorage(origin)) return
          const partition = { origin, top: origins[0]! }
          committed.set(StorageLeft.keyOf(partition), partition)
        }).pipe(Scope.provide(scope))
        return { context, scope, baseline: new Set(declared), committed } satisfies Held
      })
      let held: Held = yield* open
      const notes: Array<string> = []

      const left = Effect.gen(function*() {
        const found = notes.splice(0)
        const { entry } = behindOf(held.context)
        const state = yield* entry.state.get
        const pages = yield* held.context.pages
        if (pages.length > 0) {
          const urls = yield* Effect.forEach(pages, (page) => Effect.map(page.url, String))
          found.push(`${pages.length} page(s) open, at ${urls.join(", ")}`)
        }
        const workers = yield* held.context.workers
        if (workers.length > 0) {
          found.push(`${workers.length} worker(s), at ${workers.map((worker) => String(worker.url)).join(", ")}`)
        }
        if (state.routes.length > 0) found.push(`${state.routes.length} route(s) on the context`)
        for (const grant of state.grants) found.push(`a grant of ${grant.permissions.join(", ")} to ${grant.origin}`)
        for (const declaration of declared) {
          if (held.baseline.has(declaration)) continue
          if (declaration.on === entry.id) found.push(`${declaration.what} on the context`)
          else if (declaration.on === onBrowser) found.push(`${declaration.what} on the browser`)
        }
        const cookies = yield* held.context.cookies.list
        found.push(...cookies.map((cookie) => `a cookie ${cookie.name} for ${cookie.domain}`))
        return [...new Set(found)]
      })

      return Shared.of({
        current: Effect.sync(() => held.context),
        owner: outer,
        note: (found) => Effect.sync(() => void notes.push(...found)),
        read: (page) => Effect.flatMap(readPage(held, page), (found) => Effect.sync(() => void notes.push(...found))),
        settle: Effect.gen(function*() {
          // A top-level origin no closing page read, as one whose page the case closed itself, is read from a page
          // opened for it
          if (Array.from(held.committed.values()).some((partition) => partition.origin === partition.top)) {
            const current = held
            const read = yield* Effect.exit(
              Effect.scoped(Effect.flatMap(current.context.newPage, (page) => readPage(current, page)))
            )
            if (Exit.isSuccess(read)) notes.push(...read.value)
          }
          // What no read reached, such as a gone frame's partition under another top, isolates the case by a new
          // context, without failing it
          const unread = held.committed.size > 0
          const found = yield* left
          const stats = Option.isSome(recycler) ? yield* recycler.value.stats : undefined
          const recycle = stats !== undefined && stats.pages >= stats.limit
          if (found.length > 0 || unread || recycle) {
            yield* Scope.close(held.scope, Exit.void)
            if (recycle) yield* Option.getOrThrow(recycler).run
            held = yield* open
          }
          return found
        })
      })
    })
  ).pipe(Layer.provideMerge(backend))

/** How long each probe after a stalled storage read, and the closing of its page, may take. */
const probeDeadline = "2 seconds"
const probeDeadlineDuration = Duration.seconds(2)

/** Whether a failed storage read is the page not answering before its deadline, rather than any other failure. */
export const isStalledRead = (error: unknown): boolean =>
  Deadline.isTimeout(error) ||
  (error instanceof Error && error.message.includes("The page didn't answer before the deadline")) ||
  (error instanceof UserContext.UserContextError &&
    error.operation === "UserContext.exportStorageState" &&
    error.reason._tag === "BackendFailure" &&
    error.reason.kind === "Rejected" &&
    error.reason.method === "UserContext.exportStorageState" &&
    error.reason.hint === "UserContext.exportStorageState timed out while resolving")

/**
 * Runs one probe and records how it ended and how long it took; never fails. The probe is an operation under its own
 * `probeDeadline`, and also raced against that long on the browser's clock, so a step no deadline reaches, such as
 * a page's release, can't outlast it.
 */
const probed = Effect.fnUntraced(function*<A, E>(record: TraceRecord, probe: string, effect: Effect.Effect<A, E>) {
  const started = Date.now()
  const exit = yield* Effect.exit(
    effect.pipe(Deadline.within(probeDeadline), BrowserClock.timeoutOption(Duration.toMillis(probeDeadlineDuration)))
  )
  const outcome = Exit.isSuccess(exit)
    ? Option.isSome(exit.value) ? "answered" : "timed out"
    : isStalledRead(Cause.squash(exit.cause))
    ? "timed out"
    : `failed: ${Cause.pretty(exit.cause).split("\n")[0]}`
  record("stalled-read-probe", { probe, outcome, millis: Date.now() - started })
})

/**
 * After a page's storage read didn't answer in time, asks the browser two more things and records the answers, with
 * how long each took, in the failure trace (every backend runs it): whether the same page still answers a trivial
 * script, and whether a new page in the same context, on the stalled page's origin, answers `indexedDB.databases()`.
 * Each gets a budget of its own, whatever deadline encloses the read, and none changes the outcome. The new page's
 * close is waited for only that long; it continues on a fiber of `owner` (the current scope if none is given).
 */
export const probeStalledRead = Effect.fnUntraced(
  function*(
    context: UserContext.UserContext,
    page: Page.Page,
    record: TraceRecord,
    owner?: Scope.Scope
  ) {
    yield* probed(record, "same page answers a trivial script", page.evaluate(() => 1 + 1))
    const origin = yield* page.url.pipe(
      Effect.map((url) => new URL(String(url)).origin),
      Effect.orElseSucceed(() => "null")
    )
    if (origin === "null") {
      record("stalled-read-probe", {
        probe: "new page on the origin answers indexedDB.databases()",
        outcome: "skipped: no origin"
      })
      return
    }
    const scope = yield* Scope.make()
    yield* probed(
      record,
      "new page on the origin answers indexedDB.databases()",
      Effect.gen(function*() {
        const fresh = yield* context.newPage.pipe(Scope.provide(scope))
        yield* fresh.goto(origin, { waitUntil: "load" })
        return yield* fresh.evaluate(async () => (await indexedDB.databases()).length)
      })
    )
    // Releasing a page isn't an operation under any deadline, so it runs on a fiber of the owner's scope, which
    // outlives this wait and is settled when that scope closes
    const closing = yield* Effect.forkIn(
      Scope.close(scope, Exit.void).pipe(Operation.detached),
      owner ?? (yield* Effect.scope)
    )
    yield* probed(record, "closing that page", Fiber.join(closing))
  },
  (effect) => Effect.ignore(effect).pipe(Operation.detached)
)

/**
 * Reads the context's cookies and storage from a closing page and notes what it holds. A read the page doesn't answer
 * in time is noted as unreadable, as ever, after the probes of `probeStalledRead` have recorded what they found.
 */
export const readStorage = (
  note: (found: ReadonlyArray<string>) => Effect.Effect<void>,
  context: UserContext.UserContext,
  page: Page.Page,
  record: TraceRecord,
  deadline: Duration.Input = "5 seconds",
  owner?: Scope.Scope
) =>
  context.exportStorageState.pipe(
    Deadline.within(deadline),
    Effect.flatMap((state) => note(stored(state))),
    Effect.catchTag("TargetGone", () => Effect.void),
    Effect.catch((error) =>
      (isStalledRead(error) ? probeStalledRead(context, page, record, owner) : Effect.void).pipe(
        Effect.andThen(note([`storage that couldn't be read: ${error.message}`]))
      )
    )
  )

/** The shared context itself, for a case that declares on it; what it declares must end with the case's scope. */
export const current = Effect.gen(function*() {
  const shared = yield* Shared
  return yield* shared.current
})

/**
 * A page in the shared context, closed with the scope. Before it closes, the context's cookies and storage are read
 * from it, while its document is still there to read them from.
 */
export const newPage = Effect.gen(function*() {
  const shared = yield* Shared
  const context = yield* shared.current
  const page = yield* context.newPage
  yield* Effect.addFinalizer(() =>
    readStorage(shared.note, context, page, connection("shared-context"), "5 seconds", shared.owner).pipe(
      Effect.andThen(shared.read(page))
    )
  )
  return page
})

/**
 * The suite's cases, each checked once its scope has closed: a case that left anything in the shared context fails,
 * naming what it left. A case that failed on its own reports its own failure.
 */
export const guard = <R>(it: { readonly effect: Vitest.Tester<R | Shared | Scope.Scope> }) => ({
  effect: <A, E>(
    name: string,
    self: (context: TestContext) => Effect.Effect<A, E, R | Shared | Scope.Scope>,
    timeout?: number | TestOptions
  ) =>
    it.effect(name, (context) =>
      Effect.gen(function*() {
        const exit = yield* Effect.exit(Effect.scoped(self(context)))
        const left = yield* Effect.flatMap(Effect.service(Shared), (shared) => shared.settle)
        if (Exit.isFailure(exit)) return yield* exit
        assert.deepStrictEqual(left, [], `"${name}" left in the shared context: ${left.join("; ")}`)
        return exit.value
      }), timeout)
})
