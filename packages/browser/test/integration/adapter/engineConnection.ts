/** Shared raw-engine connection; pages, facts and waiters belong to one case only. */
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
}

export const make = Effect.fnUntraced(function*(backend: Backend) {
  const services = yield* Effect.context<Requirements>()
  let held: Held | undefined
  let active: ReturnType<typeof recorder> | undefined

  const reset = Effect.suspend(() => {
    const previous = held
    held = undefined
    return previous === undefined ? Effect.void : Scope.close(previous.scope, Exit.void)
  })
  yield* Effect.addFinalizer(() => reset)

  // Called only from a setup hook: body-created transports keep their creator's failure-trace attribution.
  const prepare = Effect.gen(function*() {
    if (held !== undefined) return
    const scope = yield* Scope.make()
    const token = {}
    const result = yield* backend.connect((fact) =>
      held?.token !== token || active === undefined ? Effect.void : active.sink(fact)
    ).pipe(
      Scope.provide(scope),
      Effect.provide(services),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    held = { adapter: result.adapter, scope, token }
  })

  const page = Effect.gen(function*() {
    const connection = held
    if (connection === undefined) {
      return yield* Effect.die(new Error("Raw engine connection was not prepared in a hook"))
    }
    if (active !== undefined) return yield* Effect.die(new Error("Raw engine cases must run serially"))
    const facts = recorder()
    active = facts
    let context: UserContext.Id | undefined
    let page: Target.NavigableId | undefined

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function*() {
        const cleaned = yield* Effect.exit(
          Effect.gen(function*() {
            if (page !== undefined) {
              yield* connection.adapter.closePage(page, { runBeforeUnload: false })
              yield* facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            }
            if (context !== undefined) {
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
      })
    )
    // The finalizer precedes acquisition; interruption before an identity returns discards the whole connection.
    context = yield* connection.adapter.createUserContext({
      proxy: Option.none(),
      acceptInsecureCerts: false
    })
    page = yield* connection.adapter.createPage(context)
    return { adapter: connection.adapter, page, context, facts }
  })
  return { prepare, reset, page }
})

export class Shared extends Context.Service<Shared, Effect.Success<ReturnType<typeof make>>>()("engine/Shared") {}
