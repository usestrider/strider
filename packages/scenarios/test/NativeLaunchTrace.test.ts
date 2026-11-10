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
  metadata: {}
}
const fixture = async (body: (file: string) => Promise<void>) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "native-launch-"))
  try {
    await body(path.join(scratch, "trace.json"))
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
it("retains complete traces and intersects causal clock bounds", async () =>
  fixture(async (file) => {
    fs.writeFileSync(file, JSON.stringify(native))
    const result = await retainNativeTrace(file, events, 50)
    expect(result.status).toBe("complete")
    expect(result.offsetMs).toEqual([-1001, -999.5])
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
    fs.writeFileSync(file, JSON.stringify(native))
    const result = await retainNativeTrace(file, events.map((e, i) => i === 3 ? { ...e, at: 31.1 } : e), 1)
    expect(result.status).toBe("error")
    expect(result.error).toMatch(/clock/)
    expect(fs.existsSync(file)).toBe(true)
  }))
