// Attribution only: per-phase wall time of the upload and response scenarios, on both libraries. The marks
// (performance.now() between steps) perturb timing slightly, so this never stands in for the paired comparison.
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Expect, FileInput, NetworkResponse } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { chromium } from "playwright-core"
import type * as Transport from "../../browser/src/protocol/Transport.ts"
import { start } from "../src/site.ts"
import {
  closeReport,
  compactMessage,
  type PhaseSample,
  summarize,
  table,
  validate,
  type WireEvent
} from "./phase-profile-model.ts"

assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
const executablePath = process.env["STRIDER_CHROMIUM"]
assert.ok(executablePath)
const output = path.resolve(process.argv[2]!)
const runs = Number(process.argv[3])
assert.ok(Number.isInteger(runs) && runs >= 4 && runs % 4 === 0)
// "timing" runs bare; "trace" runs under the loader hooks that see every protocol message, for a few pairs
const mode = process.argv[4] === "trace" ? "trace" : "timing"
const warmup = 3

let window: { events: Array<WireEvent>; started: number } | undefined
const trace = {
  begin: () => {
    window = { events: [], started: performance.now() }
  },
  end: () => {
    const done = window
    window = undefined
    return done?.events ?? []
  },
  mark: (name: string) => window?.events.push({ at: performance.now() - window.started, kind: "mark", name }),
  wire: (kind: "send" | "receive", raw: unknown) => {
    if (window === undefined) return
    const message = compactMessage(typeof raw === "string" ? JSON.parse(raw) : raw as Record<string, unknown>)
    window.events.push({ at: performance.now() - window.started, kind, message })
  },
  transport: (transport: Transport.Transport): Transport.Transport => ({
    closed: transport.closed,
    send: (message) =>
      Effect.suspend(() => {
        trace.wire("send", message)
        return transport.send(message)
      }),
    messages: transport.messages.pipe(Stream.map((message) => {
      trace.wire("receive", message)
      return message
    }))
  })
}
;(globalThis as typeof globalThis & { __phaseTrace: typeof trace }).__phaseTrace = trace

const Cart = Schema.Struct({
  items: Schema.Array(Schema.Struct({ sku: Schema.String, quantity: Schema.Number }))
})

/** Marks name the phase that ended at that moment; `finish` records the remainder as `close`. */
const recorder = (bodyEnd: string) => {
  const phases: Record<string, number> = {}
  let last = performance.now()
  const started = last
  return {
    mark: (name: string) => {
      const now = performance.now()
      phases[name] = now - last
      last = now
      if (mode === "trace") {
        trace.mark(name)
        // The window is the close: from the body's last step to the end of the sample
        if (name === bodyEnd) trace.begin()
      }
    },
    finish: (): { phases: Record<string, number>; total: number } => {
      const now = performance.now()
      phases["close"] = now - last
      return { phases, total: now - started }
    },
    phases
  }
}

const runtime = ManagedRuntime.make(Chromium.layer({ executablePath }).pipe(Layer.provideMerge(NodeServices.layer)))
const site = await start()
const samples: Array<PhaseSample> = []
const report = { status: "running", error: null as string | null, runs, warmup, samples }
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
}
try {
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    const origin = site.origin
    type StriderProgram = (
      mark: (name: string) => void
    ) => Effect.Effect<string, unknown, Browser.Browser | Scope.Scope>
    const programs = {
      upload: {
        expected: "receipt.txt:4",
        strider: Effect.fnUntraced(function*(mark: (name: string) => void) {
          // First finalizer added, so it runs last: the scope has released everything, only the runPromise exit is left
          yield* Effect.addFinalizer(() => Effect.sync(() => mark("release")))
          mark("enter")
          const page = yield* Browser.newPage()
          mark("newPage")
          yield* page.goto(`${origin}/upload`)
          mark("goto")
          yield* page.getByLabel("Receipt").setInputFiles([
            FileInput.bytes("receipt.txt", "text/plain", new TextEncoder().encode("paid"))
          ])
          mark("setInputFiles")
          yield* page.getByText("receipt.txt:4").pipe(Expect.toBeVisible)
          mark("visible")
          const text = yield* page.locator("#out").readText
          mark("read")
          return text
        }),
        playwright: async (mark: (name: string) => void, finishPage: (page: { close(): Promise<void> }) => void) => {
          const page = await browser.newPage()
          finishPage(page)
          mark("newPage")
          await page.goto(`${origin}/upload`)
          mark("goto")
          await page.getByLabel("Receipt").setInputFiles({
            name: "receipt.txt",
            mimeType: "text/plain",
            buffer: Buffer.from("paid")
          })
          mark("setInputFiles")
          await page.getByText("receipt.txt:4").waitFor()
          mark("visible")
          const text = (await page.locator("#out").textContent()) ?? ""
          mark("read")
          return text
        }
      },
      response: {
        expected: "tea × 1",
        strider: Effect.fnUntraced(function*(mark: (name: string) => void) {
          // First finalizer added, so it runs last: the scope has released everything, only the runPromise exit is left
          yield* Effect.addFinalizer(() => Effect.sync(() => mark("release")))
          mark("enter")
          const page = yield* Browser.newPage()
          mark("newPage")
          yield* page.goto(`${origin}/cart`)
          mark("goto")
          const added = yield* NetworkResponse.next(page, {
            url: `${origin}/api/cart`,
            method: "POST",
            body: HttpIncomingMessage.schemaBodyJson(Cart)
          })
          mark("arm")
          yield* page.getByRole("button", { name: "Add to cart" }).click()
          mark("click")
          const { body } = yield* added
          mark("response")
          return body.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
        }),
        playwright: async (mark: (name: string) => void, finishPage: (page: { close(): Promise<void> }) => void) => {
          const page = await browser.newPage()
          finishPage(page)
          mark("newPage")
          await page.goto(`${origin}/cart`)
          mark("goto")
          const added = page.waitForResponse((response) =>
            response.url() === `${origin}/api/cart` && response.request().method() === "POST"
          )
          mark("arm")
          await page.getByRole("button", { name: "Add to cart" }).click()
          mark("click")
          const response = await added
          const cart = (await response.json()) as { items: ReadonlyArray<{ sku: string; quantity: number }> }
          mark("response")
          return cart.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
        }
      }
    } satisfies Record<string, { expected: string; strider: StriderProgram; playwright: unknown }>
    const sample = async (scenario: keyof typeof programs, library: PhaseSample["library"], repetition: number) => {
      const program: {
        expected: string
        strider: StriderProgram
        playwright: (
          mark: (name: string) => void,
          finishPage: (page: { close(): Promise<void> }) => void
        ) => Promise<string>
      } = programs[scenario]
      const clock = recorder(scenario === "upload" ? "read" : "response")
      let text: string
      if (library === "strider") {
        // The scope closes the page after the body; `close` is the time from the body's last mark to the end.
        text = await runtime.runPromise(Effect.scoped(program.strider(clock.mark)))
      } else {
        let page: { close(): Promise<void> } | undefined
        try {
          text = await program.playwright(clock.mark, (p) => page = p)
        } finally {
          await page?.close()
        }
      }
      const { phases, total } = clock.finish()
      const events = mode === "trace" ? trace.end() : []
      assert.equal(text, program.expected)
      const result: PhaseSample = {
        scenario,
        library,
        repetition,
        warmup: repetition < 0,
        phases,
        total,
        ...(mode === "trace" ? { events } : {})
      }
      validate(result)
      samples.push(result)
    }
    for (let i = -warmup; i < runs; i++) {
      for (const scenario of ["upload", "response"] as const) {
        for (const library of i % 2 === 0 ? ["strider", "playwright"] as const : ["playwright", "strider"] as const) {
          await sample(scenario, library, i)
        }
      }
      if (i % 8 === 0) save()
    }
    report.status = "completed"
  } finally {
    await browser.close()
  }
} catch (error) {
  report.status = "failed"
  report.error = String(error)
  process.exitCode = 1
} finally {
  await runtime.dispose()
  await site.close()
  save()
  fs.writeFileSync(path.join(path.dirname(output), "phases.md"), `${table(summarize(samples))}\n`)
  if (mode === "trace") fs.writeFileSync(path.join(path.dirname(output), "close.md"), `${closeReport(samples)}\n`)
}
