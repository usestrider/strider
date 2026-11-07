// Run under the pinned integration shell; only the child loader substitutes capture functions.
import { execFileSync, fork } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sourceUrl = new URL("../../browser/src/internal/operation.ts", import.meta.url).href
const original = readFileSync(new URL(sourceUrl), "utf8")
const stub = (source, name, next) => {
  const start = source.indexOf(`const ${name} =`)
  const end = source.indexOf(next, start)
  if (start < 0 || end < 0) throw new Error(`Cannot locate ${name}`)
  return source.slice(0, start) + `const ${name} = () => undefined\n\n` + source.slice(end)
}
const control = (mode) => {
  let source = original
  if (mode !== "on") source = stub(source, "namedCaller", "/**\n * Runs `self` as an operation")
  if (mode === "off") source = stub(source, "trace", "/**\n * The stack frames `Effect.fn`")
  return source
}
if (process.argv[2] === "child") {
  const mode = process.argv[3]
  registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context)
      if (url === sourceUrl) process.env.STRIDER_CAPTURE_LOADED = mode
      return url === sourceUrl && mode !== "on" ? { ...loaded, source: control(mode) } : loaded
    }
  })
  await import("./caller-capture-worker.ts")
} else {
  if (process.env.STRIDER_ENVIRONMENT !== "nix-integration") throw new Error("Use the integration Nix shell")
  const output = resolve(process.argv[2] ?? ".data/benchmarks/caller-capture")
  mkdirSync(output, { recursive: true })
  for (const mode of ["named-off", "off"]) {
    writeFileSync(`${output}/${mode}.operation.ts`, control(mode))
  }
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
    for (const mode of ["on", "named-off", "off"]) {
      const child = fork(fileURLToPath(import.meta.url), ["child", mode], {
        stdio: ["ignore", "inherit", "inherit", "ipc"]
      })
      children.set(mode, child)
      metadata[mode] = await new Promise((resolve, reject) => {
        child.once("message", resolve)
        child.once("error", reject)
        child.once("exit", (code) => reject(new Error(`Child exited ${code}`)))
      })
    }
    for (const action of ["url", "count", "click"]) {
      for (const controlMode of ["named-off", "off"]) {
        for (let pair = -8; pair < 40; pair++) {
          const order = pair % 2 === 0 ? ["on", controlMode] : [controlMode, "on"]
          for (const mode of order) {
            const result = await request(children.get(mode), { action, calls: action === "click" ? 10 : 200 })
            if (result.error) throw new Error(result.error)
            if (pair >= 0) raw.push({ action, control: controlMode, pair, order, mode, ...result })
          }
        }
        process.stdout.write(`Completed ${action} / ${controlMode}\n`)
        writeFileSync(
          `${output}/raw.json`,
          JSON.stringify(
            {
              commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
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
    for (const child of children.values()) child.send({ action: "stop" })
  }
  process.stdout.write(`Evidence: ${output}\n`)
}
