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
