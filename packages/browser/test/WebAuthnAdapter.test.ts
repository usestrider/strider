/** Ownership and cleanup order with controllable protocol replies, without a real browser. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import type * as Adapter from "../src/internal/adapter.ts"
import * as CdpAdapter from "../src/internal/cdpAdapter.ts"
import { makeBrowser, type Sent } from "./utils/FakeBrowser.ts"

const setup = Effect.gen(function*() {
  const browser = yield* makeBrowser
  const ready = yield* Queue.unbounded<Extract<Adapter.Fact, { _tag: "PageReady" }>>()
  const commands = yield* Queue.unbounded<Sent>()
  yield* Effect.gen(function*() {
    while (true) {
      const command = yield* browser.next
      if (command.method.startsWith("WebAuthn.")) {
        yield* Queue.offer(commands, command)
        continue
      }
      const result = command.method === "Browser.getVersion"
        ? {
          protocolVersion: "1.3",
          product: "Chrome/155.0.8059.79",
          revision: "test",
          userAgent: "HeadlessChrome",
          jsVersion: "test"
        }
        : command.method === "Target.getBrowserContexts" ?
        { browserContextIds: [] }
        : command.method === "Page.getFrameTree" ?
        {
          frameTree: {
            frame: { id: "T1", loaderId: "initial", url: "about:blank", securityOrigin: "://", mimeType: "text/html" }
          }
        }
        : {}
      yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
    }
  }).pipe(Effect.forkScoped)
  const adapter = yield* CdpAdapter.connect(browser.transport, {
    ownership: "attached",
    sink: (fact) => fact._tag === "PageReady" ? Queue.offer(ready, fact).pipe(Effect.asVoid) : Effect.void
  })
  yield* browser.receive({
    method: "Target.attachedToTarget",
    params: {
      sessionId: "S1",
      targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
      waitingForDebugger: false
    }
  })
  const page = (yield* Queue.take(ready)).page
  const next = (method: string) =>
    Queue.take(commands).pipe(Effect.tap((command) => Effect.sync(() => assert.strictEqual(command.method, method))))
  const answer = (command: Sent, result = {}) =>
    browser.receive({ id: command.id, sessionId: command.sessionId, result })
  const create = Effect.gen(function*() {
    const fiber = yield* adapter.createAuthenticator(page).pipe(Effect.forkChild)
    yield* answer(yield* next("WebAuthn.enable"))
    yield* answer(yield* next("WebAuthn.addVirtualAuthenticator"), { authenticatorId: "A1" })
    return yield* Fiber.join(fiber)
  })
  return { adapter, page, browser, next, answer, create }
})

describe("CDP virtual authenticator ownership", () => {
  it.effect("reserves the page before enable and through the disable acknowledgement", () =>
    Effect.gen(function*() {
      const { adapter, page, next, answer } = yield* setup
      const first = yield* adapter.createAuthenticator(page).pipe(Effect.forkChild)
      const enable = yield* next("WebAuthn.enable")
      assert.include((yield* adapter.createAuthenticator(page).pipe(Effect.flip)).message, "already")
      yield* answer(enable)
      const add = yield* next("WebAuthn.addVirtualAuthenticator")
      assert.deepStrictEqual(add.params, {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true
        }
      })
      yield* answer(add, { authenticatorId: "A1" })
      const owner = yield* Fiber.join(first)
      const release = yield* adapter.releaseAuthenticator(owner).pipe(Effect.forkChild)
      yield* answer(yield* next("WebAuthn.removeVirtualAuthenticator"))
      const disable = yield* next("WebAuthn.disable")
      assert.include((yield* adapter.createAuthenticator(page).pipe(Effect.flip)).message, "already")
      yield* answer(disable)
      yield* Fiber.join(release)
      const again = yield* adapter.createAuthenticator(page).pipe(Effect.forkChild)
      yield* answer(yield* next("WebAuthn.enable"))
      yield* answer(yield* next("WebAuthn.addVirtualAuthenticator"), { authenticatorId: "A2" })
      assert.strictEqual((yield* Fiber.join(again)).id, "A2")
    }))

  it.effect("disables a failed acquisition before allowing a new owner", () =>
    Effect.gen(function*() {
      const { adapter, page, browser, next, answer, create } = yield* setup
      const first = yield* adapter.createAuthenticator(page).pipe(Effect.exit, Effect.forkChild)
      const enable = yield* next("WebAuthn.enable")
      yield* browser.receive({
        id: enable.id,
        sessionId: enable.sessionId,
        error: { code: -32000, message: "setup failed" }
      })
      const disable = yield* next("WebAuthn.disable")
      assert.include((yield* adapter.createAuthenticator(page).pipe(Effect.flip)).message, "already")
      yield* answer(disable)
      assert.strictEqual((yield* Fiber.join(first))._tag, "Failure")
      assert.strictEqual((yield* create).id, "A1")
    }))

  it.effect("refuses reacquisition when native environment cleanup was not confirmed", () =>
    Effect.gen(function*() {
      const { adapter, page, browser, next, answer, create } = yield* setup
      const owner = yield* create
      const release = yield* adapter.releaseAuthenticator(owner).pipe(Effect.exit, Effect.forkChild)
      yield* answer(yield* next("WebAuthn.removeVirtualAuthenticator"))
      const disable = yield* next("WebAuthn.disable")
      yield* browser.receive({
        id: disable.id,
        sessionId: disable.sessionId,
        error: { code: -32000, message: "cleanup failed" }
      })
      assert.strictEqual((yield* Fiber.join(release))._tag, "Failure")
      assert.include((yield* adapter.createAuthenticator(page).pipe(Effect.flip)).message, "already")
    }))
})
