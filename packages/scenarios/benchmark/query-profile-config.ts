import * as assert from "node:assert/strict"
import * as path from "node:path"
import type { Capture } from "./query-hooks.ts"

export const instrumentationTargets = [
  "/@effect/platform-node-shared/dist/NodeChildProcessSpawner.js",
  "/@effect/platform-node-shared/dist/NodeSink.js",
  "/protocol/Transport.ts",
  "/internal/protocolClient.ts",
  "/internal/cdpAdapter/evaluation.ts",
  "/internal/evaluation.ts",
  "/playwright-core/lib/coreBundle.js"
] as const

export const replaceAnchor = (source: string, anchor: string, replacement: string): string => {
  if (source.split(anchor).length !== 2) throw new Error("Pinned Playwright pipe anchor changed")
  return source.replace(anchor, replacement)
}

export const traceCategories =
  "v8,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-v8.runtime_stats,blink.console"

export const profileOptions = (
  args: ReadonlyArray<string>,
  installed: ReadonlySet<string> = new Set()
) => {
  if (args.length > 3) throw new Error("Unexpected profile arguments")
  if (args[0] === undefined || args[0].length === 0) throw new Error("Provide an output JSON path")
  const output = path.resolve(args[0])
  const mode = args[1] ?? "plain"
  if (
    !["plain", "instrumented", "trace", "boundary", "boundary-trace", "evaluation", "evaluation-instrumented"].includes(
      mode
    )
  ) {
    throw new Error(`Unknown profile mode: ${mode}`)
  }
  const evaluation = mode.startsWith("evaluation")
  const boundary = mode.startsWith("boundary") || evaluation
  const trace = mode.endsWith("trace")
  const instrumented = trace || mode === "instrumented" || mode === "evaluation-instrumented"
  const runs = Number(args[2] ?? (trace ? 3 : 20))
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new Error("Profile count must be a positive integer")
  if (instrumented && instrumentationTargets.some((target) => !installed.has(target))) {
    throw new Error(
      "Missing query instrumentation; use --import ./packages/scenarios/benchmark/query-profile-loader.mjs"
    )
  }
  return { output, mode, evaluation, boundary, trace, instrumented, runs, warmups: trace ? 1 : 3 }
}

export const verifyCompletion = (
  samples: ReadonlyArray<{ readonly library: string; readonly capture: Pick<Capture, "wire" | "spans"> }>,
  expected: number,
  instrumented: boolean
): void => {
  assert.equal(samples.length, expected, "Incomplete diagnostic sample set")
  if (!instrumented) return
  for (const sample of samples) {
    const required = sample.library === "strider"
      ? ["JSON.parse", "toRemoteValue", "fromRemote"]
      : ["pw.JSON.parse", "pw.fromRemote"]
    for (const direction of ["send", "receive"]) {
      assert.ok(
        sample.capture.wire.some((row) => row.direction === direction),
        "Missing diagnostic wire capture: " + direction
      )
    }
    for (const name of required) {
      assert.ok(sample.capture.spans.some((span) => span.name === name), `Missing diagnostic stage: ${name}`)
    }
  }
}

// Reassemble NUL-delimited command frames after collection, never in the timed write hook.
export const pipeFrames = (writes: Capture["writes"]) => {
  const frames: Array<
    { message: Record<string, unknown>; firstWrite: number; lastWrite: number; writeIndices: Array<number> }
  > = []
  let pending: Array<number> = []
  let indices: Array<number> = []
  let firstWrite = 0
  for (const [index, write] of writes.entries()) {
    const bytes = typeof write.data === "string" ? Buffer.from(write.data) : write.data
    for (const byte of bytes) {
      if (indices.length === 0) firstWrite = write.at
      if (indices.at(-1) !== index) indices.push(index)
      if (byte === 0) {
        assert.ok(pending.length > 0, "Empty pipe frame")
        frames.push({
          message: JSON.parse(Buffer.from(pending).toString("utf8")),
          firstWrite,
          lastWrite: write.at,
          writeIndices: indices
        })
        pending = []
        indices = []
      } else pending.push(byte)
    }
  }
  assert.equal(pending.length, 0, "Incomplete pipe frame")
  return frames
}

export const verifyPipeWrites = (
  capture: Pick<Capture, "wire" | "writes" | "enqueues">,
  requireEnqueues = true
): void => {
  const frames = pipeFrames(capture.writes)
  const sends = capture.wire.filter((row) => row.direction === "send")
  assert.equal(frames.length, sends.length, "Missing or extra pipe writes")
  if (requireEnqueues) assert.equal(capture.enqueues.length, sends.length, "Missing or extra enqueue observations")
  for (const send of sends) {
    const command = JSON.parse(send.text)
    const matches = frames.filter(({ message }) => message.id === command.id && message.sessionId === command.sessionId)
    assert.equal(matches.length, 1, "Missing or duplicate command write")
    const frame = matches[0]!
    assert.deepEqual(frame.message, command, "Pipe payload differs from send")
    if (capture.enqueues.length > 0) {
      const enqueues = capture.enqueues.filter((row) => row.text === send.text)
      assert.equal(enqueues.length, 1, "Missing or duplicate enqueue")
      assert.ok(send.at <= enqueues[0]!.at && enqueues[0]!.at <= frame.firstWrite, "Invalid enqueue/write ordering")
    }
    const replies = capture.wire.filter((row) => {
      if (row.direction !== "receive") return false
      const reply = JSON.parse(row.text)
      return reply.id === command.id && reply.sessionId === command.sessionId
    })
    assert.equal(replies.length, 1, "Missing or duplicate command reply")
    assert.ok(
      send.at <= frame.firstWrite && frame.firstWrite <= frame.lastWrite && frame.lastWrite <= replies[0]!.at,
      "Invalid send/write/reply ordering"
    )
  }
}
