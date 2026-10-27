/**
 * The WebKit adapter's wire: the envelope stock WebKit's pages reach it in (`webkitEnvelope.ts`), nested three
 * levels deep, the session lifecycle its events announce, and the error table. The transports present each page
 * this way, as WebKit's own inspector proxies reach a page.
 *
 * - **The browser session** is the connection itself: `{ id, method, params }`, replies `{ id, result }` or
 *   `{ id, error: { code, message, data } }`, events `{ method, params }`. The `Envelope` domain lives here.
 * - **A page proxy** (one page) adds `pageProxyId` to the envelope, in both directions.
 *   `Envelope.pageProxyCreated` announces it and `Envelope.pageProxyDestroyed` ends it.
 * - **An inspector target** (the page's web process, which a cross-site navigation replaces) is reached
 *   through its page proxy: a command is wrapped in `Target.sendMessageToTarget`, and everything it sends
 *   comes back wrapped in `Target.dispatchMessageFromTarget`. `Target.targetCreated` announces it;
 *   `Target.targetDestroyed` ends it, and so does `Target.didCommitProvisionalTarget` for the target it swaps
 *   out.
 * - **A worker** is reached through its target the same way, wrapped in `Worker.sendMessageToWorker` and
 *   `Worker.dispatchMessageFromWorker`, and announced by `Worker.workerCreated`.
 *
 * A wrapper is a command of its own, with an id. Each one takes the negated id of the command it carries:
 * WebKit accepts negative ids, and the wrapped command's reply still comes with the positive id. The wrapper's
 * own reply is ignored when it succeeds, and becomes the wrapped command's error when it fails, because then the
 * wrapped command never arrived. Unwrapping never publishes the wrapper events themselves.
 */
import * as Predicate from "effect/Predicate"
import type * as Protocol from "../protocol/Protocol.ts"
import type { ErrorMatcher, Incoming, Wire } from "./protocolClient.ts"

/** Where a session key routes: a page proxy, a target in it, or a worker in that target. */
export type Route =
  | { readonly _tag: "PageProxy"; readonly pageProxyId: string }
  | { readonly _tag: "Target"; readonly pageProxyId: string; readonly targetId: string }
  | { readonly _tag: "Worker"; readonly pageProxyId: string; readonly targetId: string; readonly workerId: string }

/**
 * A session's key: the ids on its path, as a JSON array (`["5"]`, `["5","page-6"]`), so no id can be mistaken
 * for a separator.
 */
export const key = (route: Route): Protocol.SessionKey =>
  JSON.stringify(
    route._tag === "PageProxy"
      ? [route.pageProxyId]
      : route._tag === "Target"
      ? [route.pageProxyId, route.targetId]
      : [route.pageProxyId, route.targetId, route.workerId]
  ) as Protocol.SessionKey

export const pageProxyKey = (pageProxyId: string) => key({ _tag: "PageProxy", pageProxyId })
export const targetKey = (pageProxyId: string, targetId: string) => key({ _tag: "Target", pageProxyId, targetId })
export const workerKey = (pageProxyId: string, targetId: string, workerId: string) =>
  key({ _tag: "Worker", pageProxyId, targetId, workerId })

/** The route of a key this wire made. */
export const route = (sessionKey: Protocol.SessionKey): Route => {
  const ids: unknown = JSON.parse(sessionKey)
  if (!Array.isArray(ids) || !ids.every(Predicate.isString)) throw new Error(`${sessionKey} isn't a WebKit session key`)
  switch (ids.length) {
    case 1:
      return { _tag: "PageProxy", pageProxyId: ids[0]! }
    case 2:
      return { _tag: "Target", pageProxyId: ids[0]!, targetId: ids[1]! }
    case 3:
      return { _tag: "Worker", pageProxyId: ids[0]!, targetId: ids[1]!, workerId: ids[2]! }
    default:
      throw new Error(`${sessionKey} isn't a WebKit session key`)
  }
}

const recorded =
  "WebKitGTK 2.54.1's MiniBrowser, recorded 2026-10-26; checked by test/integration/WebKitAutomation.test.ts"

/**
 * WebKit's error table. WebKit reports failures as JSON-RPC codes plus English text, so rows match both; a
 * reworded message falls through to `Unrecognized` and fails the integration test, never a guess. One row is the
 * transports' own: a page proxy that is gone, answered as WebKit's inspector proxies answer one.
 */
export const errors: ReadonlyArray<ErrorMatcher> = [
  {
    match: { code: -32601 },
    becomes: { _tag: "Unsupported" },
    evidence:
      `JSON-RPC 2.0 §5.1, "Method not found"; "'Nope' domain was not found" and "'Automation.nope' was not found", in a page's target and Automation's, ${recorded}`
  },
  {
    match: { code: -32602, message: { includes: "can't be processed" } },
    becomes: { _tag: "Rejected", reason: "InvalidArgument" },
    evidence:
      `JSON-RPC 2.0 §5.1, "Invalid params"; "Some arguments of method 'Runtime.evaluate' can't be processed", for a missing expression, and Automation's missing handle, ${recorded}`
  },
  {
    match: { code: -32602, message: "Cannot find page proxy with provided 'pageProxyId'" },
    becomes: { _tag: "SessionEnded", why: "detached" },
    evidence:
      "the transports' answer to a command for a page that is gone (webkitStockTransport.ts, webkitAutomation.ts)"
  },
  {
    match: { code: -32000, message: "Missing target for given targetId" },
    becomes: { _tag: "SessionEnded", why: "detached" },
    evidence: `Target.sendMessageToTarget to an unknown targetId, ${recorded}`
  },
  {
    match: { code: -32000, message: "Missing frame for given frameId" },
    becomes: { _tag: "Rejected", reason: "NoSuchFrame" },
    evidence: `Page.getResourceContent with an unknown frameId, ${recorded}`
  },
  {
    match: { code: -32000, message: "Missing node for given nodeId" },
    becomes: { _tag: "Rejected", reason: "NoSuchNode" },
    evidence: `DOM.resolveNode with an unknown nodeId, ${recorded}`
  },
  {
    match: { code: -32000, message: "WindowNotFound" },
    becomes: { _tag: "Rejected", reason: "NoSuchTarget" },
    evidence:
      `Automation's error for a browsing context it doesn't have, and for a frame it doesn't have: getBrowsingContext with an unknown handle, evaluateJavaScriptFunction with an unknown frameHandle, ${recorded}`
  }
]

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u)

const wrap = (id: number, method: string, params: unknown): Record<string, unknown> => ({ id, method, params })

export const encode = (id: number, method: string, params: unknown, sessionKey: Protocol.SessionKey | undefined) => {
  if (sessionKey === undefined) return JSON.stringify(wrap(id, method, params))
  const to = route(sessionKey)
  let message = wrap(id, method, params)
  if (to._tag === "Worker") {
    message = wrap(-id, "Worker.sendMessageToWorker", { workerId: to.workerId, message: JSON.stringify(message) })
  }
  if (to._tag !== "PageProxy") {
    message = wrap(-id, "Target.sendMessageToTarget", { targetId: to.targetId, message: JSON.stringify(message) })
  }
  return JSON.stringify({ ...message, pageProxyId: to.pageProxyId })
}

const reply = (envelope: Record<string, unknown>, id: number): Incoming => {
  const error = envelope.error
  if (error !== undefined) {
    if (!isRecord(error) || !Predicate.isNumber(error.code) || !Predicate.isString(error.message)) {
      throw new Error(`reply ${id} has a malformed error`)
    }
    // A wrapper's error is the error of the command it carried
    return { _tag: "ErrorReply", id: Math.abs(id), error: { code: error.code, message: error.message } }
  }
  return id < 0 ? { _tag: "Ignore" } : { _tag: "Reply", id, result: envelope.result }
}

const unwrap = (envelope: Record<string, unknown>, at: Route | undefined): Incoming => {
  if (typeof envelope.id === "number") return reply(envelope, envelope.id)
  const method = envelope.method
  const params = envelope.params
  if (typeof method !== "string") throw new Error("the envelope is neither a reply nor an event")
  if (at?._tag === "PageProxy" && method === "Target.dispatchMessageFromTarget" && isRecord(params)) {
    if (typeof params.targetId !== "string" || typeof params.message !== "string") {
      throw new Error("Target.dispatchMessageFromTarget without a target or a message")
    }
    return unwrap(parse(params.message), { _tag: "Target", pageProxyId: at.pageProxyId, targetId: params.targetId })
  }
  if (at?._tag === "Target" && method === "Worker.dispatchMessageFromWorker" && isRecord(params)) {
    if (typeof params.workerId !== "string" || typeof params.message !== "string") {
      throw new Error("Worker.dispatchMessageFromWorker without a worker or a message")
    }
    return unwrap(parse(params.message), { ...at, _tag: "Worker", workerId: params.workerId })
  }
  return { _tag: "Event", key: at === undefined ? undefined : key(at), method, params }
}

const parse = (message: string): Record<string, unknown> => {
  const envelope: unknown = JSON.parse(message)
  if (!isRecord(envelope)) throw new Error("the envelope isn't an object")
  return envelope
}

export const decode = (message: string): Incoming => {
  const envelope = parse(message)
  const pageProxyId = envelope.pageProxyId
  if (pageProxyId !== undefined && typeof pageProxyId !== "string") throw new Error("a pageProxyId that isn't text")
  return unwrap(envelope, pageProxyId === undefined ? undefined : { _tag: "PageProxy", pageProxyId })
}

export const wire: Wire = {
  encode,
  decode,
  lifecycle: (event, sessions) => {
    const params = event.params
    if (!isRecord(params)) return
    const at = event.key === undefined ? undefined : route(event.key)
    switch (event.method) {
      case "Envelope.pageProxyCreated":
        if (at === undefined && typeof params.pageProxyId === "string") {
          sessions.attached(pageProxyKey(params.pageProxyId), undefined)
        }
        return
      case "Envelope.pageProxyDestroyed":
        if (at === undefined && typeof params.pageProxyId === "string") {
          sessions.ended(pageProxyKey(params.pageProxyId), "targetDestroyed")
        }
        return
      case "Target.targetCreated":
        if (at?._tag === "PageProxy" && isRecord(params.targetInfo) && typeof params.targetInfo.targetId === "string") {
          sessions.attached(targetKey(at.pageProxyId, params.targetInfo.targetId), event.key)
        }
        return
      case "Target.targetDestroyed":
        if (at?._tag === "PageProxy" && typeof params.targetId === "string") {
          sessions.ended(targetKey(at.pageProxyId, params.targetId), "targetDestroyed")
        }
        return
      case "Target.didCommitProvisionalTarget":
        // The old target is destroyed next; it ends here, swapped, so that the reason says why
        if (at?._tag === "PageProxy" && typeof params.oldTargetId === "string") {
          sessions.ended(targetKey(at.pageProxyId, params.oldTargetId), "swapped")
        }
        return
      case "Worker.workerCreated":
        if (at?._tag === "Target" && typeof params.workerId === "string") {
          sessions.attached(workerKey(at.pageProxyId, at.targetId, params.workerId), event.key)
        }
        return
      case "Worker.workerTerminated":
        if (at?._tag === "Target" && typeof params.workerId === "string") {
          sessions.ended(workerKey(at.pageProxyId, at.targetId, params.workerId), "targetDestroyed")
        }
        return
    }
  },
  errors
}
