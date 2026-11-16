/**
 * Shared raw-engine connection and user context; pages, facts and waiters belong to one case only. Stock WebKit starts
 * a browser process for each context, which took most of a case's time, so the cases open their pages in one context
 * and, after each, the context must hold no page, popup or worker, and no cookie, `localStorage` or IndexedDB. A case
 * that leaves anything fails, naming what it left, and the next case gets a new context. A case that is about
 * contexts themselves asks for one of its own (`freshPage`).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type * as Adapter from "../../../src/internal/adapter.ts"
import type * as Target from "../../../src/Target.ts"
import type * as UserContext from "../../../src/UserContext.ts"
import type { Backend } from "./harness.ts"

type Requirements = Exclude<Effect.Services<ReturnType<Backend["connect"]>>, Scope.Scope>
type Kept = Extract<Adapter.Fact, {
  readonly _tag: "NavigationEnded" | "DocumentReadiness" | "NavigableRemoved" | "UserContextRemoved"
}>

/** No network bodies, console values or other unbounded payloads are retained. Overflow fails cleanup. */
export const recorder = () => {
  const facts: Array<Kept> = []
  const waiters = new Set<() => void>()
  let overflow = false
  const sink = (fact: Adapter.Fact) =>
    Effect.sync(() => {
      switch (fact._tag) {
        case "NavigationEnded":
        case "DocumentReadiness":
        case "NavigableRemoved":
        case "UserContextRemoved":
          if (facts.length === 256) overflow = true
          else facts.push(fact)
          for (const waiter of Array.from(waiters)) waiter()
      }
    })
  const when = <T extends Kept["_tag"]>(
    tag: T,
    where: (fact: Extract<Kept, { _tag: T }>) => boolean
  ) =>
    Effect.callback<Extract<Kept, { _tag: T }>>((resume) => {
      const check = () => {
        const found = facts.find((fact): fact is Extract<Kept, { _tag: T }> =>
          fact._tag === tag && where(fact as Extract<Kept, { _tag: T }>)
        )
        if (found !== undefined) {
          waiters.delete(check)
          resume(Effect.succeed(found))
        }
      }
      waiters.add(check)
      check()
      return Effect.sync(() => void waiters.delete(check))
    }).pipe(Effect.timeout("10 seconds"))
  return {
    sink,
    when,
    check: Effect.sync(() => {
      if (overflow) throw new Error("Raw engine fact buffer exceeded 256 lifecycle facts")
      if (waiters.size !== 0) throw new Error("Raw engine case left fact waiters")
    }),
    clear: Effect.sync(() => {
      facts.length = 0
      waiters.clear()
    }),
    size: () => facts.length
  }
}

interface Held {
  readonly adapter: Adapter.AdapterConnection
  readonly scope: Scope.Closeable
  readonly token: object
  /** The context the cases share, made by the first case that asks for it. */
  context: UserContext.Id | undefined
}

/** The pages, worker realms and window realms the connection's facts show, so a case's leftovers can be named. */
const tracker = () => {
  const pages = new Map<Target.NavigableId, UserContext.Id>()
  const workers = new Map<Target.RealmId, { readonly url: string; readonly context: UserContext.Id | undefined }>()
  const windows = new Map<Target.RealmId, Target.NavigableId>()
  const observe = (fact: Adapter.Fact) => {
    switch (fact._tag) {
      case "PageAdded":
        pages.set(fact.page, fact.context)
        break
      case "NavigableRemoved":
        pages.delete(fact.navigable)
        break
      case "RealmAdded":
        if (fact.kind._tag === "Window") windows.set(fact.realm, fact.kind.navigable)
        else {
          const page = Option.getOrUndefined(fact.kind.page)
          workers.set(fact.realm, {
            url: String(fact.kind.url),
            context: Option.getOrUndefined(fact.kind.context) ?? (page === undefined ? undefined : pages.get(page))
          })
        }
        break
      case "RealmRemoved":
        windows.delete(fact.realm)
        workers.delete(fact.realm)
    }
  }
  return {
    observe,
    pagesIn: (context: UserContext.Id) => Array.from(pages).filter(([, owner]) => owner === context),
    workersIn: (context: UserContext.Id) => Array.from(workers.values()).filter((worker) => worker.context === context),
    realmsOf: (page: Target.NavigableId) =>
      Array.from(windows).filter(([, navigable]) => navigable === page).map(([realm]) => realm),
    clear: () => {
      pages.clear()
      workers.clear()
      windows.clear()
    }
  }
}

/** What a page's current document can reach of its origin's storage; an opaque origin has none. */
const storageRead = `async () => {
  try {
    const databases = typeof indexedDB.databases === "function" ? (await indexedDB.databases()).length : 0
    return JSON.stringify({ origin: location.origin, localStorage: localStorage.length, databases })
  } catch {
    return JSON.stringify({ origin: location.origin, localStorage: 0, databases: 0 })
  }
}`

export const make = Effect.fnUntraced(function*(backend: Backend) {
  const services = yield* Effect.context<Requirements>()
  let held: Held | undefined
  let active: ReturnType<typeof recorder> | undefined
  const seen = tracker()

  const reset = Effect.suspend(() => {
    const previous = held
    held = undefined
    seen.clear()
    return previous === undefined ? Effect.void : Scope.close(previous.scope, Exit.void)
  })
  yield* Effect.addFinalizer(() => reset)

  // Called only from a setup hook: body-created transports keep their creator's failure-trace attribution.
  const prepare = Effect.gen(function*() {
    if (held !== undefined) return
    const scope = yield* Scope.make()
    const token = {}
    const result = yield* backend.connect((fact) => {
      if (held?.token !== token) return Effect.void
      seen.observe(fact)
      return active === undefined ? Effect.void : active.sink(fact)
    }).pipe(
      Scope.provide(scope),
      Effect.provide(services),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    held = { adapter: result.adapter, scope, token, context: undefined }
  })

  /** What a case left in the shared context while its page is still open: cookies, and its origins' storage. */
  const storageLeft = Effect.fnUntraced(function*(connection: Held, context: UserContext.Id, page: Target.NavigableId) {
    const found: Array<string> = []
    const cookies = yield* connection.adapter.cookies(context)
    found.push(...cookies.map((cookie) => `a cookie ${cookie.name} for ${cookie.domain}`))
    for (const realm of seen.realmsOf(page)) {
      const read = yield* Effect.exit(connection.adapter.evaluate(realm, {
        functionDeclaration: storageRead,
        arguments: [],
        awaitPromise: true,
        result: "value",
        userActivation: false
      }))
      // A realm its document has since left is gone; another of the page's realms reads the same origin
      if (Exit.isFailure(read) || read.value._tag !== "Value" || read.value.value.type !== "string") continue
      const held = JSON.parse(read.value.value.value) as {
        readonly origin: string
        readonly localStorage: number
        readonly databases: number
      }
      if (held.localStorage > 0) found.push(`${held.localStorage} localStorage item(s) on ${held.origin}`)
      if (held.databases > 0) found.push(`${held.databases} IndexedDB database(s) on ${held.origin}`)
    }
    return found
  })

  /** Opens a page for one case, in the shared context or, with `fresh`, in a context of its own. */
  const open = Effect.fnUntraced(function*(fresh: boolean) {
    const connection = held
    if (connection === undefined) {
      return yield* Effect.die(new Error("Raw engine connection was not prepared in a hook"))
    }
    if (active !== undefined) return yield* Effect.die(new Error("Raw engine cases must run serially"))
    const facts = recorder()
    active = facts
    let context: UserContext.Id | undefined
    let page: Target.NavigableId | undefined

    const left: Array<string> = []
    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function*() {
        const cleaned = yield* Effect.exit(
          Effect.gen(function*() {
            const shared = fresh ? undefined : connection.context
            if (page !== undefined) {
              if (shared !== undefined) left.push(...yield* storageLeft(connection, shared, page))
              yield* connection.adapter.closePage(page, { runBeforeUnload: false })
              yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            }
            if (shared !== undefined) {
              const pages = seen.pagesIn(shared)
              if (pages.length > 0) left.push(`${pages.length} page(s) open`)
              left.push(...seen.workersIn(shared).map((worker) => `a worker at ${worker.url}`))
              // The next case gets a new context, so one case's leftovers don't fail the rest
              if (left.length > 0) {
                connection.context = undefined
                yield* connection.adapter.removeUserContext(shared)
                yield* facts.when("UserContextRemoved", (fact) => fact.context === shared)
              }
            }
            if (fresh && context !== undefined) {
              yield* connection.adapter.removeUserContext(context)
              yield* facts.when("UserContextRemoved", (fact) => fact.context === context)
            }
            yield* facts.check
          }).pipe(Effect.timeout("10 seconds"))
        )
        active = undefined
        yield* facts.clear
        if (Exit.isFailure(cleaned) || Exit.isFailure(exit)) {
          const closed = yield* Effect.exit(reset)
          if (Exit.isFailure(closed)) yield* Effect.logError("Raw engine connection disposal failed", closed.cause)
          // A cleanup failure must never replace the case's original assertion/error/interruption.
          if (Exit.isFailure(exit)) {
            if (Exit.isFailure(cleaned)) yield* Effect.logError("Raw engine cleanup failed", cleaned.cause)
            return
          }
          if (Exit.isFailure(cleaned)) return yield* Effect.failCause(cleaned.cause).pipe(Effect.orDie)
          return yield* closed
        }
        if (Exit.isSuccess(exit) && left.length > 0) {
          return yield* Effect.die(new Error(`The case left in the shared context: ${[...new Set(left)].join("; ")}`))
        }
      })
    )
    // The finalizer precedes acquisition; interruption before an identity returns discards the whole connection.
    const options = { proxy: Option.none(), acceptInsecureCerts: false }
    if (fresh) context = yield* connection.adapter.createUserContext(options)
    else context = connection.context ??= yield* connection.adapter.createUserContext(options)
    page = yield* connection.adapter.createPage(context)
    return { adapter: connection.adapter, page, context, facts }
  })
  return { prepare, reset, page: open(false), freshPage: open(true) }
})

export class Shared extends Context.Service<Shared, Effect.Success<ReturnType<typeof make>>>()("engine/Shared") {}
