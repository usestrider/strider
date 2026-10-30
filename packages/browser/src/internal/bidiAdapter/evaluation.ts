/**
 * Realms and evaluation on BiDi: the `script` domain's realms, what they log and throw (`log.entryAdded`), and
 * calls in them. Firefox creates a new document's main-world realm before the document commits: one created for
 * a context whose document already has one is held, pending, for the next commit. Values cross in BiDi's own
 * serialization, which L1's `RemoteValue` follows.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Log from "../../bidi-protocol/Log.ts"
import * as Script from "../../bidi-protocol/Script.ts"
import * as ConsoleMessage from "../../ConsoleMessage.ts"
import * as L1Target from "../../Target.ts"
import * as UncaughtException from "../../UncaughtException.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Urls from "../urls.ts"
import { documentOf, type Event, navigableOf, type RealmEntry, realmOf, type State } from "./state.ts"
import { addWindowRealm, removeRealm } from "./tree.ts"

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

/** BiDi's number, whose special values are strings: one it doesn't name is read as a number. */
const numberValue = (value: number | string): number | "NaN" | "-0" | "Infinity" | "-Infinity" =>
  typeof value === "number"
    ? value
    : value === "NaN" || value === "-0" || value === "Infinity" || value === "-Infinity"
    ? value
    : Number(value)

/**
 * A value BiDi serialized, as the contract's `RemoteValue`. With `keep`, an object's handle is held for the
 * caller; a node names its document by the realm's.
 */
export const toRemote = (
  state: State,
  value: Script.RemoteValue,
  realm: RealmEntry,
  keep: boolean
): Adapter.RemoteValue => {
  const hold = (handle: Script.Handle | undefined) => {
    if (!keep || handle === undefined) return undefined
    const id = state.ids.handle()
    state.handles.set(id, { handle, realm: realm.bidi })
    return id
  }
  const item = (item: Script.RemoteValue) => toRemote(state, item, realm, keep)
  switch (value.type) {
    case "undefined":
    case "null":
      return { type: value.type }
    case "string":
      return { type: "string", value: value.value }
    case "boolean":
      return { type: "boolean", value: value.value }
    case "bigint":
      return { type: "bigint", value: value.value }
    case "date":
      return { type: "date", value: value.value }
    case "number":
      return { type: "number", value: numberValue(value.value) }
    case "regexp":
      return { type: "regexp", value: value.value }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return { type: value.type, handle: hold(value.handle), value: value.value?.map(item) }
    case "object":
    case "map":
      return {
        type: value.type,
        handle: hold(value.handle),
        value: value.value?.map(([key, member]) => [typeof key === "string" ? key : item(key), item(member)] as const)
      }
    case "node": {
      const handle = hold(value.handle)
      const document = realm.navigable?.document
      return {
        type: "node",
        handle,
        node: document !== undefined && value.sharedId !== undefined
          ? { document: document.id, binding: value.sharedId }
          : undefined,
        value: value.value === undefined
          ? undefined
          : {
            nodeType: value.value.nodeType,
            localName: value.value.localName,
            childNodeCount: value.value.childNodeCount,
            attributes: value.value.attributes
          }
      }
    }
    default:
      return { type: value.type, handle: hold(value.handle) }
  }
}

/** A value as an argument, as `script.callFunction` takes one. */
export const localValue = (value: Adapter.RemoteValue): Script.LocalValue => {
  switch (value.type) {
    case "undefined":
    case "null":
      return { type: value.type }
    case "string":
      return { type: "string", value: value.value }
    case "boolean":
      return { type: "boolean", value: value.value }
    case "bigint":
      return { type: "bigint", value: value.value }
    case "date":
      return { type: "date", value: value.value }
    case "number":
      return { type: "number", value: value.value }
    case "regexp":
      return { type: "regexp", value: value.value }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return { type: value.type === "set" ? "set" : "array", value: (value.value ?? []).map(localValue) }
    case "object":
    case "map":
      return {
        type: value.type,
        value: (value.value ?? []).map(([key, item]) =>
          [typeof key === "string" ? key : localValue(key), localValue(item)] as const
        )
      }
    case "node":
      // A shared id names a node in every realm of its document
      return value.node === undefined ? { type: "undefined" } : { sharedId: value.node.binding as Script.SharedId }
    default:
      return { type: "undefined" }
  }
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

// How Firefox's text begins for a thrown value that isn't an object
const uncaughtValue = "uncaught exception: "

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Script.realmCreated, (params, { state }) => {
      if (state.realms.has(params.realm)) return
      if (params.type === "window") {
        const navigable = navigableOf(state, params.context)
        if (navigable === undefined) return
        const realm: RealmEntry = {
          id: state.ids.realm(),
          bidi: params.realm,
          navigable,
          world: params.sandbox === undefined ? { _tag: "Main" } : { _tag: "Isolated", name: params.sandbox },
          origin: params.origin,
          ended: false,
          pending: false,
          held: []
        }
        state.realms.set(realm.bidi, realm)
        state.realmsById.set(realm.id, realm)
        const document = navigable.document
        // A second main-world realm for a document belongs to the next one, which hasn't committed yet
        if (document === undefined || (realm.world._tag === "Main" && document.hadMainRealm)) {
          realm.pending = true
          navigable.pendingRealms.push(realm)
          if (realm.world._tag === "Main") navigable.restoring?.(realm)
        } else {
          addWindowRealm(state, realm, document)
        }
        return
      }
      const realm: RealmEntry = {
        id: state.ids.realm(),
        bidi: params.realm,
        navigable: undefined,
        world: { _tag: "Main" },
        origin: params.origin,
        ended: false,
        pending: false,
        held: []
      }
      state.realms.set(realm.bidi, realm)
      state.realmsById.set(realm.id, realm)
      // A dedicated worker belongs to its owner's page; BiDi names no context for shared and service workers
      const owner = params.type === "dedicated-worker" ? state.realms.get(params.owners[0]) : undefined
      const page = owner === undefined ? undefined : owner.navigable?.page ?? state.workerPages.get(owner)
      if (page !== undefined) state.workerPages.set(realm, page)
      state.buffer.emit({
        _tag: "RealmAdded",
        realm: realm.id,
        origin: params.origin,
        kind: {
          _tag: "Worker",
          worker: params.type === "dedicated-worker"
            ? { _tag: "Dedicated", owner: Option.fromUndefinedOr(owner?.id) }
            : params.type === "shared-worker"
            ? { _tag: "Shared" }
            : { _tag: "Service", scope: Option.none() },
          // A worker realm's origin is its script's URL
          url: params.origin,
          page: Option.fromUndefinedOr(page?.id),
          context: Option.fromUndefinedOr(page?.context.id)
        }
      })
    })
    .on(Script.realmDestroyed, (params, { state }) => {
      const realm = state.realms.get(params.realm)
      // One created and destroyed before its document committed never reached the model
      if (realm !== undefined) removeRealm(state, realm, new L1Target.RealmDestroyed({}))
    })
    .on(Log.entryAdded, (params, { state }) => {
      const realm = state.realms.get(params.source.realm)
      const navigable = navigableOf(state, params.source.context)
      const top = params.stackTrace?.callFrames[0]
      // BiDi's lines and columns are 0-based; a location is 1-based, as stack traces print it. A script with no URL, or
      // one named by a string that isn't a URL, has no location
      const location = top === undefined ? Option.none() : Option.map(Urls.reportedOption(top.url), (url) => ({
        url,
        line: top.lineNumber + 1,
        column: top.columnNumber + 1
      }))
      const origin: L1Target.EventOrigin = navigable !== undefined
        ? { _tag: "Page", page: navigable.page.id }
        : realm !== undefined
        ? { _tag: "Worker", realm: realm.id }
        : { _tag: "Page", page: "" as L1Target.NavigableId }
      if (params.type === "console") {
        if (realm === undefined) return
        state.buffer.emitFrom(realm, {
          _tag: "ConsoleMessage",
          realm: realm.id,
          message: new ConsoleMessage.ConsoleMessage({
            // The console method says what the page wrote; BiDi's level is coarser (`console.log` is `info`)
            level: Kit.consoleLevel("method" in params ? params.method : "log"),
            // Firefox formats the call itself, `%f` as printf does (QUIRKS.md, Q33), and sends that text as the only
            // argument, so it is the text
            text: params.text ?? "",
            location,
            origin,
            at: Adapter.now()
          })
        })
        return
      }
      if (params.type === "javascript") {
        const text = params.text ?? ""
        // A thrown value that isn't an Error, such as a string, reads as an Error whose message is the value
        const primitive = text.startsWith(uncaughtValue)
        const colon = primitive ? -1 : text.indexOf(": ")
        const name = colon > 0 ? text.slice(0, colon) : "Error"
        const message = primitive ? text.slice(uncaughtValue.length) : colon > 0 ? text.slice(colon + 2) : text
        const frames = params.stackTrace?.callFrames ?? []
        const fact: Adapter.Fact = {
          _tag: "UncaughtException",
          realm: Option.fromUndefinedOr(realm?.id),
          exception: new UncaughtException.UncaughtException({
            // Firefox reports a rejection exactly as a throw
            kind: "unknown",
            name,
            message,
            stack: frames.length === 0 ? Option.none() : Option.some(
              [
                `${name}: ${message}`,
                ...frames.map((frame) =>
                  `    at ${frame.functionName === "" ? "<anonymous>" : frame.functionName} (${frame.url}:${
                    frame.lineNumber + 1
                  }:${frame.columnNumber + 1})`
                )
              ].join("\n")
            ),
            origin,
            at: Adapter.now()
          })
        }
        if (realm === undefined) state.buffer.emit(fact)
        else state.buffer.emitFrom(realm, fact)
      }
    })

// ── Operations ────────────────────────────────────────────────────────────────────────────────────────────

export const realm = Effect.fnUntraced(function*(state: State, id: L1Target.DocumentId, world: Adapter.World) {
  const document = yield* documentOf(state, id)
  const find = () =>
    [...document.realms].find((realm) =>
      !realm.ended && realm.world._tag === world._tag &&
      (world._tag === "Main" || (realm.world._tag === "Isolated" && realm.world.name === world.name))
    )
  const replaced = () => Kit.gone({ _tag: "Document", id }, new L1Target.DocumentReplaced({}))
  if (world._tag === "Main") {
    // The main world's realm may be reported after the document commits: wait for it, or the document's end
    const found = yield* state.buffer.waitFor(() =>
      find() ?? (state.documents.has(id) ? undefined : ("ended" as const))
    )
    return found === "ended" ? yield* Effect.fail(replaced()) : found.id
  }
  const existing = find()
  if (existing !== undefined) return existing.id
  // Evaluating in a sandbox creates its realm
  const result = yield* Kit.protocol(state.send(Script.evaluate({
    expression: "0",
    target: { context: document.navigable.bidi, sandbox: world.name },
    awaitPromise: false
  })))
  yield* state.root().drainObserved
  const created = state.realms.get(result.realm)
  if (created === undefined || created.ended) return yield* Effect.fail(replaced())
  return created.id
})

export const evaluate = Effect.fnUntraced(function*(state: State, id: L1Target.RealmId, call: Adapter.EvaluationCall) {
  const realm = yield* realmOf(state, id)
  const keep = call.result === "handle"
  const args = yield* Effect.forEach(call.arguments, (local) =>
    Kit.argument<Script.LocalValue>(local, {
      ids: state.ids,
      realm: id,
      value: localValue,
      handle: (handle) => {
        const entry = state.handles.get(handle)
        return entry === undefined ? undefined : { handle: entry.handle }
      },
      // A shared id names a node in every realm of its document
      node: (node) => ({ sharedId: node.binding as Script.SharedId })
    }))
  const reply = yield* Kit.protocol(state.send(Script.callFunction({
    functionDeclaration: call.functionDeclaration,
    awaitPromise: call.awaitPromise,
    target: { realm: realm.bidi },
    arguments: args,
    resultOwnership: keep ? "root" : "none",
    serializationOptions: { maxObjectDepth: keep ? 0 : 64, maxDomDepth: 0 },
    userActivation: call.userActivation
  })))
  if (reply.type === "exception") {
    const details = reply.exceptionDetails
    return {
      _tag: "Exception",
      text: details.text,
      exception: toRemote(state, details.exception, realm, false),
      stack: Option.none()
    } satisfies Adapter.RemoteResult
  }
  return { _tag: "Value", value: toRemote(state, reply.result, realm, keep) } satisfies Adapter.RemoteResult
})

/** A realm's handles go in one command (QUIRKS.md, Q132). */
export const releaseHandles = (state: State, list: ReadonlyArray<Adapter.HandleId>) =>
  Effect.suspend(() => {
    const byRealm = new Map<Script.Realm, Array<Script.Handle>>()
    for (const id of list) {
      const handle = state.handles.get(id)
      if (handle === undefined) continue
      state.handles.delete(id)
      byRealm.set(handle.realm, [...(byRealm.get(handle.realm) ?? []), handle.handle])
    }
    return Effect.forEach(
      byRealm,
      ([realm, owned]) => state.send(Script.disown({ handles: owned, target: { realm } })).pipe(Effect.ignore),
      { concurrency: "unbounded", discard: true }
    )
  })
