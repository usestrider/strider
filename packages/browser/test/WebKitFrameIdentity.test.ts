/** Automation and inspector frame identity must agree on a window, even when clocks disagree. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as vm from "node:vm"
import * as Input from "../src/internal/webkitAdapter/input.ts"
import type * as State from "../src/internal/webkitAdapter/state.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import type * as Automation from "../src/webkit-automation-protocol/Automation.ts"

const handle = "page" as Automation.BrowsingContextHandle
const childHandle = "child" as Automation.FrameHandle

const fixture = (
  mode: "normal" | "replace" | "removed" | "error" | "cleanup replacement" = "normal",
  origins: ReadonlyArray<number> = [101, 101],
  reverseSiblings = false
) => {
  let marks = 0
  const windows = [{}, {}]
  const contexts = windows.map((window) => vm.createContext({ window }))
  const frames = contexts.map((context, index) => {
    const frame = { removed: false } as State.FrameEntry
    const session = {
      send: (command: Protocol.Command<string, unknown, unknown>) =>
        Effect.suspend(() => {
          const { expression } = command.params as { expression: string }
          if (expression.includes("timeOrigin")) {
            return Effect.succeed({ result: { value: `[${origins[index]},"about:srcdoc"]` } })
          }
          if (mode === "error") {
            return Effect.fail(
              new Protocol.ProtocolError({
                reason: new Protocol.Rejected({
                  method: "Runtime.evaluate",
                  reason: "NoSuchFrame",
                  code: -32000,
                  description: "context destroyed"
                })
              })
            )
          }
          const value = vm.runInContext(expression, context)
          if (mode === "replace") frame.document = { ...frame.document } as State.DocumentEntry
          if (mode === "removed") frame.removed = true
          return Effect.succeed({ result: { value } })
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
            return {
              result: (reverseSiblings ? ["sibling", childHandle] : [childHandle])[
                (command.params as { ordinal: number }).ordinal
              ] ?? ""
            }
          }
          const params = command.params as Automation.EvaluateJavaScriptFunctionParams
          if (params.function.includes("timeOrigin")) {
            const origin = reverseSiblings && params.frameHandle === childHandle ? 101 : 100
            return { result: JSON.stringify(`[${origin},"about:srcdoc"]`) }
          }
          if (params.function.includes("Object.defineProperty")) marks++
          if (params.function.includes("delete window") && mode === "cleanup replacement") {
            frames[1]!.document = { ...frames[1]!.document } as State.DocumentEntry
          }
          return {
            result: JSON.stringify(
              vm.runInContext(
                `(${params.function})()`,
                contexts[reverseSiblings && params.frameHandle !== childHandle ? 0 : 1]!
              )
            ) ?? "null"
          }
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

  // Automation reads the target's time origin 1 ms off its inspector read (100 against 101), as in the retained
  // stock WebKit trace, while a sibling srcdoc frame begun a millisecond earlier reads 100 from the inspector.
  it.effect("does not accept a sibling whose fingerprint alone matches a time origin read off by one", () =>
    Effect.gen(function*() {
      const { frames, process } = fixture("normal", [100, 101])
      const result = yield* Input.matchFrame(process, handle, childHandle, frames)
      assert.strictEqual(Option.getOrUndefined(result), frames[1], "the marked window is the target, not the sibling")
    }))

  it.effect("does not cache a reverse sibling handle whose fingerprint alone matches", () =>
    Effect.gen(function*() {
      const { clean, frames, process } = fixture("normal", [100, 100], true)
      const frame = frames[1]!
      Object.assign(frame, { parent: { parent: undefined } })
      const state = { frameHandles: new WeakMap() } as unknown as State.State
      const result = yield* Input.frameHandleOf(state, frame, handle, process)
      assert.strictEqual(
        Option.getOrUndefined(result),
        childHandle,
        "the sibling's matching fingerprint is not identity"
      )
      assert.strictEqual(state.frameHandles.get(frame), childHandle)
      clean()
    }))

  for (const mode of ["normal", "replace", "removed", "error", "cleanup replacement"] as const) {
    it.effect(`rejects reverse lookup for ${mode === "normal" ? "a sibling" : mode} and cleans the mark`, () =>
      Effect.gen(function*() {
        const { clean, frames, process } = fixture(mode)
        const frame = frames[mode === "normal" ? 0 : 1]!
        Object.assign(frame, { parent: { parent: undefined } })
        const state = { frameHandles: new WeakMap() } as unknown as State.State
        const result = yield* Input.frameHandleOf(state, frame, handle, process)
        assert.isTrue(Option.isNone(result))
        assert.isUndefined(state.frameHandles.get(frame))
        clean()
      }))

    it.effect(`rejects ${mode === "normal" ? "a sibling" : mode} without leaving a mark`, () =>
      Effect.gen(function*() {
        const { clean, frames, process } = fixture(mode)
        const candidates = mode === "normal" ? [frames[0]!] : [frames[1]!]
        const result = yield* Input.matchFrame(process, handle, childHandle, candidates)
        assert.isTrue(Option.isNone(result))
        clean()
      }))
  }
})
