/**
 * Permission grants. L0's reset clears every grant in a context, so L1 keeps the grants
 * in force per context and recomputes on each change: a removal resets, then grants what remains. Each name is
 * granted on its own, so a name a backend rejects (Firefox's list is shorter) fails naming it.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import * as Declaration from "../Declaration.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

interface Grant {
  readonly origin: Option.Option<string>
  readonly permissions: ReadonlyArray<string>
}

/** The grants in force, per context. */
const contexts = new Map<UserContext.Id, Array<Grant>>()

const origin = (input: string | undefined): Option.Option<string> | undefined => {
  if (input === undefined) return Option.none()
  try {
    return Option.some(new URL(input).origin)
  } catch {
    return undefined
  }
}

export const grant = (
  runtime: Runtime.Runtime,
  context: UserContext.Id,
  operation: string,
  permissions: ReadonlyArray<UserContext.Permission>,
  options: UserContext.GrantOptions | undefined
): Effect.Effect<
  Declaration.Registration,
  Declaration.DeclarationError | Target.TargetGone | Deadline.Timeout,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const { id } = yield* Operation.record
    const adapter = runtime.model.adapter
    const fail = (reason: Declaration.DeclarationErrorReason) =>
      new Declaration.DeclarationError({ declaration: operation, reason, diagnostics: Operation.diagnostics(id) })
    const where = origin(options?.origin)
    if (where === undefined) {
      return yield* Effect.fail(fail(
        new Reason.InvalidInput({
          input: "origin",
          expected: "an origin, such as https://maps.example.com",
          hint: `${options?.origin} isn't one`
        })
      ))
    }
    const mapped = (error: Parameters<typeof Operation.fromAdapter>[0], name?: string) => {
      const failure = Operation.fromAdapter(error, id, runtime.backend)
      // A context that went is TargetGone, as for every operation on it (QUIRKS.md, Q143); the deadline, Timeout
      if (failure._tag !== "Reason") return failure.error
      // A name the browser doesn't know is the caller's to fix
      return fail(
        name !== undefined && failure.reason._tag === "BackendFailure"
          ? new Reason.InvalidInput({
            input: "permissions",
            expected: `a permission ${runtime.backend} knows`,
            hint: `${name}: ${failure.reason.hint}`
          })
          : failure.reason
      )
    }
    const list = contexts.get(context) ?? []
    contexts.set(context, list)
    const entry: Grant = { origin: where, permissions: [...permissions] }
    const apply = (grants: ReadonlyArray<Grant>) =>
      Effect.forEach(grants, (each) => adapter.grantPermissions(context, each.origin, each.permissions), {
        discard: true
      })
    const scope = yield* Scope.fork(yield* Effect.scope)
    for (const name of permissions) {
      yield* adapter.grantPermissions(context, where, [name]).pipe(
        Effect.mapError((error) => mapped(error, name)),
        // What this call granted goes again, with the grants before it: cleanup, which the deadline doesn't end
        Effect.onError(() =>
          adapter.resetPermissions(context).pipe(
            Effect.andThen(apply(list)),
            Effect.ignore,
            Effect.andThen(Scope.close(scope, Exit.void)),
            Operation.detached
          )
        )
      )
    }
    list.push(entry)
    yield* Scope.addFinalizer(
      scope,
      Effect.suspend(() => {
        const index = list.indexOf(entry)
        if (index >= 0) list.splice(index, 1)
        if (list.length === 0) contexts.delete(context)
        return adapter.resetPermissions(context).pipe(Effect.andThen(apply(list)), Effect.ignore, Operation.detached)
      })
    )
    return { remove: Scope.close(scope, Exit.void) } satisfies Declaration.Registration
  }).pipe(Operation.named(operation, {
    attributes: { "browser.context.id": context, "browser.permissions": permissions.join(",") }
  }))
