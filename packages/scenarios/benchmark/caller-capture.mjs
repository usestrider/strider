// Run under the pinned integration shell; only the child loader substitutes capture functions.
import { execFileSync, fork } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sourceUrl = new URL("../../browser/src/internal/operation.ts", import.meta.url).href
const original = readFileSync(new URL(sourceUrl), "utf8")
// The baseline is retained outside the repository, alongside the raw evidence.
const baseline = readFileSync(process.env.STRIDER_CAPTURE_BASELINE, "utf8")
const helperStart = baseline.indexOf("const namedCaller =")
const helperEnd = baseline.indexOf("/**\n * Runs `self` as an operation", helperStart)
if (helperStart < 0 || helperEnd < 0) throw new Error("Cannot locate baseline namedCaller")
const eager = baseline.slice(helperStart, helperEnd).replace("const namedCaller =", "const baselineNamedCaller =")
  .replace("return line.trim()", "const call = line.trim(); return () => call")
const switchable =
  original.replace("const namedCaller =", "let namedCaller =").replace("const trace =", "let trace =") + `
${eager}
const benchmarkNamedCaller = namedCaller
const benchmarkTrace = trace
export const benchmarkSetCapture = (mode) => {
  namedCaller = mode === "lazy" ? benchmarkNamedCaller : mode === "on" ? baselineNamedCaller : () => undefined
  trace = mode === "off" ? () => undefined : benchmarkTrace
}
`
if (process.argv[2] === "child") {
  const mode = process.argv[3]
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (url === sourceUrl) process.env.STRIDER_CAPTURE_LOADED = mode
      return url === sourceUrl && mode !== "on"
        ? { ...loaded, source: switchable }
        : loaded
    }
  })
  await import("./caller-capture-worker.ts")
} else {
  if (process.env.STRIDER_ENVIRONMENT !== "nix-integration") throw new Error("Use the integration Nix shell")
  const commit = process.argv[3] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  const output = resolve(process.argv[2] ?? ".data/benchmarks/caller-capture")
  mkdirSync(output, { recursive: true })
  writeFileSync(`${output}/baseline.operation.ts`, baseline)
  writeFileSync(`${output}/lazy.operation.ts`, original)
  const sameProcess = true
  if (sameProcess) writeFileSync(`${output}/switchable.operation.ts`, switchable)
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
    for (const mode of ["on", "lazy", "named-off", "off"]) {
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
    for (const action of ["url", "fn-url", "title", "count"]) {
      for (
        const [reference, controlMode] of [["on", "lazy"], ["on", "named-off"], ["lazy", "named-off"], ["lazy", "off"]]
      ) {
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
              date: new Date().toISOString(),
              metadata,
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
