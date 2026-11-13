/** Test-only identity records; native dump production remains Chromium's responsibility. */
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

export const enabled = process.platform === "darwin" && Boolean(process.env.STRIDER_MACOS_CRASH_DATABASE)
const directory = path.resolve(import.meta.dirname, "../../../../.data/macos-crash-reports")
let warned = false
export const recordNative = (name: "launches.ndjson" | "deliberate-crash.json", value: unknown) => {
  if (!enabled) return
  try {
    mkdirSync(directory, { recursive: true })
    const file = path.join(directory, name)
    const line = JSON.stringify({ timestamp: new Date().toISOString(), nodePid: process.pid, ...value as object }) +
      "\n"
    if (Buffer.byteLength(line) > 64 * 1024) throw new Error("Native identity record exceeds 64 KiB")
    if (name === "deliberate-crash.json") writeFileSync(file, line)
    else {
      let size = 0
      try {
        size = statSync(file).size
      } catch {}
      if (size + Buffer.byteLength(line) > 256 * 1024) throw new Error("Native launch metadata exceeds 256 KiB")
      appendFileSync(file, line)
    }
  } catch (error) {
    if (!warned) {
      warned = true
      console.error("Native crash metadata capture error", String(error))
      try {
        writeFileSync(path.join(directory, `capture-error-${process.pid}.txt`), String(error))
      } catch {}
    }
  }
}
