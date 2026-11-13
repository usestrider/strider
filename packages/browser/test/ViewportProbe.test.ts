import { describe, expect, it } from "vitest"
import { viewportTap } from "./integration/viewportProbe.ts"

describe("viewport failure trace probe", () => {
  it("injects only browser-side commands: no page code and no execution world", () => {
    const methods = new Set<string>()
    const tap = viewportTap(() => {})
    tap.inject = (message) => methods.add(JSON.parse(message).method)
    const receive = (value: object) => tap.receive(JSON.stringify(value))
    receive({
      method: "Target.attachedToTarget",
      params: { sessionId: "session", targetInfo: { targetId: "target", type: "page" }, waitingForDebugger: true }
    })
    tap.send(JSON.stringify({ id: 1, sessionId: "session", method: "Runtime.runIfWaitingForDebugger" }))
    receive({ id: 1, result: {} })
    tap.send(JSON.stringify({ id: 2, sessionId: "session", method: "Emulation.clearDeviceMetricsOverride" }))
    receive({ id: 2, result: {} })
    expect([...methods].sort()).toEqual(["Browser.getWindowForTarget", "Page.getLayoutMetrics"])
  })

  it("correlates measurements across resume and clear", () => {
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
    const native = writes[0]
    expect(receive({ id: native.id, result: { windowId: 1, bounds: { width: 800, height: 600 } } })).toBe(true)
    expect(records.at(-1)?.payload).toMatchObject({
      sessionId: "session",
      targetId: "target",
      phase: "attached-setup",
      measurement: "native-window"
    })
    tap.send(JSON.stringify({ id: 1, sessionId: "session", method: "Runtime.runIfWaitingForDebugger" }))
    expect(receive({ id: 1, result: {} })).toBe(false)
    tap.send(JSON.stringify({ id: 2, sessionId: "session", method: "Emulation.clearDeviceMetricsOverride" }))
    expect(receive({ id: 2, result: {} })).toBe(false)
    expect(records.some((entry) => entry.payload.phase === "before-clear")).toBe(true)
    expect(records.some((entry) => entry.payload.phase === "after-clear")).toBe(true)
    const layout = writes.at(-1)
    expect(layout.method).toBe("Page.getLayoutMetrics")
    expect(receive({ id: layout.id, error: { message: "target closed" } })).toBe(true)
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
