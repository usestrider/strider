// Private diagnostic only. Retain original bytes even when validation fails.
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"

type Event = { at: number; kind: string; name: string; data?: unknown }
type NativeEvent = {
  name?: string
  ph?: string
  ts?: number
  dur?: number
  args?: { call_id?: number; method?: string }
}
export const calibrateRoot = async (
  send: () => Promise<unknown>,
  mark: (name: string, data?: unknown) => void,
  timeoutMs = 2000
) => {
  mark("calibration.start", { count: 3 })
  try {
    for (let i = 0; i < 3; i++) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.resolve().then(send),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Root calibration command timed out")), timeoutMs)
          })
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    mark("calibration.end")
  } catch (error) {
    mark("calibration.error", { error: String(error) })
    throw error
  }
}

export const retainNativeTrace = async (
  file: string,
  events: ReadonlyArray<Event>,
  timeoutMs = 10_000,
  options: { requireCalibration?: boolean } = {}
) => {
  const deadline = performance.now() + timeoutMs
  let error = "Native trace not written"
  do {
    try {
      const bytes = fs.readFileSync(file)
      const parsed = JSON.parse(bytes.toString()) as {
        traceEvents: Array<NativeEvent>
        metadata?: { "clock-domain"?: string; trace_processor_stats?: { traced_buf?: Array<Record<string, number>> } }
      }
      assert.ok(Array.isArray(parsed.traceEvents) && parsed.traceEvents.length > 0, "Empty native trace")
      assert.equal(parsed.metadata?.["clock-domain"], "LINUX_CLOCK_MONOTONIC", "Missing native clock domain")
      const buffers = parsed.metadata?.trace_processor_stats?.traced_buf
      assert.ok(Array.isArray(buffers) && buffers.length > 0, "Missing native buffer-loss accounting")
      for (const buffer of buffers) {
        for (const [key, value] of Object.entries(buffer)) {
          if (/loss|discard|overwrit|dropped|^abi_violations$|^patches_failed$/.test(key)) {
            assert.equal(value, 0, `Native trace data loss: ${key}`)
          }
        }
      }
      const sends = events.filter((e) => e.kind === "wire" && e.name === "send")
      const first = sends[0]
      const message = first?.data as { id?: number; method?: string; sessionId?: string } | undefined
      assert.ok(message?.method === "Browser.getVersion" && typeof message.id === "number", "Missing first command")
      const reply = (sent: Event) => {
        const data = sent.data as { id: number; sessionId?: string }
        return events.find((e) => {
          const received = e.data as { id?: number; sessionId?: string } | undefined
          return e.kind === "wire" && e.name === "receive" && e.at >= sent.at &&
            received?.id === data.id && received.sessionId === data.sessionId
        })
      }
      const firstReply = reply(first!)
      assert.ok(firstReply, "Missing first command reply")
      const start = events.find((e) => e.kind === "mark" && e.name === "calibration.start")
      const end = events.find((e) => e.kind === "mark" && e.name === "calibration.end")
      const isCalibration = (e: Event) => start !== undefined && end !== undefined && e.at >= start.at && e.at <= end.at
      const calibration: Array<{ id: number; sendMs: number; replyMs: number; nativeStartUs: number }> = []
      let beforeLower = -Infinity
      let beforeUpper = Infinity
      let lower = -Infinity
      let upper = Infinity
      let firstNative: NativeEvent | undefined
      let matched = 0
      for (const sent of sends) {
        const data = sent.data as { id: number; method: string; sessionId?: string }
        if (data.sessionId !== undefined) continue
        const received = reply(sent)
        const native = parsed.traceEvents.find((e) =>
          e.name === "DevToolsSession::HandleCommand in Browser" && e.ph === "X" &&
          e.args?.call_id === data.id && e.args.method === data.method
        )
        if (!received || !native) continue
        assert.ok(
          Number.isFinite(native.ts) && Number.isFinite(native.dur) && native.dur! >= 0,
          "Invalid native timestamp"
        )
        lower = Math.max(lower, sent.at - native.ts! / 1000)
        upper = Math.min(upper, received.at - native.ts! / 1000)
        if (isCalibration(sent) && data.method === "Browser.getVersion") {
          assert.ok(received.at <= end!.at, "Missing calibration reply before completion")
          calibration.push({ id: data.id, sendMs: sent.at, replyMs: received.at, nativeStartUs: native.ts! })
        } else {
          beforeLower = Math.max(beforeLower, sent.at - native.ts! / 1000)
          beforeUpper = Math.min(beforeUpper, received.at - native.ts! / 1000)
        }
        matched++
        if (sent === first) firstNative = native
      }
      assert.ok(firstNative, "Missing native first command handler")
      if (options.requireCalibration) {
        const available = events.find((e) => e.kind === "mark" && e.name === "launch.available")
        const ready = events.find((e) => e.kind === "mark" && e.name === "calibration.ready")
        const gate = events.find((e) => e.kind === "mark" && e.name === "initial.gate.observed")
        assert.ok(start && end && available && ready, "Missing calibration phase evidence")
        assert.ok(
          available.at <= ready.at && ready.at <= start.at && start.at <= end.at &&
            (gate === undefined || gate.at <= ready.at),
          "Early calibration before readiness"
        )
        assert.equal((start.data as { count?: number })?.count, 3, "Invalid calibration probe count")
        assert.equal(
          calibration.length,
          3,
          "Missing calibration root send/reply/native handler evidence; trace window may have expired"
        )
        assert.equal(new Set(calibration.map((entry) => entry.id)).size, 3, "Duplicate calibration id")
      }
      assert.ok(lower <= upper, "Inconsistent native/host clock bounds")
      return {
        status: "complete",
        file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        events: parsed.traceEvents.length,
        buffers,
        clockDomain: parsed.metadata["clock-domain"],
        beforeCalibrationOffsetMs: [beforeLower, beforeUpper],
        beforeCalibrationUncertaintyMs: beforeUpper - beforeLower,
        calibration,
        offsetMs: [lower, upper],
        uncertaintyMs: upper - lower,
        matched,
        alignment:
          "Host ms = native us / 1000 + offset. Causal send/handler-entry/reply intersection; assumes common monotonic rate over this launch. Bounds include host scheduling and transport delay; no exact point alignment claimed.",
        firstCommand: {
          method: message.method,
          id: message.id,
          sendMs: first!.at,
          replyMs: firstReply.at,
          nativeStartUs: firstNative.ts,
          nativeDurationUs: firstNative.dur
        },
        error: null
      }
    } catch (cause) {
      error = String(cause)
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (performance.now() < deadline)
  return { status: "error", file, error }
}
