// Run under the pinned integration shell; only the child loader substitutes capture functions.
import { execFileSync, fork } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sourceUrl = new URL("../../browser/src/internal/operation.ts", import.meta.url).href
const original = readFileSync(new URL(sourceUrl), "utf8")
// Supplying both retained sources reproduces the optimization-stage comparisons.
const stages = process.env.STRIDER_CAPTURE_BASELINE !== undefined || process.env.STRIDER_CAPTURE_LAZY20 !== undefined
let variants = {}
let comparisons = [["on", "named-off"], ["on", "off"]]
let switchable
if (stages) {
  if (process.env.STRIDER_CAPTURE_BASELINE === undefined || process.env.STRIDER_CAPTURE_LAZY20 === undefined) {
    throw new Error("Supply both STRIDER_CAPTURE_BASELINE and STRIDER_CAPTURE_LAZY20")
  }
  // The baseline is retained outside the repository, alongside the raw evidence.
  const baseline = readFileSync(process.env.STRIDER_CAPTURE_BASELINE, "utf8")
  const lazy20 = readFileSync(process.env.STRIDER_CAPTURE_LAZY20, "utf8")
  const helper = (source, name) => {
    const start = source.indexOf("const namedCaller =")
    const end = source.indexOf("/**\n * Runs `self` as an operation", start)
    if (start < 0 || end < 0) throw new Error("Cannot locate namedCaller")
    return source.slice(start, end).replace("const namedCaller =", `const ${name} =`)
  }
  const eager = helper(baseline, "baselineNamedCaller")
    .replace("return line.trim()", "const call = line.trim(); return () => call")
  const nativeCapture = `    if (Error.captureStackTrace === undefined) {
      // Include namedCaller and namedWith when the runtime cannot omit them during capture.
      Error.stackTraceLimit = 7
      error = new Error()
    } else {
      Error.stackTraceLimit = 5
      error = Object.create(Error.prototype) as Error
      Error.captureStackTrace(error, namedWith)
    }`
  const native5 = process.env.STRIDER_CAPTURE_NATIVE5 === undefined
    ? lazy20.replace("    Error.stackTraceLimit = 20\n    error = new Error()", nativeCapture)
    : readFileSync(process.env.STRIDER_CAPTURE_NATIVE5, "utf8")
  if (
    !native5.includes("Error.stackTraceLimit = 5") || !native5.includes("Error.captureStackTrace(error, namedWith)")
  ) {
    throw new Error("STRIDER_CAPTURE_NATIVE5 must name the native depth-5 comparison source")
  }
  variants = {
    baseline,
    inline6: original,
    inline7: original.replace("Error.stackTraceLimit = 6", "Error.stackTraceLimit = 7"),
    inline8: original.replace("Error.stackTraceLimit = 6", "Error.stackTraceLimit = 8"),
    lazy20,
    native5,
    legacy7: lazy20.replace("Error.stackTraceLimit = 20", "Error.stackTraceLimit = 7"),
    native6: native5.replace("Error.stackTraceLimit = 5", "Error.stackTraceLimit = 6")
      .replace("Error.stackTraceLimit = 7", "Error.stackTraceLimit = 8"),
    native8: native5.replace("Error.stackTraceLimit = 5", "Error.stackTraceLimit = 8")
      .replace("Error.stackTraceLimit = 7", "Error.stackTraceLimit = 10")
  }
  comparisons = [
    ["on", "native5"],
    ["lazy20", "native5"],
    ["legacy7", "native5"],
    ["native6", "native5"],
    ["native8", "native5"],
    ["native5", "named-off"],
    ["native5", "off"],
    ["lazy20", "named-off"],
    ["on", "named-off"],
    ["on", "legacy7"],
    ["lazy20", "legacy7"],
    ["legacy7", "named-off"],
    ["legacy7", "off"],
    ["on", "inline6"],
    ["lazy20", "inline6"],
    ["legacy7", "inline6"],
    ["native5", "inline6"],
    ["native6", "inline6"],
    ["native8", "inline6"],
    ["inline7", "inline6"],
    ["inline8", "inline6"],
    ["inline6", "named-off"],
    ["inline6", "off"]
  ]
  const captureStart = original.indexOf("  const limit = Error.stackTraceLimit", original.indexOf("const namedWith ="))
  const captureEnd = original.indexOf("  return <A, E, R>", captureStart)
  if (captureStart < 0 || captureEnd < 0) throw new Error("Cannot locate inline capture")
  const inline = original.slice(captureStart, captureEnd)
    .replace("Error.stackTraceLimit = 6", "Error.stackTraceLimit = benchmarkDepth")
    .replace("  const call = namedCaller(error)", "  call = namedCaller(error)")
  const switched = original.slice(0, captureStart) + `
  let call
  if (benchmarkInline) {
${inline}
  } else {
    call = benchmarkModes[benchmarkMode]?.()
  }
` + original.slice(captureEnd)
  const helperVariants = Object.entries(variants).filter(([mode]) => mode !== "baseline" && !mode.startsWith("inline"))
  switchable = `let benchmarkMode = "inline6"
let benchmarkInline = true
let benchmarkDepth = 6
` + switched.replace("const trace =", "let trace =") + `
${eager}
${helperVariants.map(([mode, source]) => helper(source, `benchmark_${mode}`)).join("\n")}
const benchmarkTrace = trace
const benchmarkModes = { on: baselineNamedCaller,
  ${helperVariants.map(([mode]) => `${mode}: benchmark_${mode}`).join(", ")} }
export const benchmarkSetCapture = (mode) => {
  benchmarkInline = mode === "inline6" || mode === "inline7" || mode === "inline8"
  if (!benchmarkInline && mode !== "named-off" && mode !== "off" && !Object.hasOwn(benchmarkModes, mode)) {
    throw new Error("Unknown benchmark mode: " + mode)
  }
  benchmarkMode = mode
  benchmarkDepth = mode === "inline7" ? 7 : mode === "inline8" ? 8 : 6
  trace = mode === "off" ? () => undefined : benchmarkTrace
}
`
} else {
  // Current-source controls skip capture itself, not just its lazy formatting helper.
  // Even in separate-process mode, the on baseline has a capture branch and mutable trace;
  // future timings may include instrumentation and JIT effects.
  const start = original.indexOf("  const limit = Error.stackTraceLimit", original.indexOf("const namedWith ="))
  const end = original.indexOf("  return <A, E, R>", start)
  if (start < 0 || end < 0) throw new Error("Cannot locate inline capture")
  const capture = original.slice(start, end).replace("  const call = namedCaller(error)", "  call = namedCaller(error)")
  const switched = original.slice(0, start) + `
  let call
  if (benchmarkMode === "on") {
${capture}
  }
` + original.slice(end)
  switchable = `let benchmarkMode = "on"\n` + switched.replace("const trace =", "let trace =") + `
const benchmarkTrace = trace
export const benchmarkSetCapture = (mode) => {
  if (mode !== "on" && mode !== "named-off" && mode !== "off") throw new Error("Unknown benchmark mode: " + mode)
  benchmarkMode = mode
  trace = mode === "off" ? () => undefined : benchmarkTrace
}
`
  variants = Object.fromEntries(["on", "named-off", "off"].map((mode) => [
    mode,
    switchable + `\nbenchmarkSetCapture(${JSON.stringify(mode)})\n`
  ]))
}
if (process.argv[2] === "child") {
  const mode = process.argv[3]
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (url === sourceUrl) process.env.STRIDER_CAPTURE_LOADED = mode
      return url === sourceUrl
        ? {
          ...loaded,
          source: mode === "switchable" ?
            switchable :
            switchable + `\nbenchmarkSetCapture(${JSON.stringify(mode)})\n`
        }
        : loaded
    }
  })
  await import("./caller-capture-worker.ts")
} else {
  if (process.env.STRIDER_ENVIRONMENT !== "nix-integration") throw new Error("Use the integration Nix shell")
  const commit = process.argv[3] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const output = resolve(process.argv[2] ?? ".data/benchmarks/caller-capture")
  mkdirSync(output, { recursive: true })
  writeFileSync(`${output}/module.operation.ts`, original)
  for (const [mode, source] of Object.entries(variants)) writeFileSync(`${output}/${mode}.operation.ts`, source)
  const sameProcess = stages || process.argv[4] === "same-process"
  writeFileSync(`${output}/switchable.operation.ts`, switchable)
  const children = new Map()
  const request = (child, message) =>
    new Promise((resolve, reject) => {
      const cleanup = () => {
        child.off("message", success)
        child.off("error", failure)
        child.off("exit", exited)
      }
      const success = (result) => {
        cleanup()
        resolve(result)
      }
      const failure = (error) => {
        cleanup()
        reject(error)
      }
      const exited = (code) => failure(new Error(`Child exited ${code}`))
      child.once("message", success)
      child.once("error", failure)
      child.once("exit", exited)
      child.send(message)
    })
  const raw = []
  const metadata = {}
  try {
    for (const mode of new Set(comparisons.flat())) {
      if (sameProcess && mode !== "on") {
        children.set(mode, children.get("on"))
        continue
      }
      const child = fork(fileURLToPath(import.meta.url), ["child", sameProcess ? "switchable" : mode], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      })
      children.set(mode, child)
      metadata[mode] = await new Promise((resolve, reject) => {
        child.once("message", resolve)
        child.once("error", reject)
        child.once("exit", (code) => reject(new Error(`Child exited ${code}`)))
      })
    }
    // Warm every helper equally before the action blocks; later comparisons must not inherit a hotter helper.
    for (const mode of children.keys()) {
      const result = await request(children.get(mode), { action: "fn-url", mode, calls: 10000 })
      if (result.error) throw new Error(result.error)
      process.stdout.write(`Prewarmed fn-url / ${mode}\n`)
    }
    for (const action of stages ? ["url", "fn-url", "title", "count"] : ["url", "fn-url", "title", "count", "click"]) {
      for (const [reference, controlMode] of comparisons) {
        for (let pair = -8; pair < 40; pair++) {
          const order = pair % 2 === 0 ? [reference, controlMode] : [controlMode, reference]
          for (const mode of order) {
            const result = await request(children.get(mode), { action, mode, calls: action === "click" ? 10 : 200 })
            if (result.error) throw new Error(result.error)
            if (pair >= 0) raw.push({ action, reference, control: controlMode, pair, order, mode, ...result })
          }
        }
        process.stdout.write(`Completed ${action} / ${reference} / ${controlMode}\n`)
        writeFileSync(
          `${output}/raw.json`,
          JSON.stringify(
            {
              commit,
              sameProcess,
              comparisons,
              date: new Date().toISOString(),
              metadata,
              prewarmCallsPerMode: 10000,
              warmupPairs: 8,
              pairs: 40,
              raw
            },
            null,
            2
          ) + "\n"
        )
      }
    }
  } finally {
    for (const child of new Set(children.values())) child.send({ action: "stop" })
  }
  process.stdout.write(`Evidence: ${output}\n`)
}
