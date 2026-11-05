/** Native replacement restores the previous selection on refusal or a silently ignored upload. */
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as vm from "node:vm"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Input from "../src/internal/webkitAdapter/input.ts"
import type * as WebKitAutomation from "../src/internal/webkitAutomation.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import type * as Automation from "../src/webkit-automation-protocol/Automation.ts"

const rejected = new Protocol.ProtocolError({
  reason: new Protocol.Rejected({
    method: "Automation.setFilesForInputFileUpload",
    reason: "Unrecognized",
    code: -32000,
    description: "FileNotFound"
  })
})

const fixture = (mode: "populate" | "ignore" | "refuse" | "rollback-failure" | "populate-reset" | "partial") => {
  const events: Array<string> = []
  class InputElement {
    type = "file"
    multiple = true
    isConnected = false
    files: Array<string> = []
    listeners = new Set<(event: unknown) => void>()
    addEventListener(_type: string, listener: (event: unknown) => void) {
      this.listeners.add(listener)
    }
    removeEventListener(_type: string, listener: (event: unknown) => void) {
      this.listeners.delete(listener)
    }
    dispatchEvent(event: { type: string; isTrusted?: boolean }) {
      events.push(`${event.type}:${this.files.join("|")}`)
      if (event.type === "input") {
        for (const listener of this.listeners) listener({ ...event, target: this, composedPath: () => [this] })
      }
    }
  }
  const target = new InputElement()
  target.isConnected = true
  target.files = ["previous"]
  const nodes = new Map<string, InputElement>([["target", target]])
  const context = vm.createContext({
    HTMLInputElement: InputElement,
    addEventListener: () => {},
    removeEventListener: () => {},
    DataTransfer: class {
      files: Array<string> = []
    },
    Event: class {
      constructor(readonly type: string) {}
    }
  })
  const session = {
    send: (command: Protocol.Command<string, unknown, unknown>) =>
      Effect.suspend(() => {
        if (command.method === "Automation.setFilesForInputFileUpload") {
          const params = command.params as Automation.SetFilesForInputFileUploadParams
          if (mode === "refuse" || mode === "rollback-failure") {
            if (mode === "rollback-failure") target.type = "text"
            nodes.get(params.nodeHandle)!.files = ["partially loaded"]
            return Effect.fail(rejected)
          }
          if (mode === "populate" || mode === "populate-reset" || mode === "partial") {
            const input = nodes.get(params.nodeHandle)!
            input.files = mode === "partial" ? params.filenames.slice(0, 1) : [...params.filenames]
            input.dispatchEvent({ type: "input", isTrusted: true })
            input.dispatchEvent({ type: "change", isTrusted: true })
            if (mode === "populate-reset") input.files = []
          }
          return Effect.succeed({})
        }
        const params = command.params as Automation.EvaluateJavaScriptFunctionParams
        const args = params.arguments.map((arg) => {
          const parsed = JSON.parse(arg)
          return parsed !== null && typeof parsed === "object" && "node" in parsed
            ? nodes.get(parsed.node)
            : parsed
        })
        const result = vm.runInContext(`(${params.function})`, context)(...args)
        return Effect.succeed({ result: JSON.stringify(result ?? null) })
      })
  }
  const process = { automation: session } as unknown as WebKitAutomation.Process
  const replace = (files: ReadonlyArray<string>) =>
    Input.replaceFiles(
      process,
      "page" as Automation.BrowsingContextHandle,
      "" as Automation.FrameHandle,
      { node: "target" },
      files
    )
  return {
    target,
    events,
    replace,
    hasSaved: () => Object.getOwnPropertyNames(context).some((key) => key.startsWith("__strider_files_"))
  }
}

describe("WebKit native file replacement", () => {
  for (const mode of ["ignore", "refuse"] as const) {
    it.effect(`preserves the selection and emits no events when Automation ${mode}s the upload`, () =>
      Effect.gen(function*() {
        const { target, events, replace, hasSaved } = fixture(mode)
        const result = yield* replace(["new"]).pipe(Effect.flip)
        assert.strictEqual(result.reason._tag, "Protocol")
        if (mode === "refuse" && result.reason._tag === "Protocol") assert.strictEqual(result.reason.error, rejected)
        assert.deepStrictEqual(target.files, ["previous"])
        assert.deepStrictEqual(events, [])
        assert.isFalse(hasSaved())
      }))
  }

  it.effect("refuses multiple native paths on a single input before mutation", () =>
    Effect.gen(function*() {
      const { target, events, replace, hasSaved } = fixture("populate")
      target.multiple = false
      const result = yield* replace(["one", "two"]).pipe(Effect.exit)
      assert(Exit.isFailure(result))
      assert.deepStrictEqual(target.files, ["previous"])
      assert.deepStrictEqual(events, [])
      assert.strictEqual(target.listeners.size, 0)
      assert.isFalse(hasSaved())
    }))

  it.effect("retains a primary Timeout when restoration also fails", () =>
    Effect.gen(function*() {
      const timeout = yield* Effect.map(Operation.record, (record) => record.timeout(Option.none())).pipe(
        Operation.named("Test.upload")
      )
      const result = yield* Input.restoreOnFailure(
        Effect.fail(timeout),
        Effect.fail(Kit.undecodable("restore", "Could not restore the previous file selection"))
      ).pipe(Effect.exit)
      assert(Exit.isFailure(result))
      assert.isTrue(result.cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === timeout))
      assert.isTrue(Cause.hasDies(result.cause))
      assert.include(Cause.pretty(result.cause), "Could not restore the previous file selection")
    }))

  it.effect("keeps the native rejection alongside a rollback failure", () =>
    Effect.gen(function*() {
      const { replace } = fixture("rollback-failure")
      const result = yield* replace(["new"]).pipe(Effect.exit)
      assert(Exit.isFailure(result))
      assert.isTrue(Cause.hasDies(result.cause), Cause.pretty(result.cause))
      assert.include(Cause.pretty(result.cause), "FileNotFound")
      assert.include(Cause.pretty(result.cause), "Could not restore the previous file selection")
    }))

  it.effect("accepts native delivery when the page resets the input in its change handler", () =>
    Effect.gen(function*() {
      const { target, replace, hasSaved } = fixture("populate-reset")
      yield* replace(["new"])
      assert.deepStrictEqual(target.files, [])
      assert.isFalse(hasSaved())
      assert.strictEqual(target.listeners.size, 0)
    }))

  it.effect("replaces and clears once, with only the final selection in the events", () =>
    Effect.gen(function*() {
      const { target, events, replace, hasSaved } = fixture("populate")
      yield* replace(["one", "two"])
      assert.deepStrictEqual(target.files, ["one", "two"])
      yield* replace([])
      assert.deepStrictEqual(target.files, [])
      assert.deepStrictEqual(events, ["input:one|two", "change:one|two", "input:", "change:"])
      assert.isFalse(hasSaved())
    }))

  it.effect("refuses a trusted native delivery that loaded fewer files than requested", () =>
    Effect.gen(function*() {
      // A trusted input event proves Automation touched the input, not that it loaded every file asked for.
      const { target, replace, hasSaved } = fixture("partial")
      const result = yield* replace(["one", "two"]).pipe(Effect.exit)
      assert(Exit.isFailure(result), `accepted ${target.files.join("|")} for one|two`)
      assert.deepStrictEqual(target.files, ["previous"])
      assert.isFalse(hasSaved())
    }))

  it.effect("accepts native delivery when an earlier page listener resets the input before Strider observes it", () =>
    Effect.gen(function*() {
      // A page's window capture listener added before the upload runs ahead of Strider's, so it can clear the
      // delivered selection before the observer counts it. The delivery still happened, with its events.
      const { target, events, replace, hasSaved } = fixture("populate")
      target.addEventListener("input", () => {
        target.files = []
      })
      const result = yield* replace(["one"]).pipe(Effect.exit)
      assert(Exit.isSuccess(result), Exit.isFailure(result) ? Cause.pretty(result.cause) : "")
      assert.deepStrictEqual(target.files, [])
      assert.deepStrictEqual(events, ["input:one", "change:"])
      assert.isFalse(hasSaved())
    }))
})
