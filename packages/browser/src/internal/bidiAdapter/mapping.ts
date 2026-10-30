/**
 * BiDi's values as L1's, and L1's as BiDi's: resource types, headers and bytes, keys and buttons, URL patterns,
 * and Firefox's error pages.
 */
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import type * as Network from "../../bidi-protocol/Network.ts"
import type * as NetworkRequest from "../../NetworkRequest.ts"
import type * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"

const destinations: Readonly<Record<string, NetworkRequest.ResourceType>> = {
  document: "document",
  iframe: "document",
  frame: "document",
  style: "stylesheet",
  script: "script",
  worker: "script",
  sharedworker: "script",
  serviceworker: "script",
  image: "image",
  font: "font",
  audio: "media",
  video: "media",
  track: "media",
  manifest: "manifest"
}

export const resourceType = (request: Network.RequestData): NetworkRequest.ResourceType => {
  const known = destinations[request.destination]
  if (known !== undefined) return known
  switch (request.initiatorType) {
    case "fetch":
      return "fetch"
    case "xmlhttprequest":
      return "xhr"
    case "beacon":
      return "ping"
    default:
      return "other"
  }
}

/**
 * Bytes BiDi sent as text, in the fold, which can't fail: base64 that doesn't decode reads as empty, as a header
 * with no value would.
 */
export const bytesText = (value: Network.BytesValue): string =>
  value.type === "string" ? value.value : new TextDecoder().decode(Kit.tryDecodeBase64(value.value) ?? new Uint8Array())

/** Bytes BiDi sent; `method` names what carried them, for the failure when base64 doesn't decode. */
export const bytesOf = (value: Network.BytesValue, method: string): Effect.Effect<Uint8Array, Adapter.AdapterError> =>
  Kit.bodyBytes(value.value, value.type === "base64", method)

export const headersOf = (headers: ReadonlyArray<Network.Header>): Headers.Headers =>
  Headers.fromInput(Object.fromEntries(headers.map((header) => [header.name, bytesText(header.value)])))

// Several cookies come as one value, a line each (routes.ts)
export const bidiHeaders = (headers: Readonly<Record<string, string>>): Array<Network.Header> =>
  Object.entries(headers).flatMap(([name, value]) =>
    (name.toLowerCase() === "set-cookie" ? value.split("\n") : [value]).map((each): Network.Header => ({
      name,
      value: { type: "string", value: each }
    }))
  )

// WebDriver's codes for keys whose value isn't the text they type.
const webdriverKeys: Readonly<Record<string, string>> = {
  Cancel: "",
  Help: "",
  Backspace: "",
  Tab: "",
  Clear: "",
  // WebDriver's Return; its Enter (U+E007) is the numpad's, which Firefox reports as `NumpadEnter`
  Enter: "",
  Shift: "",
  Control: "",
  Alt: "",
  Pause: "",
  Escape: "",
  PageUp: "",
  PageDown: "",
  End: "",
  Home: "",
  ArrowLeft: "",
  ArrowUp: "",
  ArrowRight: "",
  ArrowDown: "",
  Insert: "",
  Delete: "",
  F1: "",
  F2: "",
  F3: "",
  F4: "",
  F5: "",
  F6: "",
  F7: "",
  F8: "",
  F9: "",
  F10: "",
  F11: "",
  F12: "",
  Meta: ""
}

export const keyValue = (key: string): string => webdriverKeys[key] ?? key

export const buttons: Readonly<Record<string, number>> = { none: 0, left: 0, middle: 1, right: 2, back: 3, forward: 4 }

/**
 * The BiDi pattern that covers a glob: its scheme, host and port when the glob spells them out with no
 * wildcard, or every URL.
 */
export const coveringPattern = (glob: string): Network.UrlPattern | undefined => {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/*:]+)(?::(\d+))?\//i.exec(glob)
  if (match === null) return undefined
  return {
    type: "pattern",
    protocol: match[1]!,
    hostname: match[2]!,
    ...(match[3] === undefined ? {} : { port: match[3] })
  }
}

export const errorPage = (url: string) => url.startsWith("about:neterror") || url.startsWith("about:certerror")

/**
 * Where a navigation was going: an error page's `u` parameter, since Firefox starts a navigation it refuses at
 * once (a port browsers don't use, say) as its error page.
 */
export const intended = (url: string) => {
  if (!errorPage(url)) return url
  return URL.parse(url)?.searchParams.get("u") ?? url
}

export const originOf = (url: string) => {
  return URL.parse(url)?.origin ?? "null"
}

/** An error page's error, its `e` parameter. */
export const errorText = (url: string) => {
  return URL.parse(url)?.searchParams.get("e") ?? "error page"
}
