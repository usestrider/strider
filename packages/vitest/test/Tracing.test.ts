import { assert, it, vi } from "vitest"
import { Browser, Trace } from "@usestrider/browser"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Exit, Layer } from "effect"

vi.mock("@usestrider/browser/Trace", () => ({ record: vi.fn() }))

it("records bound failures before context cleanup and preserves the assertion", async (context) => {
  const events: Array<string> = []
  const target = {} as never
  const record = vi.mocked(Trace.record)
  record.mockImplementation(() => Effect.acquireRelease(
    Effect.sync(() => {
      events.push("record")
      return {
        remove: Effect.sync(() => { events.push("remove") }),
        exportTrace: (path: string) => Effect.sync(() => { events.push("export"); return path as never })
      }
    }),
    () => Effect.sync(() => { events.push("stop") })
  ))
  const backend = Layer.succeed(Browser.Browser, {
    newContext: () => Effect.acquireRelease(Effect.succeed(target), () => Effect.sync(() => { events.push("close") }))
  } as never)
  const failure = new Error("assertion")
  const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
    yield* Browser.newContext()
    yield* Effect.die(failure)
  })).pipe(
    VitestBrowser.withTest(context),
    Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
  ))
  assert.isTrue(Exit.isFailure(exit))
  assert.deepEqual(events, ["record", "export", "stop", "close", "remove"])
  assert.deepEqual(record.mock.calls[0]?.[1], { screenshots: "perAction", domSnapshots: true, network: true })
  assert.equal(context.task.artifacts.filter((a) => a.type === "@usestrider/browser").length, 1)
})
