// Opt-in diagnosis; never use these instrumented samples as a speed comparison.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { createRequire } from "node:module"
import * as os from "node:os"
import * as path from "node:path"
import { chromium } from "playwright-core"
import * as BrowserImpl from "../../browser/src/internal/browser.ts"
import * as CdpAdapter from "../../browser/src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../browser/src/internal/chromiumLauncher.ts"
import * as Engine from "../../browser/src/internal/engine.ts"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import pins from "../../browser/test/integration/browsers.json" with { type: "json" }
import { start } from "../src/site.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
assert.ok(executablePath)
const output = path.resolve(process.argv[2]!)
const instrumented = process.argv[3] !== "control"
assert.ok([undefined, "control", "smoke"].includes(process.argv[3]), "Mode must be control or smoke")
const repeats = process.argv[3] === "smoke" ? 1 : 5
const delays = process.argv[3] === "smoke" ? [100] : [35, 100, 160, 240]
type Sample = {
  library: string
  count: number
  delay: number
  index: number
  ms?: number
  events: Array<unknown>
  snapshots: Array<unknown>
}
const samples: Array<Sample> = []
let active: Sample | undefined
let started = 0
const trace = {
  wire: (direction: string, message: unknown) =>
    active?.events.push({ at: performance.now() - started, direction, message }),
  mark: (name: string) => active?.events.push({ at: performance.now() - started, name })
}
;(globalThis as typeof globalThis & { __observationTrace: typeof trace }).__observationTrace = trace
const replace = (source: string, before: string, after: string) => {
  assert.equal(source.split(before).length, 2, `Expected one instrumentation site: ${before}`)
  return source.replace(before, after)
}
let install = Engine.install
// Capture exact source sites from the generated install function; changes require an explicit profiler update.
install = replace(
  install,
  "const first = evaluate(request.steps, request.expectation)",
  "profile.starts++; profile.checks++; const firstAt = performance.now(); const first = evaluate(request.steps, request.expectation); profile.evaluateMs += performance.now() - firstAt"
)
install = replace(install, "let done = false", "profile.active++; profile.observers++; let done = false")
install = replace(install, "observer.disconnect()", "observer.disconnect(); profile.active--; profile.finished++")
install = replace(
  install,
  "last = evaluate(request.steps, request.expectation)",
  "profile.checks++; const checkAt = performance.now(); last = evaluate(request.steps, request.expectation); profile.evaluateMs += performance.now() - checkAt"
)
install = replace(
  install,
  "const observer = new MutationObserver(recheck)",
  "const observer = new MutationObserver(() => { profile.mutations++; recheck(); })"
)
install = replace(install, "const tick = () => {", "const tick = () => { profile.frames++;")
// Add a scope-local counter object exposed solely on the engine object for out-of-band diagnostic reads.
install = install.replace(
  "{",
  "{ const profile = {starts:0,checks:0,active:0,observers:0,finished:0,mutations:0,frames:0,evaluateMs:0};"
)
// Expose the closure without introducing document mutations or an additional observer.
install = install.replace("const profile = {", "const profile = globalThis.__observationProfile = {")
let transportRef: Transport.Transport
let realm: Record<string, unknown> | undefined
let rawId = -900000
const reads = new Map<number, (value: unknown) => void>()
const instrument = (transport: Transport.Transport): Transport.Transport => {
  transportRef = transport
  return {
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        const wire = JSON.parse(message)
        if (wire.params?.functionDeclaration === Engine.install && instrumented) {
          wire.params.functionDeclaration = install
          message = JSON.stringify(wire)
        }
        if (wire.params?.functionDeclaration === Engine.run) {
          realm = { sessionId: wire.sessionId, uniqueContextId: wire.params.uniqueContextId }
        }
        trace.wire("send", wire)
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      const wire = JSON.parse(message)
      trace.wire("receive", wire)
      const read = reads.get(wire.id)
      if (read) {
        reads.delete(wire.id)
        read(wire)
      }
      return message
    }))
  }
}
const snapshot = () =>
  Effect.promise(() =>
    new Promise<unknown>((resolve, reject) => {
      assert.ok(realm)
      const id = rawId--
      const timer = setTimeout(() => {
        reads.delete(id)
        reject(new Error("Profile read timed out"))
      }, 2000)
      reads.set(id, (wire) => {
        clearTimeout(timer)
        resolve(wire)
      })
      Effect.runPromise(
        transportRef.send(JSON.stringify({
          id,
          sessionId: realm.sessionId,
          method: "Runtime.callFunctionOn",
          params: {
            uniqueContextId: realm.uniqueContextId,
            functionDeclaration: "function(){return globalThis.__observationProfile}",
            returnByValue: true
          }
        }))
      ).catch(reject)
    })
  )
const layer = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
  const { transport } = yield* ChromiumLauncher.launch({ executablePath })
  return yield* CdpAdapter.connect(instrumented ? instrument(transport) : transport, { sink, ownership: "launched" })
})).pipe(Layer.provideMerge(NodeServices.layer))
const require = createRequire(import.meta.url)
const hash = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const hashes: Record<string, string> = {}
for (const directory of ["packages/browser/src", "packages/scenarios/src", "packages/scenarios/benchmark"]) {
  for (const file of fs.readdirSync(directory, { recursive: true, encoding: "utf8" }).sort()) {
    if (/\.(ts|mjs)$/.test(file)) hashes[`${directory}/${file}`] = hash(`${directory}/${file}`)
  }
}
hashes["pnpm-lock.yaml"] = hash("pnpm-lock.yaml")
hashes["playwrightBundle"] = hash(
  path.join(path.dirname(require.resolve("playwright-core/package.json")), "lib/coreBundle.js")
)
const report = {
  status: "running",
  instrumented,
  repeats,
  delays,
  hashes,
  environment: {
    node: process.version,
    playwright: require("playwright-core/package.json").version,
    chromium: pins.chromium.version,
    load: os.loadavg()
  },
  samples,
  error: null as string | null
}
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
}
const site = await start()
const pw = await chromium.launch({ executablePath, headless: true })
try {
  assert.equal(pw.version(), pins.chromium.version)
  await Effect.runPromise(
    Effect.gen(function*() {
      assert.equal((yield* Browser.Browser).info.version, pins.chromium.version)
      for (let index = -1; index < repeats; index++) {
        for (const delay of delays) {
          for (const count of [1, 20]) {
            for (const library of index % 2 === 0 ? ["strider", "playwright"] : ["playwright", "strider"]) {
              const sample: Sample = { library, count, delay, index, events: [], snapshots: [] }
              if (index >= 0) samples.push(sample)
              if (library === "strider") {
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
                  yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
                  active = sample
                  started = performance.now()
                  yield* page.evaluateInMainWorld((ms) => {
                    setTimeout(() => {
                      const p = document.createElement("p")
                      p.id = "ready"
                      p.textContent = "Ready"
                      document.body.append(p)
                    }, ms)
                  }, delay)
                  yield* Effect.forEach(
                    Array.from({ length: count }),
                    () => page.locator("#ready").pipe(Expect.toBeVisible),
                    { concurrency: "unbounded" }
                  )
                  sample.ms = performance.now() - started
                  if (instrumented) sample.snapshots.push(yield* snapshot())
                  active = undefined
                  assert.equal(yield* page.locator("#ready").readText, "Ready")
                }))
              } else {
                const context = yield* Effect.promise(() => pw.newContext({ viewport: { width: 1280, height: 720 } }))
                yield* Effect.promise(async () => {
                  try {
                    const page = await context.newPage()
                    await page.goto(`${site.origin}/benchmark`)
                    active = sample
                    started = performance.now()
                    await page.evaluate((ms) => {
                      setTimeout(() => {
                        const p = document.createElement("p")
                        p.id = "ready"
                        p.textContent = "Ready"
                        document.body.append(p)
                      }, ms)
                    }, delay)
                    await Promise.all(
                      Array.from({ length: count }, () => page.locator("#ready").waitFor({ state: "visible" }))
                    )
                    sample.ms = performance.now() - started
                    active = undefined
                    assert.equal(await page.locator("#ready").textContent(), "Ready")
                  } finally {
                    await context.close()
                  }
                })
              }
              save()
            }
          }
        }
      }
      if (instrumented) {
        for (const count of [1, 20]) {
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
            const sample: Sample = {
              library: "strider-cancellation",
              count,
              delay: 0,
              index: 0,
              events: [],
              snapshots: []
            }
            samples.push(sample)
            active = sample
            started = performance.now()
            realm = undefined
            const fiber = yield* Effect.forEach(
              Array.from({ length: count }),
              () => page.locator("#never").pipe(Expect.toBeVisible),
              { concurrency: "unbounded" }
            ).pipe(Deadline.within("1 second"), Effect.forkChild)
            // Probe only after page counters acknowledge all pending waits. Bound polling, without forced scheduling.
            for (let attempt = 0; attempt < 50; attempt++) {
              yield* Effect.sleep("5 millis")
              if (realm === undefined) continue
              const wire = yield* snapshot() as Effect.Effect<{ result?: { result?: { value?: { active?: number } } } }>
              sample.snapshots.push(wire)
              if (wire.result?.result?.value?.active === count) break
              if (attempt === 49) throw new Error("Page-start acknowledgment missing")
            }
            const before = yield* snapshot() as Effect.Effect<{ result?: { result?: { value?: { active?: number } } } }>
            assert.equal(before.result?.result?.value?.active, count)
            sample.snapshots.push(before)
            yield* Fiber.interrupt(fiber)
            sample.snapshots.push(yield* snapshot())
            yield* Effect.sleep("100 millis")
            sample.snapshots.push(yield* snapshot())
            yield* Effect.sleep("600 millis")
            sample.snapshots.push(yield* snapshot())
            active = undefined
            save()
          }))
        }
      }
    }).pipe(Effect.provide(layer))
  )
  report.status = "passed"
} catch (error) {
  report.status = "error"
  report.error = String(error)
  throw error
} finally {
  save()
  await pw.close()
  await site.close()
}
