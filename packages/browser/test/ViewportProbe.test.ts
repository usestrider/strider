import { describe, expect, it } from "vitest"
import { viewportTap } from "./integration/viewportProbe.ts"

describe("viewport failure trace probe", () => {
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
    expect(writes.at(-1).method).toBe("Runtime.evaluate")
    tap.send(JSON.stringify({ id: 2, sessionId: "session", method: "Emulation.clearDeviceMetricsOverride" }))
    expect(receive({ id: 2, result: {} })).toBe(false)
    expect(records.some((entry) => entry.payload.phase === "before-clear")).toBe(true)
    expect(records.some((entry) => entry.payload.phase === "after-clear")).toBe(true)
    const renderer = writes.at(-1)
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
