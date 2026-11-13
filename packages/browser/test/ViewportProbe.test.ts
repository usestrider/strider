import * as vm from "node:vm"
import { describe, expect, it } from "vitest"
import { viewportTap } from "./integration/viewportProbe.ts"

describe("viewport failure trace probe", () => {
  it("does not run page-owned dimension getters while observing a resumed page", () => {
    let reads = 0
    const page = vm.createContext({
      get innerWidth() {
        reads++
        return 123
      },
      innerHeight: 456,
      outerWidth: 800,
      outerHeight: 600,
      devicePixelRatio: 1
    })
    const tap = viewportTap(() => {})
    tap.inject = (message) => {
      const command = JSON.parse(message)
      // CDP evaluates without an explicit context in the page's main world.
      if (command.method === "Runtime.evaluate" && command.params.contextId === undefined) {
        vm.runInContext(command.params.expression, page)
      }
    }
    tap.receive(JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "session",
        targetInfo: { targetId: "target", type: "page" },
        waitingForDebugger: true
      }
    }))
    tap.send(JSON.stringify({ id: 1, sessionId: "session", method: "Runtime.runIfWaitingForDebugger" }))
    tap.receive(JSON.stringify({ id: 1, result: {} }))
    expect(reads, "diagnostic measurements must not invoke author code").toBe(0)
  })

  it("never evaluates a paused renderer and correlates measurements across resume and clear", () => {
    const records: Array<{ kind: string; payload: any }> = []
    const writes: Array<any> = []
    const tap = viewportTap((kind, payload) => records.push({ kind, payload }))
    tap.inject = (message) => writes.push(JSON.parse(message))
    const receive = (value: object) => tap.receive(JSON.stringify(value))
    expect(receive({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "session",
        targetInfo: { targetId: "target", type: "page" },
        waitingForDebugger: true
      }
    })).toBe(false)
    expect(writes.map((entry) => entry.method)).toEqual(["Browser.getWindowForTarget", "Page.getLayoutMetrics"])
    expect(records.some((entry) => entry.kind === "viewport-unavailable" && entry.payload.measurement === "renderer"))
      .toBe(true)
    const native = writes[0]
    expect(receive({ id: native.id, result: { windowId: 1, bounds: { width: 800, height: 600 } } })).toBe(true)
    expect(records.at(-1)?.payload).toMatchObject({
      sessionId: "session",
      targetId: "target",
      phase: "attached-setup",
      measurement: "native-window"
    })
    tap.send(JSON.stringify({ id: 1, sessionId: "session", method: "Runtime.runIfWaitingForDebugger" }))
    expect(writes.some((entry) => entry.method === "Runtime.evaluate")).toBe(false)
    expect(receive({ id: 1, result: {} })).toBe(false)
    const world = writes.at(-1)
    expect(world).toMatchObject({ method: "Page.createIsolatedWorld", params: { frameId: "target" } })
    expect(receive({ id: world.id, result: { executionContextId: 7 } })).toBe(true)
    expect(writes.at(-1)).toMatchObject({ method: "Runtime.evaluate", params: { contextId: 7 } })
    tap.send(JSON.stringify({ id: 2, sessionId: "session", method: "Emulation.clearDeviceMetricsOverride" }))
    expect(receive({ id: 2, result: {} })).toBe(false)
    expect(records.some((entry) => entry.payload.phase === "before-clear")).toBe(true)
    expect(records.some((entry) => entry.payload.phase === "after-clear")).toBe(true)
    const afterClear = writes.at(-1)
    expect(afterClear.method).toBe("Page.createIsolatedWorld")
    expect(receive({ id: afterClear.id, result: { executionContextId: 8 } })).toBe(true)
    const renderer = writes.at(-1)
    expect(renderer.method).toBe("Runtime.evaluate")
    expect(receive({ id: renderer.id, error: { message: "context destroyed" } })).toBe(true)
    expect(records.at(-1)?.kind).toBe("viewport-unavailable")
    expect(receive({ id: 123, result: {} })).toBe(false)
  })

  it("records unavailable pending measurements when a target detaches", () => {
    const records: Array<{ kind: string; payload: any }> = []
    const tap = viewportTap((kind, payload) => records.push({ kind, payload }))
    tap.inject = () => {}
    tap.receive(JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "s",
        targetInfo: { targetId: "t", type: "page" },
        waitingForDebugger: true
      }
    }))
    tap.receive(JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId: "s" } }))
    expect(records.filter((entry) => entry.payload.reason === "target detached before reply")).toHaveLength(2)
  })
})
