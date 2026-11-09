/** CPU/allocation sampling of unchanged source, isolated in a diagnostic process. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, Deadline, LaunchProfile } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Scope from "effect/Scope"
import * as assert from "node:assert/strict"
import { start } from "../site.ts"
import { cases, viewport } from "./cases.ts"
import { recorder } from "./cost-profiler.ts"

const [name, output] = process.argv.slice(2)
assert.ok(name === "repeated-lifecycle" || name === "resources")
assert.ok(output)
assert.equal(process.env["STRIDER_ENVIRONMENT"], "nix-integration")
const executablePath = process.env["STRIDER_CHROMIUM"]
assert.ok(executablePath)
const profile = await recorder(name, output)
const phase = profile.phase
let success = false
const site = await start()
const runtime = ManagedRuntime.make(
  Chromium.layer({ executablePath, headless: true, profile: LaunchProfile.automation })
    .pipe(Layer.provideMerge(NodeServices.layer))
)
try {
  const browser = await phase("browser-setup", () => runtime.runPromise(Browser.Browser))
  assert.ok(browser.info.product.includes("155.0.8059.79"))
  const pageOptions = { emulation: { viewport } }
  for (let index = -3; index < 20; index++) {
    const prefix = index < 0 ? `warmup-${index + 3}` : `workload-${index}`
    if (name === "repeated-lifecycle") {
      await phase(prefix, async () => {
        const before = await runtime.runPromise(browser.pages)
        for (let cycle = 0; cycle < 5; cycle++) {
          const scope = Scope.makeUnsafe()
          try {
            const page = await runtime.runPromise(Browser.newPage(pageOptions).pipe(Scope.provide(scope)))
            assert.equal(await runtime.runPromise(page.evaluateInMainWorld(() => document.URL)), "about:blank")
            assert.equal((await runtime.runPromise(browser.pages)).length, before.length + 1)
            await runtime.runPromise(Scope.close(scope, Exit.void))
            await runtime.runPromise(page.context.closed.pipe(Deadline.within("30 seconds")))
            assert.equal((await runtime.runPromise(browser.pages)).length, before.length)
          } finally {
            await runtime.runPromise(Scope.close(scope, Exit.void))
          }
        }
      })
    } else {
      const scope = Scope.makeUnsafe()
      try {
        const page = await phase(`${prefix}-setup`, async () => {
          const page = await runtime.runPromise(Browser.newPage(pageOptions).pipe(Scope.provide(scope)))
          await runtime.runPromise(page.goto(`${site.origin}/benchmark`, { waitUntil: "load" }))
          return page
        })
        const entry = cases.find((entry) => entry.name === "resources")!
        await phase(prefix, async () => {
          const result = await runtime.runPromise(
            Effect.scoped(entry.strider(page, site.origin).pipe(Deadline.within("30 seconds")))
          )
          entry.verify(result)
        })
      } finally {
        await phase(`${prefix}-cleanup`, () => runtime.runPromise(Scope.close(scope, Exit.void)))
      }
    }
  }
  success = true
} finally {
  try {
    await phase("browser-cleanup", () => runtime.dispose())
  } finally {
    await site.close()
    await profile.finish(success)
  }
}
