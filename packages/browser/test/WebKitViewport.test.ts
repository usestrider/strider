/** The event-driven viewport wait, its narrow timeout recovery, and cleanup on every exit. */
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as vm from "node:vm"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Viewport from "../src/internal/webkitAdapter/viewport.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import type * as Automation from "../src/webkit-automation-protocol/Automation.ts"

const handle = "page" as Automation.BrowsingContextHandle
const requested = { width: 640, height: 480 }
const timeout = new Protocol.ProtocolError({
  reason: new Protocol.Rejected({
    method: "Automation.evaluateJavaScriptFunction",
    reason: "Unrecognized",
    code: -32000,
    description: "JavaScriptTimeout"
  })
})

const processFor = (
  send: (
    params: Automation.EvaluateJavaScriptFunctionParams
  ) => Effect.Effect<{ readonly result: string }, Protocol.ProtocolError>
) => ({
  automation: {
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      send(command.params as Automation.EvaluateJavaScriptFunctionParams)
  } as Protocol.ProtocolSession
})

const measure = (size = requested) => Effect.succeed({ result: JSON.stringify(size) })

describe("WebKit viewport confirmation", () => {
  for (const [name, final] of [["late match", requested], ["mismatch", { width: 1280, height: 762 }]] as const) {
    it.effect(`takes exactly one final measurement on callback timeout (${name})`, () =>
      Effect.gen(function*() {
        let reads = 0
        let disposed = 0
        const process = processFor((params) => {
          if (params.expectsImplicitCallbackArgument) {
            assert.strictEqual(params.callbackTimeout, 5000)
            return Effect.fail(timeout)
          }
          if (params.arguments.length > 0) {
            disposed++
            return measure()
          }
          reads++
          return measure(final)
        })
        const result = yield* Viewport.confirm(process, handle, requested).pipe(Effect.exit)
        assert.strictEqual(reads, 1)
        assert.strictEqual(disposed, 1)
        if (name === "late match") assert.strictEqual(result._tag, "Success")
        else {
          assert.strictEqual(result._tag, "Failure")
          if (result._tag === "Failure") {
            const error = Option.getOrThrow(Exit.findErrorOption(result))
            assert.deepStrictEqual(error.reason, {
              _tag: "ViewportMismatch",
              requested,
              actual: final,
              hint: "The requested CSS size was not observed within the 5 second confirmation limit"
            })
          }
        }
      }))
  }

  it.effect("preserves navigation and protocol failures without taking a final measurement", () =>
    Effect.gen(function*() {
      for (const description of ["FrameNotFound", "JavaScriptError; document was destroyed"]) {
        const failure = new Protocol.ProtocolError({
          reason: new Protocol.Rejected({
            method: "Automation.evaluateJavaScriptFunction",
            reason: "NoSuchFrame",
            code: -32000,
            description
          })
        })
        const process = processFor((params) => {
          if (params.expectsImplicitCallbackArgument) return Effect.fail(failure)
          assert.isAbove(params.arguments.length, 0, "only callback disposal follows a non-timeout failure")
          return measure()
        })
        const error = yield* Viewport.confirm(process, handle, requested).pipe(Effect.flip)
        assert.strictEqual(error.reason._tag, "Protocol")
        if (error.reason._tag === "Protocol") assert.strictEqual(error.reason.error, failure)
      }
    }))

  it.effect("caps the browser timeout at the operation deadline and preserves deadline failure", () =>
    Effect.gen(function*() {
      const at = yield* BrowserClock.after(1000)
      const process = processFor((params) => {
        if (params.expectsImplicitCallbackArgument) {
          assert.isAtMost(params.callbackTimeout!, 1000)
          assert.isAbove(params.callbackTimeout!, 0)
          return Effect.fail(timeout)
        }
        assert.isAbove(params.arguments.length, 0)
        return measure()
      })
      const error = yield* Viewport.confirm(process, handle, requested).pipe(
        Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at)),
        Effect.flip
      )
      assert.strictEqual(error.reason._tag, "Protocol")
      if (error.reason._tag === "Protocol") assert.strictEqual(error.reason.error.reason._tag, "NoReply")
    }))

  it.effect("disposes the browser callback when interrupted", () =>
    Effect.gen(function*() {
      const started = yield* Deferred.make<void>()
      let disposed = 0
      const process = processFor((params) =>
        params.expectsImplicitCallbackArgument
          ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.sync(() => {
            disposed++
            return { result: "null" }
          })
      )
      const fiber = yield* Viewport.confirm(process, handle, requested).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* Fiber.interrupt(fiber)
      assert.strictEqual(disposed, 1)
    }))

  it("cleans listeners on an unchanged size, resize, navigation, timeout and cancellation", () => {
    for (const mode of ["unchanged", "resize", "navigation", "timeout", "cancel"]) {
      const events = new Map<string, () => void>()
      let timer: (() => void) | undefined
      const replies: Array<string> = []
      const context = vm.createContext({
        innerWidth: mode === "unchanged" ? 640 : 1,
        innerHeight: 480,
        addEventListener: (name: string, fn: () => void) => events.set(name, fn),
        removeEventListener: (name: string) => events.delete(name),
        setTimeout: (fn: () => void) => {
          timer = fn
          return 1
        },
        clearTimeout: () => {
          timer = undefined
        },
        callback: (reply: string) => replies.push(reply)
      })
      vm.runInContext(`(${Viewport.watch.toString()})(640, 480, "pending", 5000, callback)`, context)
      if (mode === "resize") {
        context.innerWidth = 640
        events.get("resize")!()
      } else if (mode === "navigation") events.get("pagehide")!()
      else if (mode === "timeout") timer!()
      else if (mode === "cancel") vm.runInContext("globalThis.pending()", context)
      assert.strictEqual(events.size, 0, mode)
      assert.isUndefined(timer, mode)
      assert.isUndefined(context.pending, mode)
      assert.deepStrictEqual(
        replies,
        mode === "timeout" ?
          [] :
          [mode === "navigation" ? "navigated" : mode === "cancel" ? "cancelled" : "matched"]
      )
    }
  })
})
