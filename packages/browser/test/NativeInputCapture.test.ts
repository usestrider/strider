import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import type * as Transport from "../src/protocol/Transport.ts"
import { TraceBuffer } from "./integration/failureTrace.ts"
import { flags, NativeInputCapture, startParams } from "./integration/nativeInputCapture.ts"
import { selectProcessCapture } from "./integration/nativeInputProcess.ts"
import { pipeObserver } from "./integration/tracePipe.ts"

const read = (directory: string, name: string) => fs.readFileSync(path.join(directory, name), "utf8")
const withCapture = async (test: (capture: NativeInputCapture) => Promise<void>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-native-capture-"))
  const capture = new NativeInputCapture(directory)
  try {
    await test(capture)
  } finally {
    capture.dispose()
    capture.stderrEnd(false)
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

const fake = (capture: NativeInputCapture, options?: { endError?: boolean; noCloseReply?: boolean }) => {
  const native = JSON.stringify({ traceEvents: [{ name: "child-publication", args: { text: "界".repeat(150_000) } }] })
  const bytes = Buffer.from(native)
  const chunks = [bytes.subarray(0, 50_000), bytes.subarray(50_000, 250_001), bytes.subarray(250_001)]
  const commands: Array<any> = []
  const tail = new TraceBuffer(4096, 256)
  const raw = pipeObserver((kind, payload) => tail.record("pipe", kind, String(payload)), "pipe-receive")
  let at = 0
  const receive = (packet: any) => {
    const message = JSON.stringify(packet)
    // The actual pipe prefix/ring can overflow; the immutable file must not depend on it.
    raw(Buffer.from(message + "\0"))
    return capture.receive(message)
  }
  const transport: Transport.Transport = {
    send: (message) =>
      Effect.sync(() => {
        const packet = JSON.parse(message)
        commands.push(packet)
        switch (packet.method) {
          case "Tracing.start":
            receive({ id: packet.id, result: {} })
            break
          case "Tracing.end":
            if (options?.endError) receive({ id: packet.id, error: { code: -1, message: "diagnostic end failed" } })
            else {
              // Chromium can publish completion before the Tracing.end reply.
              receive({ method: "Tracing.tracingComplete", params: { stream: "native", dataLossOccurred: false } })
              receive({ id: packet.id, result: {} })
            }
            break
          case "IO.read": {
            const data = chunks[at++]!
            receive({
              id: packet.id,
              result: { data: data.toString("base64"), base64Encoded: true, eof: at === chunks.length }
            })
            break
          }
          case "IO.close":
            if (!options?.noCloseReply) receive({ id: packet.id, result: {} })
            break
        }
      }),
    messages: Stream.empty,
    closed: Effect.never
  }
  capture.wrap(transport)
  return { native, commands, tail, receive }
}

describe("test-scoped Chromium native capture", () => {
  it("starts with the requested categories and preserves the immutable gesture while native pipe chunks overflow", async () => {
    await withCapture(async (capture) => {
      const browser = fake(capture)
      await Effect.runPromise(capture.start())
      expect(browser.commands[0]).toMatchObject({ method: "Tracing.start", params: startParams })
      for (let id = 40; id <= 42; id++) {
        capture.sent(
          JSON.stringify({ id, sessionId: "parent", method: "Input.dispatchMouseEvent", params: { x: 148, y: 83 } })
        )
        expect(browser.receive({ id, result: {} })).toBe(false)
      }
      browser.receive({ id: 43, result: { value: false } })
      capture.checkpoint({ status: "failure", cause: "original clicked assertion" }, "recorder-checkpoint.ndjson")
      const original = read(capture.directory, "protocol.ndjson")
      const hash = createHash("sha256").update(original).digest("hex")
      await Effect.runPromise(capture.finish())
      browser.receive({ method: "Target.detachedFromTarget", params: {} })
      expect(createHash("sha256").update(read(capture.directory, "protocol.ndjson")).digest("hex")).toBe(hash)
      expect(original.split("\n").filter(Boolean)).toHaveLength(7)
      expect(original).not.toContain("Tracing.")
      expect(original).not.toContain("IO.read")
      expect(read(capture.directory, "trace.json")).toBe(browser.native)
      expect(JSON.parse(read(capture.directory, "trace.json")).traceEvents[0].name).toBe("child-publication")
      expect(read(capture.directory, "cleanup-protocol.ndjson")).toContain("Target.detachedFromTarget")
      expect(browser.tail.entries().some((entry) => entry.kind === "overflow")).toBe(true)
      expect(read(capture.directory, "capture-protocol.ndjson")).toContain("omittedStreamCharacters")
      expect(capture.metadata).toMatchObject({ traceEOF: true, streamClosed: true, outcome: { status: "failure" } })
    })
  })
  it("retains raw stderr byte views and EOF independently of ring limits and protocol drain", async () => {
    await withCapture(async (capture) => {
      capture.processStarted(123, ["chrome"])
      const bytes = Buffer.from("start\n" + "界🙂".repeat(40_000) + "\nend\n")
      const enclosed = Buffer.concat([Buffer.from("OUTSIDE"), bytes, Buffer.from("OUTSIDE")])
      capture.stderrChunk(enclosed.subarray(7, 18))
      capture.stderrChunk(enclosed.subarray(18, 7 + bytes.length))
      capture.checkpoint({ status: "success" })
      // Protocol scope closure must not close a still-live browser's stderr file.
      capture.dispose()
      capture.stderrChunk("late shutdown\n")
      capture.stderrEnd(true)
      expect(fs.readFileSync(path.join(capture.directory, "browser.stderr.log"))).toEqual(
        Buffer.concat([bytes, Buffer.from("late shutdown\n")])
      )
      expect(JSON.parse(read(capture.directory, "metadata.json"))).toMatchObject({ stderrEOF: true, errors: [] })
    })
  })
  it("observes complete owned-process stderr without taking the existing consumer's bytes", async () => {
    await import("./integration/traceProcesses.ts")
    await withCapture(async (capture) => {
      selectProcessCapture(capture)
      try {
        const child = spawn(process.execPath, [
          "-e",
          "process.stderr.write(Buffer.alloc(200000, 120)); process.stderr.write('tail\\n')",
          "--",
          flags[0]
        ], { stdio: ["ignore", "ignore", "pipe"] })
        const received: Array<Buffer> = []
        child.stderr.on("data", (chunk: Buffer) => received.push(chunk))
        const [code] = await once(child, "close")
        expect(code).toBe(0)
        const expected = Buffer.concat([Buffer.alloc(200000, 120), Buffer.from("tail\n")])
        expect(Buffer.concat(received)).toEqual(expected)
        expect(fs.readFileSync(path.join(capture.directory, "browser.stderr.log"))).toEqual(expected)
        expect(JSON.parse(read(capture.directory, "metadata.json"))).toMatchObject({ stderrEOF: true, errors: [] })
      } finally {
        selectProcessCapture(undefined)
      }
    })
  })
  it("preserves assertion failure and interruption when diagnostic finalization fails", async () => {
    for (const failure of [Effect.fail("original assertion"), Effect.interrupt]) {
      await withCapture(async (capture) => {
        fake(capture, { endError: true })
        await Effect.runPromise(capture.start())
        const result = await Effect.runPromise(Effect.exit(Effect.scoped(Effect.gen(function*() {
          yield* Effect.addFinalizer((exit) =>
            Effect.sync(() => capture.checkpoint(Exit.isFailure(exit) ? "failed" : "passed")).pipe(
              Effect.andThen(capture.finish()),
              Effect.catchCause((cause) => Effect.sync(() => capture.error(Cause.pretty(cause))))
            )
          )
          return yield* failure
        }))))
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result) && failure !== Effect.interrupt) {
          expect(Cause.pretty(result.cause)).toContain("original assertion")
        }
        expect(JSON.parse(read(capture.directory, "metadata.json")).errors.join(" ")).toContain("diagnostic end failed")
        expect(fs.existsSync(path.join(capture.directory, "protocol.ndjson"))).toBe(true)
      })
    }
  })
  it("bounds an unanswered stream close and records incompleteness instead of hanging", async () => {
    await withCapture(async (capture) => {
      fake(capture, { noCloseReply: true })
      await Effect.runPromise(capture.start())
      capture.checkpoint("pass")
      await Effect.runPromise(capture.finish())
      const metadata = JSON.parse(read(capture.directory, "metadata.json"))
      expect(metadata.traceEOF).toBe(true)
      expect(metadata.streamClosed).not.toBe(true)
      expect(metadata.errors.join(" ")).toContain("Native stream close exceeded")
    })
  }, 5000)
})
