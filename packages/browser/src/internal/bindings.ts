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
import type * as Runtime from "./runtime.ts"

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
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>()
  let next = 0
  let live = true
  const call = (...args: Array<unknown>) =>
    new P((resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
      if (!live) return reject(new E(`Binding "${name}" was removed`))
      const id = ++next
      let payload: string
      try {
        payload = stringify({ id, args })
      } catch (error) {
        return reject(error)
      }
      pending.set(id, { resolve, reject })
      send(payload)
    })
  global.Object.defineProperty(global, name, { value: call, configurable: true, writable: true })
  global.Object.defineProperty(global, key, {
    configurable: true,
    value: {
      settle: (id: number, ok: boolean, value: unknown) => {
        const waiting = pending.get(id)
        if (waiting === undefined) return
        pending.delete(id)
        if (ok) waiting.resolve(value)
        else waiting.reject(new E(value))
      },
      remove: () => {
        live = false
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

const Call = Schema.fromJsonString(Schema.Struct({ id: Schema.Number, args: Schema.Unknown }))

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
    // Calls whose answer hasn't been settled: a page that floods a binding is refused past this bound.
    const calls = new Set<Call>()
    const incoming = yield* Queue.unbounded<Call>()
    const settle = (realm: Target.RealmId, id: number, ok: boolean, value: unknown) =>
      adapter.evaluate(realm, {
        functionDeclaration: `() => { ${keyOf(token)}?.settle(${id}, ${ok}, ${JSON.stringify(value) ?? "undefined"}) }`,
        arguments: [],
        awaitPromise: false,
        result: "value",
        userActivation: false
      }).pipe(Effect.asVoid)
    const answer = Effect.fnUntraced(function*(realm: Target.RealmId, payload: string, source: Binding.Source) {
      const call = yield* Schema.decodeUnknownEffect(Call)(payload)
      const args = yield* Schema.decodeUnknownEffect(schemas.arguments)(call.args).pipe(Effect.exit)
      if (Exit.isFailure(args)) return yield* settle(realm, call.id, false, Cause.pretty(args.cause))
      const exit = yield* handler(args.value, source).pipe(
        Effect.flatMap(Schema.encodeEffect(schemas.result)),
        Effect.provideContext(services),
        Effect.exit
      )
      if (Exit.isSuccess(exit)) return yield* settle(realm, call.id, true, exit.value)
      const error = Cause.findErrorOption(exit.cause)
      if (Option.isSome(error)) return yield* settle(realm, call.id, false, messageOf(error.value))
      yield* Handlers.report(`Binding "${name}" handler failed`, exit.cause)
      yield* settle(realm, call.id, false, `Binding "${name}" handler failed`)
    })
    const bridge: Adapter.WebSocketBridge = {
      name: bridgeName,
      token,
      scope: bridgeScope,
      captured: (_realm, handle) => adapter.releaseHandles([handle]).pipe(Effect.ignore),
      receive: (realm, payload, origin, ownership) => {
        if (!live || !ownership.isAlive() || origin._tag !== "Frame") return false
        if (calls.size >= 4096) return false
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
              : answer(call.realm, result.value, call.source)
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
          webSocket: bridge
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
