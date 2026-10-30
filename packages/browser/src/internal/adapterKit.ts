/**
 * What every backend adapter does the same way, whatever its protocol: the bookkeeping beside the contract
 * (`adapter.ts`), so an adapter's own modules hold only what its protocol says.
 *
 * An adapter keeps its model in an explicit state object: its tables, keyed by L1's ids and by the protocol's,
 * and the kit's pieces below. Its per-domain modules (targets, navigation, network, evaluation, input…) take
 * that object, so no part of an adapter closes over another's tables. The kit's contract:
 *
 * - **Ids** (`makeIds`). The connection mints every id through the kit, which remembers what it minted as
 *   ranges of each kind's counter: a few numbers, however many ids. An id a table no longer holds is
 *   **`Gone`** if this connection minted it, since it ended, and **`Foreign`** only if it didn't (`lookup`,
 *   `missing`). `Foreign` is a bug in L1, which `Operation.fromAdapter` raises as a defect; an id that ended
 *   while L1 was about to use it is an ordinary race, which L1 handles as the target's end.
 * - **Facts** (`FactBuffer`). A fold handler only `emit`s; the fold's hook ends with `flush`, which delivers the
 *   facts to the sink in order, then wakes what waits on the model (`waitFor`), then starts the commands the
 *   handler couldn't wait for (`later`). An operation that learns something from a reply reports it with `run`,
 *   in order with the events. A realm reported ahead of its document is held (`Pending`): what it logs
 *   meanwhile is held with it, and reported after it is announced; one that ends unannounced is never reported.
 * - **Fire and forget** (`later`, `start`). Commands the fold can't wait for, and work an operation leaves running,
 *   run in fibers of a `FiberSet` in the connection's scope, so they end with the connection rather than outliving
 *   it. Never `Effect.forkDetach`.
 * - **Waiting on the model** (`waitFor`). An operation that needs something the fold will report, such as a
 *   document's main realm, waits with a check run after every flush, in the worker, which returns what it
 *   found. One mechanism for every adapter: no waiter sets keyed by hand, and no evaluation to make a realm
 *   appear.
 * - **Navigations a command started** (`Expectations`, `neverStarted`). A navigation command mints its id before
 *   it is sent, as an expectation the browser's event takes, by URL, oldest first. A command that never started a
 *   navigation takes its expectation back and reports it ended in one step of the worker, so the event can't
 *   slip between (QUIRKS.md, Q233).
 * - **Event handlers** (`handlers`). A typed table: each `on(event, handler)` gets the event's decoded params, and
 *   the table gives the fold both the events to decode and the handler to call, so the two can't drift apart.
 * - **Values.** `decodeBase64` fails with an `AdapterError` rather than returning empty bytes; `argument`
 *   resolves an evaluation's argument and fails a handle or node it can't resolve as `Gone`, never sending an
 *   empty reference; `realmFailure` gives `Gone` for an evaluation whose realm or session ended.
 */
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as FiberSet from "effect/FiberSet"
import * as Headers from "effect/http/Headers"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import * as NetworkRequest from "../NetworkRequest.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as Protocol from "../protocol/Protocol.ts"
import type * as Target from "../Target.ts"
import * as Adapter from "./adapter.ts"
import type * as ConsoleFormat from "./consoleFormat.ts"
import type * as ProtocolClient from "./protocolClient.ts"

// ── Errors ────────────────────────────────────────────────────────────────────────────────────────────────

/** A target that ended, and why. */
export const gone = (target: Target.Description, reason: Target.CloseReason): Adapter.AdapterError =>
  new Adapter.AdapterError({ reason: { _tag: "Gone", target, reason } })

/** An id this connection never minted: a bug in L1. */
export const foreign = (id: string): Adapter.AdapterError =>
  new Adapter.AdapterError({ reason: { _tag: "Foreign", id } })

/** A capability the backend lacks, with what to do instead. */
export const unsupported = (capability: string, hint: string): Adapter.AdapterError =>
  new Adapter.AdapterError({ reason: { _tag: "Unsupported", capability, hint } })

/** Why targets end when the connection does. */
export const closed = (): Target.CloseReason => ({ _tag: "ConnectionLost" })

/** A protocol failure as an adapter error (`Adapter.protocolError`). */
export const protocolError = Adapter.protocolError

/** An effect's protocol failures as adapter errors. */
export const protocol = <A, R>(
  effect: Effect.Effect<A, Protocol.ProtocolError, R>
): Effect.Effect<A, Adapter.AdapterError, R> => Effect.mapError(effect, protocolError)

/** What the browser sent that didn't decode, as `Protocol`'s `Decode`, which L1 reports as an incompatible reply. */
export const undecodable = (method: string, issue: string): Adapter.AdapterError =>
  protocolError(new Protocol.ProtocolError({ reason: new Protocol.Decode({ method, issue }) }))

/**
 * A command in a realm that failed: `Gone` where the realm ended or its session did, as when its page closed
 * while the command was in flight; the protocol's error otherwise.
 */
export const realmFailure =
  (realm: Target.RealmId, ended: () => boolean) => (error: Protocol.ProtocolError): Adapter.AdapterError =>
    ended() || error.reason._tag === "SessionEnded"
      ? gone({ _tag: "Realm", id: realm }, { _tag: "RealmDestroyed" })
      : protocolError(error)

// ── Ids ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A connection's ids, which also say which ids it minted. */
export interface Ids extends Adapter.Ids {
  /** Whether this connection minted an id (a hop's, by its request), whether or not it has ended. */
  readonly owns: (id: string) => boolean
}

/** The kinds' prefixes and counters: `N3`, `DL2`, a hop `Q12.1` by its request `Q12`. */
const idPattern = /^([A-Z]+)(\d+)(?:\.\d+)?$/

/**
 * A connection's ids (`Adapter.makeIds`), remembering what it minted. The process's connections share each kind's
 * counter, so one connection's ids are runs of consecutive numbers, kept as ranges: one range while a single
 * connection mints, another each time a second one minted in between.
 */
export const makeIds = (): Ids => {
  const base = Adapter.makeIds()
  const ranges = new Map<string, Array<[number, number]>>()
  const record = <A extends string>(mint: () => A) => (): A => {
    const id = mint()
    const match = idPattern.exec(id)
    if (match !== null) {
      const n = Number(match[2])
      const list = ranges.get(match[1]!) ?? []
      const last = list.at(-1)
      if (last !== undefined && last[1] === n - 1) last[1] = n
      else list.push([n, n])
      ranges.set(match[1]!, list)
    }
    return id
  }
  return {
    ...base,
    userContext: record(base.userContext),
    navigable: record(base.navigable),
    document: record(base.document),
    realm: record(base.realm),
    navigation: record(base.navigation),
    request: record(base.request),
    prompt: record(base.prompt),
    download: record(base.download),
    connection: record(base.connection),
    obligation: record(base.obligation),
    handle: record(base.handle),
    registration: record(base.registration),
    owns: (id) => {
      const match = idPattern.exec(id)
      if (match === null) return false
      const n = Number(match[2])
      return (ranges.get(match[1]!) ?? []).some(([from, to]) => n >= from && n <= to)
    }
  }
}

/** An id no table holds: `Gone` as `ended` says if this connection minted it, `Foreign` if it didn't. */
export const missing = (ids: Ids, id: string, ended: () => Adapter.AdapterError): Adapter.AdapterError =>
  ids.owns(id) ? ended() : foreign(id)

/**
 * The entry an L1 id names, if it is still live; an id this connection minted that ended fails as `ended` says,
 * and one it didn't, `Foreign`.
 */
export const lookup = <K extends string, V>(
  ids: Ids,
  table: ReadonlyMap<K, V>,
  id: K,
  ended: () => Adapter.AdapterError,
  live: (entry: V) => boolean = () => true
): Effect.Effect<V, Adapter.AdapterError> =>
  Effect.suspend(() => {
    const entry = table.get(id)
    return entry !== undefined && live(entry) ? Effect.succeed(entry) : Effect.fail(missing(ids, id, ended))
  })

// ── Facts ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A realm that may be reported after it is created, once its document commits. */
export interface Pending {
  /** Not reported yet: what it emits is held. */
  pending: boolean
  /** What it emitted while pending, in order. */
  readonly held: Array<Adapter.Fact>
}

/** A fold's facts, delivered in order, and what waits on them. */
export interface FactBuffer {
  /** Adds a fact, delivered at the next flush. */
  readonly emit: (fact: Adapter.Fact) => void
  /** Adds a fact a realm caused: held while the realm is pending, so it is reported after the realm. */
  readonly emitFrom: (realm: Pending, fact: Adapter.Fact) => void
  /** Reports a pending realm with its `RealmAdded`, then what it held. */
  readonly announce: (realm: Pending, added: Adapter.Fact) => void
  /**
   * A command the fold can't wait for, started after the flush that follows, in the connection's scope: its
   * failure is ignored, and it ends with the connection.
   */
  readonly later: (effect: Effect.Effect<unknown, unknown>) => void
  /**
   * Starts work now that outlives the operation starting it, such as a watch on a page, in the connection's scope:
   * its failure is ignored, and it ends with the connection. From the fold, use `later`.
   */
  readonly start: (effect: Effect.Effect<unknown, unknown>) => void
  /**
   * Waits until `check` finds something, checked now and after every flush, in the worker: what it found is the
   * value.
   */
  readonly waitFor: <A>(check: () => A | undefined) => Effect.Effect<A>
  /** Delivers the facts so far, wakes what they satisfy, and starts what `later` queued. */
  readonly flush: Effect.Effect<void>
  /** Runs `facts` in the worker after every event received so far, then flushes (`FoldControl.run`). */
  readonly run: (facts: () => void) => Effect.Effect<void>
  /** Gives the buffer the client's control, once the client has made the fold. */
  readonly connect: (control: ProtocolClient.FoldControl) => void
}

/** A fact buffer delivering to a sink, whose `later` fibers live in the scope. */
export const makeFactBuffer = (sink: Adapter.Sink): Effect.Effect<FactBuffer, never, Scope.Scope> =>
  Effect.map(FiberSet.makeRuntime<never, unknown, unknown>(), (fork) => {
    let out: Array<Adapter.Fact> = []
    let queued: Array<Effect.Effect<unknown, unknown>> = []
    const waiters = new Set<() => void>()
    let control: ProtocolClient.FoldControl | undefined
    const emit = (fact: Adapter.Fact): void => void out.push(fact)
    const flush = Effect.suspend(() => {
      const facts = out
      out = []
      return Effect.forEach(facts, sink, { discard: true }).pipe(
        Effect.andThen(Effect.sync(() => {
          for (const waiter of Array.from(waiters)) waiter()
          const list = queued
          queued = []
          for (const effect of list) fork(Effect.ignore(effect))
        }))
      )
    })
    return {
      emit,
      emitFrom: (realm, fact) => {
        if (realm.pending) realm.held.push(fact)
        else emit(fact)
      },
      announce: (realm, added) => {
        realm.pending = false
        emit(added)
        for (const fact of realm.held.splice(0)) emit(fact)
      },
      later: (effect) => void queued.push(effect),
      start: (effect) => void fork(Effect.ignore(effect)),
      waitFor: <A>(check: () => A | undefined) =>
        Effect.callback<A>((resume) => {
          const found = check()
          if (found !== undefined) return resume(Effect.succeed(found))
          const waiter = () => {
            const found = check()
            if (found === undefined) return
            waiters.delete(waiter)
            resume(Effect.succeed(found))
          }
          waiters.add(waiter)
          return Effect.sync(() => void waiters.delete(waiter))
        }),
      flush,
      run: (facts) =>
        Effect.suspend(() => {
          if (control === undefined) return Effect.die(new Error("The fact buffer has no client yet"))
          return control.run(Effect.suspend(() => {
            facts()
            return flush
          }))
        }),
      connect: (given) => {
        control = given
      }
    }
  })

// ── The navigable tree ────────────────────────────────────────────────────────────────────────────────────

/** A realm in the kit's tree: what the kit reads, which an adapter's entry extends. */
export interface RealmNode extends Pending {
  readonly id: Target.RealmId
  ended: boolean
}

/** A navigation in the kit's tree: what the kit reads, which an adapter's entry extends. */
export interface NavigationNode {
  readonly id: PageNavigation.Id
  ended: boolean
}

/** A navigable in the kit's tree, a page's main frame or a frame: what the kit reads. */
export interface NavigableNode<F> {
  readonly id: Target.NavigableId
  readonly parent: F | undefined
  readonly children: Set<F>
  readonly navigations: ReadonlyMap<string, NavigationNode>
  removed: boolean
}

/**
 * Removes a realm: `remove` forgets it in the adapter's tables, and a realm L1 was told of gets `RealmRemoved`;
 * a pending one never reached the model.
 */
export const removeRealm = <R extends RealmNode>(
  buffer: FactBuffer,
  realm: R,
  reason: Target.CloseReason,
  remove: (realm: R) => void
): void => {
  if (realm.ended) return
  realm.ended = true
  remove(realm)
  if (realm.pending) {
    realm.held.length = 0
    return
  }
  buffer.emit({ _tag: "RealmRemoved", realm: realm.id, reason })
}

/** Ends a navigation once: `remove` forgets it in the adapter's tables, and L1 gets its outcome. */
export const endNavigation = <N extends NavigationNode>(
  buffer: FactBuffer,
  navigation: N,
  outcome: Adapter.NavigationOutcome,
  evidence: string,
  remove: (navigation: N) => void
): void => {
  if (navigation.ended) return
  navigation.ended = true
  remove(navigation)
  buffer.emit({ _tag: "NavigationEnded", navigation: navigation.id, outcome, evidence })
}

/**
 * Ends a navigable and everything below it, deepest first: `remove` forgets each one in the adapter's tables,
 * with its document and realms; its navigations end with it, unreported, and L1 gets `NavigableRemoved`.
 */
export const removeNavigable = <F extends NavigableNode<F>>(
  buffer: FactBuffer,
  navigable: F,
  reason: Target.CloseReason,
  evidence: string,
  remove: (navigable: F, reason: Target.CloseReason) => void
): void => {
  if (navigable.removed) return
  for (const child of Array.from(navigable.children)) removeNavigable(buffer, child, reason, evidence, remove)
  navigable.removed = true
  navigable.parent?.children.delete(navigable)
  remove(navigable, reason)
  for (const navigation of navigable.navigations.values()) navigation.ended = true
  buffer.emit({ _tag: "NavigableRemoved", navigable: navigable.id, reason, evidence })
}

// ── Navigations a command started ─────────────────────────────────────────────────────────────────────────

/** A navigation a command started, which the browser hasn't announced yet. */
export interface Expected {
  readonly id: PageNavigation.Id
  readonly url: string
  readonly initiatedAs: Adapter.InitiatedAs
}

/** A navigable's expected navigations, oldest first. */
export interface Expectations {
  readonly list: Array<Expected>
}

export const makeExpectations = (): Expectations => ({ list: [] })

/** Mints a navigation's id before its command is sent, for the browser's event to take. */
export const expect = (
  ids: Ids,
  expectations: Expectations,
  url: string,
  initiatedAs: Adapter.InitiatedAs = "crossDocument"
): PageNavigation.Id => {
  const id = ids.navigation()
  expectations.list.push({ id, url, initiatedAs })
  return id
}

/** Takes an expectation back, as when its command failed; whether it was still there. */
export const unexpect = (expectations: Expectations, id: PageNavigation.Id): boolean => {
  const index = expectations.list.findIndex((expected) => expected.id === id)
  if (index < 0) return false
  expectations.list.splice(index, 1)
  return true
}

/** The expectation a navigation the browser announced fulfils: the oldest to its URL, else the oldest. */
export const take = (expectations: Expectations, url: string): Expected | undefined => {
  const normalized = normalize(url)
  const index = expectations.list.findIndex((expected) => normalize(expected.url) === normalized)
  return index >= 0 ? expectations.list.splice(index, 1)[0] : expectations.list.shift()
}

/**
 * A command that never started its navigation: once the events before its reply are folded (`drained`), its
 * expectation is taken back and the navigation reported started and failed, in one step of the worker. An event
 * that announced it first took the expectation, and then nothing is reported here (QUIRKS.md, Q233).
 */
export const neverStarted = (
  buffer: FactBuffer,
  options: {
    readonly drained: Effect.Effect<void>
    readonly expectations: Expectations
    readonly navigable: Target.NavigableId
    readonly navigation: PageNavigation.Id
    readonly url: string
    readonly error: string
    readonly evidence: string
  }
): Effect.Effect<void> =>
  Effect.andThen(
    options.drained,
    buffer.run(() => {
      if (!unexpect(options.expectations, options.navigation)) return
      buffer.emit({
        _tag: "NavigationStarted",
        navigation: options.navigation,
        navigable: options.navigable,
        url: options.url,
        initiatedAs: "crossDocument"
      })
      buffer.emit({
        _tag: "NavigationEnded",
        navigation: options.navigation,
        outcome: { _tag: "Failed", error: options.error, errorDocument: Option.none() },
        evidence: options.evidence
      })
    })
  )

// ── Event handlers ────────────────────────────────────────────────────────────────────────────────────────

/** A fold's event handlers, each typed by its event, and the events they need. */
export interface Handlers<C> {
  /** Handles an event with its decoded params; `context` is what the fold resolved the session to. */
  readonly on: <M extends string, A>(
    event: Protocol.EventDef<M, A>,
    handler: (params: A, context: C) => void
  ) => Handlers<C>
  /** The events the handlers need, by method: the fold's `events`. */
  readonly events: ReadonlyMap<string, Protocol.EventDef<string, any>>
  /** Calls the handler of a method, if there is one. */
  readonly apply: (method: string, params: unknown, context: C) => void
}

/** An empty table of handlers. A method handled twice is a defect, as the fold could call only one. */
export const handlers = <C>(): Handlers<C> => {
  const events = new Map<string, Protocol.EventDef<string, any>>()
  const table = new Map<string, (params: unknown, context: C) => void>()
  const self: Handlers<C> = {
    on: (event, handler) => {
      if (table.has(event.method)) throw new Error(`${event.method} is handled twice`)
      events.set(event.method, event)
      // The client decodes an event's params with its codec before the fold sees them
      table.set(event.method, handler as (params: unknown, context: C) => void)
      return self
    },
    events,
    apply: (method, params, context) => table.get(method)?.(params, context)
  }
  return self
}

// ── Values ────────────────────────────────────────────────────────────────────────────────────────────────

/** Bytes as base64, as protocols carry them. */
export const encodeBase64 = (bytes: Uint8Array): string => Encoding.encode(bytes)

/** Base64 the browser sent, decoded; `method` names what carried it, for the failure. */
export const decodeBase64 = (text: string, method: string): Effect.Effect<Uint8Array, Adapter.AdapterError> => {
  const decoded = Encoding.decode(text)
  return decoded._tag === "Success"
    ? Effect.succeed(decoded.success)
    : Effect.fail(undecodable(method, `its base64 didn't decode: ${decoded.failure.message}`))
}

/** Base64 decoded in the fold, which can't fail: `undefined` where it doesn't decode. */
export const tryDecodeBase64 = (text: string): Uint8Array | undefined => {
  const decoded = Encoding.decode(text)
  return decoded._tag === "Success" ? decoded.success : undefined
}

/** A body as the browser sent it: base64, or text. */
export const bodyBytes = (
  body: string,
  base64Encoded: boolean,
  method: string
): Effect.Effect<Uint8Array, Adapter.AdapterError> =>
  base64Encoded ? decodeBase64(body, method) : Effect.succeed(new TextEncoder().encode(body))

/** A URL as the browser writes it, so `http://a` and `http://a/` compare equal; anything else as it is. */
export const normalize = (url: string): string => {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

/** Headers from a protocol's record of them, each value as a string. */
export const headersOf = (headers: unknown): Headers.Headers => {
  const record: Record<string, string> = {}
  if (typeof headers === "object" && headers !== null) {
    for (const [name, value] of Object.entries(headers)) record[name] = String(value)
  }
  return Headers.fromInput(record)
}

const methods = new Set(NetworkRequest.Method.literals as ReadonlyArray<string>)

/** A request's method, as the model knows them; another is `GET`. */
export const methodOf = (method: string): NetworkRequest.NetworkRequest["method"] =>
  (methods.has(method) ? method : "GET") as NetworkRequest.NetworkRequest["method"]

/** A console message's level from the console method or type the page used (`warn`, or CDP's `warning`). */
export const consoleLevel = (type: string): ConsoleMessage.Level =>
  type === "error" || type === "assert"
    ? "error"
    : type === "warning" || type === "warn"
    ? "warning"
    : type === "info"
    ? "info"
    : type === "debug"
    ? "debug"
    : "log"

/** A console argument as CDP and WebKit describe one: a `Runtime.RemoteObject`. */
export interface RemoteObject {
  readonly type: string
  readonly value?: unknown
  readonly unserializableValue?: string | undefined
  readonly description?: string | undefined
}

/** A remote object's text, as the console prints it. */
export const textOf = (value: RemoteObject): string =>
  value.type === "string"
    ? String(value.value)
    : value.unserializableValue !== undefined
    ? value.unserializableValue
    : value.value !== undefined && value.type !== "object"
    ? String(value.value)
    : value.description ?? value.type

/** A console argument, for the Console Standard's formatter (QUIRKS.md, Q33). */
export const argumentOf = (value: RemoteObject): ConsoleFormat.Argument => ({
  text: textOf(value),
  value: value.type === "string" || value.type === "number"
    ? (typeof value.value === "string" || typeof value.value === "number" ? value.value : undefined) ??
      (value.unserializableValue === undefined ? undefined : Number(value.unserializableValue))
    : undefined,
  string: value.type === "string"
})

/** A serialized value as plain JSON, for protocols that take arguments by value. */
export const plain = (value: Adapter.RemoteValue): unknown => {
  switch (value.type) {
    case "undefined":
      return undefined
    case "null":
      return null
    case "string":
    case "boolean":
      return value.value
    case "number":
      return typeof value.value === "number" ? value.value : Number(value.value)
    case "array":
    case "set":
      return (value.value ?? []).map(plain)
    case "object":
    case "map":
      return Object.fromEntries(
        (value.value ?? []).map(([key, item]) => [typeof key === "string" ? key : String(plain(key)), plain(item)])
      )
    case "date":
      return value.value
    default:
      return null
  }
}

/**
 * An evaluation's argument, as the protocol takes it: a value, a handle the connection holds, or a node by its
 * binding. A handle it doesn't hold any more, or a node its realm can't resolve, fails as `Gone`; one another
 * connection minted, `Foreign`. Nothing is sent with an empty reference.
 */
export const argument = <A>(
  local: Adapter.LocalValue,
  options: {
    readonly ids: Ids
    /** The realm called, which a missing handle or node is reported against. */
    readonly realm: Target.RealmId
    readonly value: (value: Adapter.RemoteValue) => A
    readonly handle: (handle: Adapter.HandleId) => A | undefined
    readonly node: (node: Adapter.NodeBinding) => A | undefined
  }
): Effect.Effect<A, Adapter.AdapterError> =>
  Effect.suspend(() => {
    switch (local._tag) {
      case "Value":
        return Effect.succeed(options.value(local.value))
      case "Handle": {
        const resolved = options.handle(local.handle)
        return resolved !== undefined
          ? Effect.succeed(resolved)
          : Effect.fail(
            missing(options.ids, local.handle, () =>
              gone({ _tag: "Realm", id: options.realm }, { _tag: "RealmDestroyed" }))
          )
      }
      case "Node": {
        const resolved = options.node(local.node)
        return resolved !== undefined
          ? Effect.succeed(resolved)
          : Effect.fail(
            missing(
              options.ids,
              local.node.document,
              () =>
                gone({ _tag: "Document", id: local.node.document }, { _tag: "DocumentReplaced" })
            )
          )
      }
    }
  })
