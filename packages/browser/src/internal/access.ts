/**
 * Access held by a scope (review 19, candidate 2; CONCEPTS.md §3). A page the connection created, or one in a
 * context it created, is controlled for its whole life. Any other page is observed, and `inspect` or `control`
 * acquires a grant in the caller's scope: while it lives, the handle it made can do what its level allows; once
 * the scope closes, every member above observe fails with `TargetGone{AccessReleased}`, and the declarations made
 * through the handle are removed with it, whichever scope they were made in.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as Declaration from "../Declaration.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import * as Operation from "./operation.ts"

/** A grant of access to a page or a context, for the scope that acquired it. */
export interface Grant {
  readonly level: "inspect" | "control"
  readonly target: Target.Description
  /** Whether its scope has closed. */
  readonly released: () => boolean
  /** Runs `finalizer` when the grant is released, or now if it already was. */
  readonly onRelease: (finalizer: Effect.Effect<void>) => Effect.Effect<void>
}

/** A grant, released when the caller's scope closes: its finalizers run, the latest first. */
export const acquire = (
  level: Grant["level"],
  target: Target.Description
): Effect.Effect<Grant, never, Scope.Scope> =>
  Effect.gen(function*() {
    let released = false
    const finalizers: Array<Effect.Effect<void>> = []
    const grant: Grant = {
      level,
      target,
      released: () => released,
      onRelease: (finalizer) =>
        Effect.suspend(() => {
          if (released) return finalizer
          finalizers.push(finalizer)
          return Effect.void
        })
    }
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        released = true
        return Effect.forEach(finalizers.splice(0).reverse(), (finalizer) => Effect.ignore(finalizer), {
          discard: true
        })
      })
    )
    return grant
  })

/** Fails with `TargetGone{AccessReleased}` once the grant is released; nothing for a handle with no grant. */
export const check = (grant: Option.Option<Grant>): Effect.Effect<void, Target.TargetGone> =>
  Effect.suspend(() =>
    Option.isSome(grant) && grant.value.released()
      ? Effect.fail(
        new Target.TargetGone({
          target: grant.value.target,
          reason: { _tag: "AccessReleased" },
          diagnostics: Operation.diagnostics(Operation.operationId())
        })
      )
      : Effect.void
  )

/** A declaration made through a granted handle, removed with the grant too. */
export const track = <R extends Declaration.Registration>(grant: Option.Option<Grant>) => (registration: R) =>
  Option.isSome(grant)
    ? Effect.as(grant.value.onRelease(registration.remove), registration)
    : Effect.succeed(registration)

/** Why a released grant refuses a member whose errors have no `TargetGone`: its module's `NotPermitted`. */
export const releasedReason = (grant: Grant): Reason.NotPermitted =>
  new Reason.NotPermitted({
    required: grant.level,
    hint: "The access was released with the scope that acquired it; acquire it again with inspect or control"
  })

/** Fails with `refuse`'s error once the grant is released; for members whose errors have no `TargetGone`. */
export const checkOr = <E>(
  grant: Option.Option<Grant>,
  refuse: (reason: Reason.NotPermitted) => E
): Effect.Effect<void, E> =>
  Effect.suspend(() =>
    Option.isSome(grant) && grant.value.released() ? Effect.fail(refuse(releasedReason(grant.value))) : Effect.void
  )

/** How a handle's members are guarded, by name; a sub-handle's are named after it, as `clock.install`. */
export interface Members {
  /** Members that need no grant: what observing gives. */
  readonly observed: ReadonlySet<string>
  /** Members that make a declaration, removed with the grant. */
  readonly declarations: ReadonlySet<string>
  /** Members whose errors have no `TargetGone`: the error a released grant fails them with, given its arguments. */
  readonly refusals: Readonly<Record<string, (reason: Reason.NotPermitted, args: ReadonlyArray<unknown>) => unknown>>
}

/**
 * A handle's members, guarded: each effect, and each effect a member returns, checks the grant first, and a
 * declaration it makes is tracked; observed members are left as they are, and sub-handles are guarded the same
 * way. Locators carry the grant in their owner, so they check it themselves.
 */
export const guard = <A extends object>(handle: A, grant: Grant, members: Members, prefix = ""): A => {
  const wrap = (value: unknown, name: string, args: ReadonlyArray<unknown>): unknown => {
    if (!Effect.isEffect(value)) return value
    const refuse = members.refusals[name]
    const checked = Effect.andThen(
      refuse === undefined ? check(Option.some(grant)) : checkOr(Option.some(grant), (reason) => refuse(reason, args)),
      value
    )
    return members.declarations.has(name)
      ? Effect.flatMap(checked, (registration) => track(Option.some(grant))(registration as Declaration.Registration))
      : checked
  }
  const out: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(handle)) {
    const descriptor = Object.getOwnPropertyDescriptor(handle, key)!
    const name = typeof key === "symbol" ? "" : `${prefix}${key}`
    if (typeof key === "symbol" || members.observed.has(name)) {
      Object.defineProperty(out, key, descriptor)
      continue
    }
    if (descriptor.get !== undefined) {
      const get = descriptor.get
      Object.defineProperty(out, key, { ...descriptor, get: () => wrap(get.call(handle), name, []) })
      continue
    }
    const value = descriptor.value
    if (typeof value === "function") {
      out[key] = (...args: ReadonlyArray<unknown>) => wrap(value.apply(handle, args), name, args)
    } else if (Effect.isEffect(value)) {
      out[key] = wrap(value, name, [])
    } else if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      out[key] = guard(value as object, grant, members, `${name}.`)
    } else {
      out[key] = value
    }
  }
  return out as A
}
