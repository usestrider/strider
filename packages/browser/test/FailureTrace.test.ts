import * as fs from "node:fs"
import { describe, expect, it } from "vitest"
import { TraceBuffer } from "./integration/failureTrace.ts"
import { pipeObserver } from "./integration/tracePipe.ts"
import { instrument } from "./integration/tracePlugin.ts"

describe("failure trace buffer", () => {
  it("keeps both directions and connection identity in sequence", () => {
    const trace = new TraceBuffer(4096, 100)
    trace.record("a", "send", "command")
    trace.record("b", "receive", "reply")
    const entries = trace.entries()
    expect(entries.map((entry) => [entry.sequence, entry.connection, entry.kind, entry.payload])).toEqual([
      [1, "a", "send", "command"],
      [2, "b", "receive", "reply"]
    ])
    expect(entries[0]!.timestamp).toEqual(expect.any(String))
  })
  it("marks truncated messages and evicted history within a fixed bound", () => {
    const trace = new TraceBuffer(512, 32)
    for (let i = 0; i < 100; i++) trace.record("a", "receive", "x".repeat(100))
    const entries = trace.entries()
    expect(entries[0]!.kind).toBe("overflow")
    expect(entries.at(-1)?.truncated).toBe(true)
    expect(entries.at(-1)?.originalLength).toBe(100)
    expect(trace.bytes).toBeLessThanOrEqual(512)
    expect(entries.length).toBeLessThan(100)
  })
  it("clears passing traffic", () => {
    const trace = new TraceBuffer()
    trace.record("a", "stderr", "text")
    trace.clear()
    expect(trace.entries()).toEqual([])
    expect(trace.bytes).toBe(0)
  })
})

describe("integration-only source interception", () => {
  it("covers pipe, WebSocket and stock WebKit inspector messages and preserves line numbers", () => {
    for (const file of ["../src/protocol/Transport.ts", "../src/internal/webkitInspectorSocket.ts"]) {
      const url = new URL(file, import.meta.url)
      const source = fs.readFileSync(url, "utf8")
      const output = instrument(source, url.pathname)!
      expect(output.code).toContain("__trace(\"send\", message)")
      expect(output.code).toContain("__trace(\"receive\", message)")
      expect(output.code).toContain("__trace(\"closed\", reason)")
      expect(output.code.split("\n").length).toBe(source.split("\n").length)
    }
  })
  it("fails loudly if a transport changes instead of silently losing capture", () => {
    expect(() => instrument("changed", "/src/protocol/Transport.ts")).toThrow("no longer matches")
    expect(instrument("unchanged", "/src/internal/model.ts")).toBeUndefined()
  })
})

describe("failure trace runner lifecycle", () => {
  it("retains failures and shared hook context, discards passes, and observes owned processes", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8"
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const read = (part: string) =>
      files.filter((name) => name.includes(part)).map((name) => fs.readFileSync(new URL(name, directory), "utf8")).join(
        "\n"
      )
    expect(files.some((name) => name.startsWith("passing.fixture"))).toBe(false)
    const test = read("lifecycle.fixture").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const payloads = test.map((entry) => entry.payload)
    expect(payloads).toContain("FAIL_ONLY")
    expect(payloads).toContain("SETUP_ONLY")
    expect(payloads).toContain("TEARDOWN_ONLY")
    expect(payloads).not.toContain("PASS_ONLY")
    expect(payloads).not.toContain("LATE_PASS_ONLY")
    expect(read("setup.fixture")).toContain("SETUP_FAILURE_ONLY")
    expect(read("process.fixture")).toContain("OWNED_STDERR")
    expect(read("process.fixture")).toContain("\"kind\":\"pipe-send\"")
    expect(read("process.fixture")).toContain("PIPE_SEND")
    expect(read("process.fixture")).toContain("\"kind\":\"pipe-receive\"")
    expect(read("process.fixture")).toContain("PIPE_RECEIVE")
    expect(read("process.fixture")).toContain("\"kind\":\"process-exit\"")
    expect(read("process.fixture")).toContain("\\\"code\\\":7")
    expect(run.stderr).toContain("Integration failure trace:")
    // A failed outer assertion leaves the diagnostic files available for inspection.
    for (const name of files) fs.unlinkSync(new URL(name, directory))
  }, 30_000)
})

describe("owned Chromium pipe framing", () => {
  it("orders split and joined frames and explicitly marks bounded payload prefixes", () => {
    const entries: Array<[string, unknown]> = []
    const observe = pipeObserver((kind, payload) => entries.push([kind, payload]), "pipe-receive")
    observe("one\0tw")
    observe("o\0" + "x".repeat(40 * 1024))
    observe("x\0last\0")
    expect(entries.slice(0, 2)).toEqual([["pipe-receive", "one"], ["pipe-receive", "two"]])
    expect((entries[2]![1] as string).length).toBe(32 * 1024)
    expect(entries[3]).toEqual(["wire-truncation", {
      direction: "pipe-receive",
      originalBytes: 40 * 1024 + 1,
      retainedBytes: 32 * 1024
    }])
    expect(entries[4]).toEqual(["pipe-receive", "last"])
  })
})
