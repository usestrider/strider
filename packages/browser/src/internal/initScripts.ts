/**
 * Init scripts. L0 orders a world's scripts (the environment phase first, broader
 * scopes first, then registration order), which the probes confirm on every backend, so `after` never
 * reorders: it validates, a dependency in force and of equal or broader scope, and it gates, since L0 runs a
 * script only if each script it comes after ran in that document without throwing.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Declaration from "../Declaration.ts"
import type * as InitScript from "../InitScript.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

/** The isolated world of the caller's code: apart from the engine's, where `page.evaluate` will run too. */
export const isolatedWorld: Adapter.World = { _tag: "Isolated", name: "__strider_isolated__" }

export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly scope: Adapter.DeclarationScope
  /** `Page.addInitScript` or `UserContext.addInitScript`. */
  readonly operation: string
}

/** `Unsupported` where the backend can't run a script in a worker before the worker's own. */
export const inWorkers = (runtime: Runtime.Runtime): Effect.Effect<void, Reason.Unsupported> =>
  Effect.flatMap(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === "initScripts.workers")
    return entry === undefined || entry.status !== "unsupported" ? Effect.void : Effect.fail(
      new Reason.Unsupported({
        capability: "initScripts.workers",
        backend: runtime.backend,
        hint: entry.limitations.join("; ") || `${runtime.backend} can't run a script in a worker first`
      })
    )
  })

/** What a script of this library is: its registration, where, and whether it is still in force. */
interface Registered {
  readonly id: Adapter.RegistrationId
  readonly scope: Adapter.DeclarationScope
  readonly world: Adapter.World
  readonly workers: boolean
  live: boolean
}

const registered = new WeakMap<InitScript.InitScript, Registered>()

/** Whether a dependency's scope is equal to or broader than the dependent's, so it can outlive it. */
const covers = (dependency: Adapter.DeclarationScope, dependent: Adapter.DeclarationScope, context: string) =>
  dependency._tag === "Browser" ||
  (dependency._tag === "UserContext" && dependency.context === context) ||
  (dependency._tag === "Page" && dependent._tag === "Page" && dependency.page === dependent.page)

/** The script's source: a function is called, so it must be self-contained; a path is read now. */
const sourceOf = Effect.fnUntraced(function*(runtime: Runtime.Runtime, script: InitScript.Source) {
  if (typeof script === "function") return `(${script.toString()})();`
  if ("source" in script) return script.source
  if (Option.isNone(runtime.fileSystem) || Option.isNone(runtime.path)) {
    return yield* Effect.fail(
      new Reason.InvalidInput({
        input: "path",
        expected: "a script's source, where the layer has no FileSystem to read a path with",
        hint: "Provide a FileSystem and Path to the layer, or pass { source }"
      })
    )
  }
  const path = runtime.path.value.resolve(script.path)
  return yield* runtime.fileSystem.value.readFileString(path).pipe(
    Effect.mapError((error) =>
      new Reason.InvalidInput({ input: "path", expected: "a readable script", hint: `${path}: ${error.message}` })
    )
  )
})

export const add = (
  owner: Owner,
  context: string,
  script: InitScript.Source,
  options: InitScript.Options | undefined
): Effect.Effect<InitScript.InitScript, Declaration.DeclarationError | Target.TargetGone, Scope.Scope> =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const fail = (reason: Declaration.DeclarationErrorReason) =>
      new Declaration.DeclarationError({ declaration: owner.operation, reason, diagnostics: Operation.diagnostics(id) })
    const source = yield* sourceOf(owner.runtime, script).pipe(Effect.mapError(fail))
    const world: Adapter.World = options?.world === "isolated" ? isolatedWorld : { _tag: "Main" }
    const workers = options?.workers === true
    if (workers) {
      // A worker has one world, its own
      if (world._tag !== "Main") {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({
            input: "workers",
            expected: "a script in the main world",
            hint: "A worker has no isolated world"
          })
        ))
      }
      yield* inWorkers(owner.runtime).pipe(Effect.mapError(fail))
    }
    const after: Array<Adapter.RegistrationId> = []
    for (const dependency of options?.after ?? []) {
      const known = registered.get(dependency)
      if (known === undefined) {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({ input: "after", expected: "an init script of this library", hint: "It isn't one" })
        ))
      }
      if (!known.live) {
        return yield* Effect.fail(fail(
          new Declaration.DependencyReleased({ hint: `${known.id} was removed before this script was added` })
        ))
      }
      if (known.world._tag !== world._tag) {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({
            input: "after",
            expected: "a script in the same world",
            hint: `${known.id} runs in the ${known.world._tag === "Main" ? "main" : "isolated"} world`
          })
        ))
      }
      if (workers && !known.workers) {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({
            input: "after",
            expected: "a script that runs in workers too",
            hint: `${known.id} runs in documents only, so this one would never run in a worker`
          })
        ))
      }
      if (!covers(known.scope, owner.scope, context)) {
        return yield* Effect.fail(fail(
          new Reason.InvalidInput({
            input: "after",
            expected: "a script of equal or broader scope, which outlives this one",
            hint: `${known.id} belongs to another page or context, or a page of this context`
          })
        ))
      }
      after.push(known.id)
    }
    const scope = yield* Scope.fork(yield* Effect.scope)
    const registration = yield* owner.runtime.model.adapter.declare(owner.scope, {
      _tag: "InitScript",
      source,
      world,
      phase: "user",
      workers,
      timing: options?.timing ?? "beforeAuthorScript",
      after
    }).pipe(
      Scope.provide(scope),
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, owner.runtime.backend)
        // A target that went is TargetGone, as for every operation on it (QUIRKS.md, Q143)
        return mapped._tag === "Gone" ? mapped.error : fail(mapped.reason)
      }),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    const handle: InitScript.InitScript = {
      id: registration as unknown as InitScript.Id,
      remove: Scope.close(scope, Exit.void)
    }
    const entry: Registered = { id: registration, scope: owner.scope, world, workers, live: true }
    registered.set(handle, entry)
    // Its dependents stop with it: L0 runs a script only after what it comes after ran
    yield* Scope.addFinalizer(scope, Effect.sync(() => (entry.live = false)))
    return handle
  }).pipe(Operation.named(owner.operation, {
    attributes: { ...Spans.scopeAttributes(owner.scope), "browser.initScript.world": options?.world ?? "main" }
  }))
