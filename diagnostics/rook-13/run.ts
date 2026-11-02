import { NodeServices } from '@effect/platform-node'
import { Browser, Expect, LaunchProfile } from '../../packages/browser/src/index.ts'
import { Chromium } from '../../packages/browser/src/chromium/index.ts'
import { Effect, Layer, Stream } from 'effect'
import { appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const directory = process.env.ROOK13_OUTPUT!
mkdirSync(directory, { recursive: true })
const log = (file: string, entry: unknown) => appendFileSync(`${directory}/${file}.ndjson`, JSON.stringify({ at: new Date().toISOString(), monotonicMs: performance.now(), ...entry as object }) + '\n')
let connection = 0
;(globalThis as any).__rook13Trace = (transport: any) => {
  const serial = ++connection
  const pending = new Map<number, string>()
  const record = (direction: string, raw: string) => {
    const message = JSON.parse(raw)
    if (direction === 'out' && message.id) pending.set(message.id, message.method)
    const method = message.method ?? pending.get(message.id)
    // Keep every envelope, including replies too large for the drift recorder.
    // Image bytes are represented by their receipt length and SHA-256.
    for (const payload of [message.result, message.params]) {
      if (typeof payload?.data === 'string' && (method === 'Page.captureScreenshot' || method === 'Page.screencastFrame')) {
        const data = payload.data
        payload.data = { base64Length: data.length, decodedBytes: Buffer.from(data, 'base64').length, sha256: createHash('sha256').update(data).digest('hex') }
      }
    }
    log('wire', { connection: serial, direction, bytes: Buffer.byteLength(raw), method, message })
  }
  return {
    ...transport,
    send: (raw: string) => Effect.sync(() => record('out', raw)).pipe(Effect.andThen(transport.send(raw))),
    messages: transport.messages.pipe(Stream.tap((raw: string) => Effect.sync(() => record('in', raw))))
  }
}
const backend = Chromium.layer({ executablePath: process.env.ROOK13_CHROMIUM ?? '/etc/profiles/per-user/jpowers/bin/chromium', profile: LaunchProfile.automation }).pipe(Layer.provide(NodeServices.layer))
const end = Date.now() + Number(process.env.ROOK13_SECONDS ?? 900) * 1000
let attempt = 0
while (Date.now() < end) {
  for (const server of ['dev', 'static']) for (const path of ['playwright', 'errors']) for (const area of ['element', 'viewport']) {
    if (Date.now() >= end) break
    const condition = { attempt: ++attempt, server, path, area }
    log('attempts', { ...condition, event: 'start' })
    const started = performance.now()
    const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* page.emulate({ viewport: { width: 1440, height: 1000 } })
      yield* page.goto(`http://127.0.0.1:${server === 'dev' ? 4390 : 4391}/docs/${path}`, { waitUntil: 'load' })
      yield* page.locator('main').pipe(Expect.toBeVisible)
      // A passive animation-frame counter; no capture command or artificial wait.
      yield* page.evaluateInMainWorld(() => {
        (window as any).__rookFrames = 0
        const tick = () => { (window as any).__rookFrames++; requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      })
      yield* page.emulate({ viewport: { width: 1100, height: 1000 } })
      log('attempts', { ...condition, event: 'before', dimensions: yield* page.evaluateInMainWorld(() => ({ width: innerWidth, height: innerHeight, frames: (window as any).__rookFrames, main: document.querySelector('main')!.getBoundingClientRect().toJSON() })) })
      const image = yield* page.screenshot(area === 'element' ? { area: { _tag: 'Element', locator: page.locator('main') } } : {})
      log('attempts', { ...condition, event: 'captured', bytes: image.length, frames: yield* page.evaluateInMainWorld(() => (window as any).__rookFrames) })
    })).pipe(Effect.provide(backend), Effect.exit))
    log('attempts', { ...condition, event: 'end', elapsedMs: performance.now() - started, exit })
    console.log(JSON.stringify({ ...condition, elapsedMs: performance.now() - started, exit: exit._tag }))
  }
}
