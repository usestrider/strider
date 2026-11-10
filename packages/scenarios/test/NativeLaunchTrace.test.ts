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
