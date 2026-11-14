/**
 * Realms and evaluation on CDP: the `Runtime` domain's contexts as realms, what they log and throw, and calls in
 * them. Realms are keyed by `uniqueId`, since context ids repeat after a process swap, and a call names its realm
 * by `uniqueContextId`. Values come back in WebDriver BiDi's serialization, which CDP produces with
 * `serialization: "deep"`.
 */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as DOM from "../../cdp/DOM.ts"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as ConsoleMessage from "../../ConsoleMessage.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as L1Target from "../../Target.ts"
import * as UncaughtException from "../../UncaughtException.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import * as ConsoleFormat from "../consoleFormat.ts"
import * as Argument from "../evaluationArgument.ts"
import * as Groups from "../objectGroups.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import * as Urls from "../urls.ts"
import { contextKey, documentOf, type Event, frameOf, realmOf, type State } from "./state.ts"
import { addRealm, removeRealm } from "./tree.ts"

// ── Remote values ─────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

const isSerialized = (value: unknown): value is Runtime.DeepSerializedValue =>
  isRecord(value) && typeof value.type === "string"

/** A value serialized as a handle alone, with no value of its own. */
type Opaque =
  | "symbol"
  | "function"
  | "weakmap"
  | "weakset"
  | "generator"
  | "error"
  | "proxy"
  | "promise"
  | "typedarray"
  | "arraybuffer"
  | "window"

const opaque: ReadonlySet<string> = new Set<Opaque>([
  "symbol",
  "function",
  "weakmap",
  "weakset",
  "generator",
  "error",
  "proxy",
  "promise",
  "typedarray",
  "arraybuffer",
  "window"
])

const isOpaque = (type: string): type is Opaque => opaque.has(type)

const numberValue = (value: unknown): number | "NaN" | "-0" | "Infinity" | "-Infinity" =>
  typeof value === "number"
    ? value
    : value === "NaN" || value === "-0" || value === "Infinity" || value === "-Infinity"
    ? value
    : Number(value)

/** A value CDP serialized deeply, as the contract's `RemoteValue`; a node names its document by loader id. */
const toRemoteValue = (
  value: Runtime.DeepSerializedValue | undefined,
  documentOf: (loaderId: string) => L1Target.DocumentId | undefined
): Adapter.RemoteValue => {
  if (value === undefined) return { type: "undefined" }
  const v = value.value
  const item = (item: unknown) => toRemoteValue(isSerialized(item) ? item : undefined, documentOf)
  const type: string = value.type
  switch (type) {
    case "undefined":
      return { type: "undefined" }
    case "null":
      return { type: "null" }
    case "string":
      return { type: "string", value: String(v) }
    case "boolean":
      return { type: "boolean", value: v === true }
    case "bigint":
      return { type: "bigint", value: String(v) }
    case "date":
      return { type: "date", value: String(v) }
    case "number":
      return { type: "number", value: numberValue(v) }
    case "regexp":
      return {
        type: "regexp",
        value: isRecord(v)
          ? { pattern: String(v.pattern), ...(typeof v.flags === "string" ? { flags: v.flags } : {}) }
          : { pattern: "" }
      }
    case "array":
    case "set":
    case "nodelist":
    case "htmlcollection":
      return { type, value: Array.isArray(v) ? v.map(item) : undefined }
    case "object":
    case "map":
      return {
        type,
        value: Array.isArray(v)
          ? v.map((entry: unknown) => {
            const [key, member] = Array.isArray(entry) ? entry : []
            return [typeof key === "string" ? key : item(key), item(member)] as const
          })
          : undefined
      }
    case "node": {
      if (!isRecord(v)) return { type: "node", node: undefined, value: undefined }
      const document = typeof v.loaderId === "string" ? documentOf(v.loaderId) : undefined
      return {
        type: "node",
        node: document !== undefined && v.backendNodeId !== undefined
          ? { document, binding: String(v.backendNodeId) }
          : undefined,
        value: {
          nodeType: Number(v.nodeType),
          localName: typeof v.localName === "string" ? v.localName : undefined,
          childNodeCount: typeof v.childNodeCount === "number" ? v.childNodeCount : undefined,
          attributes: isRecord(v.attributes) ? v.attributes as Readonly<Record<string, string>> : undefined
        }
      }
    }
    default:
      // An opaque value, or a kind CDP added since: a handle with no value
      return { type: isOpaque(type) ? type : "object" }
  }
}

/** Whether native CDP would lose data inside this value. Top-level undefined has a native argument form. */
const requiresDecoder = (value: Adapter.RemoteValue, nested = false): boolean => {
  switch (value.type) {
    case "undefined":
      return nested
    case "null":
    case "string":
    case "boolean":
      return false
    case "number":
      return typeof value.value !== "number" || !Number.isFinite(value.value) || Object.is(value.value, -0)
    case "array":
      return (value.value ?? []).some((item) => requiresDecoder(item, true))
    case "object":
      return (value.value ?? []).some(([key, item]) =>
        typeof key !== "string" || key === "__proto__" || requiresDecoder(item, true)
      )
    default:
      return true
  }
}

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────

/** Folds a native context; opted-in popup replay uses the same handler after installing its frame tree. */
export const contextCreated = (params: Runtime.ExecutionContextCreatedParams, { state, target }: Event): void => {
  if (target === undefined) return
  const context = params.context
  const auxData = (context.auxData ?? {}) as { frameId?: string; isDefault?: boolean; type?: string }
  const base = {
    uniqueId: context.uniqueId ?? contextKey(target, context.id as number),
    contextId: context.id as number,
    target,
    origin: context.origin
  }
  if (target.kind === "worker" || target.kind === "service_worker" || target.kind === "shared_worker") {
    const realm = addRealm(state, { ...base, frame: undefined, world: { _tag: "Main" } })
    target.realm = realm
    state.buffer.emit({
      _tag: "RealmAdded",
      realm: realm.id,
      origin: context.origin,
      kind: {
        _tag: "Worker",
        worker: target.kind === "worker"
          ? { _tag: "Dedicated", owner: Option.none() }
          : target.kind === "shared_worker"
          ? { _tag: "Shared" }
          : { _tag: "Service", scope: Option.none() },
        url: Urls.reported(target.url),
        page: Option.fromUndefinedOr(target.page?.id),
        context: Option.fromUndefinedOr((target.page?.context ?? state.workerContexts.get(target))?.id)
      }
    })
    return
  }
  const frame = frameOf(state, auxData.frameId)
  const document = frame?.document
  if (frame === undefined || document === undefined) return
  const realm = addRealm(state, {
    ...base,
    frame,
    world: auxData.isDefault === true ? { _tag: "Main" } : { _tag: "Isolated", name: context.name }
  })
  // During a traversal, Chromium creates a restored document's realm before its commit
  if (realm.world._tag === "Main" && [...frame.navigations.values()].some((pending) => pending.traversal)) {
    realm.pending = true
    frame.pendingRealms.push(realm)
    return
  }
  document.realms.add(realm)
  state.buffer.emit({
    _tag: "RealmAdded",
    realm: realm.id,
    origin: context.origin,
    kind: { _tag: "Window", navigable: frame.id, document: document.id, world: realm.world }
  })
}

export const register = (handlers: Kit.Handlers<Event>) =>
  handlers
    .on(Runtime.executionContextCreated, contextCreated)
    .on(Runtime.executionContextDestroyed, (params, { state, target }) => {
      if (target === undefined || params.executionContextUniqueId === undefined) return
      const realm = state.realmsByUnique.get(params.executionContextUniqueId)
      if (realm !== undefined) removeRealm(state, realm, new L1Target.RealmDestroyed({}))
    })
    .on(Runtime.executionContextsCleared, (_params, { state, target }) => {
      for (const realm of Array.from(state.realms.values())) {
        if (realm.target === target && realm.frame !== undefined) {
          removeRealm(state, realm, new L1Target.RealmDestroyed({}))
        }
      }
    })
    .on(Runtime.consoleAPICalled, (params, { state, target }) => {
      if (target === undefined) return
      const realm = state.realmsByContext.get(contextKey(target, params.executionContextId as number))
      if (realm === undefined) return
      const top = params.stackTrace?.callFrames[0]
      state.buffer.emitFrom(realm, {
        _tag: "ConsoleMessage",
        realm: realm.id,
        message: new ConsoleMessage.ConsoleMessage({
          level: Kit.consoleLevel(params.type),
          text: ConsoleFormat.format(params.args.map(Kit.argumentOf)),
          // CDP's lines and columns are 0-based; a location is 1-based, as stack traces print it. A script with no URL,
          // or one named by a string that isn't a URL, has no location
          location: top === undefined ? Option.none() : Option.map(Urls.reportedOption(top.url), (url) => ({
            url,
            line: top.lineNumber + 1,
            column: top.columnNumber + 1
          })),
          origin: realm.frame !== undefined
            ? { _tag: "Page", page: realm.frame.page.id }
            : { _tag: "Worker", realm: realm.id },
          at: Adapter.now()
        })
      })
    })
    .on(Runtime.exceptionThrown, (params, { state, target }) => {
      if (target === undefined) return
      const details = params.exceptionDetails
      const realm = details.executionContextId === undefined
        ? target.realm
        : state.realmsByContext.get(contextKey(target, details.executionContextId as number))
      const exception = details.exception
      // `Uncaught TypeError: …`, or with no exception object, as for a timer an evaluation set, `Uncaught a string`
      const text = details.text.replace(/^Uncaught (\(in promise\) )?/, "")
      // A thrown value that isn't an Error, such as a string, reads as an Error whose message is the value
      const primitive = exception !== undefined && exception.type !== "object" && exception.type !== "function"
      const description = primitive
        ? exception.description ?? String(exception.value ?? exception.unserializableValue ?? "")
        : exception?.description ?? text
      const [first = text, ...rest] = description.split("\n")
      const colon = primitive ? -1 : first.indexOf(": ")
      const fact: Adapter.Fact = {
        _tag: "UncaughtException",
        realm: Option.fromUndefinedOr(realm?.id),
        exception: new UncaughtException.UncaughtException({
          kind: details.text.startsWith("Uncaught (in promise)") ? "unhandledRejection" : "thrown",
          name: primitive ? "Error" : exception?.className ?? (colon > 0 ? first.slice(0, colon) : "Error"),
          message: colon > 0 ? first.slice(colon + 2) : first,
          stack: !primitive && rest.length > 0 ? Option.some(description) : Option.none(),
          origin: realm?.frame !== undefined
            ? { _tag: "Page", page: realm.frame.page.id }
            : realm !== undefined
            ? { _tag: "Worker", realm: realm.id }
            : { _tag: "Page", page: target.page?.id ?? ("" as L1Target.NavigableId) },
          at: Adapter.now()
        })
      }
      if (realm === undefined) state.buffer.emit(fact)
      else state.buffer.emitFrom(realm, fact)
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
    // The main world's realm is reported a moment after the document commits: wait for it, or the document's end
    const found = yield* state.buffer.waitFor(() =>
      find() ?? (state.documents.has(id) ? undefined : ("ended" as const))
    )
    return found === "ended" ? yield* Effect.fail(replaced()) : found.id
  }
  const existing = find()
  if (existing !== undefined) return existing.id
  const frame = document.frame
  const { executionContextId } = yield* Kit.protocol(
    Page.createIsolatedWorld({ frameId: frame.frameId as Page.FrameId, worldName: world.name }).pipe(
      Protocol.on(frame.owner.session)
    )
  )
  yield* frame.owner.session.drainObserved
  const created = state.realmsByContext.get(contextKey(frame.owner, executionContextId as number))
  // The creation is addressed to the frame, not the document: a commit meanwhile makes the new realm the
  // replacement's, which is not the realm asked for, and the requested document is gone.
  if (created === undefined || !state.documents.has(id) || !document.realms.has(created)) {
    return yield* Effect.fail(replaced())
  }
  return created.id
})

export const evaluate = Effect.fnUntraced(function*(state: State, id: L1Target.RealmId, call: Adapter.EvaluationCall) {
  // A dedicated worker's evaluations wait until its script has loaded or it has ended (`workerGate` in
  // targets.ts); the operation's deadline bounds the wait, and an ended worker's realm is gone when looked up again
  const held = (yield* realmOf(state, id)).target.scriptLoaded
  if (held !== undefined) yield* Deferred.await(held)
  const realm = yield* realmOf(state, id)
  const on = Protocol.on(realm.target.session)
  const deadline = yield* ProtocolClient.CommandDeadline
  const timeout = Option.isSome(deadline)
    ? Duration.millis(yield* BrowserClock.left(deadline.value))
    : yield* Protocol.CommandTimeout
  const at = Option.isSome(deadline) ? deadline.value : yield* BrowserClock.after(Duration.toMillis(timeout))
  const failed = Kit.realmFailure(id, () => realm.ended)
  // Install cleanup before acquiring the first node. Each interruptible wire wait returns into the mask,
  // so its object ids are recorded before interruption can skip ownership registration.
  const nodes = new Map<string, string>()
  const resultIds = new Set<string>()
  let cleanup: Fiber.Fiber<void> | undefined
  const handoff = Effect.suspend(() => {
    const ids = new Set([...nodes.values(), ...resultIds])
    // A closing connection owns teardown of its realms; never start unowned work or wait here.
    if (ids.size === 0 || state.cleanupScope.state._tag === "Closed") return Effect.void
    const work = Effect.forEach(
      ids,
      (objectId) => Runtime.releaseObject({ objectId: objectId as Runtime.RemoteObjectId }).pipe(on, Effect.ignore),
      { discard: true }
    ).pipe(
      Operation.detached,
      Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning("CDP evaluation object cleanup failed", cause)
      ),
      Effect.interruptible
    )
    return work.pipe(
      Effect.forkIn(state.cleanupScope, { startImmediately: true }),
      Effect.tap((fiber) =>
        Effect.sync(() => {
          cleanup = fiber
        })
      ),
      Effect.asVoid
    )
  })
  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      for (const argument of call.arguments) {
        if (argument._tag !== "Node" || nodes.has(argument.node.binding)) continue
        const { object } = yield* DOM.resolveNode({
          backendNodeId: Number(argument.node.binding) as DOM.BackendNodeId,
          executionContextId: realm.contextId as Runtime.ExecutionContextId
        }).pipe(on, Effect.mapError(failed), restore)
        if (object.objectId !== undefined) nodes.set(argument.node.binding, object.objectId)
      }
      // Decide from values, never callback source: ordinary engine requests are strings (or have no arguments).
      const reconstruct = call.arguments.some((local) => local._tag === "Value" && requiresDecoder(local.value))
      const reply = yield* Effect.forEach(call.arguments, (local) =>
        Kit.argument<Runtime.CallArgument>(local, {
          ids: state.ids,
          realm: id,
          value: (value) => reconstruct ? { value } : value.type === "undefined" ? {} : { value: Kit.plain(value) },
          handle: (handle) => {
            const entry = state.handles.get(handle)
            return entry === undefined ? undefined : { objectId: entry.objectId as Runtime.RemoteObjectId }
          },
          node: (node) => {
            const objectId = nodes.get(node.binding)
            return objectId === undefined ? undefined : { objectId: objectId as Runtime.RemoteObjectId }
          }
        })).pipe(
          Effect.flatMap((args) =>
            Runtime.callFunctionOn({
              functionDeclaration: reconstruct ? Argument.call(call.functionDeclaration) : call.functionDeclaration,
              uniqueContextId: realm.uniqueId,
              arguments: reconstruct ?
                [
                  { value: call.arguments.map((argument) => argument._tag === "Value" ? "v" : "h") },
                  ...args
                ] :
                args,
              awaitPromise: call.awaitPromise,
              userGesture: call.userActivation,
              ...(call.group === undefined ? {} : { objectGroup: call.group }),
              returnByValue: false,
              serializationOptions: call.result === "value"
                ? { serialization: "deep", maxDepth: 64 }
                : { serialization: "idOnly" }
            }).pipe(
              on,
              Effect.catch((error) => {
                const reason = error.reason
                if (
                  reason._tag !== "Rejected" || reason.method !== "Runtime.callFunctionOn" ||
                  !((reason.code === -32000 &&
                    (reason.description === "Inspected target navigated or closed" ||
                      reason.description === "Execution context was destroyed.")) ||
                    // A call naming a context a frame's process swap destroyed before it ran
                    (reason.code === -32602 && reason.description === "uniqueContextId not found"))
                ) return Effect.fail(error)
                // CDP can reject before contexts-cleared or target-detached reaches the fold. Wait for that
                // evidence before reporting Gone; only the engine's caller may reroute, never this evaluation.
                // Keep the command's original deadline while those lifecycle events catch up.
                if (reason.description === "Inspected target navigated or closed") {
                  return state.buffer.waitFor(() => realm.ended ? true : undefined).pipe(
                    BrowserClock.until(at),
                    Effect.flatMap((ended) =>
                      Effect.fail(
                        Option.isSome(ended) ? error : new Protocol.ProtocolError({
                          reason: new Protocol.NoReply({ method: reason.method, timeout })
                        })
                      )
                    )
                  )
                }
                // "Execution context was destroyed." and "uniqueContextId not found" arrive after the destroy event
                // on the wire, and are no evidence by themselves: fold the events received before the reply, then
                // fail at once. `failed` reports Gone only if the realm ended, and the rejection otherwise.
                return state.buffer.run(() => {}).pipe(
                  BrowserClock.until(at),
                  Effect.flatMap((folded) =>
                    Effect.fail(
                      Option.isSome(folded) ? error : new Protocol.ProtocolError({
                        reason: new Protocol.NoReply({ method: reason.method, timeout })
                      })
                    )
                  )
                )
              }),
              Effect.mapError(failed),
              restore
            )
          )
        )
      if (call.result === "value" && call.releaseResult === true) {
        if (reply.result.objectId !== undefined) resultIds.add(reply.result.objectId)
        const exception = reply.exceptionDetails?.exception?.objectId
        if (exception !== undefined) resultIds.add(exception)
      }
      const documentOf = (loaderId: string) => state.documentsByLoader.get(loaderId)?.id
      const value = (object: Runtime.RemoteObject): Adapter.RemoteValue => {
        const serialized = object.deepSerializedValue ??
          { type: object.type as Runtime.DeepSerializedValueType, value: object.value }
        if (call.result === "handle" && object.objectId !== undefined) {
          const handle = state.ids.handle()
          state.handles.set(handle, { target: realm.target, realm, objectId: object.objectId, group: call.group })
          if (call.group !== undefined) Groups.join(state.groups, call.group, handle)
          return withHandle(toRemoteValue(object.deepSerializedValue ?? { type: object.type }, documentOf), handle)
        }
        return toRemoteValue(serialized, documentOf)
      }
      if (reply.exceptionDetails !== undefined) {
        const details = reply.exceptionDetails
        return {
          _tag: "Exception",
          text: details.exception?.description ?? details.text,
          exception: details.exception === undefined ? { type: "undefined" } : value(details.exception),
          stack: Option.fromUndefinedOr(details.exception?.description)
        } satisfies Adapter.RemoteResult
      }
      return { _tag: "Value", value: value(reply.result) } satisfies Adapter.RemoteResult
    }).pipe(
      // Ownership transfers while masked; the caller's finalizer never waits for the browser.
      Effect.ensuring(handoff),
      Effect.flatMap((result) =>
        cleanup === undefined
          ? Effect.succeed(result)
          : restore(Fiber.await(cleanup)).pipe(Effect.as(result))
      )
    )
  )
})

/** A value with the handle the caller holds on it; a primitive, which has no object id, has none to hold. */
const withHandle = (value: Adapter.RemoteValue, handle: Adapter.HandleId): Adapter.RemoteValue => {
  switch (value.type) {
    case "undefined":
    case "null":
    case "string":
    case "number":
    case "boolean":
    case "bigint":
      return value
    default:
      return { ...value, handle }
  }
}

/** A group given whole goes in one command (QUIRKS.md, Q132). */
export const releaseHandles = (state: State, list: ReadonlyArray<Adapter.HandleId>) =>
  Effect.forEach(Groups.release(state.groups, state.handles, list), (released) => {
    const target = released._tag === "Group" ? released.first.target : released.handle.target
    if (target.ended) return Effect.void
    const on = Protocol.on(target.session)
    return (released._tag === "Group"
      ? Runtime.releaseObjectGroup({ objectGroup: released.group }).pipe(on)
      : Runtime.releaseObject({ objectId: released.handle.objectId as Runtime.RemoteObjectId }).pipe(on)).pipe(
        Effect.ignore
      )
  }, { concurrency: "unbounded", discard: true })
