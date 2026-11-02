/** The event-driven viewport wait, its narrow timeout recovery, and cleanup on every exit. */
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as vm from "node:vm"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as WebKitAutomation from "../src/internal/webkitAdapter/automation.ts"
import type * as State from "../src/internal/webkitAdapter/state.ts"
import * as Viewport from "../src/internal/webkitAdapter/viewport.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"
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

  it.effect("keeps a page's disappearance a typed failure when its callback can't be disposed", () =>
    Effect.gen(function*() {
      const gone = new Protocol.ProtocolError({
        reason: new Protocol.Rejected({
          method: "Automation.evaluateJavaScriptFunction",
          reason: "Unrecognized",
          code: -32000,
          description: "WindowNotFound"
        })
      })
      const result = yield* Viewport.confirm(processFor(() => Effect.fail(gone)), handle, requested).pipe(Effect.exit)
      assert.isTrue(Exit.isFailure(result))
      if (Exit.isFailure(result)) assert.isFalse(Cause.hasDies(result.cause), Cause.pretty(result.cause))
    }))

  it.effect("keeps a confirmed size when the page goes before its callback is disposed", () =>
    Effect.gen(function*() {
      const process = processFor((params) =>
        params.expectsImplicitCallbackArgument
          ? Effect.succeed({ result: "\"matched\"" })
          : Effect.fail(
            new Protocol.ProtocolError({
              reason: new Protocol.Rejected({
                method: "Automation.evaluateJavaScriptFunction",
                reason: "Unrecognized",
                code: -32000,
                description: "WindowNotFound"
              })
            })
          )
      )
      const result = yield* Viewport.confirm(process, handle, requested).pipe(Effect.exit)
      assert.strictEqual(result._tag, "Success")
    }))

  it.effect("takes the final measurement when a restoration's confirmation times out", () =>
    Effect.gen(function*() {
      let reads = 0
      const process = processFor((params) => {
        if (params.expectsImplicitCallbackArgument) return Effect.fail(timeout)
        if (params.arguments.length > 0) return measure()
        reads++
        return measure()
      })
      const result = yield* Viewport.cleanup(Viewport.confirm(process, handle, requested)).pipe(Effect.exit)
      assert.strictEqual(reads, 1)
      assert.strictEqual(result._tag, "Success")
    }))

  it("does not mistake pairing exhaustion or a different protocol rejection for confirmed removal", () => {
    const unpaired = new Adapter.AdapterError({
      reason: {
        _tag: "Gone",
        target: { _tag: "Browser" },
        reason: new Target.Vanished({})
      }
    })
    assert.isFalse(Viewport.isGone(unpaired))
    const other = new Protocol.ProtocolError({
      reason: new Protocol.Rejected({
        method: "Automation.evaluateJavaScriptFunction",
        reason: "NoSuchFrame",
        code: -32000,
        description: "FrameNotFound"
      })
    })
    assert.isFalse(Viewport.isGone(other))
  })

  it.effect("preserves confirmation success when non-gone disposal fails", () =>
    Effect.gen(function*() {
      const failure = new Protocol.ProtocolError({
        reason: new Protocol.Rejected({
          method: "Automation.evaluateJavaScriptFunction",
          reason: "Unrecognized",
          code: -32000,
          description: "InternalError"
        })
      })
      const process = processFor((params) =>
        params.expectsImplicitCallbackArgument
          ? Effect.succeed({ result: "\"matched\"" }) :
          Effect.fail(failure)
      )
      const result = yield* Viewport.confirm(process, handle, requested).pipe(Effect.exit)
      assert.strictEqual(result._tag, "Success")
      assert.isFalse(Viewport.isGone(failure))
    }))

  it.effect("reserves final-measurement time and never extends nested cleanup deadlines", () =>
    Effect.gen(function*() {
      yield* Viewport.cleanup(Effect.gen(function*() {
        const outer = yield* ProtocolClient.CommandDeadline
        const inner = yield* Viewport.cleanup(ProtocolClient.CommandDeadline)
        assert.deepStrictEqual(inner, outer)
        const process = processFor((params) => {
          if (params.expectsImplicitCallbackArgument) {
            assert.isAtMost(params.callbackTimeout!, 4000)
            assert.isAbove(params.callbackTimeout!, 0)
            return Effect.fail(timeout)
          }
          return measure()
        })
        yield* Viewport.confirm(process, handle, requested)
      }))
    }))

  it.effect("waits for an unpaired failed creation to leave the inspector model", () =>
    Effect.gen(function*() {
      const entered = yield* Deferred.make<void>()
      const removed = yield* Deferred.make<void>()
      const context = { browserContextId: "context" } as State.ContextEntry
      const page = { id: "unpaired", context, ended: false } as State.PageEntry
      const pages = new Map([[page.id, page]])
      const state = {
        pages,
        pageHandles: new Map(),
        creating: new Map(),
        root: () => ({ drainObserved: Effect.void }),
        buffer: {
          waitFor: Effect.fnUntraced(function*(check: () => unknown) {
            assert.isUndefined(check(), "an unpaired page is still listed")
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(removed)
            assert.strictEqual(check(), true)
          })
        }
      } as unknown as Parameters<typeof WebKitAutomation.closeFailedPage>[0]
      const fiber = yield* WebKitAutomation.closeFailedPage(
        state,
        context,
        processFor(() => measure()),
        handle,
        new Set()
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      assert.isUndefined(fiber.pollUnsafe())
      pages.delete(page.id)
      yield* Deferred.succeed(removed, undefined)
      yield* Fiber.join(fiber)
    }))

  it.effect("does not add a defect when failed creation cleanup finds a vanished window", () =>
    Effect.gen(function*() {
      const gone = new Protocol.ProtocolError({
        reason: new Protocol.Rejected({
          method: "Automation.closeBrowsingContext",
          reason: "NoSuchTarget",
          code: -32000,
          description: "WindowNotFound"
        })
      })
      const state = {} as Parameters<typeof WebKitAutomation.closeFailedPage>[0]
      yield* WebKitAutomation.closeFailedPage(
        state,
        {} as State.ContextEntry,
        processFor(() => Effect.fail(gone)),
        handle,
        new Set()
      )
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
