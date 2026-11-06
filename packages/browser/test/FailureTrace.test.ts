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
    const concurrentShared = files.filter((name) => name.startsWith("concurrent.fixture") && name.includes("-shared"))
      .map((name) => fs.readFileSync(new URL(name, directory), "utf8")).join("\n")
    expect(concurrentShared).toContain("CONCURRENT_A")
    expect(concurrentShared).toContain("CONCURRENT_B")
    expect(concurrentShared).toContain("CONCURRENT_SHARED_A")
    expect(concurrentShared).toContain("CONCURRENT_SHARED_B")
    for (const name of files.filter((name) => name.startsWith("concurrent.fixture") && name.includes("-test"))) {
      expect(fs.readFileSync(new URL(name, directory), "utf8")).not.toContain("CONCURRENT_")
    }
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

describe("failure trace files", () => {
  it("writes only JSON lines, even when a failing file has no shared traffic", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "process.fixture"
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const shared = files.filter((name) => name.includes("-shared"))
    const contents = shared.map((name) => fs.readFileSync(new URL(name, directory), "utf8"))
    for (const name of files) fs.unlinkSync(new URL(name, directory))
    expect(shared.length).toBe(1)
    for (const line of contents[0]!.replace(/\n$/, "").split("\n")) expect(() => JSON.parse(line)).not.toThrow()
  }, 30_000)
})

describe("late cleanup overflow", () => {
  it("writes one terminal overflow marker with a new sequence number", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "late.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8"
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const tests = files.filter((name) => name.includes("-test"))
    expect(tests.length).toBe(1)
    const entries = fs.readFileSync(new URL(tests[0]!, directory), "utf8").replace(/\n$/, "").split("\n").map((line) =>
      JSON.parse(line)
    )
    const records = entries.slice(1)
    expect(records.map((entry) => entry.sequence)).toEqual(records.map((_, index) => index + 1))
    expect(records.filter((entry) => entry.kind === "overflow").length).toBe(1)
    expect(records.at(-1)?.kind).toBe("overflow")
    expect(records.some((entry) => entry.payload === "AFTER_OVERFLOW")).toBe(false)
    for (const name of files) fs.unlinkSync(new URL(name, directory))
  }, 30_000)
})

describe("a browser shared through layer", () => {
  it("keeps a later failing test's traffic on the connection the first test's beforeEach built", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "sharedLayer.fixture"
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const tests = files.filter((name) => name.includes("-test"))
    const contents = tests.map((name) => fs.readFileSync(new URL(name, directory), "utf8"))
    for (const name of files) fs.unlinkSync(new URL(name, directory))
    expect(tests.length).toBe(1)
    expect(contents[0]).toContain("LATER_TEST")
    expect(contents[0]).not.toContain("FIRST_TEST")
  }, 30_000)
})

describe("shared layer lifecycle attribution", () => {
  it("separates two failures and links shared acquisition and finalization", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "sharedLifecycle.fixture",
      "sharedSetupFailure.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8"
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const parse = (name: string) =>
      fs.readFileSync(new URL(name, directory), "utf8").trimEnd().split("\n").map((line) => JSON.parse(line))
    const tests = files.filter((name) => name.startsWith("sharedLifecycle.fixture") && name.includes("-test")).map(
      parse
    )
    expect(tests.length).toBe(2)
    const first = tests.find((entries) => entries[0].scope === "first shared test fails")!
    const second = tests.find((entries) => entries[0].scope === "later shared test fails")!
    expect(first.map((entry) => entry.payload)).toContain("FIRST_FAIL_ONLY")
    expect(first.map((entry) => entry.payload)).not.toContain("SECOND_FAIL_SEND")
    expect(second.map((entry) => entry.payload)).toContain("SECOND_FAIL_SEND")
    expect(second.map((entry) => entry.payload)).toContain("SECOND_FAIL_RECEIVE")
    expect(second.map((entry) => entry.payload)).not.toContain("FIRST_FAIL_ONLY")
    const sharedName = files.find((name) => name.startsWith("sharedLifecycle.fixture") && name.includes("-shared"))!
    expect(first[0].sharedArtifact).toBe(sharedName)
    expect(second[0].sharedArtifact).toBe(sharedName)
    const shared = parse(sharedName).map((entry) => entry.payload)
    const setupName = files.find((name) => name.startsWith("sharedSetupFailure.fixture") && name.includes("-shared"))!
    expect(parse(setupName).map((entry) => entry.payload)).toContain("LAYER_SETUP_FAILURE")
    expect(shared).toContain("SHARED_SETUP")
    expect(shared).toContain("SHARED_CLEANUP_STDERR")
    expect(shared).toContain("SHARED_EXIT")
    expect(shared).toContain("REAL_SHARED_READY")
    expect(shared).toContain("REAL_SHARED_CLEANUP_STDERR")
    expect(parse(sharedName).some((entry) => entry.kind === "process-exit")).toBe(true)
    for (const name of files) fs.unlinkSync(new URL(name, directory))
  }, 30_000)
})

describe("skipped task bookkeeping", () => {
  it("does not treat a skipped test as a concurrent observer", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "skipped.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8"
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const test = files.find((name) => name.includes("-test"))!
    const shared = files.find((name) => name.includes("-shared"))!
    expect(fs.readFileSync(new URL(test, directory), "utf8")).toContain("AFTER_SKIP_PROBE")
    expect(fs.readFileSync(new URL(shared, directory), "utf8")).not.toContain("AFTER_SKIP_PROBE")
    for (const name of files) fs.unlinkSync(new URL(name, directory))
  }, 30_000)
})

describe("run-time skip bookkeeping", () => {
  it("does not treat a test that skipped itself as a concurrent observer", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
    const before = new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "dynamicSkip.fixture"
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
    const files = fs.readdirSync(directory).filter((name) => !before.has(name))
    const read = (part: string) =>
      fs.readFileSync(new URL(files.find((name) => name.includes(part))!, directory), "utf8")
    const test = read("-test")
    const shared = read("-shared")
    for (const name of files) fs.unlinkSync(new URL(name, directory))
    expect(test).toContain("AFTER_DYNAMIC_SKIP")
    expect(shared).not.toContain("AFTER_DYNAMIC_SKIP")
  }, 30_000)
})

describe("native video failure artifacts", () => {
  it("retains the page, stage and underlying error in the actual failed-test file", async () => {
    const { spawnSync } = await import("node:child_process")
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "video.fixture.ts"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8"
    })
    expect(run.status).toBe(1)
    const paths = [...run.stderr.matchAll(/Integration failure trace: (.+video\.fixture\.ts.+-test\.ndjson)/g)]
    expect(paths.length).toBeGreaterThan(0)
    const content = paths.map((match) => fs.readFileSync(match[1]!, "utf8")).join("\n")
    expect(content).toContain("native-video-failure")
    expect(content).toContain("video-page")
    expect(content).toContain("acquisition")
    expect(content).toContain("ACQUISITION_REASON")
    expect(content).toContain("STOP_REASON")
    expect(content).toContain("READ_REASON")
    expect(content).not.toContain("token=secret")
    expect(content).not.toContain("user:pass")
  })
})
