/** Context-owned WebSocket declarations, detached handlers and conservative cross-realm credit leases. */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Deadline from "../Deadline.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import * as Url from "../Url.ts"
import * as WebSocketRoute from "../WebSocketRoute.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Events from "./events.ts"
import * as Handlers from "./handlers.ts"
import * as InitScripts from "./initScripts.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as UrlPattern from "./urlPattern.ts"
import * as Watchable from "./watchable.ts"
import * as Admission from "./webSocketAdmission.ts"
import * as Allocation from "./webSocketAllocation.ts"
import * as Shim from "./webSocketShim.ts"

// A context shares one constructor shim per realm across registrations.
const installationLocks = new WeakMap<Model.ContextEntry, Semaphore.Semaphore>()
const installations = new WeakMap<
  Model.ContextEntry,
  Map<Target.RealmId, {
    handle: Adapter.HandleId
    users: Set<string>
  }>
>()

const MiB = Allocation.messageBytes
const WireMessage = Schema.Union([
  Schema.TaggedStruct("Text", { data: Schema.String }),
  Schema.TaggedStruct("Binary", { data: Schema.String })
])
const Envelope = Schema.Struct({
  token: Schema.String,
  type: Schema.Literals(["ready", "create", "message", "opened", "closed", "close", "fault", "error"]),
  id: Schema.String,
  sequence: Schema.optional(Schema.Number),
  url: Schema.optional(Schema.String),
  protocols: Schema.optional(Schema.Array(Schema.String)),
  direction: Schema.optional(Schema.Literals(["page", "server"])),
  bytes: Schema.optional(Schema.Number),
  message: Schema.optional(WireMessage),
  protocol: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Number),
  reason: Schema.optional(Schema.String),
  wasClean: Schema.optional(Schema.Boolean),
  provenance: Schema.optional(Schema.Literals(["native", "synthetic"]))
})
type Envelope = typeof Envelope.Type

type State = "connecting" | "open" | "closed"
interface Connection {
  readonly id: string
  readonly realm: Target.RealmId
  readonly alive: () => boolean
  readonly lease: Admission.Lease
  readonly scope: Scope.Closeable
  readonly status: SubscriptionRef.SubscriptionRef<State>
  readonly events: Events.Channel<WebSocketRoute.Event>
  readonly lock: Semaphore.Semaphore
  released: boolean
  readonly opened: Deferred.Deferred<string, WebSocketRoute.WebSocketRouteError | Target.TargetGone>
  fromPage?: ((message: WebSocketRoute.Message) => Effect.Effect<void, unknown>) | undefined
  fromServer?: ((message: WebSocketRoute.Message) => Effect.Effect<void, unknown>) | undefined
  mode?: "mock" | "proxy" | undefined
}

export const register = <E, R>(
  runtime: Runtime.Runtime,
  entry: Model.ContextEntry,
  handler: (connection: WebSocketRoute.Connection) => Effect.Effect<void, E, R>,
  pattern: Url.Pattern | string,
  options: WebSocketRoute.Options
): Effect.Effect<
  WebSocketRoute.Registration,
  WebSocketRoute.WebSocketRouteError | Target.TargetGone | Deadline.Timeout,
  Scope.Scope | R
> =>
  Effect.gen(function*() {
    const fail = (reason: typeof WebSocketRoute.WebSocketRouteErrorReason.Type) =>
      new WebSocketRoute.WebSocketRouteError({ reason, diagnostics: Operation.diagnosticsNow() })
    const record = yield* Operation.record
    const adapter = runtime.model.adapter
    if (options?.implementation !== "script") {
      return yield* Effect.fail(
        fail(
          new Reason.InvalidInput({
            input: "implementation",
            expected: "\"script\"",
            hint: "Explicit consent to a main-world constructor shim is required"
          })
        )
      )
    }
    if (
      (adapter.info.protocol === "webkit" || (adapter.info.protocol === "cdp" && adapter.ownership === "attached")) &&
      options.timing !== "bestEffort"
    ) {
      return yield* Effect.fail(
        fail(
          new Reason.Unsupported({
            capability: "webSocketRouting.beforeAuthorScript",
            backend: runtime.backend,
            hint: "New popups cannot be armed before their first script; choose timing: bestEffort explicitly"
          })
        )
      )
    }
    if (options.workers) yield* InitScripts.inWorkers(runtime).pipe(Effect.mapError(fail))
    const matches = yield* Effect.try({
      try: () => UrlPattern.compile(pattern),
      catch: (error) =>
        fail(new Reason.InvalidInput({ input: "pattern", expected: "a valid URL pattern", hint: String(error) }))
    })
    const context = yield* Effect.context<R>()
    const environment = yield* Effect.context<never>()
    const budget = yield* Deadline.DefaultBudget
    const clock = yield* BrowserClock.CurrentClock
    const scope = yield* Scope.fork(yield* Effect.scope)
    const bridgeScope = yield* Scope.fork(scope)
    const token = crypto.randomUUID()
    // Unrelated to the token: the page can see the binding's name until the shim captures it.
    const name = `__strider_ws_${crypto.randomUUID().replaceAll("-", "")}`
    const transport = adapter.info.protocol === "webkit" ? "console" : "binding"
    const source = Shim.source(name, token, pattern, transport, adapter.info.protocol === "bidi")
    const allocation = Allocation.make()
    const accounting = allocation.budget
    const connections = new Map<string, Connection>()
    const realms = new Set<Target.RealmId>()
    let holders = installations.get(entry)
    if (holders === undefined) {
      holders = new Map()
      installations.set(entry, holders)
    }
    const shared = holders
    let installationLock = installationLocks.get(entry)
    if (installationLock === undefined) {
      installationLock = Semaphore.makeUnsafe(1)
      installationLocks.set(entry, installationLock)
    }
    const installLock = installationLock
    const captured = new Map<Target.RealmId, Deferred.Deferred<void>>()
    const reference = (realm: Target.RealmId) => {
      let ready = captured.get(realm)
      if (ready === undefined) {
        ready = Deferred.makeUnsafe<void>()
        captured.set(realm, ready)
      }
      return ready
    }
    const release = (realm: Target.RealmId) => {
      captured.delete(realm)
      const holder = shared.get(realm)
      if (holder === undefined) return Effect.void
      holder.users.delete(token)
      if (holder.users.size > 0) return Effect.void
      shared.delete(realm)
      return adapter.releaseHandles([holder.handle])
    }
    const unconfirmed = new Map<Target.RealmId, Array<Admission.Lease>>()
    type Incoming = {
      realm: Target.RealmId
      payload: Effect.Effect<string, Adapter.AdapterError>
      origin: WebSocketRoute.Initiator
      destroyed: boolean
      alive: () => boolean
      release: Effect.Effect<void>
    }
    const owned = new Set<Incoming>()
    const incoming = yield* Queue.make<Incoming>({ capacity: 4096 })
    let live = true
    const blocked = new Set<Target.RealmId>()
    const destroying = new Set<Target.RealmId>()
    const faults = yield* Queue.unbounded<{ realm: Target.RealmId; destroyed: boolean }>()
    const fault = (realm: Target.RealmId) => {
      if (blocked.has(realm)) return
      blocked.add(realm)
      Queue.offerUnsafe(faults, { realm, destroyed: false })
    }
    /** A realm that ended: its payloads stop, and its connections and installation are released. */
    const retire = (realm: Target.RealmId) => {
      if (destroying.has(realm)) return
      let known = realms.has(realm) || unconfirmed.has(realm)
      for (const item of owned) {
        if (item.realm !== realm || item.destroyed) continue
        item.destroyed = true
        known = true
      }
      if (!known) return
      destroying.add(realm)
      Deferred.doneUnsafe(reference(realm), Effect.void)
      realms.delete(realm)
      Queue.offerUnsafe(faults, { realm, destroyed: true })
    }
    const mapped = (error: Adapter.AdapterError | Deadline.Timeout) => {
      const failure = Operation.fromAdapter(error, record.id, runtime.backend)
      return failure._tag === "Reason"
        ? fail(failure.reason as typeof WebSocketRoute.WebSocketRouteErrorReason.Type)
        : failure.error
    }
    const evaluate = (realm: Target.RealmId, functionDeclaration: string) =>
      Effect.suspend(() => {
        const holder = shared.get(realm)
        return holder === undefined || !holder.users.has(token)
          ? Effect.fail(
            fail(
              new Reason.BackendFailure({
                kind: "Rejected",
                method: "WebSocketRoute.dispatch",
                hint: "Installation reference is unavailable"
              })
            )
          )
          : adapter.evaluate(realm, {
            functionDeclaration,
            arguments: [{ _tag: "Handle", handle: holder.handle }],
            awaitPromise: true,
            result: "value",
            userActivation: false
          }).pipe(Effect.mapError(mapped))
      }).pipe(
        Effect.flatMap((result) =>
          result._tag === "Exception"
            ? Effect.fail(
              fail(
                new Reason.BackendFailure({ kind: "Rejected", method: "WebSocketRoute.dispatch", hint: result.text })
              )
            ) :
            Effect.void
        )
      )
    const command = (connection: Pick<Connection, "id" | "realm">, value: Record<string, unknown>) =>
      evaluate(connection.realm, Shim.command(token, { id: connection.id, ...value })).pipe(
        Effect.tapError(() =>
          Effect.suspend(() => {
            const current = connections.get(`${connection.realm}:${connection.id}`)
            if (current !== undefined && !current.alive()) bridge.ended(current.realm)
            return Effect.void
          })
        )
      )
    const forget = Effect.fnUntraced(function*(connection: Connection, destroyed: boolean, uncertain = false) {
      if (connection.released) return
      connection.released = true
      yield* SubscriptionRef.set(connection.status, "closed")
      connections.delete(`${connection.realm}:${connection.id}`)
      if (uncertain) {
        const held = unconfirmed.get(connection.realm) ?? []
        held.push(connection.lease)
        unconfirmed.set(connection.realm, held)
      } else if (destroyed) accounting.destroy(connection.lease.owner, connection.lease.generation)
      else accounting.leave(connection.lease)
      const reason = new Target.RealmDestroyed({})
      yield* Deferred.fail(
        connection.opened,
        new Target.TargetGone({
          target: { _tag: "Realm", id: connection.realm },
          reason,
          diagnostics: Operation.diagnosticsNow()
        })
      )
      Events.end(connection.events, { normal: !destroyed, reason })
      yield* Scope.close(connection.scope, Exit.void).pipe(Effect.forkIn(scope))
    }, Effect.uninterruptible)
    const terminate = Effect.fnUntraced(function*(connection: Connection, reason: string) {
      yield* SubscriptionRef.set(connection.status, "closed")
      Events.publish(connection.events, { _tag: "Error", message: reason })
      yield* command(connection, { type: "fail", reason }).pipe(Effect.ignore)
      // Reclaim only after the realm has stopped accepting and conversion chains have acknowledged draining.
      const drained = yield* command(connection, { type: "drain" }).pipe(Effect.exit)
      if (Exit.isSuccess(drained)) yield* forget(connection, false)
      else yield* forget(connection, false, true)
    })
    const run = (connection: Connection, effect: Effect.Effect<void, unknown>, bounded = true) =>
      effect.pipe(
        // The handler's own work has no deadline once it has decided: only a message handler's turn is bounded.
        bounded ? Operation.apart("WebSocketRoute.handler", budget) : Operation.detached,
        bounded ?
          (self) =>
            self.pipe(
              BrowserClock.timeoutOn(clock, Duration.toMillis(budget)),
              Effect.flatMap((result) =>
                Option.isNone(result) ? terminate(connection, "routing handler deadline") : Effect.void
              )
            ) :
          (self) => self,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Option.exists(Cause.findErrorOption(cause), Target.isTargetGone)
            ? forget(connection, !connection.alive(), connection.alive())
            : Handlers.report("WebSocket routing handler failed; closing the connection", cause).pipe(
              Effect.andThen(terminate(connection, "routing handler failed"))
            )
        ),
        Scope.provide(connection.scope),
        Effect.provideContext(environment),
        Effect.forkIn(connection.scope),
        Effect.asVoid
      )
    const encode = (message: WebSocketRoute.Message) =>
      message._tag === "Text" ? message : { _tag: "Binary", data: Encoding.encode(message.data) }
    const writable = (connection: Connection, direction: "page" | "server"): WebSocketRoute.Writable => ({
      send: Effect.fnUntraced(function*(message: WebSocketRoute.Message) {
        if (SubscriptionRef.getUnsafe(connection.status) !== "open") {
          return yield* Effect.fail(
            fail(new WebSocketRoute.InvalidState({ state: SubscriptionRef.getUnsafe(connection.status) }))
          )
        }
        const bytes = message._tag === "Binary" ? message.data.byteLength : Admission.textBytes(message.data)
        const sequence = allocation.reserveHost(bytes)
        if (sequence === undefined) {
          yield* terminate(connection, "routing overflow")
          return yield* Effect.fail(
            fail(
              new WebSocketRoute.Overflow({ limit: bytes > MiB ? "1 MiB message" : "2 MiB or 256 pending host sends" })
            )
          )
        }
        yield* command(connection, { type: "send", direction, message: encode(message) }).pipe(
          Effect.ensuring(Effect.sync(() => {
            allocation.completeHost(sequence)
          }))
        )
      }, Operation.named("WebSocketRoute.send", { attributes: { "browser.realm.id": connection.realm } })),
      close: Effect.fnUntraced(
        function*(options?: { readonly code?: number | undefined; readonly reason?: string | undefined } | undefined) {
          const code = options?.code
          const reason = options?.reason ?? ""
          if (
            (code !== undefined && (!Number.isInteger(code) || (code !== 1000 && (code < 3000 || code > 4999)))) ||
            Admission.textBytes(reason, 123) > 123
          ) {
            return yield* Effect.fail(
              fail(
                new Reason.InvalidInput({
                  input: "close",
                  expected: "code 1000 or 3000–4999 and a reason of at most 123 UTF-8 bytes",
                  hint: "Reserved protocol codes cannot be sent by browser WebSocket.close"
                })
              )
            )
          }
          if (SubscriptionRef.getUnsafe(connection.status) === "closed") return
          yield* command(connection, { type: "close", direction, code, reason })
        },
        Operation.named("WebSocketRoute.close", { attributes: { "browser.realm.id": connection.realm } })
      )
    })
    const create = Effect.fnUntraced(
      function*(realm: Target.RealmId, message: Envelope, origin: WebSocketRoute.Initiator, alive: () => boolean) {
        if (!alive() || !live) return
        const owner = `${realm}:${message.id}`
        if (connections.has(owner)) return
        // The page sends the URL: check it against this route's pattern as the shim did.
        if (!matches(message.url ?? "")) {
          return yield* command({ realm, id: message.id }, { type: "fail", reason: "constructor url" }).pipe(
            Effect.andThen(command({ realm, id: message.id }, { type: "drain" }))
          )
        }
        const lease = allocation.admit(owner, 1)
        const reject = () =>
          command({ realm, id: message.id }, { type: "fail", reason: "constructor admission" }).pipe(
            Effect.andThen(command({ realm, id: message.id }, { type: "drain" }))
          )
        if (lease === undefined) return yield* reject()
        const child = yield* Scope.fork(scope)
        const status = yield* SubscriptionRef.make<State>("connecting")
        const events = Events.make<WebSocketRoute.Event>({ _tag: "Realm", id: realm }, () => 0)
        const opened = yield* Deferred.make<string, WebSocketRoute.WebSocketRouteError | Target.TargetGone>()
        const lock = yield* Semaphore.make(1)
        const decided = yield* Deferred.make<void>()
        const connection: Connection = {
          id: message.id,
          realm,
          alive,
          lease,
          scope: child,
          status,
          events,
          opened,
          released: false,
          lock
        }
        const page = writable(connection, "page"), server = writable(connection, "server")
        const choose = Effect.fnUntraced(
          function*<E2, R2>(
            mode: "mock" | "proxy",
            handlers: WebSocketRoute.MockHandlers<E2, R2> | WebSocketRoute.ProxyHandlers<E2, R2>,
            protocol?: string
          ) {
            if (SubscriptionRef.getUnsafe(status) === "closed") {
              return yield* Effect.fail(fail(new WebSocketRoute.InvalidState({ state: "closed" })))
            }
            if (connection.mode !== undefined) {
              return yield* Effect.fail(fail(new WebSocketRoute.InvalidState({ state: "already opened" })))
            }
            if (protocol !== undefined && !(message.protocols ?? []).includes(protocol)) {
              return yield* Effect.fail(
                fail(
                  new Reason.InvalidInput({
                    input: "protocol",
                    expected: "one of the requested subprotocols",
                    hint: protocol
                  })
                )
              )
            }
            if (mode === "proxy" && !allocation.proxy(lease)) {
              return yield* Effect.fail(fail(new WebSocketRoute.Overflow({ limit: "14 MiB browser reservations" })))
            }
            const services = yield* Effect.context<R2>()
            connection.mode = mode
            Deferred.doneUnsafe(decided, Effect.void)
            if (mode === "mock") {
              const fromPage = (handlers as WebSocketRoute.MockHandlers<E2, R2>).fromPage
              connection.fromPage = fromPage === undefined
                ? undefined
                : (message) =>
                  Effect.provideContext(
                    fromPage(message, page).pipe(
                      Operation.apart("WebSocketRoute.fromPage", budget),
                      Scope.provide(child)
                    ),
                    services
                  )
            } else {
              const proxy = handlers as WebSocketRoute.ProxyHandlers<E2, R2>
              connection.fromPage = proxy.fromPage === undefined
                ? undefined
                : (message) =>
                  Effect.provideContext(
                    proxy.fromPage!(message, { page, server }).pipe(
                      Operation.apart("WebSocketRoute.fromPage", budget),
                      Scope.provide(child)
                    ),
                    services
                  )
              connection.fromServer = proxy.fromServer === undefined
                ? undefined
                : (message) =>
                  Effect.provideContext(
                    proxy.fromServer!(message, { page, server }).pipe(
                      Operation.apart("WebSocketRoute.fromServer", budget),
                      Scope.provide(child)
                    ),
                    services
                  )
            }
            // Both grants must reach the realm before author code can see open.
            yield* command(connection, { type: "grant", direction: "page", bytes: MiB, serial: 1 })
            if (mode === "proxy") {
              yield* command(connection, { type: "grant", direction: "server", bytes: MiB, serial: 1 })
            }
            if (mode === "mock") yield* SubscriptionRef.set(status, "open")
            yield* command(connection, { type: mode === "mock" ? "open" : "connect", protocol })
            return mode === "mock" ? "" : yield* Deferred.await(opened)
          }
        )
        const handle: WebSocketRoute.Connection = {
          id: WebSocketRoute.Id.make(`${token}:${realm}:${message.id}`),
          realm,
          initiator: origin,
          url: Url.Url.make(message.url ?? ""),
          protocols: message.protocols ?? [],
          page,
          status: Watchable.make({
            ref: status,
            project: Option.some,
            ended: () => Option.none(),
            final: (state) => state === "closed",
            target: { _tag: "Realm", id: realm },
            operation: "WebSocketRoute.status"
          }),
          events: Events.stream(
            {
              operation: "WebSocketRoute.events",
              noun: "a WebSocket event",
              deliver: (event: WebSocketRoute.Event) => event
            },
            events,
            () => true,
            undefined
          ),
          open: (handlers, options) =>
            choose("mock", handlers, options?.protocol).pipe(Effect.asVoid, Operation.named("WebSocketRoute.open")),
          connectToServer: (handlers) =>
            choose("proxy", handlers).pipe(
              Effect.map((protocol) => ({ ...server, protocol })),
              Operation.named("WebSocketRoute.connectToServer")
            )
        }
        if (!alive() || !live) {
          accounting.destroy(lease.owner, lease.generation)
          yield* Scope.close(child, Exit.void)
          return
        }
        connections.set(owner, connection)
        realms.add(realm)
        // The deadline covers the decision only: until the handler opens, connects or returns. What it does
        // afterwards runs in the connection's scope until the connection closes.
        yield* run(
          connection,
          Effect.provideContext(
            handler(handle).pipe(Operation.detached, Scope.provide(child)),
            context
          ).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                connection.mode === undefined && !connection.released
                  ? terminate(connection, "routing handler returned without opening the connection")
                  : Effect.void
              )
            ),
            Effect.ensuring(Effect.sync(() => Deferred.doneUnsafe(decided, Effect.void)))
          ),
          false
        )
        yield* Deferred.await(decided).pipe(
          BrowserClock.timeoutOn(clock, Duration.toMillis(budget)),
          Effect.flatMap((result) =>
            Option.isNone(result) && connection.mode === undefined && !connection.released
              ? terminate(connection, "routing handler deadline")
              : Effect.void
          ),
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(child),
          Effect.asVoid
        )
      }
    )
    const process = Effect.fnUntraced(
      function*(realm: Target.RealmId, envelope: Envelope, origin: WebSocketRoute.Initiator, alive: () => boolean) {
        if (envelope.token !== token || !live || !alive() || blocked.has(realm)) return
        if (envelope.type === "ready") {
          realms.add(realm)
          return
        }
        if (envelope.type === "create") return yield* create(realm, envelope, origin, alive)
        const connection = connections.get(`${realm}:${envelope.id}`)
        if (connection === undefined) return
        if (envelope.type === "error") {
          Events.publish(connection.events, { _tag: "Error", message: "Native WebSocket error" })
          return
        }
        if (envelope.type === "opened") {
          yield* SubscriptionRef.set(connection.status, "open")
          yield* Deferred.succeed(connection.opened, envelope.protocol ?? "")
          return
        }
        if (envelope.type === "message") {
          const direction = envelope.direction
          if (
            direction === undefined || envelope.bytes === undefined || envelope.sequence === undefined ||
            envelope.message === undefined ||
            !accounting.consume(connection.lease, direction, envelope.sequence, envelope.bytes)
          ) return yield* terminate(connection, "invalid routing reservation")
          const wire = envelope.message
          const message = wire._tag === "Text"
            ? wire
            : {
              _tag: "Binary" as const,
              data: yield* Effect.fromResult(Encoding.decode(wire.data)).pipe(
                Effect.mapError(() =>
                  fail(
                    new Reason.InvalidInput({ input: "binary", expected: "base64", hint: "Malformed bridge payload" })
                  )
                )
              )
            }
          const actualBytes = message._tag === "Text" ? Admission.textBytes(message.data) : message.data.byteLength
          if (actualBytes !== envelope.bytes || actualBytes > MiB) {
            return yield* terminate(connection, "invalid message reservation")
          }
          Events.publish(connection.events, { _tag: "Message", direction, message })
          const callback = direction === "page" ? connection.fromPage : connection.fromServer
          const deliver = callback === undefined
            ? (connection.mode === "proxy"
              ? writable(connection, direction === "page" ? "server" : "page").send(message)
              : Effect.void)
            : callback(message)
          yield* run(
            connection,
            connection.lock.withPermits(1)(
              deliver.pipe(
                Effect.andThen(command(connection, { type: "ack", direction, sequence: envelope.sequence })),
                Effect.andThen(Effect.sync(() => accounting.complete(connection.lease, direction, envelope.sequence!)))
              )
            )
          )
        } else if (envelope.type === "close") {
          yield* run(
            connection,
            connection.lock.withPermits(1)(
              command(connection, { type: "close", direction: "server", code: envelope.code, reason: envelope.reason })
                .pipe(
                  Effect.andThen(
                    command(connection, {
                      type: "close",
                      direction: "page",
                      code: envelope.code,
                      reason: envelope.reason
                    })
                  )
                )
            )
          )
        } else if (envelope.type === "closed") {
          yield* SubscriptionRef.set(connection.status, "closed")
          Events.publish(connection.events, {
            _tag: "Closed",
            direction: envelope.direction ?? "page",
            code: envelope.code ?? 1006,
            reason: envelope.reason ?? "",
            wasClean: envelope.wasClean ?? false,
            provenance: envelope.provenance ?? "synthetic"
          })
          yield* run(
            connection,
            connection.lock.withPermits(1)(
              command(connection, { type: "drain" }).pipe(Effect.andThen(forget(connection, false)))
            )
          )
        } else if (envelope.type === "fault") yield* terminate(connection, envelope.reason ?? "routing failed")
      }
    )
    const bridge: Adapter.WebSocketBridge = {
      name,
      token,
      scope: bridgeScope,
      captured: (realm, handle, isAlive) =>
        Effect.suspend(() => {
          if (!live || destroying.has(realm) || isAlive?.() === false) {
            return adapter.releaseHandles([handle])
          }
          const previous = shared.get(realm)
          if (previous === undefined) shared.set(realm, { handle, users: new Set([token]) })
          else {
            previous.users.add(token)
            const duplicate = handle
            handle = previous.handle
            realms.add(realm)
            Deferred.doneUnsafe(reference(realm), Effect.void)
            return duplicate === handle ? Effect.void : adapter.releaseHandles([duplicate])
          }
          realms.add(realm)
          Deferred.doneUnsafe(reference(realm), Effect.void)
          return Effect.void
        }),
      receive: (realm, payload, origin, ownership) => {
        if (!live || blocked.has(realm) || destroying.has(realm) || !ownership.isAlive()) return false
        // Include objects already pulled into a Stream chunk in the admission bound.
        if (owned.size >= 4096) {
          fault(realm)
          return false
        }
        let released = false
        const item: Incoming = {
          realm,
          payload: Deferred.await(reference(realm)).pipe(Effect.andThen(payload)),
          origin,
          destroyed: false,
          alive: () => !item.destroyed && ownership.isAlive(),
          release: Effect.suspend(() => {
            if (released) return Effect.void
            released = true
            owned.delete(item)
            return (ownership.release ?? Effect.void).pipe(
              Effect.interruptible,
              BrowserClock.timeoutOn(clock, Duration.toMillis(budget)),
              Effect.flatMap((result) =>
                Option.isSome(result) ?
                  Effect.void :
                  Handlers.report("WebSocket payload release deadline", Cause.die("release did not complete"))
              ),
              Effect.catchCause((cause) => Handlers.report("WebSocket payload release failed", cause))
            )
          }).pipe(Effect.uninterruptible)
        }
        if (Queue.offerUnsafe(incoming, item)) {
          owned.add(item)
          return true
        }
        fault(realm)
        return false
      },
      failed: fault,
      ended: retire
    }
    /** A payload whose fetch found its own realm gone: an end its notification may announce only later. */
    const goneRealm = (cause: Cause.Cause<unknown>, realm: Target.RealmId) =>
      Option.exists(Cause.findErrorOption(cause), (error) => {
        const reason = (error as Partial<Adapter.AdapterError>).reason
        return reason?._tag === "Gone" && reason.target._tag === "Realm" && reason.target.id === realm
      })
    yield* Stream.fromQueue(incoming).pipe(
      Stream.runForEach((incoming) =>
        incoming.payload.pipe(
          Effect.interruptible,
          BrowserClock.timeoutOn(clock, Duration.toMillis(budget)),
          Effect.flatMap((result) => {
            if (Option.isNone(result)) {
              if (incoming.alive() && live) fault(incoming.realm)
              return Handlers.report("WebSocket payload fetch deadline", Cause.die("payload fetch did not complete"))
            }
            const payload = result.value
            if (!incoming.alive() || !live) return Effect.void
            return Admission.textBytes(payload, 7 * MiB) > 7 * MiB
              ? Effect.sync(() => fault(incoming.realm))
              : Schema.decodeUnknownEffect(Envelope)(JSON.parse(payload)).pipe(
                Effect.flatMap((message) =>
                  incoming.alive()
                    ? process(incoming.realm, message, incoming.origin, incoming.alive)
                    : Effect.void
                )
              )
          }),
          Effect.catchCause((cause) =>
            !incoming.alive() || !live
              ? Effect.void
              : goneRealm(cause, incoming.realm)
              ? Effect.sync(() => retire(incoming.realm))
              : Handlers.report("WebSocket bridge failed", cause).pipe(
                Effect.andThen(Effect.sync(() => fault(incoming.realm)))
              )
          ),
          Effect.ensuring(incoming.release)
        )
      ),
      Operation.detached,
      Effect.provideContext(environment),
      Effect.forkIn(scope)
    )
    yield* Stream.fromQueue(faults).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function*() {
          if (!event.destroyed) {
            yield* evaluate(event.realm, Shim.command(token, { type: "faultRealm" })).pipe(Effect.ignore)
          }
          for (const connection of connections.values()) {
            if (connection.realm !== event.realm) continue
            if (event.destroyed) yield* forget(connection, true)
            else yield* terminate(connection, "bridge overflow")
          }
          if (event.destroyed) {
            for (const lease of unconfirmed.get(event.realm) ?? []) {
              accounting.destroy(lease.owner, lease.generation)
            }
            unconfirmed.delete(event.realm)
            blocked.delete(event.realm)
            destroying.delete(event.realm)
            realms.delete(event.realm)
            yield* release(event.realm)
          }
        })
      ),
      Operation.detached,
      Effect.provideContext(environment),
      Effect.forkIn(scope)
    )
    const cleanup = Effect.gen(function*() {
      if (!live) return
      live = false
      const acknowledged = new Set<Target.RealmId>()
      for (const realm of realms) {
        const result = yield* evaluate(realm, Shim.command(token, { type: "remove" })).pipe(Effect.exit)
        if (Exit.isSuccess(result)) acknowledged.add(realm)
        else {
          const error = Option.getOrUndefined(Exit.findErrorOption(result))
          if (error?._tag === "TargetGone") acknowledged.add(realm)
          else yield* Handlers.report("WebSocket routing cleanup could not confirm draining", result.cause)
        }
      }
      for (const connection of connections.values()) {
        if (acknowledged.has(connection.realm)) yield* forget(connection, false)
        else yield* forget(connection, false, true)
      }
      yield* Queue.clear(incoming)
    }).pipe(
      Effect.ensuring(
        Scope.close(bridgeScope, Exit.void).pipe(
          Effect.catchCause((cause) => Handlers.report("WebSocket bridge teardown failed", cause)),
          Effect.ensuring(Effect.suspend(() => Effect.forEach([...captured.keys()], release, { discard: true }))),
          Effect.ensuring(
            Scope.close(scope, Exit.void).pipe(
              Effect.catchCause((cause) => Handlers.report("WebSocket consumer teardown failed", cause))
            )
          ),
          // Intake bounds this set; start every discard even if another release stalls.
          Effect.ensuring(Effect.suspend(() =>
            Effect.forEach(
              [...owned],
              (item) => item.release,
              { concurrency: "unbounded", discard: true }
            )
          ))
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
      yield* adapter.declare({ _tag: "UserContext", context: entry.id }, {
        _tag: "InitScript",
        source,
        world: { _tag: "Main" },
        phase: "environment",
        workers: options.workers ?? false,
        timing: options.timing ?? "beforeAuthorScript",
        after: [],
        webSocket: bridge
      }).pipe(Scope.provide(bridgeScope), Effect.mapError(mapped))
      // Install into already loaded documents as well as future ones. Existing sockets remain native.
      const current = yield* entry.state.get
      for (const page of current.pages) {
        const state = yield* page.state.get
        const documents = [
          ...(state.status._tag === "Open" ? [state.status.document.id] : []),
          ...state.frames.flatMap((frame) => Option.toArray(frame.document))
        ]
        for (const document of documents) {
          yield* adapter.realm(document, { _tag: "Main" }).pipe(
            Effect.mapError(mapped),
            Effect.flatMap((realm) => {
              return installLock.withPermits(1)(Effect.suspend(() => {
                const old = shared.get(realm)
                return adapter.evaluate(realm, {
                  functionDeclaration: `(old) => {
                  const holder = old ?? (${Shim.install.toString()})();
                  holder.add(${JSON.stringify(name)}, ${JSON.stringify(token)}, ${JSON.stringify(pattern)}, ${
                    JSON.stringify(transport)
                  });
                  return holder;
                }`,
                  arguments: old === undefined ? [] : [{ _tag: "Handle", handle: old.handle }],
                  awaitPromise: false,
                  result: "handle",
                  userActivation: false
                }).pipe(
                  Effect.mapError(mapped),
                  Effect.flatMap((result) => {
                    if (result._tag === "Value" && "handle" in result.value && result.value.handle !== undefined) {
                      return bridge.captured(realm, result.value.handle)
                    }
                    return Effect.fail(
                      fail(
                        new Reason.BackendFailure({
                          kind: "Rejected",
                          method: "WebSocketRoute.install",
                          hint: "Installation did not return a handle"
                        })
                      )
                    )
                  })
                )
              }))
            }),
            Effect.catch((error) => error._tag === "TargetGone" ? Effect.void : Effect.fail(error))
          )
        }
      }
    }).pipe(Effect.onError(() => remove))
    return { remove }
  }).pipe(Operation.named("UserContext.routeWebSocket", { attributes: { "browser.context.id": entry.id } }))
