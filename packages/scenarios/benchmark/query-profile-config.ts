import * as path from "node:path"

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
  _installed: ReadonlySet<string> = new Set()
) => {
  if (args[0] === undefined) throw new Error("Provide an output JSON path")
  const output = path.resolve(args[0])
  const mode = args[1] ?? "plain"
  const boundary = mode.startsWith("boundary")
  const trace = mode.endsWith("trace")
  const instrumented = trace || mode === "instrumented"
  const runs = Number(args[2] ?? (trace ? 3 : 20))
  return { output, mode, boundary, trace, instrumented, runs, warmups: trace ? 1 : 3 }
}
