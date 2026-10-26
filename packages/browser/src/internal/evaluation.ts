/**
 * Evaluation in a page's documents (review 18, candidate 1). A function crosses as its source; its arguments
 * and its result cross by value through the serializer review 14 built for workers, or the result stays where it
 * is, as a handle the caller's scope owns.
 *
 * - **`page.evaluate`** calls in the isolated world for the caller's code, `__strider_isolated__`, which
 *   isolated init scripts share, in the page's current document. `evaluateInMainWorld` calls in the page's own
 *   world, with user activation inside `Page.withUserGesture`.
 * - **A document that ends before the call** is no failure: nothing ran, so the call goes to the new one. One
 *   that ends during it is `TargetGone`, since the function may have run partly, and nothing runs it again.
 * - **A handle** is a remote object in one realm, released by `release` or when its scope closes, once.
 *   A primitive result has no remote object, and its handle holds the value. A scope's handles in a realm are
 *   one object group, which its close releases in one command (review 22, QUIRKS.md, Q132).
 */
import * as Effect from "effect/Effect"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import { pipeArguments } from "effect/Pipeable"
import * as Scope from "effect/Scope"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import * as JSHandle from "../JSHandle.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import { isolatedWorld } from "./initScripts.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import * as Serialization from "./serialization.ts"
import * as Spans from "./spans.ts"

export { isolatedWorld }

/** The reasons an evaluation fails with, before a module names the operation in its own error. */
export type EvaluationReason =
  | Reason.EvaluationThrown
  | Reason.NotSerializable
  | Reason.Unsupported
  | Reason.BackendFailure
  | Reason.PromptBlocking

/** Why an evaluation didn't produce a value. */
export type Failure =
  | { readonly _tag: "Gone"; readonly error: Target.TargetGone }
  | { readonly _tag: "Reason"; readonly reason: EvaluationReason }
  | { readonly _tag: "Deadline" }

/** An exception's name and message, from the text the browser gives (`Uncaught TypeError: boom`). */
export const exception = (result: Extract<Adapter.RemoteResult, { readonly _tag: "Exception" }>) => {
  // Chromium's text ends with the stack, which `stack` has
  const text = result.text.replace(/^Uncaught (\(in promise\) )?/, "").replace(/\n\s+at [\s\S]*$/, "")
  const colon = text.indexOf(": ")
  const named = colon > 0 && /^[A-Za-z_$][\w$]*$/.test(text.slice(0, colon))
  return {
    name: named ? text.slice(0, colon) : "Error",
    message: named ? text.slice(colon + 2) : text,
    stack: result.stack
  }
}

const notSerializable = (error: Serialization.Unserializable): Failure => ({
  _tag: "Reason",
  reason: new Reason.NotSerializable({ path: error.path, hint: error.hint })
})

/** What a handle stands for in a call: its remote object, or the primitive it holds. */
export const localOf = (handle: HandleImpl<unknown>): Adapter.LocalValue =>
  handle.value.type !== "undefined" && "handle" in handle.value && handle.value.handle !== undefined
    ? { _tag: "Handle", handle: handle.value.handle }
    : { _tag: "Value", value: handle.value }

/**
 * The arguments as local values. A handle crosses as itself into its own realm; anything else crosses by value,
 * and the first that can't fails with the path to it.
 */
export const toLocal = (
  args: ReadonlyArray<unknown>,
  realm: Target.RealmId,
  offset = 0
): Effect.Effect<ReadonlyArray<Adapter.LocalValue>, Failure> =>
  Effect.suspend(() => {
    const values: Array<Adapter.LocalValue> = []
    for (const [index, arg] of args.entries()) {
      const path = `args[${index + offset}]`
      if (arg instanceof HandleImpl) {
        if (arg.realm !== realm) {
          return Effect.fail<Failure>({
            _tag: "Reason",
            reason: new Reason.NotSerializable({
              path,
              hint: "A handle crosses only into its own realm; read its value, or evaluate in the handle's realm"
            })
          })
        }
        if (arg.released) return Effect.die(new Error("A JSHandle was used after it was released"))
        values.push(localOf(arg))
        continue
      }
      try {
        values.push({ _tag: "Value", value: Serialization.toRemote(arg, path) })
      } catch (error) {
        if (!(error instanceof Serialization.Unserializable)) throw error
        return Effect.fail(notSerializable(error))
      }
    }
    return Effect.succeed(values)
  })

/** A result by value, as a JavaScript value. */
export const fromRemote = (value: Adapter.RemoteValue): Effect.Effect<unknown, Failure> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(Serialization.fromRemote(value))
    } catch (error) {
      if (!(error instanceof Serialization.Unserializable)) throw error
      return Effect.fail(notSerializable(error))
    }
  })

export interface Call {
  readonly realm: Target.RealmId
  readonly functionDeclaration: string
  readonly arguments: ReadonlyArray<Adapter.LocalValue>
  readonly result: "value" | "handle"
  /** The object group a handle result joins (`groupOf`). */
  readonly group?: string | undefined
  readonly userActivation: boolean
  /** The page whose dialogs can pause the call: one nothing will decide fails it at once. */
  readonly page: Option.Option<Model.PageEntry>
  readonly at: MonotonicInstant.MonotonicInstant
  readonly id: Diagnostics.OperationId
}

/** Calls a function in a realm, until the deadline: its result, or why there is none. */
export const call = (runtime: Runtime.Runtime, options: Call): Effect.Effect<Adapter.RemoteValue, Failure> =>
  Effect.gen(function*() {
    const evaluated = runtime.model.adapter.evaluate(options.realm, {
      functionDeclaration: options.functionDeclaration,
      arguments: options.arguments,
      awaitPromise: true,
      result: options.result,
      ...(options.group === undefined ? {} : { group: options.group }),
      userActivation: options.userActivation
    }).pipe(
      Effect.mapError((error): Failure => Operation.fromAdapter(error, options.id, runtime.backend)),
      Effect.timeoutOption(Operation.millisLeft(options.at)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail<Failure>({ _tag: "Deadline" }),
        onSome: Effect.succeed
      }))
    )
    const result = yield* Option.match(options.page, {
      onNone: () => evaluated,
      onSome: (page) =>
        Effect.raceFirst(
          evaluated,
          Effect.mapError(Runtime.promptBlocked(page), (failure): Failure =>
            failure._tag === "Reason" ? failure : { _tag: "Deadline" })
        )
    })
    if (result._tag === "Exception") {
      return yield* Effect.fail<Failure>({
        _tag: "Reason",
        reason: new Reason.EvaluationThrown({
          exception: exception(result),
          hint: "The function threw, or returned a promise that rejected"
        })
      })
    }
    return result.value
  })

/**
 * The realm of a world in a page's current document. A document that ends before the realm is found is
 * followed to the next one: nothing ran in it.
 */
export const pageRealm = (
  runtime: Runtime.Runtime,
  page: Model.PageEntry,
  world: Adapter.World,
  id: Diagnostics.OperationId,
  at: MonotonicInstant.MonotonicInstant
): Effect.Effect<Target.RealmId, Failure> =>
  Effect.gen(function*() {
    while (true) {
      if (Operation.millisLeft(at) <= 0) return yield* Effect.fail<Failure>({ _tag: "Deadline" })
      const open = yield* Runtime.openState(page, id).pipe(
        Effect.timeoutOption(Operation.millisLeft(at)),
        Effect.mapError((failure): Failure => failure._tag === "Gone" ? failure : { _tag: "Deadline" }),
        Effect.flatMap(
          Option.match({ onNone: () => Effect.fail<Failure>({ _tag: "Deadline" }), onSome: Effect.succeed })
        )
      )
      const realm = yield* runtime.model.adapter.realm(open.document.id, world).pipe(
        Effect.map(Option.some),
        Effect.catch((error) => {
          const reason = error.reason
          if (reason._tag === "Gone" && (reason.target._tag === "Document" || reason.target._tag === "Realm")) {
            return Effect.succeed(Option.none<Target.RealmId>())
          }
          return Effect.fail<Failure>(Operation.fromAdapter(error, id, runtime.backend))
        })
      )
      if (Option.isSome(realm)) return realm.value
    }
  })

/** The realm of a world in one document. */
export const documentRealm = (
  runtime: Runtime.Runtime,
  document: Target.DocumentId,
  world: Adapter.World,
  id: Diagnostics.OperationId
): Effect.Effect<Target.RealmId, Failure> =>
  runtime.model.adapter.realm(document, world).pipe(
    Effect.mapError((error): Failure => Operation.fromAdapter(error, id, runtime.backend))
  )

// ── Handles ───────────────────────────────────────────────────────────────────────────────────────────────

const TypeId = "~@usestrider/browser/JSHandle"

const handleError = (operation: string, reason: JSHandle.JSHandleErrorReason, id: Diagnostics.OperationId) =>
  new JSHandle.JSHandleError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** A handle operation's failure, as the handle's error, its realm's end, or the deadline. */
const asHandleFailure = (operation: string, id: Diagnostics.OperationId, budget: Operation.Budget) =>
(
  failure: Failure
) =>
  failure._tag === "Gone"
    ? failure.error
    : failure._tag === "Deadline"
    ? Operation.timeout({
      operation,
      id,
      phase: "dispatchedUnconfirmed",
      budget: budget.budget,
      history: [],
      hint: Option.some("The realm didn't answer before the deadline; the function may still be running"),
      dispatch: { _tag: "MayHaveBeenSent" }
    })
    : failure.reason._tag === "PromptBlocking"
    // A handle's operations have no `PromptBlocking`: a dialog nothing decides holds the realm as a failure would
    ? handleError(
      operation,
      new Reason.BackendFailure({ kind: "Rejected", method: operation, metadata: {}, hint: failure.reason.message }),
      id
    )
    : handleError(operation, failure.reason, id)

/** A handle: a remote object in one realm, or a primitive held here; released once. */
export class HandleImpl<A> implements JSHandle.JSHandle<A> {
  readonly [TypeId] = TypeId as typeof TypeId
  readonly realm: Target.RealmId
  readonly value: Adapter.RemoteValue
  readonly runtime: Runtime.Runtime
  readonly page: Option.Option<Model.PageEntry>
  released = false
  constructor(
    runtime: Runtime.Runtime,
    realm: Target.RealmId,
    value: Adapter.RemoteValue,
    page: Option.Option<Model.PageEntry>
  ) {
    this.runtime = runtime
    this.realm = realm
    this.value = value
    this.page = page
  }

  get remote(): Option.Option<Adapter.HandleId> {
    return "handle" in this.value && this.value.handle !== undefined ? Option.some(this.value.handle) : Option.none()
  }

  private run<B, R>(
    operation: string,
    fn: Function,
    args: ReadonlyArray<unknown>,
    result: "value" | "handle",
    then: (value: Adapter.RemoteValue) => Effect.Effect<B, Failure, R>
  ): Effect.Effect<B, JSHandle.JSHandleError | Target.TargetGone | Deadline.Timeout, R> {
    return Effect.gen({ self: this }, function*() {
      if (this.released) return yield* Effect.die(new Error(`${operation}: the handle was released`))
      const id = Operation.operationId()
      const budget = yield* Operation.budget
      const group = yield* groupFor(this.runtime, this.realm, result)
      return yield* Effect.gen({ self: this }, function*() {
        const rest = yield* toLocal(args, this.realm, 1)
        const value = yield* call(this.runtime, {
          realm: this.realm,
          functionDeclaration: fn.toString(),
          arguments: [localOf(this as HandleImpl<unknown>), ...rest],
          result,
          group,
          userActivation: false,
          page: this.page,
          at: budget.at,
          id
        })
        return yield* then(value)
      }).pipe(Effect.mapError(asHandleFailure(operation, id, budget)))
    }).pipe(Spans.operation(operation, { attributes: { "browser.realm.id": this.realm } }))
  }

  evaluate<Args extends ReadonlyArray<unknown>, B>(fn: (value: A, ...args: Args) => B | Promise<B>, ...args: Args) {
    return this.run("JSHandle.evaluate", fn, args, "value", fromRemote) as Effect.Effect<
      JSHandle.Serialized<B>,
      JSHandle.JSHandleError | Target.TargetGone | Deadline.Timeout
    >
  }

  evaluateHandle<Args extends ReadonlyArray<unknown>, B>(
    fn: (value: A, ...args: Args) => B | Promise<B>,
    ...args: Args
  ) {
    return this.run(
      "JSHandle.evaluateHandle",
      fn,
      args,
      "handle",
      (value) => own<Awaited<B>>(this.runtime, this.realm, value, this.page)
    )
  }

  /** The value, read in its realm, which says whether the realm is still there. */
  get read() {
    return this.run("JSHandle.read", (value: unknown) => value, [], "value", fromRemote) as Effect.Effect<
      JSHandle.Serialized<A>,
      JSHandle.JSHandleError | Target.TargetGone | Deadline.Timeout
    >
  }

  get release(): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.released) return Effect.void
      this.released = true
      return Option.match(this.remote, {
        onNone: () => Effect.void,
        onSome: (handle) => this.runtime.model.adapter.releaseHandles([handle])
      })
    })
  }

  pipe() {
    return pipeArguments(this, arguments)
  }
  toString() {
    return `JSHandle(${this.realm} ${this.value.type})`
  }
  toJSON() {
    return { _id: "JSHandle", realm: this.realm, type: this.value.type }
  }
  [Inspectable.NodeInspectSymbol]() {
    return this.toJSON()
  }
}

/** A scope's handles in one realm: an object group, released together as the scope closes (review 22, Q132). */
export interface Group {
  readonly name: string
  readonly handles: Set<HandleImpl<unknown>>
}

const groups = new WeakMap<Scope.Scope, Map<Target.RealmId, Group>>()
let made = 0

/** The group of a scope's handles in a realm, made with the finalizer that releases them in one command. */
export const groupOf = (runtime: Runtime.Runtime, scope: Scope.Scope, realm: Target.RealmId): Effect.Effect<Group> =>
  Effect.suspend(() => {
    let realms = groups.get(scope)
    if (realms === undefined) {
      realms = new Map()
      groups.set(scope, realms)
    }
    const found = realms.get(realm)
    if (found !== undefined) return Effect.succeed(found)
    const group: Group = { name: `strider-${++made}`, handles: new Set() }
    const own = realms
    own.set(realm, group)
    return Scope.addFinalizer(
      scope,
      Effect.suspend(() => {
        own.delete(realm)
        const remote: Array<Adapter.HandleId> = []
        for (const handle of group.handles) {
          if (handle.released) continue
          handle.released = true
          remote.push(...Option.toArray(handle.remote))
        }
        return remote.length === 0 ? Effect.void : runtime.model.adapter.releaseHandles(remote)
      })
    ).pipe(Effect.as(group))
  })

/** The group a call's handle result joins: its scope's in the realm, where it asks for a handle. */
export const groupFor = (
  runtime: Runtime.Runtime,
  realm: Target.RealmId,
  result: "value" | "handle"
): Effect.Effect<string | undefined> =>
  result === "value" ?
    Effect.undefined :
    Effect.flatMap(Effect.serviceOption(Scope.Scope), (scope) =>
      Option.match(scope, {
        onNone: () => Effect.undefined,
        onSome: (scope) => Effect.map(groupOf(runtime, scope, realm), (group) => group.name)
      }))

/** A handle for a result, released with its group when the caller's scope closes. */
export const own = <A>(
  runtime: Runtime.Runtime,
  realm: Target.RealmId,
  value: Adapter.RemoteValue,
  page: Option.Option<Model.PageEntry>
): Effect.Effect<JSHandle.JSHandle<A>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const handle = new HandleImpl<A>(runtime, realm, value, page)
    const group = yield* groupOf(runtime, yield* Effect.scope, realm)
    group.handles.add(handle as HandleImpl<unknown>)
    return handle
  })
