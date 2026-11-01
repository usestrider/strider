/**
 * CDP's names for things, as L1's: target kinds, resource types, navigation types, keys, buttons and failure
 * reasons, and the shapes CDP carries headers and bodies in.
 */
import * as Option from "effect/Option"
import type * as Fetch from "../../cdp/Fetch.ts"
import type * as Network from "../../cdp/Network.ts"
import type * as NetworkRequest from "../../NetworkRequest.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import type { TargetKind } from "./state.ts"

export const targetKind = (type: string): TargetKind =>
  type === "page" || type === "iframe" || type === "worker" || type === "service_worker" || type === "shared_worker"
    ? type
    : "other"

export const resourceTypes: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  Document: "document",
  Stylesheet: "stylesheet",
  Image: "image",
  Media: "media",
  Font: "font",
  Script: "script",
  XHR: "xhr",
  Fetch: "fetch",
  EventSource: "eventSource",
  WebSocket: "webSocket",
  Manifest: "manifest",
  Ping: "ping"
}

export const initiatedAs = (type: string): Adapter.InitiatedAs =>
  type === "reload" || type === "reloadBypassingCache"
    ? "reload"
    : type === "historyDifferentDocument" || type === "historySameDocument" || type === "restore" ||
        type === "restoreWithPost"
    ? "traversal"
    : type === "sameDocument"
    ? "fragment"
    : "crossDocument"

export const isSameDocument = (type: string) => type === "sameDocument" || type === "historySameDocument"

// Windows virtual key codes for the keys whose `text` doesn't say what they are; CDP needs them to act.
const keyCodes: Readonly<Record<string, number>> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Shift: 16,
  Control: 17,
  Alt: 18,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  " ": 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
  Meta: 91,
  F1: 112,
  F2: 113,
  F3: 114,
  F4: 115,
  F5: 116,
  F6: 117,
  F7: 118,
  F8: 119,
  F9: 120,
  F10: 121,
  F11: 122,
  F12: 123
}

export const keyCode = (key: string): number | undefined => {
  const known = keyCodes[key]
  if (known !== undefined) return known
  if (key.length === 1) {
    const upper = key.toUpperCase()
    if (/[A-Z0-9]/.test(upper)) return upper.charCodeAt(0)
  }
  return undefined
}

export const modifierBits = (modifiers: Adapter.Modifiers): number =>
  (modifiers.alt ? 1 : 0) | (modifiers.control ? 2 : 0) | (modifiers.meta ? 4 : 0) | (modifiers.shift ? 8 : 0)

/** The first button `MouseEvent.buttons` says is held, or none. */
export const heldButton = (buttons: number): "none" | "left" | "right" | "middle" =>
  buttons & 1 ? "left" : buttons & 2 ? "right" : buttons & 4 ? "middle" : "none"

/** Each reason a request can fail with, as `Network.ErrorReason` names it: CDP's are the full list. */
export const failReasons: Readonly<
  Record<Extract<Adapter.Decision, { _tag: "Fail" }>["error"], Network.ErrorReason>
> = {
  failed: "Failed",
  aborted: "Aborted",
  timedOut: "TimedOut",
  accessDenied: "AccessDenied",
  connectionClosed: "ConnectionClosed",
  connectionReset: "ConnectionReset",
  connectionRefused: "ConnectionRefused",
  connectionAborted: "ConnectionAborted",
  connectionFailed: "ConnectionFailed",
  nameNotResolved: "NameNotResolved",
  internetDisconnected: "InternetDisconnected",
  addressUnreachable: "AddressUnreachable",
  blockedByClient: "BlockedByClient",
  blockedByResponse: "BlockedByResponse"
}

/** Headers as `Fetch` sends a response's: several cookies come as one value, a line each (routes.ts). */
export const fetchHeaders = (headers: Readonly<Record<string, string>>): Array<Fetch.HeaderEntry> =>
  Object.entries(headers).flatMap(([name, value]) =>
    name.toLowerCase() === "set-cookie"
      ? value.split("\n").map((cookie) => ({ name, value: cookie }))
      : [{ name, value }]
  )

/**
 * A request's body as an event carries it: its entries' bytes. An entry without bytes, such as a file's, or
 * with bytes that don't decode, leaves the body to be read by the request's id (Q164).
 */
export const postData = (request: Network.Request): Option.Option<Uint8Array> => {
  if (request.postDataEntries === undefined || request.postDataEntries.length === 0) return Option.none()
  const parts: Array<Uint8Array> = []
  for (const entry of request.postDataEntries) {
    const part = entry.bytes === undefined ? undefined : Kit.tryDecodeBase64(entry.bytes)
    if (part === undefined) return Option.none()
    parts.push(part)
  }
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return Option.some(bytes)
}
