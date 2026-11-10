import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { TraceBuffer } from "./integration/failureTrace.ts"
import { pipeObserver } from "./integration/tracePipe.ts"
import { instrument } from "./integration/tracePlugin.ts"

// The runner reports every artifact it writes. Directory snapshots also pick up other runs' traces.
const fixtureFiles = (
  stderr: string
) => [
  ...new Set([...stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)].map((match) => path.basename(match[1]!)))
]

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
  it("instruments rendering rounds and host deadline selection only in the recorder build", () => {
    for (const name of ["engine", "runtime", "operation"]) {
      const url = new URL(`../src/internal/${name}.ts`, import.meta.url)
      const source = fs.readFileSync(url, "utf8")
      const output = instrument(source, url.pathname)!
      expect(output.code).toContain(name === "engine" ? "__rendering" : "__failureConnection")
      expect(output.code.split("\n").length).toBe(source.split("\n").length)
      expect(source).not.toContain("__rendering")
    }
  })
  it("correlates callback and timer winners with bounded per-round page-clock evidence", async () => {
    const url = new URL("../src/internal/engine.ts", import.meta.url)
    const output = instrument(fs.readFileSync(url, "utf8"), url.pathname)!.code
    const body = output.slice(output.indexOf("  const nextFrame ="), output.indexOf("  const fire ="))
    const compiled = stripTypeScriptTypes(body) + "\nreturn nextFrame"
    let timer: () => void = () => {}
    let frame: () => void = () => {}
    let time = 10
    let cleared = 0
    const document = { visibilityState: "hidden" }
    const next = new Function("setTimer", "clearTimer", "onFrame", "now", "document", compiled)(
      (callback: () => void) => {
        timer = callback
        return 1
      },
      () => {
        cleared++
      },
      (callback: () => void) => {
        frame = callback
      },
      () => time,
      document
    )
    const first = { events: [] as Array<any>, omitted: 0 }
    const second = { events: [] as Array<any>, omitted: 0 }
    const waiting = next(100, first)
    time = 110
    timer()
    expect(await waiting).toBe(false)
    expect(first.events[0]).toMatchObject({
      start: 10,
      cap: 100,
      timer: 110,
      callback: null,
      winner: "timer",
      visibility: "hidden",
      clock: "page-performance-ms"
    })
    time = 115
    frame()
    expect(first.events[0]).toMatchObject({ callback: 115, winner: "timer" })
    document.visibilityState = "visible"
    for (let i = 0; i < 40; i++) {
      const waiting = next(7, second)
      frame()
      expect(await waiting).toBe(true)
    }
    expect(second.events).toHaveLength(32)
    expect(second.omitted).toBe(8)
    expect(second.events[0]).toMatchObject({ cap: 7, visibility: "visible", winner: "callback", timer: null })
    expect(first.events).toHaveLength(1)
    expect(cleared).toBe(41)
  })
  it("attributes runtime replies to their operation, document, realm and distinct round", () => {
    const url = new URL("../src/internal/runtime.ts", import.meta.url)
    const output = instrument(fs.readFileSync(url, "utf8"), url.pathname)!.code
    const start = output.indexOf("const callInDocument =")
    const end = output.indexOf("/**", start)
    const code = stripTypeScriptTypes(output.slice(start, end))
    const entries: Array<{ kind: string; payload: any }> = []
    const call = (_runtime: unknown, _realm: unknown, _declaration: unknown, args: Array<string>) => {
      const request = JSON.parse(args[0]!)
      return Effect.succeed({
        _tag: "Value",
        value: { type: "string", value: JSON.stringify({ _tag: "NotReady", __rendering: request.__rendering }) }
      })
    }
    const callInDocument = new Function(
      "Effect",
      "Option",
      "engineRealm",
      "call",
      "string",
      "__failureConnection",
      "const Engine = { missing: \"missing\" }; let __roundSequence = 0;" + code + ";return callInDocument"
    )(
      Effect,
      Option,
      () => Effect.succeed("realm-a"),
      call,
      (s: string) => s,
      () => (kind: string, payload: any) => entries.push({ kind, payload })
    )
    Effect.runSync(callInDocument({}, "document-a", "run", JSON.stringify({ op: "act", cap: 100 }), "operation-a"))
    Effect.runSync(callInDocument({}, "document-b", "run", JSON.stringify({ op: "act", cap: 50 }), "operation-b"))
    const replies = entries.filter((entry) => entry.kind === "engine-round-reply").map((entry) => entry.payload)
    expect(replies).toHaveLength(2)
    expect(replies[0]).toMatchObject({
      round: 1,
      document: "document-a",
      realm: "realm-a",
      operationId: "operation-a",
      cap: 100,
      rendering: { round: 1, events: [], omitted: 0 }
    })
    expect(replies[1]).toMatchObject({
      round: 2,
      document: "document-b",
      operationId: "operation-b",
      cap: 50,
      rendering: { round: 2 }
    })
  })
  it("fails loudly if a transport changes instead of silently losing capture", () => {
    expect(() => instrument("changed", "/src/protocol/Transport.ts")).toThrow("no longer matches")
    expect(instrument("unchanged", "/src/internal/model.ts")).toBeUndefined()
  })
})

describe("failure trace runner lifecycle", () => {
  it("caps aggregate passing artifacts without retaining raw traffic", async () => {
    const { spawnSync } = await import("node:child_process")
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "retention.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STRIDER_TRACE_RETAIN_PASSES: "1" }
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stderr).toContain("retention budget exhausted")
    const paths = [...run.stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)].map((match) => match[1]!)
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.reduce((bytes, file) => bytes + fs.statSync(file).size, 0)).toBeLessThanOrEqual(16 * 1024 * 1024)
    let remaining = 16 * 1024 * 1024
    for (const file of paths.filter((file) => file.endsWith("-test.ndjson"))) {
      const text = fs.readFileSync(file, "utf8")
      const header = JSON.parse(text.split("\n")[0]!)
      expect(header.passingRetentionRemainingBytes).toBe(remaining)
      remaining -= Buffer.byteLength(text)
    }
    expect(remaining).toBeLessThan(128 * 1024)
    const artifacts = paths.map((file) => fs.readFileSync(file, "utf8"))
    expect(artifacts.some((text) => text.includes("Passing diagnostic retention budget exhausted"))).toBe(true)
    for (const file of paths) fs.unlinkSync(file)
  }, 30_000)

  it("retains failed-scope traffic independently after the passing budget is exhausted", async () => {
    const { spawnSync } = await import("node:child_process")
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "retention.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STRIDER_TRACE_RETAIN_PASSES: "1", STRIDER_QUOTA_FAILED_SCOPE: "1" }
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(run.stderr).toContain("retention budget exhausted")
    const paths = [...run.stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)].map((match) => match[1]!)
    const passingBytes = paths.filter((file) => file.endsWith("-test.ndjson")).reduce(
      (bytes, file) => bytes + fs.statSync(file).size,
      0
    )
    const failed = paths.filter((file) => file.endsWith("-shared.ndjson"))
    expect(passingBytes).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(failed).toHaveLength(1)
    expect(fs.readFileSync(failed[0]!, "utf8")).toContain("FAILED_AFTER_QUOTA")
    expect(fs.statSync(failed[0]!).size).toBeGreaterThan(512 * 1024)
    expect(passingBytes + fs.statSync(failed[0]!).size).toBeGreaterThan(16 * 1024 * 1024)
    for (const file of paths) fs.unlinkSync(file)
  }, 30_000)

  it("keeps a late passing test's diagnostics after many passes that recorded none", async () => {
    const { spawnSync } = await import("node:child_process")
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "emptyPasses.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STRIDER_TRACE_RETAIN_PASSES: "1" }
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    const paths = [...run.stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)].map((match) => match[1]!)
    const passing = paths.filter((file) => file.endsWith("-test.ndjson"))
    expect(passing).toHaveLength(1)
    const entries = fs.readFileSync(passing[0]!, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line))
    const diagnostic = entries.find((entry) => entry.kind === "host-timeout")
    const ownership = entries.find((entry) => entry.kind === "connection" && entry.connection === diagnostic.connection)
    expect(JSON.parse(ownership.payload)).toMatchObject({
      label: "late-diagnostic",
      owner: expect.any(String),
      ambiguousCreator: false
    })
    expect(JSON.parse(ownership.payload).owner).not.toBe("shared suite context")
    const sharedDiagnostic = entries.find((entry) =>
      entry.kind === "host-timeout" && JSON.parse(entry.payload).operationId === "shared-late"
    )
    const sharedOwnership = entries.find((entry) =>
      entry.kind === "connection" && entry.connection === sharedDiagnostic.connection
    )
    expect(JSON.parse(sharedOwnership.payload)).toMatchObject({
      label: "shared-diagnostic",
      owner: "shared suite context"
    })
    expect(sharedOwnership.ownershipSource).toMatchObject({
      sharedArtifact: expect.any(String),
      sequence: expect.any(Number)
    })
    for (const pid of [101, 102]) {
      const child = entries.find((entry) => entry.kind === "host-timeout" && entry.origin?.pid === pid)
      const childOwner = entries.find((entry) =>
        entry.kind === "connection" && entry.origin?.pid === pid && entry.origin.connection === child.origin.connection
      )
      expect(JSON.parse(childOwner.payload).label).toBe(`child-${pid}`)
      const transferOwner = entries.find((entry) =>
        entry.kind === "connection" && entry.origin === undefined && entry.connection === child.connection
      )
      expect(JSON.parse(transferOwner.payload)).toMatchObject({
        label: "child-transfer-probe",
        owner: JSON.parse(ownership.payload).owner
      })
    }
    expect(entries.some((entry) => entry.payload?.includes("empty-connection"))).toBe(false)
    const kept = paths.some((file) => fs.readFileSync(file, "utf8").includes("\\\"operationId\\\":\\\"late\\\""))
    for (const file of paths) fs.unlinkSync(file)
    expect(kept, "the late test's host-timeout entry should survive the per-file passing budget").toBe(true)
  }, 60_000)

  it("can retain passing diagnostic evidence for a bounded investigation", async () => {
    const { spawnSync } = await import("node:child_process")
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "lifecycle.fixture",
      "-t",
      "passing test discarded"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STRIDER_TRACE_RETAIN_PASSES: "1" }
    })
    const paths = [...run.stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)].map((match) => match[1]!)
    const passing = paths.filter((file) => file.endsWith("-test.ndjson"))
    expect(passing).toHaveLength(1)
    expect(fs.readFileSync(passing[0]!, "utf8")).toContain("Passing.operation")
    expect(fs.readFileSync(passing[0]!, "utf8")).not.toContain("PASS_ONLY")
    for (const file of paths) fs.unlinkSync(file)
  }, 30_000)

  it("retains failures and shared hook context, discards passes, and observes owned processes", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
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
    const files = fixtureFiles(run.stderr)
    const read = (part: string) =>
      files.filter((name) => name.includes(part)).map((name) => fs.readFileSync(new URL(name, directory), "utf8")).join(
        "\n"
      )
    expect(files.some((name) => name.startsWith("passing.fixture"))).toBe(false)
    const test = read("lifecycle.fixture").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    const payloads = test.map((entry) => entry.payload)
    expect(payloads).toContain("FAIL_ONLY")
    const deadlines = test.filter((entry) => entry.kind === "host-timeout").map((entry) => JSON.parse(entry.payload))
    expect(deadlines).toContainEqual(
      expect.objectContaining({
        operation: "Unrelated.failure",
        hint: expect.objectContaining({ _tag: "Some", value: "diagnostic refusal" })
      })
    )
    expect(deadlines.some((entry) => entry.operation === "Passing.operation")).toBe(false)
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
    fs.mkdirSync(directory, { recursive: true })
    const unrelated = new URL(`unrelated-${randomUUID()}.ndjson`, directory)
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "process.fixture"
    ], {
      cwd: new URL("../../../", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, STRIDER_UNRELATED_TRACE: unrelated.pathname }
    })
    expect(run.status, run.stdout + run.stderr).toBe(1)
    expect(fs.readFileSync(unrelated, "utf8")).toBe("unrelated trace\n")
    const files = fixtureFiles(run.stderr)
    const shared = files.filter((name) => name.includes("-shared"))
    const contents = shared.map((name) => fs.readFileSync(new URL(name, directory), "utf8"))
    expect(shared.length).toBe(1)
    for (const line of contents[0]!.replace(/\n$/, "").split("\n")) expect(() => JSON.parse(line)).not.toThrow()
    for (const name of files) fs.unlinkSync(new URL(name, directory))
    try {
      expect(fs.existsSync(unrelated)).toBe(true)
    } finally {
      fs.rmSync(unrelated, { force: true })
    }
  }, 30_000)
})

describe("late cleanup overflow", () => {
  it("writes one terminal overflow marker with a new sequence number", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
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
    const files = fixtureFiles(run.stderr)
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
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "sharedLayer.fixture"
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
    const files = fixtureFiles(run.stderr)
    const tests = files.filter((name) => name.includes("-test"))
    const contents = tests.map((name) => fs.readFileSync(new URL(name, directory), "utf8"))
    expect(tests.length).toBe(1)
    expect(contents[0]).toContain("LATER_TEST")
    expect(contents[0]).not.toContain("FIRST_TEST")
    for (const name of files) fs.unlinkSync(new URL(name, directory))
  }, 30_000)
})

describe("shared layer lifecycle attribution", () => {
  it("separates two failures and links shared acquisition and finalization", async () => {
    const { spawnSync } = await import("node:child_process")
    const directory = new URL("../../../.data/integration-failures/", import.meta.url)
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
    const files = fixtureFiles(run.stderr)
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
    const files = fixtureFiles(run.stderr)
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
    const run = spawnSync("pnpm", [
      "exec",
      "vitest",
      "--run",
      "--config",
      "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
      "dynamicSkip.fixture"
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
    const files = fixtureFiles(run.stderr)
    const read = (part: string) =>
      fs.readFileSync(new URL(files.find((name) => name.includes(part))!, directory), "utf8")
    const test = read("-test")
    const shared = read("-shared")
    expect(test).toContain("AFTER_DYNAMIC_SKIP")
    expect(shared).not.toContain("AFTER_DYNAMIC_SKIP")
    for (const name of files) fs.unlinkSync(new URL(name, directory))
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
    expect(content).toContain("native-video-pending")
    expect(content).toContain("acquisition is still pending at export")
    expect(content).toContain("video-page")
    expect(content).toContain("acquisition")
    expect(content).toContain("ACQUISITION_REASON")
    expect(content).toContain("STOP_REASON")
    expect(content).toContain("READ_REASON")
    expect(content).not.toContain("token=secret")
    expect(content).not.toContain("user:pass")
  })
})

it("transfers bounded child and detached daemon records with process-local ordering", async () => {
  const { spawnSync } = await import("node:child_process")
  const run = spawnSync("pnpm", [
    "exec",
    "vitest",
    "--run",
    "--config",
    "packages/browser/test/fixtures/failureTrace/vitest.config.ts",
    "child.fixture"
  ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })
  expect(run.status, run.stdout + run.stderr).toBe(1)
  const paths = [...run.stderr.matchAll(/Integration failure trace: (.+child\.fixture.+-test\.ndjson)/g)]
  expect(paths).toHaveLength(1)
  const text = fs.readFileSync(paths[0]![1]!, "utf8")
  expect(text).toContain("DAEMON_FAIL")
  expect(text).toContain("DAEMON_ORDER_ONE")
  expect(text).toContain("DAEMON_ORDER_TWO")
  expect(text).toContain("DAEMON_OWN_STDERR")
  expect(text).toContain("BYTE_STDERR_é")
  expect(text).toContain("node-stderr")
  expect(text).toContain("FLOOD_TAIL")
  expect(text).toContain("overflow")
  expect(text).not.toContain("CHILD_PASS")
  expect(text).not.toContain("LATE_CHILD_PASS")
  const entries = text.trimEnd().split("\n").map((line) => JSON.parse(line))
  const childTimeout = entries.find((entry) =>
    entry.kind === "host-timeout" && JSON.parse(entry.payload).operation === "DAEMON_FAIL"
  )
  expect(childTimeout?.origin.pid).toBeGreaterThan(0)
  expect(entries.some((entry) => entry.kind === "host-timeout" && JSON.parse(entry.payload).operation === "CHILD_PASS"))
    .toBe(false)
  const children = entries.filter((entry) => entry.kind === "send" || entry.kind === "receive").map((entry) => ({
    ...entry.origin,
    payload: entry.payload
  }))
  const first = children.find((entry) => entry.payload === "DAEMON_ORDER_ONE")!
  const second = children.find((entry) => entry.payload === "DAEMON_ORDER_TWO")!
  expect(first.pid).toBe(second.pid)
  expect(first.sequence).toBeLessThan(second.sequence)
  expect(first.connection).toBe(second.connection)
  expect(Buffer.byteLength(text)).toBeLessThan(3 * 1024 * 1024)
  for (const match of run.stderr.matchAll(/Integration failure trace: (.+\.ndjson)/g)) fs.unlinkSync(match[1]!)
}, 30_000)

it("caps process slots, reports exhaustion and removes the transfer spool", async () => {
  const { execFileSync } = await import("node:child_process")
  const { processSlots, TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  const records: Array<[string, unknown]> = []
  const scope = new TransferScope(() => (kind, payload) => records.push([kind, payload]))
  const directory = scope.open()
  for (let slot = 0; slot < processSlots; slot++) fs.unlinkSync(path.join(directory, `${slot}.claim`))
  execFileSync(process.execPath, [
    `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
    "-e",
    ""
  ], {
    env: { ...process.env, [transferVariable]: directory }
  })
  expect(fs.readdirSync(directory)).toHaveLength(processSlots * 3 + 1)
  scope.close()
  expect(records).toContainEqual(["overflow", "Child process slot budget exhausted"])
  expect(fs.existsSync(directory)).toBe(false)
})

it("keeps the test's own records when replayed child records exceed the artifact buffer", async () => {
  const { execFileSync } = await import("node:child_process")
  const { TraceBuffer } = await import("./integration/failureTrace.ts")
  const { TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  const trace = new TraceBuffer()
  trace.record("client", "receive", "PARENT_FAILURE_EVIDENCE")
  const scope = new TransferScope(() => (kind, payload, origin) =>
    trace.record("child-transfer", kind, typeof payload === "string" ? payload : JSON.stringify(payload), origin)
  )
  const directory = scope.open()
  // Eight ordinary children, each within its own 256 KiB spool bound, still add more than the 2 MiB buffer.
  for (let child = 0; child < 8; child++) {
    execFileSync(process.execPath, [
      `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
      "-e",
      "for (let i = 0; i < 40; i++) process.stderr.write('x'.repeat(8000))"
    ], { env: { ...process.env, [transferVariable]: directory }, stdio: "ignore" })
  }
  scope.close()
  expect(trace.entries().some((entry) => entry.kind === "node-stderr")).toBe(true)
  expect(trace.entries().map((entry) => entry.payload)).toContain("PARENT_FAILURE_EVIDENCE")
}, 30_000)

it("retains recent early-slot daemon evidence independently of parent history and slot replay order", () => {
  const trace = new TraceBuffer()
  trace.record("parent", "receive", "PARENT_FAILURE_EVIDENCE")
  trace.record("child-transfer", "receive", "RECENT_EARLY_DAEMON", {
    pid: 1,
    connection: "daemon",
    sequence: 1,
    timestamp: "2026-11-07T12:00:00.000Z"
  })
  // Later slots replay old traffic after the daemon. Their combined volume exceeds the child budget.
  for (let pid = 2; pid <= 9; pid++) {
    for (let sequence = 1; sequence <= 40; sequence++) {
      trace.record("child-transfer", "node-stderr", "x".repeat(8000), {
        pid,
        connection: `client:${pid}`,
        sequence,
        timestamp: "2026-11-07T11:00:00.000Z"
      })
    }
  }
  expect(trace.entries().map((entry) => entry.payload)).toContain("RECENT_EARLY_DAEMON")
  expect(trace.entries().map((entry) => entry.payload)).toContain("PARENT_FAILURE_EVIDENCE")
  expect(trace.entries().some((entry) => entry.kind === "overflow")).toBe(true)
  expect(trace.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
})

it("retires the writer-visible path before collecting and removing a live child's spool", async () => {
  const { spawn } = await import("node:child_process")
  const { once } = await import("node:events")
  const { TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  let directory = ""
  let observations = 0
  const scope = new TransferScope(() => () => {
    observations++
    expect(fs.existsSync(directory)).toBe(false)
  })
  directory = scope.open()
  const child = spawn(process.execPath, [
    `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
    "-e",
    "process.stdout.write('ready'); setInterval(() => process.stderr.write('x'.repeat(8000)), 1)"
  ], { env: { ...process.env, [transferVariable]: directory }, stdio: ["ignore", "pipe", "ignore"] })
  try {
    await once(child.stdout!, "data")
    scope.close()
    expect(observations).toBeGreaterThan(0)
    expect(fs.existsSync(directory)).toBe(false)
    expect(fs.existsSync(`${directory}.closed`)).toBe(false)
  } finally {
    child.kill()
    await once(child, "close")
  }
}, 30_000)

it("bounds parent and chronological child tails separately and clears both", () => {
  const trace = new TraceBuffer()
  for (let sequence = 1; sequence <= 300; sequence++) {
    trace.record("parent", "receive", `${sequence}:` + "p".repeat(8000))
    trace.record("child", "receive", `${sequence}:` + "c".repeat(8000), {
      pid: 1,
      connection: "daemon",
      sequence,
      timestamp: new Date(sequence).toISOString()
    })
  }
  const entries = trace.entries().filter((entry) => entry.kind !== "overflow")
  for (const child of [false, true]) {
    const selected = entries.filter((entry) => (entry.origin !== undefined) === child)
    const bytes = selected.reduce((sum, entry) => sum + JSON.stringify(entry).length * 2, 0)
    expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(bytes).toBeGreaterThan(2 * 1024 * 1024 - 20 * 1024)
    expect(selected.at(-1)?.payload).toMatch(/^300:/)
    expect(selected.map((entry) => entry.sequence)).toEqual(
      selected.map((entry) => entry.sequence).sort((a, b) => a - b)
    )
  }
  expect(trace.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
  trace.clear()
  expect(trace.bytes).toBe(0)
  expect(trace.entries()).toEqual([])
})

it("records a byte-array stderr view as text while preserving the actual bytes written", async () => {
  const { spawnSync } = await import("node:child_process")
  const { stderrText } = await import("./integration/traceStderr.ts")
  const { TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  const data = new TextEncoder().encode("beforeBYTE_STDERR_éafter")
  const view = data.subarray(6, data.length - 5)
  expect(stderrText(view)).toBe("BYTE_STDERR_é")
  expect(stderrText(Buffer.from(view))).toBe("BYTE_STDERR_é")
  const records: Array<[string, unknown]> = []
  const scope = new TransferScope(() => (kind, payload) => records.push([kind, payload]))
  const directory = scope.open()
  const child = spawnSync(process.execPath, [
    `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
    "-e",
    "const data = new TextEncoder().encode('beforeBYTE_STDERR_éafter'); process.stderr.write(data.subarray(6, data.length - 5))"
  ], { env: { ...process.env, [transferVariable]: directory } })
  scope.close()
  expect(child.status).toBe(0)
  expect(child.stderr).toEqual(Buffer.from(view))
  expect(records).toContainEqual(["node-stderr", "BYTE_STDERR_é"])
})

it("keeps child transfer overflow markers out of the parent history budget", async () => {
  const { TransferScope } = await import("./integration/traceTransfer.ts")
  const trace = new TraceBuffer(512)
  trace.record("parent", "receive", "PARENT_NEAR_FULL")
  const scope = new TransferScope(() => (kind, payload, origin) =>
    trace.record("child-transfer", kind, typeof payload === "string" ? payload : JSON.stringify(payload), origin)
  )
  const directory = scope.open()
  fs.writeFileSync(
    path.join(directory, "0-0"),
    JSON.stringify({
      sequence: 2,
      timestamp: "2026-11-07T12:00:00.000Z",
      connection: "daemon",
      kind: "receive",
      payload: "tail",
      pid: 1
    }) + "\n"
  )
  scope.close()
  expect(trace.entries().map((entry) => entry.payload)).toContain("PARENT_NEAR_FULL")
  expect(trace.entries().some((entry) => entry.kind === "overflow" && entry.origin !== undefined)).toBe(true)
})

it("protects startup through spool rotation and aggregate child pressure", async () => {
  const { execFileSync } = await import("node:child_process")
  const { TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  const trace = new TraceBuffer()
  const scope = new TransferScope(() => (kind, payload, origin) =>
    trace.record("child", kind, typeof payload === "string" ? payload : JSON.stringify(payload), origin)
  )
  const directory = scope.open()
  execFileSync(process.execPath, [
    `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
    "-e",
    "process.stderr.write('LAUNCH_HANDSHAKE'); for(let i=0;i<200;i++) process.stderr.write('x'.repeat(8000)); process.stderr.write('RECENT_PROTOCOL')"
  ], { env: { ...process.env, [transferVariable]: directory }, stdio: "ignore" })
  expect(
    fs.readdirSync(directory).filter((name) => !name.endsWith(".claim"))
      .reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0)
  ).toBeLessThanOrEqual(256 * 1024)
  scope.close()
  const gap = trace.entries().find((entry) => entry.kind === "overflow" && entry.origin?.pid === 0)!
  const omitted = JSON.parse(gap.payload)
  expect(omitted.from).toBeGreaterThan(1)
  expect(omitted.to).toBeGreaterThan(omitted.from)
  expect(trace.entries().map((entry) => entry.payload)).toContain("RECENT_PROTOCOL")
  expect(trace.entries().some((entry) => entry.kind === "node-exit")).toBe(true)
  for (let sequence = 1; sequence <= 300; sequence++) {
    trace.record("child", "receive", "new".repeat(2600), {
      pid: 999,
      sequence,
      connection: "other",
      timestamp: "2099-01-01T00:00:00.000Z"
    })
  }
  const entries = trace.entries()
  expect(entries.some((entry) => entry.kind === "node-start")).toBe(true)
  expect(entries.map((entry) => entry.payload)).toContain("LAUNCH_HANDSHAKE")
  expect(entries.some((entry) => entry.kind === "overflow")).toBe(true)
  expect(trace.bytes).toBeLessThanOrEqual(4 * 1024 * 1024)
  expect(fs.existsSync(directory)).toBe(false)
})

it("caps protected startup allocation while retaining the newest child tail", () => {
  const trace = new TraceBuffer()
  for (let sequence = 1; sequence <= 400; sequence++) {
    trace.record("child", "receive", String(sequence) + "s".repeat(8000), {
      pid: 1,
      sequence,
      startup: true,
      connection: "daemon",
      timestamp: new Date(sequence).toISOString()
    })
  }
  const entries = trace.entries().filter((entry) => entry.origin !== undefined)
  expect(entries[0]?.origin?.sequence).toBe(1)
  expect(entries.at(-1)?.origin?.sequence).toBe(400)
  const prefix = entries.filter((entry) => entry.origin!.sequence < 100)
  expect(prefix.reduce((sum, entry) => sum + JSON.stringify(entry).length * 2, 0)).toBeLessThanOrEqual(512 * 1024)
  expect(entries.some((entry) => entry.origin!.sequence === 100)).toBe(false)
  expect(trace.bytes).toBeLessThanOrEqual(trace.childLimit)
  trace.clear()
  expect(trace.entries()).toEqual([])
  expect(trace.bytes).toBe(0)
})

it("retains a child record up to the documented 64 KiB serialized bound", async () => {
  const { execFileSync } = await import("node:child_process")
  const { TransferScope, transferVariable } = await import("./integration/traceTransfer.ts")
  const records: Array<[string, unknown]> = []
  const scope = new TransferScope(() => (kind, payload) => records.push([kind, payload]))
  const directory = scope.open()
  // 8 Ki characters, within the child payload limit; JSON escaping makes the record about 56 KiB in UTF-16.
  const text = "\u0001".repeat(4000) + "a".repeat(4192)
  execFileSync(process.execPath, [
    `--import=${new URL("./integration/tracePreload.ts", import.meta.url).href}`,
    "-e",
    `process.stderr.write(${JSON.stringify(text)})`
  ], {
    env: { ...process.env, [transferVariable]: directory },
    stdio: "ignore"
  })
  scope.close()
  expect(records.filter(([kind]) => kind === "node-stderr")).toHaveLength(1)
  expect(records.map(([kind]) => kind)).not.toContain("overflow")
})
