/**
 * Request sizes cost nothing in a context that doesn't enable them. Chromium sends `Network.dataReceived` for
 * every chunk of every response once `Network.enable` is on, in every context. An event no handler names is dropped
 * before its params are decoded, so a handler for it, even one that returns at once, makes every chunk in every
 * context decoded and folded.
 */
import { assert, describe, it } from "@effect/vitest"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Network from "../src/internal/cdpAdapter/network.ts"
import type * as State from "../src/internal/cdpAdapter/state.ts"

describe("Request sizes on the default path", () => {
  it("doesn't make Chromium's fold decode every response chunk", () => {
    const handlers = Kit.handlers<State.Event>()
    Network.register(handlers)
    assert.isFalse(handlers.events.has("Network.dataReceived"))
  })
})
