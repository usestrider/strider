/**
 * Realms and evaluation on stock WebKit. Realms are execution contexts, of the page's world only: stock WebKit's
 * inspector makes no other (QUIRKS.md, Q194). WebKit never says one is destroyed: a document's realms end when
 * another document commits in its frame, when the frame goes, or with their target.
 *
 * Evaluation runs through a helper installed in each realm (`webkitUtility.ts`), because WebKit calls functions only
 * on objects and serializes only JSON. The helper returns WebDriver BiDi's `RemoteValue`.
 */
import * as Cache from "effect/Cache"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Protocol from "../../protocol/Protocol.ts"
import type * as L1Target from "../../Target.ts"
import * as Runtime from "../../webkit-stock-protocol/Runtime.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as Groups from "../objectGroups.ts"
import * as Utility from "../webkitUtility.ts"
import {
  anchorGroup,
  anchorKey,
  anchorRealm,
  contextKey,
  documentOf,
  type Event,
  frameKey,
  type RealmEntry,
  realmOf,
  type State
} from "./state.ts"
import { originOf } from "./tree.ts"

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

/** The `RemoteValue` type of a WebKit remote object, for a value kept as a handle. */
const remoteType = (object: Runtime.RemoteObject): Adapter.RemoteValue["type"] => {
  switch (object.type) {
    case "undefined":
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "function":
      return object.type as Adapter.RemoteValue["type"]
  }
  switch (object.subtype) {
    case "null":
      return "null"
    case "array":
    case "node":
    case "regexp":
    case "date":
    case "error":
    case "map":
    case "set":
    case "weakmap":
    case "weakset":
    case "proxy":
      return object.subtype as Adapter.RemoteValue["type"]
    case "iterator":
      return "generator"
  }
  switch (object.className) {
    case "Promise":
      return "promise"
    case "Window":
      return "window"
    case "NodeList":
      return "nodelist"
    case "HTMLCollection":
      return "htmlcollection"
    case "ArrayBuffer":
      return "arraybuffer"
  }
  return object.className !== undefined && /^(Big)?(Int|Uint|Float)\d+(Clamped)?Array$/.test(object.className)
    ? "typedarray"
    : "object"
}

/** A primitive remote object's value. */
const primitive = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
  switch (object.type) {
    case "undefined":
      return { type: "undefined" }
    case "string":
      return { type: "string", value: String(object.value) }
    case "boolean":
      return { type: "boolean", value: Boolean(object.value) }
    case "number": {
      const description = object.description ?? String(object.value)
      return {
        type: "number",
        value: typeof object.value === "number" && !Object.is(object.value, -0)
          ? object.value
          : description === "-0" || description === "NaN" || description === "Infinity" || description === "-Infinity"
          ? description
          : Number(description)
      }
    }
    case "bigint":
      return { type: "bigint", value: (object.description ?? "0").replace(/n$/, "") }
    default:
      return object.subtype === "null" ? { type: "null" } : { type: remoteType(object) } as Adapter.RemoteValue
  }
}

/** A serialized value from the helper: nodes carry their index in the batch, replaced by their binding here. */
type Serialized = Adapter.RemoteValue & { readonly nodeIndex?: number }

const withBindings = (
  value: Serialized,
  binding: (index: number) => Adapter.NodeBinding | undefined
): Adapter.RemoteValue => {
  switch (value.type) {
    case "node": {
      const { nodeIndex, ...rest } = value as Serialized & { readonly type: "node" }
      const node = nodeIndex === undefined ? undefined : binding(nodeIndex)
      return node === undefined ? rest : { ...rest, node }
    }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return value.value === undefined ? value : {
        ...value,
        value: value.value.map((item) => withBindings(item as Serialized, binding))
      }
    case "object":
    case "map":
      return value.value === undefined ? value : {
        ...value,
        value: value.value.map(([key, item]) =>
          [
            typeof key === "string" ? key : withBindings(key as Serialized, binding),
            withBindings(item as Serialized, binding)
          ] as const
        )
      }
    default:
      return value
  }
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Runtime.executionContextCreated, (params, { state, target }) => {
      // A provisional target's contexts are its empty first document's, which never commits in the page
      if (target === undefined || target.page.provisional === target) return
      const context = params.context
      if (context.type === "internal") return
      const frame = state.frames.get(frameKey(target, context.frameId))
      const document = frame?.document
      if (frame === undefined || document === undefined) return
      const realm: RealmEntry = {
        id: state.ids.realm(),
        session: target.session,
        contextId: context.id as number,
        target,
        document,
        world: context.type === "normal" ? { _tag: "Main" } : { _tag: "Isolated", name: context.name },
        ended: false,
        pending: false,
        held: []
      }
      state.realms.set(realm.id, realm)
      state.realmsByContext.set(contextKey(target, realm.contextId!), realm)
      document.realms.add(realm)
      state.buffer.emit({
        _tag: "RealmAdded",
        realm: realm.id,
        origin: originOf(document.url),
        kind: { _tag: "Window", navigable: frame.id, document: document.id, world: realm.world }
      })
    })

// ── Realms ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A document's realm in a world: the page's only, since stock WebKit's inspector makes no other (QUIRKS.md,
 * Q194). The page's world comes to each new document, reported a moment after it commits: its report is waited
 * for, or the document's end.
 */
export const realmFor = Effect.fnUntraced(function*(state: State, id: L1Target.DocumentId, world: Adapter.World) {
  if (world._tag !== "Main") {
    return yield* Effect.fail(Kit.unsupported("isolatedWorlds", "stock WebKit's inspector makes no worlds"))
  }
  const document = yield* documentOf(state, id)
  const found = yield* state.buffer.waitFor(() =>
    [...document.realms].find((realm) => !realm.ended && realm.world._tag === "Main") ??
      (state.documents.get(id) === document ? undefined : null)
  )
  if (found === null) return yield* Effect.fail(Kit.gone({ _tag: "Document", id }, { _tag: "DocumentReplaced" }))
  return found.id
})

/** A command in a realm that failed: `Gone` where it was refused, as a context that's gone is, or the realm ended. */
const madeIn = (realm: RealmEntry) => (error: Protocol.ProtocolError): Adapter.AdapterError =>
  error.reason._tag === "Rejected"
    ? Kit.gone({ _tag: "Realm", id: realm.id }, { _tag: "RealmDestroyed" })
    : Kit.realmFailure(realm.id, () => realm.ended)(error)

/** An object an expression makes in a realm, by its id. */
const make = (realm: RealmEntry, params: Omit<Runtime.EvaluateParams, "contextId">) =>
  Runtime.evaluate({
    ...params,
    ...(realm.contextId === undefined ? {} : { contextId: realm.contextId as Runtime.ExecutionContextId }),
    doNotPauseOnExceptionsAndMuteConsole: true
  }).pipe(
    Protocol.on(realm.session),
    Effect.mapError(madeIn(realm)),
    Effect.flatMap((reply) =>
      reply.wasThrown === true || reply.result.objectId === undefined
        ? Effect.fail(Kit.gone({ _tag: "Realm", id: realm.id }, { _tag: "RealmDestroyed" }))
        : Effect.succeed(reply.result.objectId as string)
    )
  )

/** How long a cached object is kept: for good once made, and not at all if making it failed, so it's tried again. */
export const keepMade = (exit: Exit.Exit<string, Adapter.AdapterError>): Duration.Duration =>
  Exit.isFailure(exit) ? Duration.zero : Duration.infinity

/** The most realms' helpers, or groups' anchors, kept: an evicted one is made again. */
export const madeCapacity = 4096

/** A realm's helper (`webkitUtility.ts`), which every evaluation in it calls: `State.helpers`' lookup. */
export const installHelper = (state: State, id: L1Target.RealmId) =>
  Effect.flatMap(realmOf(state, id), (realm) => make(realm, { expression: Utility.source }))

/**
 * An object group's anchor in a realm: `State.anchors`' lookup. WebKit puts what a call returns in the object group
 * of the object it was called on, and its `callFunctionOn` names no group: a group's handles come from calls on an
 * object made in it.
 */
export const makeAnchor = (state: State, key: string) =>
  Effect.flatMap(
    realmOf(state, anchorRealm(key)),
    (realm) => make(realm, { expression: "({})", objectGroup: anchorGroup(key) })
  )

/** Forgets the anchors `drop` names, by realm and group. */
export const dropAnchors = (state: State, drop: (realm: L1Target.RealmId, group: string) => boolean) =>
  Effect.flatMap(
    Cache.keys(state.anchors),
    (keys) =>
      Effect.forEach(
        Array.from(keys).filter((key) => drop(anchorRealm(key), anchorGroup(key))),
        (key) => Cache.invalidate(state.anchors, key),
        { discard: true }
      )
  )

/** Forgets what was made in a realm that ended. */
export const forgetRealm = (state: State, id: L1Target.RealmId) =>
  Effect.andThen(Cache.invalidate(state.helpers, id), dropAnchors(state, (realm) => realm === id))

// ── Evaluation ────────────────────────────────────────────────────────────────────────────────────────────

export const evaluate = Effect.fnUntraced(function*(
  state: State,
  id: L1Target.RealmId,
  call: Adapter.EvaluationCall
) {
  const realm = yield* realmOf(state, id)
  const helper = yield* Cache.get(state.helpers, id)
  const anchor = call.result === "handle" && call.group !== undefined
    ? yield* Cache.get(state.anchors, anchorKey(id, call.group))
    : undefined
  const on = Protocol.on(realm.session)
  const realmGone = Kit.realmFailure(id, () => realm.ended)
  // A node crosses as its binding: stock WebKit has one world, the page's, whose object the binding already is,
  // and its `DOM.resolveNode` takes only a node id (QUIRKS.md, Q229)
  const args = yield* Effect.forEach(call.arguments, (local) =>
    Kit.argument<Runtime.CallArgument>(local, {
      ids: state.ids,
      realm: id,
      value: (value) => ({ value }),
      handle: (handle) => {
        const entry = state.handles.get(handle)
        return entry === undefined ? undefined : { objectId: entry.objectId as Runtime.RemoteObjectId }
      },
      node: (node) => ({ objectId: node.binding as Runtime.RemoteObjectId })
    }))
  const reply = yield* Runtime.callFunctionOn({
    objectId: (anchor ?? helper) as Runtime.RemoteObjectId,
    functionDeclaration: anchor === undefined
      ? Utility.call(call.functionDeclaration, call.result, call.awaitPromise)
      : Utility.callBeside(call.functionDeclaration, call.result, call.awaitPromise),
    arguments: [
      ...(anchor === undefined ? [] : [{ objectId: helper as Runtime.RemoteObjectId }]),
      { value: call.arguments.map((argument) => argument._tag === "Value" ? "v" : "h") },
      ...args
    ],
    awaitPromise: call.awaitPromise,
    returnByValue: false,
    emulateUserGesture: call.userActivation
  }).pipe(on, Effect.mapError(realmGone))
  const document = realm.document
  const handleOf = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
    const type = remoteType(object)
    if (object.objectId === undefined || object.subtype === "null") return primitive(object)
    const handle = state.ids.handle()
    state.handles.set(handle, { session: realm.session, realm: id, objectId: object.objectId, group: call.group })
    if (call.group !== undefined) Groups.join(state.groups, call.group, handle)
    return type === "node"
      ? {
        type,
        handle,
        ...(document === undefined ? {} : { node: { document: document.id, binding: object.objectId } })
      }
      : { type, handle } as Adapter.RemoteValue
  }
  if (reply.wasThrown === true) {
    const thrown = reply.result
    const text = thrown.description ?? Kit.textOf(thrown)
    return {
      _tag: "Exception",
      text,
      exception: thrown.objectId === undefined
        ? primitive(thrown)
        : { type: remoteType(thrown) } as Adapter.RemoteValue,
      stack: Option.fromUndefinedOr(text.includes("\n") ? text : undefined)
    } satisfies Adapter.RemoteResult
  }
  if (call.result === "handle") {
    return { _tag: "Value", value: handleOf(reply.result) } satisfies Adapter.RemoteResult
  }
  const encoded = yield* Effect.try({
    try: () => JSON.parse(String(reply.result.value)) as { readonly batch: number; readonly value: Serialized },
    catch: () => Kit.undecodable("Runtime.callFunctionOn", "the helper's result isn't JSON")
  })
  if (encoded.batch === 0 || document === undefined) {
    return { _tag: "Value", value: withBindings(encoded.value, () => undefined) } satisfies Adapter.RemoteResult
  }
  // The nodes it holds, as remote objects: WebKit's handle on a node
  const batch = yield* Runtime.callFunctionOn({
    objectId: helper as Runtime.RemoteObjectId,
    functionDeclaration: Utility.takeNodes,
    arguments: [{ value: encoded.batch }]
  }).pipe(on, Effect.mapError(realmGone))
  const objectIds = new Map<number, string>()
  if (batch.result.objectId !== undefined) {
    const { properties } = yield* Runtime.getProperties({ objectId: batch.result.objectId, ownProperties: true })
      .pipe(on, Effect.mapError(realmGone))
    for (const property of properties) {
      const index = Number(property.name)
      if (Number.isInteger(index) && property.value?.objectId !== undefined) {
        objectIds.set(index, property.value.objectId)
      }
    }
    yield* Runtime.releaseObject({ objectId: batch.result.objectId }).pipe(on, Effect.ignore)
  }
  return {
    _tag: "Value",
    value: withBindings(encoded.value, (index) => {
      const objectId = objectIds.get(index)
      return objectId === undefined ? undefined : { document: document.id, binding: objectId }
    })
  } satisfies Adapter.RemoteResult
})

/** A group given whole goes in one command, its anchors with it (QUIRKS.md, Q132). */
export const releaseHandles = (state: State, list: ReadonlyArray<Adapter.HandleId>) =>
  Effect.forEach(Groups.release(state.groups, state.handles, list), (released) =>
    (released._tag === "Group"
      ? dropAnchors(state, (_, group) => group === released.group).pipe(
        Effect.andThen(
          Runtime.releaseObjectGroup({ objectGroup: released.group }).pipe(Protocol.on(released.first.session))
        )
      )
      : Runtime.releaseObject({ objectId: released.handle.objectId as Runtime.RemoteObjectId }).pipe(
        Protocol.on(released.handle.session)
      )).pipe(Effect.ignore), { concurrency: "unbounded", discard: true })
