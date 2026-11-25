/**
 * What the slices expect of a backend, read from its capability table (`Browser.capabilities`) rather than its
 * name: a case runs where the backend has what it needs, and checks the refusal where it hasn't.
 */
import { assert } from "@effect/vitest"
import { Browser, type ConsoleMessage } from "@usestrider/browser"
import * as Effect from "effect/Effect"

/** A capability's status in the browser's table; a name the table lacks fails the test. */
export const status = Effect.fnUntraced(function*(name: string) {
  const capabilities = yield* (yield* Browser.Browser).capabilities
  const entry = capabilities.entries.find((each) => each.name === name)
  assert.isDefined(entry, `${name} is in the capability table`)
  return entry.status
})

/** Whether the browser has a capability, in full or in part. */
export const supports = (name: string) => Effect.map(status(name), (found) => found !== "unsupported")

/** Whether the browser has a capability in full. */
export const fullySupports = (name: string) => Effect.map(status(name), (found) => found === "supported")

/**
 * What each backend reads a method of the slice's console case as, where it differs, or `null` where the browser
 * reports no message for it; a backend with an entry here has `console.method` partial, and one without has it
 * supported: Chromium sends `timeLog` as a plain `log`, Firefox sends nothing for `groupEnd`, and
 * stock WebKit sends `count` as a plain message at level `debug` and `timeLog` as the same `timing` as `timeEnd`.
 */
export const consoleMethodReads: Readonly<
  Record<string, Readonly<Partial<Record<ConsoleMessage.Method, ConsoleMessage.Method | null>>>>
> = {
  Chromium: { timeLog: "log" },
  "Chromium attached": { timeLog: "log" },
  Firefox: { groupEnd: null },
  WebKit: { count: "debug", timeLog: "timeEnd" }
}

/** Native upload metadata supplied by the pinned browsers, independently of transferred File construction. */
export const nativeFileModificationTime: Readonly<Record<string, "disk" | "creation">> = {
  Chromium: "disk",
  Firefox: "disk",
  WebKit: "creation",
  "Chromium attached": "disk"
}

/** Whether adding a response intercept can reach a request that already passed its request stage. */
export const responseRouteInFlight: Readonly<Record<"Chromium" | "Firefox" | "WebKit", boolean>> = {
  Chromium: false,
  Firefox: true,
  WebKit: true
}

/**
 * Whether a page's second fetch of a cacheable URL, with no route in force, is answered from the HTTP cache: stock
 * WebKit's MiniBrowser sends it to the server again.
 */
export const cachesFetches: Readonly<Record<"Chromium" | "Firefox" | "WebKit", boolean>> = {
  Chromium: true,
  Firefox: true,
  WebKit: false
}

/**
 * Whether a dedicated worker's requests bypass the HTTP cache while a route is in force: Firefox answers a worker's
 * second fetch of a cacheable URL from its cache even while the session's cache behavior is `bypass`.
 */
export const workerFetchesBypassCache: Readonly<Record<"Chromium" | "Firefox" | "WebKit", boolean>> = {
  Chromium: true,
  Firefox: false,
  WebKit: true
}

/**
 * Whether the browser reports the end of a navigation the page starts to a URL whose scheme it can't load: Firefox
 * reports the navigation's start and never its end, so no outcome comes for it.
 */
export const endsUnloadablePageNavigation: Readonly<Record<"Chromium" | "Firefox" | "WebKit", boolean>> = {
  Chromium: true,
  Firefox: false,
  WebKit: true
}

/**
 * How a backend that reports `input.fractionalPointer` as partial places a fractional pointer position: Firefox
 * rounds to the nearest whole pixel, and launched WebKit truncates the fraction.
 */
export const pointerQuantization: Readonly<Record<"Chromium" | "Firefox" | "WebKit", "exact" | "round" | "truncate">> =
  {
    Chromium: "exact",
    Firefox: "round",
    WebKit: "truncate"
  }

/**
 * What each backend reports of a response's server and TLS connection. Chromium reports all of it with every
 * response. Stock WebKit reports the certificate, without its issuer, with a response but not a redirect's, and the
 * server's address and TLS version only as a hop finishes, which a redirect's never does: the HAR has them, the
 * response doesn't. Firefox reports neither.
 */
export const responseSecurity: Readonly<
  Record<"Chromium" | "Firefox" | "WebKit", {
    readonly securityDetails: { readonly redirect: boolean; readonly final: boolean }
    readonly issuer: boolean
    readonly protocolWithResponse: boolean
    readonly addressWithResponse: boolean
    readonly addressInHar: { readonly redirect: boolean; readonly final: boolean }
  }>
> = {
  Chromium: {
    securityDetails: { redirect: true, final: true },
    issuer: true,
    protocolWithResponse: true,
    addressWithResponse: true,
    addressInHar: { redirect: true, final: true }
  },
  Firefox: {
    securityDetails: { redirect: false, final: false },
    issuer: false,
    protocolWithResponse: false,
    addressWithResponse: false,
    addressInHar: { redirect: false, final: false }
  },
  WebKit: {
    securityDetails: { redirect: false, final: true },
    issuer: false,
    protocolWithResponse: false,
    addressWithResponse: false,
    addressInHar: { redirect: false, final: true }
  }
}
