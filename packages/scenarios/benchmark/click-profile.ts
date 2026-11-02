// Diagnostic instrumentation only. Use uninstrumented benchmark runs for performance comparisons.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import * as BrowserImpl from "../../browser/src/internal/browser.ts"
import * as CdpAdapter from "../../browser/src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../browser/src/internal/chromiumLauncher.ts"
import * as Engine from "../../browser/src/internal/engine.ts"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import browsers from "../../browser/test/integration/browsers.json" with { type: "json" }
import { summarize } from "../src/benchmarks/measure.ts"
import { start } from "../src/site.ts"

const executablePath = process.env["STRIDER_CHROMIUM"]
if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration" || executablePath === undefined) {
  throw new Error("Run `pnpm profile:click` in the pinned Nix integration environment")
}
const output = path.resolve(process.argv[2] ?? ".data/benchmarks/click-profile.json")
interface Command {
  phase: string
  startMs: number
  endMs?: number
  framesRequested?: number
}
interface Sample {
  page: number
  click: number
  ms: number
  commands: Array<Command>
}
const samples: Array<Sample> = []
let active: { started: number; sample: Sample } | undefined

// Count registrations, not callbacks. The engine captures this wrapper at installation; restoring the global
// immediately keeps application scripts untouched. No extra frames are scheduled by the profiler itself.
const install = `function() {
  const key = Symbol.for(${JSON.stringify(Engine.installKey)});
  if (globalThis[key]) return "installed";
  const original = globalThis.requestAnimationFrame;
  let frames = 0;
  globalThis.requestAnimationFrame = function(callback) {
    frames++;
    return original.call(globalThis, callback);
  };
  try { (${Engine.install})(); } finally { globalThis.requestAnimationFrame = original; }
  const engine = globalThis[key];
  const run = engine.run;
  engine.run = async function(request) {
    const before = frames;
    const result = JSON.parse(await run(request));
    result.__profileFrames = frames - before;
    return JSON.stringify(result);
  };
  return "installed";
}`

const instrument = (transport: Transport.Transport): Transport.Transport => {
  const pending = new Map<number, { command: Command; started: number }>()
  return {
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        const wire = JSON.parse(message)
        let phase = wire.method as string
        if (wire.params?.functionDeclaration === Engine.install) {
          wire.params.functionDeclaration = install
          message = JSON.stringify(wire)
          phase = "engine.install"
        } else if (wire.params?.functionDeclaration === Engine.run) {
          const request = JSON.parse(wire.params.arguments[0].value)
          phase = request.op === "act"
            ? request.stability === "capture" ? "readiness" : "revalidation"
            : `engine.${request.op}`
        } else if (wire.method === "Input.dispatchMouseEvent") {
          phase = wire.params.type
        }
        if (active !== undefined) {
          const command: Command = { phase, startMs: performance.now() - active.started }
          active.sample.commands.push(command)
          pending.set(wire.id, { command, started: active.started })
        }
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      const wire = JSON.parse(message)
      const entry = pending.get(wire.id)
      if (entry !== undefined) {
        entry.command.endMs = performance.now() - entry.started
        pending.delete(wire.id)
        const value = wire.result?.result?.value
        if (typeof value === "string" && value.startsWith("{")) {
          const result = JSON.parse(value)
          if (typeof result.__profileFrames === "number") entry.command.framesRequested = result.__profileFrames
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
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
          yield* page.goto(`${site.origin}/benchmark`, { waitUntil: "load" })
          const button = page.getByRole("button", { name: "Increment" })
          for (let click = 0; click < 5; click++) {
            const sample: Sample = { page: pageIndex, click, ms: 0, commands: [] }
            active = { started: performance.now(), sample }
            yield* button.click().pipe(Effect.ensuring(Effect.sync(() => {
              sample.ms = performance.now() - active!.started
              samples.push(sample)
              active = undefined
            })))
            assert.equal(yield* page.locator("#count").readText, String(click + 1))
          }
        }))
      }
    }).pipe(Deadline.within("60 seconds"), Effect.provide(layer))
  )
} finally {
  await site.close()
}
const phases = new Map<string, Array<number>>()
let reused = 0
let revalidated = 0
for (const sample of samples) {
  for (const command of sample.commands) {
    assert.notEqual(command.endMs, undefined, `Unanswered command: ${command.phase}`)
    const durations = phases.get(command.phase) ?? []
    durations.push(command.endMs! - command.startMs)
    phases.set(command.phase, durations)
    if (command.phase === "readiness") {
      assert.ok((command.framesRequested ?? 0) > 0, "Readiness frame instrumentation did not run")
    }
    if (command.phase === "revalidation") {
      assert.notEqual(command.framesRequested, undefined, "Revalidation frame instrumentation did not run")
      revalidated++
      if (command.framesRequested === 0) reused++
    }
  }
}
const summary = {
  firstClick: summarize(samples.filter((sample) => sample.click === 0).map((sample) => sample.ms)),
  subsequentClick: summarize(samples.filter((sample) => sample.click > 0).map((sample) => sample.ms)),
  phases: Object.fromEntries([...phases].map(([phase, durations]) => [phase, summarize(durations)])),
  stability: { reused, revalidated }
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(
  output,
  `${
    JSON.stringify(
      {
        kind: "instrumented-click-diagnostic",
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
process.stdout.write(`Stability reused: ${reused}/${revalidated} revalidations\n`)
process.stdout.write(`Click phase diagnostics: ${output}\n`)
