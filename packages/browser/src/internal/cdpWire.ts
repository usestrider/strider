/**
 * CDP's wire: the JSON envelope in flat-session mode, the session lifecycle `Target` events announce, and the
 * error table.
 *
 * Commands are `{ id, method, params, sessionId }`; replies `{ id, result }` or `{ id, error: { code, message,
 * data } }`; events `{ method, params, sessionId }`. A message without `sessionId` belongs to the browser's own
 * session. `Target.attachedToTarget` announces a session before any message on it, and before the reply to the
 * `attachToTarget` that caused it; `Target.detachedFromTarget` ends it.
 */
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import type * as Protocol from "../protocol/Protocol.ts"
import { type ErrorMatcher, type Incoming, isRecord, parseRecord, type Wire } from "./protocolClient.ts"

const recorded = "Chromium 155.0.8059.79, recorded 2026-10-19; checked by test/integration/Chromium.test.ts"

/**
 * CDP's error table. Chromium reports most failures as JSON-RPC codes plus English text, so rows match both;
 * a reworded message falls through to `Unrecognized` and fails the integration test, never a guess.
 */
export const errors: ReadonlyArray<ErrorMatcher> = [
  {
    match: { code: -32601 },
    becomes: { _tag: "Unsupported" },
    evidence: `JSON-RPC 2.0 §5.1, "Method not found"; "'Nope.nothing' wasn't found", ${recorded}`
  },
  {
    match: { code: -32602, message: "Invalid parameters" },
    becomes: { _tag: "Rejected", reason: "InvalidArgument" },
    evidence: `JSON-RPC 2.0 §5.1, "Invalid params"; Target.createTarget without url, ${recorded}`
  },
  {
    match: { code: -32602, message: "No target with given id found" },
    becomes: { _tag: "Rejected", reason: "NoSuchTarget" },
    evidence: `Target.attachToTarget with an unknown targetId, ${recorded}`
  },
  {
    match: { code: -32602, message: "No frame for given id found" },
    becomes: { _tag: "Rejected", reason: "NoSuchFrame" },
    evidence: `Page.createIsolatedWorld with an unknown frameId, ${recorded}`
  },
  {
    match: { code: -32000, message: "Could not find node with given id" },
    becomes: { _tag: "Rejected", reason: "NoSuchNode" },
    evidence: `DOM.describeNode with an unknown nodeId, ${recorded}`
  },
  {
    match: { code: -32001, message: "Session with given id not found." },
    becomes: { _tag: "SessionEnded", why: "detached" },
    evidence: `Runtime.evaluate on a session after Target.closeTarget, and on an unknown sessionId, ${recorded}`
  }
]

const sessionKey = (u: unknown): Protocol.SessionKey | undefined =>
  typeof u === "string" ? u as Protocol.SessionKey : undefined

const incoming = (envelope: Record<string, unknown>): Result.Result<Incoming, string> => {
  if (typeof envelope.id === "number") {
    const error = envelope.error
    if (error === undefined) return Result.succeed({ _tag: "Reply", id: envelope.id, result: envelope.result })
    if (isRecord(error) && Predicate.isNumber(error.code) && Predicate.isString(error.message)) {
      return Result.succeed({
        _tag: "ErrorReply",
        id: envelope.id,
        error: { code: error.code, message: error.message }
      })
    }
    return Result.fail(`reply ${envelope.id} has a malformed error`)
  }
  if (typeof envelope.method === "string") {
    return Result.succeed({
      _tag: "Event",
      key: sessionKey(envelope.sessionId),
      method: envelope.method,
      params: envelope.params
    })
  }
  return Result.fail("the envelope is neither a reply nor an event")
}

// The kinds a rejected command names; a type Chromium adds later, such as `tab` or `auction_worklet`, is `other`
const targetKind = (info: unknown): string | undefined => {
  if (!isRecord(info) || typeof info.type !== "string") return undefined
  const type = info.type
  return type === "page" || type === "iframe" || type === "worker" || type === "service_worker" ||
      type === "shared_worker"
    ? type
    : "other"
}

export const wire: Wire = {
  encode: (id, method, params, key) => JSON.stringify({ id, method, params, sessionId: key }),
  decode: (message) => Result.flatMap(parseRecord(message), incoming),
  lifecycle: (event, sessions) => {
    if (!isRecord(event.params)) return
    const key = sessionKey(event.params.sessionId)
    if (key === undefined) return
    if (event.method === "Target.attachedToTarget") {
      sessions.attached(key, event.key, targetKind(event.params.targetInfo))
    } else if (event.method === "Target.detachedFromTarget") sessions.ended(key, "detached")
  },
  errors
}
