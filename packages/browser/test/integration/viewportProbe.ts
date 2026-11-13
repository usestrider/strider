/** Recorder-only CDP viewport observations. Queries never gate target resume or adapter completion. */
import type { Record } from "./failureTrace.ts"
import type { Tap } from "./pointerRecipients.ts"

export const viewportTap = (trace: Record): Tap => {
  let nextId = 2 ** 29
  let sample = 0
  const sessions = new Map<string, { targetId: string; paused: boolean }>()
  const pending = new Map<number, { metadata: object; measurement: string; then?: (result: any) => void }>()
  const commands = new Map<number, { sessionId: string; method: string }>()
  const query = (
    sessionId: string | undefined,
    method: string,
    params: object,
    metadata: object,
    measurement: string,
    then?: (result: any) => void
  ) => {
    if (tap.inject === undefined || pending.size >= 512) {
      trace("viewport-unavailable", { ...metadata, measurement, reason: "probe unavailable or pending limit" })
      return
    }
    const id = nextId++
    pending.set(id, { metadata, measurement, ...(then === undefined ? {} : { then }) })
    trace("viewport-request", { ...metadata, measurement, id, status: "pending; no reply is not a measurement" })
    tap.inject(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }))
  }
  const measure = (sessionId: string, phase: string) => {
    const target = sessions.get(sessionId)
    if (target === undefined) return
    const metadata = { sample: ++sample, sessionId, targetId: target.targetId, phase, paused: target.paused }
    query(undefined, "Browser.getWindowForTarget", { targetId: target.targetId }, metadata, "native-window")
    query(sessionId, "Page.getLayoutMetrics", {}, metadata, "layout")
    if (target.paused) {
      trace("viewport-unavailable", {
        ...metadata,
        measurement: "renderer",
        reason: "target paused; evaluation would wait for resume"
      })
    } else {
      // Read in an isolated world of the main frame, as restoration does, so no page-owned getter runs and no
      // page-defined name can supply a value.
      query(
        sessionId,
        "Page.createIsolatedWorld",
        { frameId: target.targetId, worldName: "__strider_viewport_probe" },
        metadata,
        "renderer-world",
        (world) =>
          query(
            sessionId,
            "Runtime.evaluate",
            {
              expression: "({ width: innerWidth, height: innerHeight, outerWidth, outerHeight, devicePixelRatio })",
              contextId: world.executionContextId,
              returnByValue: true
            },
            metadata,
            "renderer"
          )
      )
    }
  }
  const tap: Tap = {
    inject: undefined,
    send(message) {
      try {
        const sent = JSON.parse(message)
        if (!sessions.has(sent.sessionId)) return
        if (sent.method === "Page.getLayoutMetrics") {
          trace("viewport-baseline-request", {
            sessionId: sent.sessionId,
            targetId: sessions.get(sent.sessionId)!.targetId,
            id: sent.id
          })
          commands.set(sent.id, { sessionId: sent.sessionId, method: sent.method })
        }
        if (
          sent.method === "Runtime.runIfWaitingForDebugger" || sent.method === "Emulation.clearDeviceMetricsOverride"
        ) {
          commands.set(sent.id, { sessionId: sent.sessionId, method: sent.method })
          measure(
            sent.sessionId,
            sent.method === "Emulation.clearDeviceMetricsOverride" ? "before-clear" : "before-resume"
          )
        }
      } catch {}
    },
    receive(message) {
      if (typeof message !== "string") return false
      try {
        const received = JSON.parse(message)
        const own = pending.get(received.id)
        if (own !== undefined) {
          pending.delete(received.id)
          if (own.then !== undefined && !received.error && typeof received.result?.executionContextId === "number") {
            own.then(received.result)
            return true
          }
          trace(received.error || received.result?.exceptionDetails ? "viewport-unavailable" : "viewport-measurement", {
            ...own.metadata,
            measurement: own.measurement,
            id: received.id,
            result: received.result ?? null,
            error: received.error ?? received.result?.exceptionDetails ?? null
          })
          return true
        }
        const command = commands.get(received.id)
        if (command !== undefined) {
          commands.delete(received.id)
          trace("viewport-command-reply", {
            ...command,
            targetId: sessions.get(command.sessionId)?.targetId ?? null,
            id: received.id,
            result: received.result ?? null,
            error: received.error ?? null
          })
          if (command.method === "Runtime.runIfWaitingForDebugger") {
            const target = sessions.get(command.sessionId)
            if (target && !received.error) target.paused = false
            measure(command.sessionId, "after-resume")
          } else if (command.method === "Emulation.clearDeviceMetricsOverride") {
            measure(command.sessionId, "after-clear")
          }
        }
        if (received.method === "Target.attachedToTarget" && received.params.targetInfo.type === "page") {
          const { sessionId, targetInfo, waitingForDebugger } = received.params
          sessions.set(sessionId, { targetId: targetInfo.targetId, paused: waitingForDebugger === true })
          measure(sessionId, "attached-setup")
        }
        if (received.method === "Target.detachedFromTarget") {
          const sessionId = received.params.sessionId
          sessions.delete(sessionId)
          for (const [id, entry] of pending) {
            if ((entry.metadata as { sessionId: string }).sessionId !== sessionId) continue
            trace("viewport-unavailable", {
              ...entry.metadata,
              measurement: entry.measurement,
              id,
              reason: "target detached before reply"
            })
            // Keep the ID reserved so a late probe reply cannot reach the protocol client.
          }
        }
      } catch {}
      return false
    }
  }
  return tap
}
