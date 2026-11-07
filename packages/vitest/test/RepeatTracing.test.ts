import { Browser, Trace } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Exit, Layer } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, assert, it, vi } from "vitest"

vi.mock("@usestrider/browser/Trace", async (original) => ({ ...await original<typeof Trace>(), record: vi.fn() }))
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>()
  return { ...fs, rm: vi.fn(fs.rm) }
})

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

const directory = mkdtempSync(join(tmpdir(), "strider-repeat-traces-"))
let earlierPath: string
let attachedPath: string
afterAll(() => rmSync(directory, { recursive: true, force: true }))
it("keeps an earlier archive when a later repeat recovers", { repeats: 1 }, async (context) => {
  const repeat = context.task.result?.repeatCount ?? 0
  vi.mocked(Trace.record).mockImplementation(() =>
    Effect.succeed({
      remove: Effect.void,
      exportTrace: (path: string) =>
        Effect.promise(async () => {
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, `repeat-${repeat}`)
          if (repeat === 0) earlierPath = path
          return path as never
        })
    })
  )
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  const body = Effect.scoped(Effect.andThen(Browser.newContext(), Effect.fail("failure")))
  await Effect.runPromiseExit((repeat === 0 ? body : body.pipe(Effect.catch(() => Effect.void))).pipe(
    VitestBrowser.withTest(context),
    Effect.provide(VitestBrowser.layer(backend, { trace: { directory } }))
  ))
  if (repeat === 0) {
    const artifact = context.task.artifacts.find((artifact) => artifact.type === "@usestrider/browser")!
    attachedPath = artifact.attachments[0]!.path
  }
  assert.equal(await readFile(earlierPath, "utf8"), "repeat-0")
  assert.equal(await readFile(attachedPath, "utf8"), "repeat-0")
})

it("retains the captured repeat when the runner mutates its task", { repeats: 1 }, (context) => {
  const result = context.task.result!
  const before = result.repeatCount ?? 0
  const bind = VitestBrowser.withTest(context)
  try {
    result.repeatCount = before + 1
    const run = Effect.runSync(TestRun.TestRun.pipe(bind))
    assert.equal(run.info.repeat, before)
  } finally {
    result.repeatCount = before
  }
})
