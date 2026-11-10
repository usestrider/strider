// Attribution only: phase timestamps and a separate, bounded protocol capture.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { chromium } from "playwright-core"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import { start } from "../src/site.ts"
import { type Sample, validate } from "./navigation-profile-model.ts"

assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
const executablePath = process.env["STRIDER_CHROMIUM"]
assert.ok(executablePath)
const output = path.resolve(process.argv[2]!)
const runs = Number(process.argv[3])
assert.ok(Number.isInteger(runs) && runs >= 4 && runs % 4 === 0)
const samples: Array<Sample> = []
let active: Sample | undefined
let started = 0
const trace = {
  mark: (name: string) => {
    if (active?.trace) active.events.push({ at: performance.now() - started, kind: "mark", name })
  },
  wire: (name: string, raw: Record<string, unknown>) => {
    if (!active?.trace) return
    // Retain dependency IDs, command/result shape and function identity without megabytes of engine source.
    const compact = JSON.parse(
      JSON.stringify(raw, (_key, value: unknown) =>
        typeof value === "string" && value.length > 400
          ? {
            length: value.length,
            sha256: createHash("sha256").update(value).digest("hex"),
            prefix: value.slice(0, 100)
          }
          : value)
    ) as Record<string, unknown>
    active.events.push({ at: performance.now() - started, kind: "wire", name, message: compact })
  },
  transport: (transport: Transport.Transport): Transport.Transport => ({
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        if (active?.trace) trace.wire("send", JSON.parse(message))
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      if (active?.trace) trace.wire("receive", JSON.parse(message))
      return message
    }))
  })
}
;(globalThis as typeof globalThis & { __navigationTrace: typeof trace }).__navigationTrace = trace
const report = { status: "running", error: null as string | null, runs, warmup: 3, tracePairs: 4, samples }
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
}
const runtime = ManagedRuntime.make(Chromium.layer({ executablePath }).pipe(Layer.provideMerge(NodeServices.layer)))
const site = await start()
try {
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const sample = async (library: Sample["library"], index: number, capture: boolean) => {
      const current: Sample = { library, index, trace: capture, phases: [], titles: [], events: [] }
      // Preserve partial failures too; active capture begins after fixture setup and ends before cleanup.
      samples.push(current)
      const begin = () => {
        active = current
        started = performance.now()
      }
      const end = () => {
        active = undefined
      }
      if (library === "strider") {
        await runtime.runPromise(Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
          yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
          yield* Effect.sync(begin)
          try {
            yield* Effect.gen(function*() {
              for (const phase of ["goto", "first", "second"] as const) {
                const before = yield* Effect.sync(() => {
                  trace.mark(`${phase}.start`)
                  return performance.now()
                })
                if (phase === "goto") yield* page.goto(`${site.origin}/`, { waitUntil: "load" })
                else current.titles.push(yield* page.title)
                yield* Effect.sync(() => {
                  current.phases.push(performance.now() - before)
                  trace.mark(`${phase}.end`)
                })
              }
            }).pipe(Deadline.within("30 seconds"))
          } finally {
            end()
          }
        })))
      } else {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
        try {
          context.setDefaultTimeout(30_000)
          context.setDefaultNavigationTimeout(30_000)
          const page = await context.newPage()
          await page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
          begin()
          try {
            for (const phase of ["goto", "first", "second"] as const) {
              trace.mark(`${phase}.start`)
              const before = performance.now()
              if (phase === "goto") await page.goto(`${site.origin}/`, { waitUntil: "load" })
              else current.titles.push(await page.title())
              current.phases.push(performance.now() - before)
              trace.mark(`${phase}.end`)
            }
          } finally {
            end()
          }
        } finally {
          await context.close()
        }
      }
      validate(current)
      save()
    }
    for (let i = -3; i < runs + 4; i++) {
      for (const library of i % 2 === 0 ? ["strider", "playwright"] as const : ["playwright", "strider"] as const) {
        await sample(library, i, i >= runs)
      }
    }
    report.status = "completed"
  } finally {
    await browser.close()
  }
} catch (error) {
  report.status = "failed"
  report.error = String(error)
  throw error
} finally {
  await runtime.dispose()
  await site.close()
  save()
}
