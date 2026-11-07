import { Browser, Trace } from "@usestrider/browser"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Exit, Layer } from "effect"
import { assert, it, vi } from "vitest"

vi.mock("@usestrider/browser/Trace", async (original) => ({ ...await original<typeof Trace>(), record: vi.fn() }))
vi.mock("node:fs/promises", () => ({ rm: vi.fn(async () => {}) }))

const destinations: Array<string> = []

// Vitest's `repeats` runs the same test again with `retryCount` back at 0, counting in `repeatCount`. Each repetition
// that fails attaches its own archive, so a later repetition must not overwrite (or, on recovery, delete) the file an
// earlier one attached.
it("gives each failed repetition its own archive", { repeats: 1 }, async (context) => {
  vi.mocked(Trace.record).mockImplementation(() =>
    Effect.succeed({
      remove: Effect.void,
      exportTrace: (path: string) =>
        Effect.sync(() => {
          destinations.push(path)
          return path as never
        })
    } as never)
  )
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Effect.andThen(Browser.newContext(), Effect.die(new Error("assertion")))).pipe(
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
    )
  )
  assert.isTrue(Exit.isFailure(exit))
  if (destinations.length === 2) assert.notEqual(destinations[0], destinations[1])
})
