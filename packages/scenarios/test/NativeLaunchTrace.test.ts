import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { expect, it } from "vitest"
import { retainNativeTrace } from "../benchmark/native-launch-trace.ts"

const events = [
  { at: 10, kind: "wire", name: "send", data: { id: 1, method: "Browser.getVersion" } },
  { at: 30, kind: "wire", name: "receive", data: { id: 1, result: {} } },
  { at: 31, kind: "wire", name: "send", data: { id: 2, method: "Target.setAutoAttach" } },
  { at: 33, kind: "wire", name: "receive", data: { id: 2, result: {} } }
]
const native = {
  traceEvents: [
    {
      name: "DevToolsSession::HandleCommand in Browser",
      ph: "X",
      ts: 1020000,
      dur: 1000,
      args: { call_id: 1, method: "Browser.getVersion" }
    },
    {
      name: "DevToolsSession::HandleCommand in Browser",
      ph: "X",
      ts: 1032000,
      dur: 500,
      args: { call_id: 2, method: "Target.setAutoAttach" }
    }
  ],
  metadata: {
    "clock-domain": "LINUX_CLOCK_MONOTONIC",
    trace_processor_stats: { traced_buf: [{ bytes_overwritten: 0 }] }
  }
}
const fixture = async (body: (file: string) => Promise<void>) => {
  const retained = process.env["STRIDER_LAUNCH_TEST_OUTPUT"]
  if (retained !== undefined) fs.mkdirSync(retained, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(retained ?? os.tmpdir(), "native-launch-"))
  try {
    await body(path.join(scratch, "trace.json"))
  } finally {
    if (retained === undefined) fs.rmSync(scratch, { recursive: true, force: true })
  }
}
it("retains complete traces and intersects causal clock bounds", async () =>
  fixture(async (file) => {
    fs.writeFileSync(file, JSON.stringify(native))
    const result = await retainNativeTrace(file, events, 50)
    expect(result.status).toBe("complete")
    expect(result.offsetMs).toEqual([-1001, -999])
    expect(result.firstCommand).toEqual({
      method: "Browser.getVersion",
      id: 1,
      sendMs: 10,
      replyMs: 30,
      nativeStartUs: 1020000,
      nativeDurationUs: 1000
    })
    expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify(native))
  }))
it.each(["{", JSON.stringify({ traceEvents: [] })])(
  "rejects incomplete traces without deleting raw bytes (%s)",
  async (bytes) =>
    fixture(async (file) => {
      fs.writeFileSync(file, bytes)
      expect((await retainNativeTrace(file, events, 1)).status).toBe("error")
      expect(fs.readFileSync(file, "utf8")).toBe(bytes)
    })
)
it.each([0, 1])("rejects missing first-command evidence %s", async (index) =>
  fixture(async (file) => {
    fs.writeFileSync(file, JSON.stringify(native))
    const result = await retainNativeTrace(file, events.filter((_, i) => i !== index), 1)
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/first/)
  }))
it("rejects inconsistent clock bounds and preserves the trace", async () =>
  fixture(async (file) => {
    const value = structuredClone(native)
    value.traceEvents[1]!.ts = 1000000
    fs.writeFileSync(file, JSON.stringify(value))
    const result = await retainNativeTrace(file, events, 1)
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/clock/)
    expect(fs.existsSync(file)).toBe(true)
  }))

it.each(["clock", "loss", "handler"])("rejects unusable native evidence (%s)", async (kind) =>
  fixture(async (file) => {
    const value = structuredClone(native)
    if (kind === "clock") value.metadata["clock-domain"] = "unknown"
    if (kind === "loss") value.metadata.trace_processor_stats.traced_buf[0]!.bytes_overwritten = 1
    if (kind === "handler") value.traceEvents = value.traceEvents.slice(1)
    fs.writeFileSync(file, JSON.stringify(value))
    expect((await retainNativeTrace(file, events, 1)).status).toBe("error")
    expect(fs.existsSync(file)).toBe(true)
  }))

it("bounds handler entry even when the handler ends after reply delivery", async () =>
  fixture(async (file) => {
    const value = structuredClone(native)
    value.traceEvents[0]!.dur = 100000
    fs.writeFileSync(file, JSON.stringify(value))
    expect((await retainNativeTrace(file, events, 1)).status).toBe("complete")
  }))
it("rejects traces whose buffers report corrupted or rejected chunks", async () =>
  fixture(async (file) => {
    // Perfetto's traced_buf reports dropped data under names the loss pattern misses: chunks
    // from a misbehaving producer (abi_violations) and chunk patches that could not be applied.
    for (const counter of ["abi_violations", "patches_failed"]) {
      const corrupted = {
        ...native,
        metadata: {
          ...native.metadata,
          trace_processor_stats: { traced_buf: [{ bytes_overwritten: 0, [counter]: 1 }] }
        }
      }
      fs.writeFileSync(file, JSON.stringify(corrupted))
      const result = await retainNativeTrace(file, events, 50)
      expect(result.status, counter).toBe("error")
    }
  }))

const calibrationEvents = [
  ...events,
  { at: 34, kind: "mark", name: "launch.available" },
  { at: 35, kind: "mark", name: "initial.gate.observed" },
  { at: 40, kind: "mark", name: "calibration.start", data: { count: 3 } },
  ...[101, 102, 103].flatMap((id, i) => [
    { at: 41 + i * 2, kind: "wire", name: "send", data: { id, method: "Browser.getVersion" } },
    { at: 41.4 + i * 2, kind: "wire", name: "receive", data: { id, result: {} } }
  ]),
  { at: 47, kind: "mark", name: "calibration.end" }
]
const calibratedNative = {
  ...native,
  traceEvents: [
    ...native.traceEvents,
    ...[101, 102, 103].map((id, i) => ({
      name: "DevToolsSession::HandleCommand in Browser",
      ph: "X",
      ts: 1041000 + i * 2000,
      dur: 100,
      args: { call_id: id, method: "Browser.getVersion" }
    }))
  ]
}
it("tightens the same sample using post-gate root calibration while preserving first-command evidence", async () =>
  fixture(async (file) => {
    fs.writeFileSync(file, JSON.stringify(calibratedNative))
    const result = await retainNativeTrace(file, calibrationEvents, 1, { requireCalibration: true })
    expect(result.status).toBe("complete")
    expect(result.beforeCalibrationOffsetMs).toEqual([-1001, -999])
    expect(result.offsetMs?.[0]).toBe(-1000)
    expect(result.uncertaintyMs).toBeCloseTo(0.4)
    expect(result.calibration).toHaveLength(3)
    expect(result.firstCommand?.id).toBe(1)
  }))
it.each(["marks", "reply", "native", "early", "first"])(
  "rejects missing or invalid calibration evidence (%s) and retains bytes",
  async (kind) =>
    fixture(async (file) => {
      const trace = structuredClone(calibratedNative)
      let observed = calibrationEvents
      if (kind === "marks") observed = observed.filter((e) => !e.name.startsWith("calibration."))
      if (kind === "reply") observed = observed.filter((e) => !(e.name === "receive" && e.data?.id === 103))
      if (kind === "native") trace.traceEvents = trace.traceEvents.filter((e) => e.args.call_id !== 103)
      if (kind === "early") observed = observed.map((e) => e.name === "initial.gate.observed" ? { ...e, at: 48 } : e)
      if (kind === "first") trace.traceEvents = trace.traceEvents.filter((e) => e.args.call_id !== 1)
      const bytes = JSON.stringify(trace)
      fs.writeFileSync(file, bytes)
      const result = await retainNativeTrace(file, observed, 1, { requireCalibration: true })
      expect(result.status).toBe("error")
      expect(result.error).toMatch(kind === "first" ? /first/ : /calibration/)
      expect(fs.readFileSync(file, "utf8")).toBe(bytes)
    })
)
