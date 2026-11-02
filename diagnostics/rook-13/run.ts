import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Stream } from "effect"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync } from "node:fs"
import { Chromium } from "../../packages/browser/src/chromium/index.ts"
import { Browser, Expect, LaunchProfile } from "../../packages/browser/src/index.ts"
const directory = process.env.ROOK13_OUTPUT!
mkdirSync(directory, { recursive: true })
const log = (file: string, entry: unknown) =>
  appendFileSync(
    `${directory}/${file}.ndjson`,
    JSON.stringify({ at: new Date().toISOString(), monotonicMs: performance.now(), ...entry as object }) + "\n"
  )
let connection = 0
;(globalThis as any).__rook13Trace = (transport: any) => {
  const serial = ++connection
  const pending = new Map<number, string>()
  let probeId = -1
  let captureSession: string | undefined
  let probing = false
  const probeSend = (method: string, params: unknown = {}) => {
    const raw = JSON.stringify({ id: probeId--, method, params, sessionId: captureSession })
    return Effect.sync(() => record("out", raw)).pipe(Effect.andThen(transport.send(raw)))
  }
  ;(globalThis as any).__rook13Probe = (start: boolean) => {
    probing = start
    return probeSend(start ? "Page.startScreencast" : "Page.stopScreencast", start ? { format: "jpeg" } : {})
  }
  const record = (direction: string, raw: string) => {
    const message = JSON.parse(raw)
    if (direction === "out" && message.id) pending.set(message.id, message.method)
    const method = message.method ?? pending.get(message.id)
    if (direction === "out" && method === "Page.captureScreenshot") captureSession = message.sessionId
    if (direction === "in" && method === "Page.screencastFrame" && probing) {
      void Effect.runPromise(probeSend("Page.screencastFrameAck", { sessionId: message.params.sessionId })).catch((
        error
      ) => log("probe-errors", { error: String(error) }))
    }
    // Keep every envelope, including replies too large for the drift recorder.
    // Image bytes are represented by their receipt length and SHA-256.
    for (const payload of [message.result, message.params]) {
      if (
        typeof payload?.data === "string" && (method === "Page.captureScreenshot" || method === "Page.screencastFrame")
      ) {
        const data = payload.data
        payload.data = {
          base64Length: data.length,
          decodedBytes: Buffer.from(data, "base64").length,
          sha256: createHash("sha256").update(data).digest("hex")
        }
      }
    }
    log("wire", { connection: serial, direction, bytes: Buffer.byteLength(raw), method, message })
  }
  return {
    ...transport,
    send: (raw: string) => Effect.sync(() => record("out", raw)).pipe(Effect.andThen(transport.send(raw))),
    messages: transport.messages.pipe(Stream.tap((raw: string) => Effect.sync(() => record("in", raw))))
  }
}
const backend = Chromium.layer({
  executablePath: process.env.ROOK13_CHROMIUM ?? "/etc/profiles/per-user/jpowers/bin/chromium",
  profile: LaunchProfile.automation
}).pipe(Layer.provide(NodeServices.layer))
const end = Date.now() + Number(process.env.ROOK13_SECONDS ?? 900) * 1000
let attempt = 0
while (Date.now() < end) {
  for (const server of ["dev", "static"]) {
    for (const path of ["playwright", "errors"]) {
      for (const area of ["element", "viewport"]) {
        if (Date.now() >= end) break
        const instrumented = process.env.ROOK13_FRAMES === "1"
        const startupPage = process.env.ROOK13_STARTUP_PAGE === "1"
        const condition = { attempt: ++attempt, server, path, area, instrumented, startupPage }
        log("attempts", { ...condition, event: "start" })
        const started = performance.now()
        const exit = await Effect.runPromise(
          Effect.scoped(Effect.gen(function*() {
            const page = startupPage
              ? yield* Effect.gen(function*() {
                const browser = yield* Browser.Browser
                const pages = yield* browser.pages
                if (pages.length !== 1) {
                  return yield* Effect.die(new Error(`Expected one startup page, got ${pages.length}`))
                }
                return yield* pages[0]!.control
              })
              : yield* Browser.newPage()
            yield* page.emulate({ viewport: { width: 1440, height: 1000 } })
            yield* page.goto(`http://127.0.0.1:${server === "dev" ? 4390 : 4391}/docs/${path}`, { waitUntil: "load" })
            yield* page.locator("main").pipe(Expect.toBeVisible)
            if (instrumented) {
              // Renderer callbacks are not compositor-frame evidence.
              yield* page.evaluateInMainWorld(() => {
                ;(window as any).__rookFrames = 0
                const tick = () => {
                  ;(window as any).__rookFrames++
                  requestAnimationFrame(tick)
                }
                requestAnimationFrame(tick)
              })
            }
            yield* page.emulate({ viewport: { width: 1100, height: 1000 } })
            if (instrumented) {
              log("attempts", {
                ...condition,
                event: "before",
                dimensions: yield* page.evaluateInMainWorld(() => ({
                  width: innerWidth,
                  height: innerHeight,
                  frames: (window as any).__rookFrames,
                  main: document.querySelector("main")!.getBoundingClientRect().toJSON()
                }))
              })
            }
            const captured = yield* Effect.exit(
              page.screenshot(area === "element" ? { area: { _tag: "Element", locator: page.locator("main") } } : {})
            )
            if (captured._tag === "Failure") {
              log("attempts", { ...condition, event: "capture-failed", exit: captured })
              if (process.env.ROOK13_PROBE === "1") {
                // Only after the original capture has already failed its default deadline.
                yield* (globalThis as any).__rook13Probe(true)
                const renderer = yield* Effect.exit(page.evaluateInMainWorld(async () => {
                  const before = performance.now()
                  await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
                  )
                  return { before, after: performance.now(), width: innerWidth, height: innerHeight }
                }))
                log("attempts", { ...condition, event: "post-failure-renderer", renderer })
                yield* (globalThis as any).__rook13Probe(false)
              }
              return yield* captured
            }
            const image = captured.value
            log("attempts", {
              ...condition,
              event: "captured",
              bytes: image.length,
              frames: instrumented
                ? yield* page.evaluateInMainWorld(() => (window as any).__rookFrames)
                : undefined
            })
          })).pipe(Effect.provide(backend), Effect.exit)
        )
        log("attempts", { ...condition, event: "end", elapsedMs: performance.now() - started, exit })
        console.log(JSON.stringify({ ...condition, elapsedMs: performance.now() - started, exit: exit._tag }))
      }
    }
  }
}
