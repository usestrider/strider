// Diagnostic attribution, never a performance gate. Use the loader only for the instrumented generation.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { chromium, type Page as PWPage } from "playwright-core"
import * as BrowserImpl from "../../browser/src/internal/browser.ts"
import * as CdpAdapter from "../../browser/src/internal/cdpAdapter.ts"
import * as Launcher from "../../browser/src/internal/chromiumLauncher.ts"
import * as Serialization from "../../browser/src/internal/serialization.ts"
import * as Utility from "../../browser/src/internal/webkitUtility.ts"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import pins from "../../browser/test/integration/browsers.json" with { type: "json" }
import { start } from "../src/site.ts"
import { type Capture, state, sync, wire } from "./query-hooks.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || executablePath === undefined) {
  throw new Error("Use the pinned integration Nix shell")
}
if (process.argv[2] === undefined) throw new Error("Provide an absolute output JSON path")
const output = path.resolve(process.argv[2])
const mode = process.argv[3] ?? "plain"
const instrumented = mode !== "plain"
const trace = mode === "trace"
const runs = Number(process.argv[4] ?? (trace ? 3 : 20))
const warmups = trace ? 1 : 3
const samples: Array<{
  library: string
  name: string
  index: number
  ms: number
  capture: Capture
  pageTiming?: unknown
}> = []
let commandId = -1
let transport: Transport.Transport
const callbacks = new Map<number, (value: unknown) => void>()
const loadAtStart = os.loadavg()
const events: Array<unknown> = []
let clockSync: { before: number; after: number } | undefined
let traceComplete = () => {}
const completed = new Promise<void>((resolve) => {
  traceComplete = resolve
})
const bounded = async <A>(promise: Promise<A>): Promise<A> => {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Diagnostic command exceeded 30 seconds")), 30_000)
      })
    ])
  } finally {
    clearTimeout(timer!)
  }
}
const send = async (method: string, params: unknown = {}) => {
  const id = commandId--
  const result = new Promise<unknown>((resolve) => callbacks.set(id, resolve))
  await Effect.runPromise(transport.send(JSON.stringify({ id, method, params })))
  return bounded(result)
}
const instrument = (underlying: Transport.Transport): Transport.Transport => ({
  closed: underlying.closed,
  send: (text) =>
    Effect.suspend(() => {
      if (instrumented) wire("send", text)
      return underlying.send(text)
    }),
  messages: underlying.messages.pipe(Stream.map((text) => {
    if (instrumented) wire("receive", text)
    if (trace) {
      const value = JSON.parse(text)
      if (value.id < 0) {
        callbacks.get(value.id)?.(value)
        callbacks.delete(value.id)
      }
      if (value.method === "Tracing.dataCollected") events.push(...value.params.value)
      if (value.method === "Tracing.tracingComplete") traceComplete()
    }
    return text
  }))
})
const layer = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
  const launched = yield* Launcher.launch({ executablePath })
  transport = launched.transport
  return yield* CdpAdapter.connect(instrument(transport), { sink, ownership: "launched" })
})).pipe(Layer.provideMerge(NodeServices.layer))

// All controls return the same records; selecting only the first 100 changes result size, not the fixture.
const read = (limit: number) => {
  const started = performance.now()
  const nodes = document.querySelectorAll("input")
  const queried = performance.now()
  const result = Array.from(nodes).slice(0, limit).map((input) => ({
    id: input.id,
    value: input.value,
    disabled: input.disabled,
    label: input.getAttribute("aria-label")
  }))
  const finished = performance.now()
  ;(globalThis as unknown as { __queryTiming: unknown }).__queryTiming = {
    query: queried - started,
    properties: finished - queried
  }
  return result
}
const synthetic = (size: number) => {
  const started = performance.now()
  const result = Array.from({ length: size }, (_, i) => ({
    id: `field-${i}`,
    value: `Value ${i} café`,
    disabled: i % 2 === 0,
    label: i % 3 === 0 ? null : `Field ${i}`
  }))
  ;(globalThis as unknown as { __queryTiming: unknown }).__queryTiming = {
    query: 0,
    properties: performance.now() - started
  }
  return result
}
const expected = (size: number) =>
  Array.from({ length: size }, (_, i) => ({
    id: `field-${i}`,
    value: `Value ${i} café`,
    disabled: i % 2 === 0,
    label: i % 3 === 0 ? null : `Field ${i}`
  }))
// Diagnostic encoding alternative: reuse the existing WebKit helper without changing the runtime adapter.
// Helper construction is included, so this is not an installed-helper fast path.
const encoded = new Function(
  "size",
  `
  const helper = ${Utility.source};
  const started = performance.now();
  const result = helper.run((${read.toString()}), ["v"], [{type: "number", value: size}], "value", false);
  globalThis.__queryTiming.encode = performance.now() - started;
  return result;
`
) as (size: number) => string
const decodeEncoded = (value: string) => {
  const parsed = sync("alternative.JSON.parse", () => JSON.parse(value)) as {
    batch: number
    value: import("../../browser/src/internal/adapter.ts").RemoteValue
  }
  assert.equal(parsed.batch, 0)
  return sync("alternative.fromRemote", () => Serialization.fromRemote(parsed.value))
}
const cases = [
  { name: "evaluate", document: 0, size: 0, synthetic: false, encoded: false },
  { name: "dom100-result100", document: 100, size: 100, synthetic: false, encoded: false },
  { name: "dom1000-result1000", document: 1000, size: 1000, synthetic: false, encoded: false },
  { name: "dom1000-result100", document: 1000, size: 100, synthetic: false, encoded: false },
  { name: "dom0-result1000", document: 0, size: 1000, synthetic: true, encoded: false },
  { name: "dom1000-tagged-string", document: 1000, size: 1000, synthetic: false, encoded: true }
]
const striderRun = (page: Page.Page, entry: typeof cases[number]) =>
  entry.size === 0
    ? Effect.forEach(Array.from({ length: 20 }), () => page.evaluateInMainWorld(() => ({ answer: 42 })))
    : entry.encoded
    ? page.evaluateInMainWorld(encoded, entry.size).pipe(Effect.map(decodeEncoded))
    : page.evaluateInMainWorld(entry.synthetic ? synthetic : read, entry.size)
const pwRun = async (page: PWPage, entry: typeof cases[number]) => {
  if (entry.encoded) return decodeEncoded(await page.evaluate(encoded, entry.size))
  if (entry.size !== 0) return page.evaluate(entry.synthetic ? synthetic : read, entry.size)
  const values = []
  for (let i = 0; i < 20; i++) values.push(await page.evaluate(() => ({ answer: 42 })))
  return values
}
const site = await start()
const runtime = ManagedRuntime.make(layer)
let status = "incomplete"
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  assert.ok((await runtime.runPromise(Browser.Browser)).info.product.includes(pins.chromium.version))
  browser = await chromium.launch({ executablePath, headless: true })
  assert.equal(browser.version(), pins.chromium.version)
  if (trace) {
    await send("Tracing.start", {
      categories:
        "v8,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-v8.runtime_stats,blink.console",
      options: "record-as-much-as-possible",
      transferMode: "ReportEvents"
    })
  }
  if (trace) {
    const before = performance.now()
    const marker = await send("Tracing.recordClockSyncMarker", { syncId: "query-profile" })
    assert.ok(!(marker as { error?: unknown }).error)
    clockSync = { before, after: performance.now() }
  }
  for (const entry of cases) {
    for (let index = -warmups; index < runs; index++) {
      for (const library of index % 2 === 0 ? ["strider", "playwright"] : ["playwright", "strider"]) {
        const capture: Capture = { start: 0, spans: [], wire: [], chunks: [] }
        let ms: number
        let pageTiming: unknown
        const url = `${site.origin}${entry.document === 0 ? "/benchmark" : `/benchmark-reads?n=${entry.document}`}`
        if (library === "strider") {
          ms = await runtime.runPromise(Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
            yield* page.goto(url, { waitUntil: "load" })
            const started = performance.now()
            Object.assign(capture, { start: started })
            if (instrumented) state.active = capture
            const value = yield* striderRun(page, entry).pipe(
              Deadline.within("30 seconds"),
              Effect.ensuring(Effect.sync(() => {
                state.active = undefined
              }))
            )
            const elapsed = performance.now() - started
            assert.deepEqual(
              value,
              entry.size === 0 ? Array.from({ length: 20 }, () => ({ answer: 42 })) : expected(entry.size)
            )
            if (entry.size !== 0) {
              pageTiming = yield* page.evaluateInMainWorld(() =>
                (globalThis as unknown as { __queryTiming: unknown }).__queryTiming
              )
            }
            return elapsed
          })))
        } else {
          const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
          try {
            const page = await context.newPage()
            await page.goto(url, { waitUntil: "load" })
            const started = performance.now()
            Object.assign(capture, { start: started })
            if (instrumented) state.active = capture
            let value: unknown
            try {
              value = await pwRun(page, entry)
              ms = performance.now() - started
            } finally {
              state.active = undefined
            }
            assert.deepEqual(
              value,
              entry.size === 0 ? Array.from({ length: 20 }, () => ({ answer: 42 })) : expected(entry.size)
            )
            if (entry.size !== 0) {
              pageTiming = await page.evaluate(() => ({
                ...(globalThis as unknown as { __queryTiming: object }).__queryTiming,
                pwSerialize: (globalThis as unknown as { __pwSerializeMs?: number }).__pwSerializeMs
              }))
            }
          } finally {
            await context.close()
          }
        }
        if (index >= 0) samples.push({ library, name: entry.name, index, ms, capture, pageTiming })
      }
    }
    console.log(entry.name, "complete")
  }
  if (trace) {
    await send("Tracing.end")
    await bounded(completed)
  }
  status = "completed"
} finally {
  state.active = undefined
  await browser?.close()
  await runtime.dispose()
  await site.close()
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const hash = createHash("sha256")
  for (const dir of ["packages/browser/src", "packages/scenarios/src", "packages/scenarios/benchmark"]) {
    for (const file of fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort()) {
      if (/\.(ts|mjs)$/.test(file)) hash.update(`${dir}/${file}\0`).update(fs.readFileSync(path.join(dir, file)))
    }
  }
  hash.update(fs.readFileSync("pnpm-lock.yaml"))
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        status,
        mode,
        runs,
        warmups,
        sourceHash: hash.digest("hex"),
        clockSync,
        timeOrigin: performance.timeOrigin,
        playwrightSourceHash: createHash("sha256").update(
          fs.readFileSync("packages/scenarios/node_modules/playwright-core/lib/coreBundle.js")
        ).digest("hex"),
        environment: {
          loadAtStart,
          node: process.version,
          chromium: pins.chromium.version,
          playwright: "1.64.1",
          cpu: os.cpus()[0]?.model,
          load: os.loadavg()
        },
        samples,
        events
      },
      null,
      2
    )
  )
  console.log(output)
}
