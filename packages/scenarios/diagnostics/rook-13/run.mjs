import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import {
  bounded,
  clip,
  conditions,
  executable,
  recorder,
  serve
} from "../../../../diagnostics/rook-13/overlap/common.mjs"
import { runRaw } from "../../../../diagnostics/rook-13/overlap/raw.mjs"

const require = createRequire(import.meta.url)
const version = JSON.parse(readFileSync(require.resolve("playwright-core/package.json"), "utf8")).version
if (version !== "1.64.1") throw new Error(`Expected playwright-core 1.64.1; found ${version}`)
const root = resolve(process.env.ROOK13_OVERLAP_OUTPUT ?? "diagnostics/rook-13/overlap/artifacts")
const recordRaw = recorder(`${root}/raw`)
const recordPW = recorder(`${root}/playwright`)
let connectionCounter = 0
const connections = new WeakMap()
let active
function serial(connection) {
  if (!connections.has(connection)) connections.set(connection, ++connectionCounter)
  return connections.get(connection)
}
globalThis.__rookPWDispatch = (connection, message, send) => {
  const current = active
  const isCapture = message.method === "Page.captureScreenshot"
  const inject = current?.armed && isCapture && current.order !== "no-navigation"
  if (isCapture && current) current.captureIds.push({ id: message.id, sessionId: message.sessionId })
  const navigation = () => {
    current.armed = false
    current.navigation = bounded(
      connection._sessions.get(message.sessionId).send("Page.navigate", { url: current.navigationUrl })
    )
  }
  if (inject && current.order === "navigation-capture") navigation()
  recordPW.wire(serial(connection), "out", message)
  send()
  if (inject && current.order === "capture-navigation") navigation()
}
globalThis.__rookPWReceive = (connection, message) => recordPW.wire(serial(connection), "in", message)
const { chromium } = await import("playwright-core")
async function runPW({ origin, stopAt, rounds }) {
  let attempt = 0
  for (let round = 1; round <= rounds; round++) {
    for (const condition of conditions()) {
      if (Date.now() + 35_000 > stopAt) return
      const label = { implementation: "playwright", attempt: ++attempt, round, ...condition }
      const begin = performance.now()
      recordPW.log("attempts", { ...label, event: "start" })
      let browser
      try {
        browser = await chromium.launch({ executablePath: executable, headless: true, timeout: 30_000 })
        if (browser.version() !== "155.0.8059.79") throw new Error(`Unexpected Chromium ${browser.version()}`)
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
        const page = await context.newPage()
        page.setDefaultTimeout(30_000)
        await page.goto(`${origin}/a`, { waitUntil: "load" })
        await page.locator("main").waitFor({ state: "visible" })
        if (condition.resize) await page.setViewportSize({ width: 1100, height: 1000 })
        active = { ...condition, armed: true, navigationUrl: `${origin}/b`, captureIds: [] }
        const started = performance.now()
        let capture
        try {
          const image = await page.screenshot(
            condition.area === "clip"
              ? {
                timeout: 30_000,
                fullPage: true,
                clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }
              }
              : { timeout: 30_000 }
          )
          capture = { status: "success", elapsedMs: performance.now() - started, bytes: image.length }
        } catch (error) {
          capture = {
            status: error.name === "TimeoutError" ? "timeout" : "error",
            elapsedMs: performance.now() - started,
            error: String(error)
          }
        }
        const navigation = active.navigation ? await active.navigation : null
        recordPW.log("attempts", {
          ...label,
          event: "capture-result",
          capture,
          navigation,
          captureIds: active.captureIds,
          injectionOccurred: !!active.navigation,
          elapsedMs: performance.now() - begin
        })
        console.log(
          JSON.stringify({
            ...label,
            capture: capture.status,
            elapsedMs: capture.elapsedMs,
            captures: active.captureIds.length
          })
        )
        active = undefined
      } catch (error) {
        recordPW.log("attempts", {
          ...label,
          event: "setup-error",
          error: String(error),
          elapsedMs: performance.now() - begin
        })
        active = undefined
      } finally {
        if (browser) await browser.close()
      }
    }
  }
}
const site = await serve()
// One shared hard budget; phase deadlines reserve >=35 s for any new attempt.
const start = Date.now()
const budgetMs = Math.min(840_000, Number(process.env.ROOK13_OVERLAP_SECONDS ?? 840) * 1000)
const stopAt = start + budgetMs
recordRaw.log("run", { event: "start", version, origin: site.origin, budgetMs, executable })
try {
  const rawSeconds = Number(process.env.ROOK13_RAW_SECONDS ?? 360)
  await runRaw({
    record: recordRaw,
    origin: site.origin,
    stopAt: Math.min(stopAt - 90_000, start + rawSeconds * 1000),
    rounds: Number(process.env.ROOK13_ROUNDS ?? 3)
  })
  await runPW({ origin: site.origin, stopAt, rounds: Number(process.env.ROOK13_ROUNDS ?? 3) })
} finally {
  await site.close()
  recordRaw.log("run", { event: "end", elapsedMs: Date.now() - start })
}
