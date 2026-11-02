import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"
import { createServer } from "node:http"
export const executable = "/etc/profiles/per-user/jpowers/bin/chromium"
export const deadline = 30_000
export const clip = { x: 256, y: 93, width: 829, height: 5631, scale: 1 }
export const fixture =
  "<!doctype html><meta charset=\"utf-8\"><title>capture navigation overlap</title><style>body{margin:0;background:white}main{position:absolute;left:256px;top:93px;width:829px;height:5631px;background:linear-gradient(#acf,#fca);font:20px sans-serif}p{margin:20px}</style><main><p>Self-contained tall page. No scripts, HMR, fonts or animations.</p></main>"
export async function serve() {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
    response.end(fixture)
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}
export function recorder(directory) {
  mkdirSync(directory, { recursive: true })
  const methods = new Map()
  const log = (file, row) =>
    appendFileSync(
      `${directory}/${file}.ndjson`,
      JSON.stringify({ at: new Date().toISOString(), monotonicMs: performance.now(), ...row }) + "\n"
    )
  const wire = (connection, direction, message) => {
    const raw = JSON.stringify(message)
    const key = `${connection}:${message.sessionId ?? ""}:${message.id}`
    if (direction === "out") methods.set(key, message.method)
    const method = message.method ?? methods.get(key)
    const copy = JSON.parse(raw)
    for (const value of [copy.result, copy.params]) {
      if (typeof value?.data === "string" && ["Page.captureScreenshot", "Page.screencastFrame"].includes(method)) {
        const data = value.data
        value.data = {
          base64Length: data.length,
          decodedBytes: Buffer.from(data, "base64").length,
          sha256: createHash("sha256").update(data).digest("hex")
        }
      }
    }
    log("wire", { connection, direction, bytes: Buffer.byteLength(raw), method, message: copy })
  }
  return { log, wire }
}
export function bounded(promise, timeout = deadline) {
  let timer
  const begin = performance.now()
  return Promise.race([
    promise.then(
      (value) => ({ status: "success", elapsedMs: performance.now() - begin, value }),
      (error) => ({ status: "error", elapsedMs: performance.now() - begin, error: String(error) })
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ status: "timeout", elapsedMs: performance.now() - begin }), timeout)
    })
  ]).finally(() => clearTimeout(timer))
}
export const conditions = () =>
  ["capture-navigation", "navigation-capture", "no-navigation"].flatMap((order) =>
    [true, false].flatMap((resize) => ["clip", "viewport"].map((area) => ({ order, resize, area })))
  )
