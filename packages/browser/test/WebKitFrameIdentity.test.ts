/** Automation and inspector frame identity must agree on a window, even when clocks disagree. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as vm from "node:vm"
import * as Input from "../src/internal/webkitAdapter/input.ts"
import type * as State from "../src/internal/webkitAdapter/state.ts"
import type * as Protocol from "../src/protocol/Protocol.ts"
import type * as Automation from "../src/webkit-automation-protocol/Automation.ts"

const handle = "page" as Automation.BrowsingContextHandle
const childHandle = "child" as Automation.FrameHandle

const fixture = (mode: "normal" | "replace" | "removed" | "throw" = "normal") => {
  let marks = 0
  const windows = [{}, {}]
  const contexts = windows.map((window) => vm.createContext({ window }))
  const frames = contexts.map((context, index) => {
    const frame = { removed: false } as State.FrameEntry
    const session = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.sync(() => {
          const { expression } = command.params as { expression: string }
          if (expression.includes("timeOrigin")) return { result: { value: "[101,\"about:srcdoc\"]" } }
          if (mode === "throw") return { result: { value: false } }
          const value = vm.runInContext(expression, context)
          if (mode === "replace") frame.document = { ...frame.document } as State.DocumentEntry
          if (mode === "removed") frame.removed = true
          return { result: { value } }
        })
    }
    frame.document = {
      realms: new Set([{ world: { _tag: "Main" }, ended: false, contextId: index + 1, session }])
    } as State.DocumentEntry
    return frame
  })
  const process = {
    automation: {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.sync(() => {
          if (command.method === "Automation.resolveChildFrameHandle") {
            return { result: (command.params as { ordinal: number }).ordinal === 0 ? childHandle : "" }
          }
          const params = command.params as Automation.EvaluateJavaScriptFunctionParams
          if (params.function.includes("timeOrigin")) return { result: JSON.stringify("[100,\"about:srcdoc\"]") }
          if (params.function.includes("Object.defineProperty")) marks++
          return { result: JSON.stringify(vm.runInContext(`(${params.function})()`, contexts[1]!)) ?? "null" }
        })
    }
  } as unknown as Parameters<typeof Input.matchFrame>[0]
  const clean = () => {
    assert.isAbove(marks, 0, "identity must be checked with a mark")
    windows.forEach((window) => assert.deepStrictEqual(Object.getOwnPropertyNames(window), []))
  }
  return { frames, process, clean }
}

describe("WebKit frame identity", () => {
  it.effect("confirms the right sibling when no fingerprint matches and removes every mark", () =>
    Effect.gen(function*() {
      const { clean, frames, process } = fixture()
      const result = yield* Input.matchFrame(process, handle, childHandle, frames)
      assert.strictEqual(Option.getOrThrow(result), frames[1])
      clean()
    }))

  it.effect("finds the reverse handle when fingerprints disagree and removes its mark", () =>
    Effect.gen(function*() {
      const { clean, frames, process } = fixture()
      const frame = frames[1]!
      Object.assign(frame, { parent: { parent: undefined } })
      const state = { frameHandles: new WeakMap() } as unknown as State.State
      const result = yield* Input.frameHandleOf(state, frame, handle, process)
      assert.strictEqual(Option.getOrThrow(result), childHandle)
      assert.strictEqual(state.frameHandles.get(frame), childHandle)
      clean()
    }))

  for (const mode of ["normal", "replace", "removed", "throw"] as const) {
    it.effect(`rejects ${mode === "normal" ? "a sibling" : mode} without leaving a mark`, () =>
      Effect.gen(function*() {
        const { clean, frames, process } = fixture(mode)
        const candidates = mode === "normal" ? [frames[0]!] : [frames[1]!]
        const result = yield* Input.matchFrame(process, handle, childHandle, candidates).pipe(Effect.option)
        assert.isTrue(Option.isNone(result) || Option.isNone(result.value))
        clean()
      }))
  }
})
