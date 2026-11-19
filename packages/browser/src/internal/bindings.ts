/**
 * Host bindings: `window[name](...)` in a page's documents, answered by a host handler.
 *
 * A binding is an init script that carries a host transport of its own, the same one WebSocket routing uses: a CDP
 * `Runtime.addBinding`, a BiDi `script.channel`, or WebKit console messages marked with the binding's token. The
 * adapter opts in only the targets the declaration covers, so a context without a binding gets none of it.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Binding from "../Binding.ts"
import * as Deadline from "../Deadline.ts"
import * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Handlers from "./handlers.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import * as Serialization from "./serialization.ts"

/** The page side. This function is serialized; it must not close over host code. */
export const install = (name: string, bridge: string, token: string, transport: string) => {
  const global = globalThis as any
  const key = global.Symbol.for("strider.binding." + token)
  if (global[key] !== undefined) return
  const P = global.Promise
  const E = global.Error
  const stringify = global.JSON.stringify.bind(global.JSON)
  const debug = global.console.debug.bind(global.console)
  const send = (payload: string) =>
    transport === "console" ? debug({ __striderWebSocket: token, payload }) : global[bridge](payload)
  // A call's arguments wait here until the host reads them by value, as an evaluation's result.
  let unread = 0
  const pending = new Map<
    number,
    { args: unknown; taken: boolean; resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >()
  let next = 0
  let live = true
  const call = (...args: Array<unknown>) =>
    new P((resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
      if (!live) return reject(new E(`Binding "${name}" was removed`))
      if (pending.size >= 4096) {
        return reject(new E(`Binding "${name}" has 4096 calls waiting for their answer; await some first`))
      }
      const id = ++next
      pending.set(id, { args, taken: false, resolve, reject })
      // One notice when the document's unread calls go from none to some: a read takes them all
      if (unread++ === 0) send(stringify({}))
    })
  global.Object.defineProperty(global, name, { value: call, configurable: true, writable: true })
  global.Object.defineProperty(global, key, {
    configurable: true,
    value: {
      // Every call not yet read, as [id, arguments] pairs: one read answers a burst of calls.
      drain: () => {
        const calls: Array<[number, unknown]> = []
        for (const [id, waiting] of pending) {
          if (waiting.taken) continue
          waiting.taken = true
          calls.push([id, waiting.args])
          waiting.args = undefined
        }
        unread = 0
        return calls
      },
      settle: (id: number, ok: boolean, value: unknown) => {
        const waiting = pending.get(id)
        if (waiting === undefined) return
        pending.delete(id)
        if (ok) waiting.resolve(value)
        else waiting.reject(new E(value))
      },
      remove: () => {
        live = false
        unread = 0
        if (global[name] === call) delete global[name]
        for (const waiting of pending.values()) waiting.reject(new E(`Binding "${name}" was removed`))
        pending.clear()
      }
    }
  })
}

const source = (name: string, bridge: string, token: string, transport: string) =>
  `(${install.toString()})(${[name, bridge, token, transport].map((value) => JSON.stringify(value)).join(",")});`

const keyOf = (token: string) => `globalThis[Symbol.for(${JSON.stringify("strider.binding." + token)})]`

/** The names exposed in a context, by the context or by one of its pages. */
const exposed = new WeakMap<Model.ContextEntry, { context: Set<string>; pages: Map<Target.NavigableId, Set<string>> }>()

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === "string" ? error : String(error)

export const expose = <A extends ReadonlyArray<unknown>, B, E, R>(
  runtime: Runtime.Runtime,
  context: Model.ContextEntry,
  page: Model.PageEntry | undefined,
  name: string,
  schemas: Binding.Schemas<A, B>,
  handler: Binding.Handler<A, B, E, R>
): Effect.Effect<Binding.Registration, Binding.BindingError | Target.TargetGone | Deadline.Timeout, Scope.Scope | R> =>
  Effect.gen(function*() {
    const fail = (reason: Binding.BindingErrorReason) =>
      new Binding.BindingError({ name, reason, diagnostics: Operation.diagnosticsNow() })
    const record = yield* Operation.record
    const adapter = runtime.model.adapter
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      return yield* Effect.fail(
        fail(new Reason.InvalidInput({ input: "name", expected: "a JavaScript identifier", hint: name }))
      )
    }
    let names = exposed.get(context)
    if (names === undefined) {
      names = { context: new Set(), pages: new Map() }
      exposed.set(context, names)
    }
    const taken: "page" | "context" | undefined = names.context.has(name)
      ? "context"
      : page === undefined
      ? ([...names.pages.values()].some((set) => set.has(name)) ? "page" : undefined)
      : names.pages.get(page.id)?.has(name)
      ? "page"
      : undefined
    if (taken !== undefined) return yield* Effect.fail(fail(new Binding.NameTaken({ name, by: taken })))
    const owned = page === undefined ? names.context : (() => {
      let set = names.pages.get(page.id)
      if (set === undefined) names.pages.set(page.id, set = new Set())
      return set
    })()
    owned.add(name)
    const services = yield* Effect.context<R>()
    const environment = yield* Effect.context<never>()
    const budget = yield* Deadline.DefaultBudget
    const clock = yield* BrowserClock.CurrentClock
    const scope = yield* Scope.fork(yield* Effect.scope)
    const bridgeScope = yield* Scope.fork(scope)
    const token = crypto.randomUUID()
    const bridgeName = `__strider_binding_${token.replaceAll("-", "")}`
    const transport = adapter.info.protocol === "webkit" ? "console" : "binding"
    const script = source(name, bridgeName, token, transport)
    const mapped = (error: Adapter.AdapterError | Deadline.Timeout) => {
      const failure = Operation.fromAdapter(error, record.id, runtime.backend)
      return failure._tag === "Reason" ? fail(failure.reason as Binding.BindingErrorReason) : failure.error
    }
    let live = true
    interface Call {
      readonly realm: Target.RealmId
      readonly payload: Effect.Effect<string, Adapter.AdapterError>
      readonly source: Binding.Source
      readonly ownership: { readonly isAlive: () => boolean; readonly release?: Effect.Effect<void> | undefined }
    }
    // Calls whose answer hasn't been settled. Each document bounds its own (`install`), so none is refused here.
    const calls = new Set<Call>()
    const incoming = yield* Queue.unbounded<Call>()
    const settle = (realm: Target.RealmId, id: number, ok: boolean, value: unknown) => {
      let remote: Adapter.RemoteValue
      try {
        remote = Serialization.toRemote(value, "result")
      } catch (error) {
        if (!(error instanceof Serialization.Unserializable)) throw error
        ok = false
        remote = { type: "string", value: new Reason.NotSerializable({ path: error.path, hint: error.hint }).message }
      }
      return adapter.evaluate(realm, {
        functionDeclaration: `(id, ok, value) => { ${keyOf(token)}?.settle(id, ok, value) }`,
        arguments: [
          { _tag: "Value", value: { type: "number", value: id } },
          { _tag: "Value", value: { type: "boolean", value: ok } },
          { _tag: "Value", value: remote }
        ],
        awaitPromise: false,
        result: "value",
        userActivation: false
      }).pipe(Effect.asVoid)
    }
    const failed = `Binding "${name}" handler failed`
    const notSerializable = (error: Serialization.Unserializable) =>
      new Reason.NotSerializable({ path: error.path, hint: error.hint }).message
    // Every exit of a call it has an id for settles the page's promise: a rejection carries a failure's message, and
    // anything else, a defect or an interruption, the fixed one, after it is logged.
    // Reads every call the document has not yet handed over, by value, and answers each one.
    const drainAll = Effect.fnUntraced(function*(realm: Target.RealmId, source: Binding.Source) {
      const read = yield* adapter.evaluate(realm, {
        functionDeclaration: `() => ${keyOf(token)}?.drain() ?? []`,
        arguments: [],
        awaitPromise: false,
        result: "value",
        releaseResult: true,
        userActivation: false
      })
      if (read._tag === "Exception") return yield* Effect.die(new Error(read.text))
      for (const entry of read.value.type === "array" ? read.value.value ?? [] : []) {
        const pair = entry.type === "array" ? entry.value ?? [] : []
        const first = pair[0]
        if (first?.type !== "number") continue
        yield* answer(realm, Number(first.value), pair[1] ?? { type: "undefined" }, source).pipe(Effect.forkIn(scope))
      }
    })
    const answer = (realm: Target.RealmId, id: number, remote: Adapter.RemoteValue, source: Binding.Source) =>
      Effect.gen(function*() {
        const read = { value: remote }
        // As in an evaluation's arguments, a function or symbol is refused where it is an argument itself
        const items = read.value.type === "array" ? read.value.value ?? [] : []
        const refused = items.findIndex((item) => item.type === "function" || item.type === "symbol")
        if (refused !== -1) {
          return yield* settle(
            realm,
            id,
            false,
            notSerializable(
              new Serialization.Unserializable(`args[${refused}]`, `A ${items[refused]!.type} can't cross by value`)
            )
          )
        }
        let given: unknown
        try {
          given = Serialization.fromRemote(read.value, "args")
        } catch (error) {
          if (!(error instanceof Serialization.Unserializable)) throw error
          return yield* settle(realm, id, false, notSerializable(error))
        }
        const args = yield* Schema.decodeUnknownEffect(schemas.arguments)(given).pipe(Effect.exit)
        if (Exit.isFailure(args)) {
          const issue = Cause.findErrorOption(args.cause)
          return yield* settle(realm, id, false, Option.isSome(issue) ? issue.value.message : "Invalid arguments")
        }
        const exit = yield* Effect.suspend(() => handler(args.value, source)).pipe(
          Effect.flatMap(Schema.encodeEffect(schemas.result)),
          Effect.provideContext(services),
          Effect.exit
        )
        if (Exit.isSuccess(exit)) return yield* settle(realm, id, true, exit.value)
        const error = Cause.findErrorOption(exit.cause)
        if (Option.isSome(error)) return yield* settle(realm, id, false, messageOf(error.value))
        yield* Handlers.report(failed, exit.cause)
        yield* settle(realm, id, false, failed)
      }).pipe(
        Effect.catchCause((cause) =>
          Handlers.report(failed, cause).pipe(
            Effect.andThen(settle(realm, id, false, failed)),
            Effect.ignore
          )
        )
      )
    const bridge: Adapter.HostBridge = {
      name: bridgeName,
      token,
      scope: bridgeScope,
      captured: (_realm, handle) => adapter.releaseHandles([handle]).pipe(Effect.ignore),
      receive: (realm, payload, origin, ownership) => {
        if (!live || !ownership.isAlive() || origin._tag !== "Frame") return false
        const call: Call = { realm, payload, source: { page: origin.page, frame: origin.frame }, ownership }
        calls.add(call)
        Queue.offerUnsafe(incoming, call)
        return true
      },
      failed: () => {},
      ended: () => {}
    }
    yield* Stream.fromQueue(incoming).pipe(
      Stream.runForEach((call) =>
        call.payload.pipe(
          Effect.interruptible,
          BrowserClock.timeoutOn(clock, Duration.toMillis(budget)),
          Effect.flatMap((result) =>
            Option.isNone(result)
              ? Handlers.report(`Binding "${name}" call fetch deadline`, Cause.die("payload fetch did not complete"))
              : drainAll(call.realm, call.source)
          ),
          Effect.catchCause((cause) =>
            !live || !call.ownership.isAlive() ?
              Effect.void :
              Handlers.report(`Binding "${name}" call failed`, cause)
          ),
          Effect.ensuring(Effect.suspend(() => {
            calls.delete(call)
            return call.ownership.release ?? Effect.void
          })),
          Effect.forkIn(scope)
        )
      ),
      Operation.detached,
      Effect.provideContext(environment),
      Effect.forkIn(scope)
    )
    const documentsOf = Effect.gen(function*() {
      const pages = page === undefined ? (yield* context.state.get).pages : [page]
      const documents: Array<Target.DocumentId> = []
      for (const each of pages) {
        // A page still opening, such as a tab adopted by this operation, has documents the model doesn't hold yet,
        // and the init script registered meanwhile doesn't run in them: wait for it to open, as evaluation does.
        yield* Runtime.openState(each, record.id).pipe(BrowserClock.until(record.budget.at), Effect.ignore)
        const state = yield* each.state.get
        if (state.status._tag === "Open") documents.push(state.status.document.id)
        for (const frame of state.frames) documents.push(...Option.toArray(frame.document))
      }
      return documents
    })
    const inDocuments = Effect.fnUntraced(function*(functionDeclaration: string) {
      for (const document of yield* documentsOf) {
        yield* adapter.realm(document, { _tag: "Main" }).pipe(
          Effect.flatMap((realm) =>
            adapter.evaluate(realm, {
              functionDeclaration,
              arguments: [],
              awaitPromise: false,
              result: "value",
              userActivation: false
            })
          ),
          Effect.catch((error) =>
            error._tag === "AdapterError" && error.reason._tag === "Gone" ? Effect.void : Effect.fail(error)
          )
        )
      }
    })
    const cleanup = Effect.gen(function*() {
      if (!live) return
      live = false
      owned.delete(name)
      yield* inDocuments(`() => { ${keyOf(token)}?.remove() }`).pipe(
        Effect.catchCause((cause) => Handlers.report(`Binding "${name}" removal failed`, cause))
      )
    }).pipe(
      Effect.ensuring(
        Scope.close(scope, Exit.void).pipe(
          Effect.catchCause((cause) => Handlers.report(`Binding "${name}" teardown failed`, cause))
        )
      ),
      Operation.detached
    )
    let removing: Fiber.Fiber<void, never> | undefined
    const remove: Effect.Effect<void> = Effect.suspend(() =>
      removing === undefined
        ? cleanup.pipe(
          Effect.forkIn(runtime.model.scope),
          Effect.flatMap((fiber) => {
            removing = fiber
            return Fiber.join(fiber)
          })
        )
        : Fiber.join(removing)
    )
    yield* Effect.addFinalizer(() => remove)
    yield* Effect.gen(function*() {
      yield* adapter.declare(
        page === undefined ? { _tag: "UserContext", context: context.id } : { _tag: "Page", page: page.id },
        {
          _tag: "InitScript",
          source: script,
          world: { _tag: "Main" },
          phase: "environment",
          workers: false,
          timing: adapter.info.protocol === "webkit" ? "bestEffort" : "beforeAuthorScript",
          after: [],
          hostBridge: bridge
        }
      ).pipe(Scope.provide(bridgeScope))
      // Documents already open get the binding now; the declaration covers the ones that follow.
      yield* inDocuments(`() => { ${script} }`)
    }).pipe(
      Effect.mapError(mapped),
      Effect.onError(() => remove)
    )
    return { remove }
  }).pipe(
    Operation.named(page === undefined ? "UserContext.exposeBinding" : "Page.exposeBinding", {
      attributes: page === undefined ? { "browser.context.id": context.id } : { "browser.page.id": page.id }
    })
  )
