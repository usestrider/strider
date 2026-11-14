/**
 * What the slices expect of a backend, read from its capability table (`Browser.capabilities`) rather than its
 * name: a case runs where the backend has what it needs, and checks the refusal where it hasn't.
 */
import { assert } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
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
 * How a backend that reports `input.fractionalPointer` as partial places a fractional pointer position: Firefox
 * rounds to the nearest whole pixel, and launched WebKit truncates the fraction.
 */
export const pointerQuantization: Readonly<Record<"Chromium" | "Firefox" | "WebKit", "exact" | "round" | "truncate">> =
  {
    Chromium: "exact",
    Firefox: "round",
    WebKit: "truncate"
  }
