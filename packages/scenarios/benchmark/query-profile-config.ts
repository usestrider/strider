import * as assert from "node:assert/strict"
import * as path from "node:path"
import type { Capture } from "./query-hooks.ts"

export const instrumentationTargets = [
  "/protocol/Transport.ts",
  "/internal/protocolClient.ts",
  "/internal/cdpAdapter/evaluation.ts",
  "/internal/evaluation.ts",
  "/playwright-core/lib/coreBundle.js"
] as const

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
  if (!["plain", "instrumented", "trace", "boundary", "boundary-trace"].includes(mode)) {
    throw new Error(`Unknown profile mode: ${mode}`)
  }
  const boundary = mode.startsWith("boundary")
  const trace = mode.endsWith("trace")
  const instrumented = trace || mode === "instrumented"
  const runs = Number(args[2] ?? (trace ? 3 : 20))
  if (!Number.isSafeInteger(runs) || runs <= 0) throw new Error("Profile count must be a positive integer")
  if (instrumented && instrumentationTargets.some((target) => !installed.has(target))) {
    throw new Error(
      "Missing query instrumentation; use --import ./packages/scenarios/benchmark/query-profile-loader.mjs"
    )
  }
  return { output, mode, boundary, trace, instrumented, runs, warmups: trace ? 1 : 3 }
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
    assert.ok(sample.capture.wire.length > 0, "Missing diagnostic wire capture")
    for (const name of required) {
      assert.ok(sample.capture.spans.some((span) => span.name === name), `Missing diagnostic stage: ${name}`)
    }
  }
}
