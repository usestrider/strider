/**
 * One context for a suite's cases, checked after each. Stock WebKit starts a browser process for each context, which
 * took most of a case's time, so a suite whose cases keep nothing in their context opens their pages in one
 * (`newPage`) and registers its cases through `guard`.
 *
 * After each case, the context must hold no page, popup or worker; no route, grant, init script, emulation or other
 * declaration, its own or the browser's; and no cookie or storage. Cookies and storage are read from each of the
 * case's pages as it closes, because stock WebKit reports only what its open pages hold. A case that leaves anything
 * fails, naming what it left, and the next case gets a new context, so one case's leftovers don't fail the rest.
 */
import { assert, type Vitest } from "@effect/vitest"
import { Browser, Deadline, type StorageState, type UserContext } from "@usestrider/browser"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import type { TestContext } from "vitest"
import type * as Adapter from "../../../src/internal/adapter.ts"
import type * as BoundedAdapter from "../../../src/internal/boundedAdapter.ts"
import * as Handles from "../../../src/internal/handles.ts"

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
}

export class Shared extends Context.Service<Shared, {
  readonly current: Effect.Effect<UserContext.UserContext>
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
      const declared = new Set<Declared>()
      let watching = false
      const open = Effect.gen(function*() {
        const scope = yield* Scope.fork(outer)
        const context = yield* browser.newContext().pipe(Scope.provide(scope))
        if (!watching) {
          watchDeclarations(behindOf(context).runtime.model.adapter, declared)
          watching = true
        }
        return { context, scope, baseline: new Set(declared) } satisfies Held
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
        note: (found) =>
          Effect.sync(() => {
            if (found.some((note) => note.includes("couldn't be read"))) {
              ;(globalThis as Record<string, (why: string) => void>)["__r475dump"]?.("STORAGE NOT READ")
            }
            notes.push(...found)
          }),
        settle: Effect.gen(function*() {
          const found = yield* left
          if (found.length > 0) {
            yield* Scope.close(held.scope, Exit.void)
            held = yield* open
          }
          return found
        })
      })
    })
  ).pipe(Layer.provideMerge(backend))

/**
 * A page in the shared context, closed with the scope. Before it closes, the context's cookies and storage are read
 * from it, while its document is still there to read them from.
 */
export const newPage = Effect.gen(function*() {
  const shared = yield* Shared
  const context = yield* shared.current
  const page = yield* context.newPage
  yield* Effect.addFinalizer(() =>
    context.exportStorageState.pipe(
      Deadline.within("5 seconds"),
      Effect.flatMap((state) => shared.note(stored(state))),
      Effect.catchTag("TargetGone", () => Effect.void),
      Effect.catch((error) => shared.note([`storage that couldn't be read: ${error.message}`]))
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
    timeout?: number
  ) =>
    it.effect(name, (context) =>
      Effect.gen(function*() {
        console.log("R475CASE", name)
        const exit = yield* Effect.exit(Effect.scoped(self(context)))
        const left = yield* Effect.flatMap(Effect.service(Shared), (shared) => shared.settle)
        if (Exit.isFailure(exit)) return yield* exit
        assert.deepStrictEqual(left, [], `"${name}" left in the shared context: ${left.join("; ")}`)
        return exit.value
      }), timeout)
})
