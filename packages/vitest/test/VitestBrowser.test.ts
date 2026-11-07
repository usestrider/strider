/**
 * The Vitest adapter: `TestRun` for the test running, and its attachments, including concurrent callbacks.
 */
import { assert, describe, it, layer } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { TestRunner } from "vitest"

describe("VitestBrowser", () => {
  it.effect("describes the test running, and attaches its files", () =>
    Effect.gen(function*() {
      const run = yield* TestRun.TestRun
      assert.include(run.info.id, "VitestBrowser > describes the test running, and attaches its files")
      assert.include(run.info.file, "VitestBrowser.test.ts")
      assert.strictEqual(run.info.attempt, 0)
      yield* run.attach({ _tag: "Screenshot", path: "test/VitestBrowser.test.ts" as never })
      const test = TestRunner.getCurrentTest()!
      assert.deepInclude(
        test.artifacts.map((artifact) => artifact.type),
        "@usestrider/browser"
      )
    }).pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>))))

  it("reads the current test each time", () => {
    const { info } = Effect.runSync(
      TestRun.TestRun.pipe(Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>)))
    )
    assert.include(info.id, "reads the current test each time")
  })
})

// Both callbacks must reach each phase before either can finish and clear Vitest's current test.
const barrier = () => {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return () => {
    if (++arrived === 2) release()
    return gate
  }
}

const started = barrier()
const attached = barrier()

let builds = 0
const sharedBrowser = Layer.syncContext(() => {
  builds++
  return Context.empty() as Context.Context<Browser.Browser>
})
layer(VitestBrowser.layer(sharedBrowser), { concurrent: true })("shared browser", (it) => {
  for (const artifact of ["Screenshot", "Har"] as const) {
    it.effect(`keeps ${artifact} identity and attachments in its concurrent callback`, (context) => {
      assert.strictEqual(builds, 1)
      const task = context.task
      return Effect.gen(function*() {
        const run = yield* TestRun.TestRun
        yield* Effect.promise(started)
        const before = run.info
        yield* Effect.yieldNow
        yield* run.attach({ _tag: artifact, path: "test/VitestBrowser.test.ts" as never })
        yield* Effect.promise(attached)
        // The callback's own context remains stable across both asynchronous boundaries.
        context.expect.soft(context.task).toBe(task)
        context.expect.soft(before.id).toContain(task.name)
        context.expect.soft(run.info.id).toContain(task.name)
        context.expect.soft(run.info.file).toBe(task.file.filepath)
        context.expect.soft(run.info.attempt).toBe(task.result?.retryCount ?? 0)
        context.expect.soft(
          task.artifacts.filter((entry) => entry.type === "@usestrider/browser").map((entry) => entry.artifact)
        ).toEqual([artifact])
      }).pipe(VitestBrowser.withTest(context))
    })
  }
})

const checkedAttempts: Array<number> = []
let retained: TestRun.TestRun | undefined

it("keeps sequential identity and retry attempt across an asynchronous yield", { retry: 1 }, async (context) => {
  const task = context.task
  const attempt = task.result?.retryCount ?? 0
  await Effect.runPromise(
    Effect.gen(function*() {
      const run = yield* TestRun.TestRun
      const before = run.info
      if (attempt === 1) {
        assert.strictEqual(retained!.info.attempt, 0)
        assert.include(retained!.info.id, task.name)
      }
      retained = run
      yield* Effect.yieldNow
      assert.strictEqual(context.task, task)
      assert.include(before.id, task.name)
      assert.include(run.info.id, task.name)
      assert.strictEqual(before.attempt, attempt)
      assert.strictEqual(run.info.attempt, attempt)
      yield* run.attach({ _tag: "Screenshot", path: "test/VitestBrowser.test.ts" as never })
      assert.isTrue(task.artifacts.some((entry) => entry.type === "@usestrider/browser"))
    }).pipe(VitestBrowser.withTest(context))
  )
  checkedAttempts.push(attempt)
  if (attempt === 0) throw new Error("Exercise Vitest's retry with a fresh test attempt")
  assert.deepStrictEqual(checkedAttempts, [0, 1])
})

const providedStarted = barrier()
const providedAttached = barrier()

// The per-effect form: the browser layer provided to the effect itself, then the callback bound. The binding must
// still decide identity and the attachment owner, not the layer's global lookup.
for (const artifact of ["Screenshot", "Har"] as const) {
  it.concurrent(`keeps ${artifact} bound when the browser layer is provided to the effect`, async (context) => {
    const task = context.task
    await Effect.runPromise(
      Effect.gen(function*() {
        const run = yield* TestRun.TestRun
        yield* Effect.promise(providedStarted)
        yield* run.attach({ _tag: artifact, path: "test/VitestBrowser.test.ts" as never })
        yield* Effect.promise(providedAttached)
        context.expect.soft(run.info.id).toContain(task.name)
        context.expect.soft(
          task.artifacts.filter((entry) => entry.type === "@usestrider/browser").map((entry) => entry.artifact)
        ).toEqual([artifact])
      }).pipe(
        Effect.provide(VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>)),
        VitestBrowser.withTest(context)
      )
    )
  })
}
