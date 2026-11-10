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
export const retainNativeTrace = async (file: string, events: ReadonlyArray<Event>, timeoutMs = 10_000) => {
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
          if (/loss|discard|overwrit|dropped/.test(key)) assert.equal(value, 0, `Native trace data loss: ${key}`)
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
        matched++
        if (sent === first) firstNative = native
      }
      assert.ok(firstNative, "Missing native first command handler")
      assert.ok(lower <= upper, "Inconsistent native/host clock bounds")
      return {
        status: "complete",
        file,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        events: parsed.traceEvents.length,
        buffers,
        clockDomain: parsed.metadata["clock-domain"],
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
