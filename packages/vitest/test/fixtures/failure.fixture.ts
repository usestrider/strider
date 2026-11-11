import { NodeServices } from "@effect/platform-node"
import { layer } from "@effect/vitest"
import { Browser, LaunchProfile } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Layer } from "effect"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { afterAll, type TestContext } from "vitest"
import { assertPinned, chromium } from "../../../browser/test/integration/browsers.ts"

const directory = process.env["STRIDER_VITEST_TRACES"]!
const tasks: Array<TestContext["task"]> = []
const browser = VitestBrowser.layer(
  Chromium.layer({
    executablePath: chromium.executable,
    profile: LaunchProfile.concurrent
  }).pipe(Layer.provide(NodeServices.layer)),
  { trace: { directory } }
)

layer(browser, { excludeTestServices: true, timeout: 60_000 })("real failure traces", (it) => {
  it.effect("failed assertion", (context) => {
    tasks.push(context.task)
    return Effect.gen(function*() {
      const browser = yield* Browser.Browser
      assertPinned("Chromium", browser.info.version, chromium.version)
      const page = yield* Browser.newPage({ focus: "emulated" })
      yield* page.goto("data:text/html,<title>failed</title><button>Pay</button>")
      yield* page.getByRole("button", { name: "Pay" }).click()
      context.expect("actual").toBe("expected failure fixture")
    }).pipe(VitestBrowser.withTest(context))
  })
  it.effect("successful test", (context) => {
    tasks.push(context.task)
    return Effect.gen(function*() {
      const page = yield* Browser.newPage({ focus: "emulated" })
      yield* page.goto("data:text/html,<title>success</title>")
    }).pipe(VitestBrowser.withTest(context))
  })
  it.effect("recovered scope failure", (context) => {
    tasks.push(context.task)
    return Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({ focus: "emulated" })
      yield* page.goto("data:text/html,<title>recovered</title>")
      return yield* Effect.fail("recovered failure")
    })).pipe(Effect.catch(() => Effect.void), VitestBrowser.withTest(context))
  })
})

afterAll(async () => {
  await writeFile(
    join(directory, "tasks.json"),
    JSON.stringify(tasks.map((task) => ({
      name: task.name,
      state: task.result?.state,
      artifacts: task.artifacts
    })))
  )
})
