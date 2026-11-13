/** Correctness-only checks of the viewport workload definitions; records no timing samples. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as assert from "node:assert/strict"
import * as fs from "node:fs"
import { chromium } from "playwright-core"
import { viewport, viewportCases } from "../src/benchmarks/cases.ts"
import { start } from "../src/site.ts"

const executablePath = process.env.STRIDER_CHROMIUM
if (process.env.STRIDER_ENVIRONMENT !== "nix-integration" || !executablePath) {
  throw new Error("Use the pinned Nix integration environment")
}
const pins = JSON.parse(fs.readFileSync("packages/browser/test/integration/browsers.json", "utf8"))
const site = await start()
const runtime = ManagedRuntime.make(
  Chromium.layer({ executablePath, headless: true }).pipe(Layer.provideMerge(NodeServices.layer))
)
try {
  const strider = await runtime.runPromise(Browser.Browser)
  assert.ok(strider.info.product.includes(pins.chromium.version))
  for (const entry of viewportCases) {
    await runtime.runPromise(Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({ emulation: { viewport } })
      yield* page.goto(`${site.origin}${entry.fixture ?? "/benchmark"}`, { waitUntil: "load" })
      if (entry.prepareStrider) yield* entry.prepareStrider(page)
      entry.verify(yield* entry.strider(page, site.origin).pipe(Deadline.within("30 seconds")))
    })))
    console.log(`Strider: ${entry.name} passed`)
  }
  const browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000 })
  try {
    assert.equal(browser.version(), pins.chromium.version)
    for (const entry of viewportCases) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
      try {
        context.setDefaultTimeout(30_000)
        const page = await context.newPage()
        await page.goto(`${site.origin}${entry.fixture ?? "/benchmark"}`, { waitUntil: "load" })
        if (entry.preparePlaywright) await entry.preparePlaywright(page)
        entry.verify(await entry.playwright(page, site.origin))
        console.log(`Playwright: ${entry.name} passed`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
} finally {
  await runtime.dispose()
  await site.close()
}
