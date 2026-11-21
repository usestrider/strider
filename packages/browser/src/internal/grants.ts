/**
 * Permission grants and denials. L0's reset clears every setting in a context, so L1 keeps the grants and denials
 * in force in the context's state, which the model's fold writes, and recomputes on each change: a removal resets,
 * then sets what remains. For each origin and name, the latest declaration in force that covers it wins, whether it
 * names that origin or every origin. Chromium keeps a setting for one origin ahead of one for every origin, whichever
 * came later, so L1 sends what that rule resolves to (`resolve`), not each declaration in turn: a setting for every
 * origin also goes to each origin that has one of its own. Each name is set on its own, so a name a backend rejects
 * (Firefox's list is shorter) fails naming it.
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
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"

const origin = (input: string | undefined): Option.Option<string> | undefined => {
  if (input === undefined) return Option.none()
  const parsed = URL.parse(input)
  return parsed === null ? undefined : Option.some(parsed.origin)
}

const key = (origin: string, name: string) => JSON.stringify([origin, name])

/**
 * What declarations, oldest first, leave in force, one name per entry: for each name, the latest declaration for every
 * origin that names it; for each origin a declaration names, and each name, the latest declaration covering both.
 */
export const resolve = (grants: ReadonlyArray<Model.GrantEntry>): ReadonlyArray<Model.GrantEntry> => {
  const everywhere = new Map<string, Adapter.PermissionSetting>()
  const each = new Map<string, Model.GrantEntry>()
  for (const declaration of grants) {
    for (const name of declaration.permissions) {
      if (Option.isSome(declaration.origin)) {
        each.set(key(declaration.origin.value, name), {
          origin: declaration.origin,
          permissions: [name],
          setting: declaration.setting
        })
        continue
      }
      everywhere.set(name, declaration.setting)
      for (const [at, setting] of each) {
        if (setting.permissions[0] === name) each.set(at, { ...setting, setting: declaration.setting })
      }
    }
  }
  return [
    ...Array.from(everywhere, ([name, setting]) => ({ origin: Option.none(), permissions: [name], setting })),
    ...each.values()
  ]
}

export const grant = (
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  operation: string,
  setting: Adapter.PermissionSetting,
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
    const context = entry.id
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
    const grant: Model.GrantEntry = { origin: where, permissions: [...permissions], setting }
    const inForce = Effect.map(entry.state.get, (state) => state.grants)
    const apply = (grants: ReadonlyArray<Model.GrantEntry>) =>
      Effect.forEach(
        resolve(grants),
        (each) => adapter.grantPermissions(context, each.origin, each.permissions, each.setting),
        { discard: true }
      )
    // A declaration for every origin overrides the settings of origins of their own for its names too
    const overridden = Option.isSome(where) ? [] : resolve(yield* inForce).filter((each) =>
      Option.isSome(each.origin) && permissions.includes(each.permissions[0]!)
    )
    const sends = [
      ...permissions.map((name) => ({ origin: where, name, reported: true })),
      ...overridden.map((each) => ({ origin: each.origin, name: each.permissions[0]!, reported: false }))
    ]
    const scope = yield* Scope.fork(yield* Effect.scope)
    for (const send of sends) {
      yield* adapter.grantPermissions(context, send.origin, [send.name], setting).pipe(
        Effect.mapError((error) => mapped(error, send.reported ? send.name : undefined)),
        // What this call set goes again, with the declarations before it: cleanup, which the deadline doesn't end
        Effect.onError(() =>
          adapter.resetPermissions(context).pipe(
            Effect.andThen(Effect.flatMap(inForce, apply)),
            Effect.ignore,
            Effect.andThen(Scope.close(scope, Exit.void)),
            Operation.detached
          )
        )
      )
    }
    // What a removal sets again, after it resets; once this one is removed, the others
    yield* Scope.addFinalizer(
      scope,
      adapter.resetPermissions(context).pipe(
        Effect.andThen(Effect.flatMap(inForce, apply)),
        Effect.ignore,
        Operation.detached
      )
    )
    yield* runtime.model.grant(entry, grant).pipe(Scope.provide(scope))
    return { remove: Scope.close(scope, Exit.void) } satisfies Declaration.Registration
  }).pipe(Operation.named(operation, {
    attributes: { "browser.context.id": entry.id, "browser.permissions": permissions.join(",") }
  }))
