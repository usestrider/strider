// Diagnostic instrumentation only. Use uninstrumented benchmark runs for performance comparisons.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Base64 from "effect/encoding/Base64"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as Kit from "../../browser/src/internal/adapterKit.ts"
import * as BrowserImpl from "../../browser/src/internal/browser.ts"
import * as CdpAdapter from "../../browser/src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../browser/src/internal/chromiumLauncher.ts"
import * as Engine from "../../browser/src/internal/engine.ts"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import browsers from "../../browser/test/integration/browsers.json" with { type: "json" }
import { captureCases, cases } from "../src/benchmarks/cases.ts"
import { summarize } from "../src/benchmarks/measure.ts"
import { start } from "../src/site.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || executablePath === undefined) {
  throw new Error("Run `pnpm profile:screenshot` in the pinned Nix integration environment")
}
const output = path.resolve(process.argv[2] ?? ".data/benchmarks/screenshot-profile.json")
interface Command {
  phase: string
  startMs: number
  endMs?: number
  responseBytes?: number
  parseMs?: number
  effectDecodeMs?: number
  bufferDecodeMs?: number
  decodedBytes?: number
  helperDecodeMs?: number
}
interface Sample {
  page: number
  name: string
  ms: number
  commands: Array<Command>
}
const payloads = new WeakMap<Command, string>()
const samples: Array<Sample> = []
let active: { started: number; sample: Sample } | undefined

const instrument = (transport: Transport.Transport): Transport.Transport => {
  const pending = new Map<number, { command: Command; started: number }>()
  return {
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        const wire = JSON.parse(message)
        let phase = wire.method as string
        if (wire.params?.functionDeclaration === Engine.install) phase = "engine.install"
        else if (wire.params?.functionDeclaration === Engine.run) {
          phase = `engine.${JSON.parse(wire.params.arguments[0].value).op}`
        }
        if (active !== undefined) {
          const command: Command = { phase, startMs: performance.now() - active.started }
          active.sample.commands.push(command)
          pending.set(wire.id, { command, started: active.started })
        }
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      const parsing = performance.now()
      const wire = JSON.parse(message)
      const parseMs = performance.now() - parsing
      const entry = pending.get(wire.id)
      if (entry !== undefined) {
        entry.command.endMs = performance.now() - entry.started
        pending.delete(wire.id)
        entry.command.responseBytes = Buffer.byteLength(message)
        entry.command.parseMs = parseMs
        if (entry.command.phase === "Page.captureScreenshot" && typeof wire.result?.data === "string") {
          payloads.set(entry.command, wire.result.data)
        }
      }
      return message
    }))
  }
}

const layer = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
  const { transport } = yield* ChromiumLauncher.launch({ executablePath })
  return yield* CdpAdapter.connect(instrument(transport), { sink, ownership: "launched" })
})).pipe(Layer.provideMerge(NodeServices.layer))
const site = await start()
try {
  await Effect.runPromise(
    Effect.gen(function*() {
      assert.equal((yield* Browser.Browser).info.version, browsers.chromium.version)
      for (const entry of [...cases, ...captureCases].filter((entry) => entry.name.startsWith("screenshot"))) {
        for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
            yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
            if (entry.prepareStrider) yield* entry.prepareStrider(page)
            const sample: Sample = { page: pageIndex, name: entry.name, ms: 0, commands: [] }
            active = { started: performance.now(), sample }
            const value = yield* entry.strider(page, site.origin).pipe(Effect.ensuring(Effect.sync(() => {
              sample.ms = performance.now() - active!.started
              samples.push(sample)
              active = undefined
            })))
            entry.verify(value)
            // Replay decoding after the timed public operation; these are CPU-cost probes, not extra
            // work on the measured capture path. Keep the original protocol payload out of the report.
            for (const command of sample.commands) {
              const data = payloads.get(command)
              if (data === undefined) continue
              const beforeEffect = performance.now()
              const decoded = Base64.decode(data)
              command.effectDecodeMs = performance.now() - beforeEffect
              assert.equal(decoded._tag, "Success")
              const beforeBuffer = performance.now()
              const buffer = Buffer.from(data, "base64")
              command.bufferDecodeMs = performance.now() - beforeBuffer
              command.decodedBytes = buffer.length
              if (decoded._tag === "Success") assert.deepEqual(buffer, Buffer.from(decoded.success))
              const beforeHelper = performance.now()
              const helper = Kit.tryDecodeBase64(data)
              command.helperDecodeMs = performance.now() - beforeHelper
              assert.notEqual(helper, undefined)
              assert.deepEqual(buffer, Buffer.from(helper!))
              payloads.delete(command)
            }
          }))
        }
      }
    }).pipe(Deadline.within("180 seconds"), Effect.provide(layer))
  )
} finally {
  await site.close()
}
const phases = new Map<string, Array<number>>()
for (const sample of samples) {
  for (const command of sample.commands) {
    assert.notEqual(command.endMs, undefined, `Unanswered command: ${command.phase}`)
    const durations = phases.get(command.phase) ?? []
    durations.push(command.endMs! - command.startMs)
    phases.set(command.phase, durations)
  }
}
const summary = {
  phases: Object.fromEntries([...phases].map(([phase, durations]) => [phase, summarize(durations)]))
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(
  output,
  `${
    JSON.stringify(
      {
        kind: "instrumented-screenshot-diagnostic",
        chromium: browsers.chromium.version,
        summary,
        samples
      },
      null,
      2
    )
  }\n`
)
for (const [phase, timing] of Object.entries(summary.phases)) {
  process.stdout.write(`${phase}: ${timing.median.toFixed(2)} ms median\n`)
}
process.stdout.write(`Screenshot phase diagnostics: ${output}\n`)
