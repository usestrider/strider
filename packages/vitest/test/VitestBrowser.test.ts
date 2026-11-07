/**
 * The Vitest adapter: `TestRun` for the test running, and its attachments, including concurrent callbacks.
 */
import { assert, describe, it, layer } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { afterAll, TestRunner } from "vitest"

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

// Reusing the adapter with one memo map must share the backend, never a callback's TestRun.
const memoMap = Layer.makeMemoMapUnsafe()
const memoScope = Scope.makeUnsafe()
let memoBuilds = 0
const reusedLayer = VitestBrowser.layer(Layer.empty as unknown as Layer.Layer<Browser.Browser>)
const memoLayer = VitestBrowser.layer(Layer.syncContext(() => {
  memoBuilds++
  return Context.empty() as Context.Context<Browser.Browser>
}))
afterAll(() => Effect.runPromise(Scope.close(memoScope, Exit.void)))

for (const order of ["binding first", "layer first", "shared memo map"] as const) {
  const ready = barrier()
  const done = barrier()
  for (const artifact of ["Screenshot", "Har"] as const) {
    it.concurrent(`keeps ${artifact} isolated with ${order}`, async (context) => {
      const task = context.task
      const check = Effect.gen(function*() {
        const run = yield* TestRun.TestRun
        const info = run.info
        yield* Effect.promise(ready)
        yield* Effect.yieldNow
        yield* run.attach({ _tag: artifact, path: "test/VitestBrowser.test.ts" as never })
        yield* Effect.promise(done)
        context.expect.soft(run.info).toBe(info)
        context.expect.soft(info.id).toContain(task.name)
        context.expect.soft(
          task.artifacts.filter((entry) => entry.type === "@usestrider/browser").map((entry) => entry.artifact)
        ).toEqual([artifact])
      })
      if (order === "binding first") {
        await Effect.runPromise(check.pipe(VitestBrowser.withTest(context), Effect.provide(reusedLayer)))
      } else if (order === "layer first") {
        await Effect.runPromise(check.pipe(Effect.provide(reusedLayer), VitestBrowser.withTest(context)))
      } else {
        await Effect.runPromise(
          Effect.gen(function*() {
            const services = yield* Layer.buildWithMemoMap(memoLayer, memoMap, memoScope)
            yield* check.pipe(Effect.provideContext(services))
            context.expect.soft(memoBuilds).toBe(1)
          }).pipe(VitestBrowser.withTest(context))
        )
      }
    })
  }
}

// Two bound callbacks building the adapter through one memo map build its backend exactly once.
const onceMemoMap = Layer.makeMemoMapUnsafe()
const onceScope = Scope.makeUnsafe()
let onceBuilds = 0
const onceLayer = VitestBrowser.layer(Layer.syncContext(() => {
  onceBuilds++
  return Context.empty() as Context.Context<Browser.Browser>
}))
const onceBuilt = barrier()
afterAll(() => Effect.runPromise(Scope.close(onceScope, Exit.void)))

for (const artifact of ["Screenshot", "Har"] as const) {
  it.concurrent(`builds the backend once for ${artifact} through a shared memo map`, async (context) => {
    await Effect.runPromise(
      Effect.gen(function*() {
        const services = yield* Layer.buildWithMemoMap(onceLayer, onceMemoMap, onceScope)
        const run = Context.get(services, TestRun.TestRun)
        yield* Effect.promise(onceBuilt)
        context.expect.soft(onceBuilds).toBe(1)
        context.expect.soft(run.info.id).toContain(context.task.name)
      }).pipe(VitestBrowser.withTest(context))
    )
  })
}

it("releases a per-effect backend when the bound effect ends, and on a failed build", async (context) => {
  const events: Array<string> = []
  const backend = Layer.effectContext(
    Effect.acquireRelease(
      Effect.sync(() => {
        events.push("acquire")
        return Context.empty() as Context.Context<Browser.Browser>
      }),
      () => Effect.sync(() => events.push("release"))
    )
  )
  await Effect.runPromise(
    Effect.sync(() => events.push("use")).pipe(
      Effect.provide(VitestBrowser.layer(backend)),
      VitestBrowser.withTest(context)
    )
  )
  assert.deepStrictEqual(events, ["acquire", "use", "release"])

  const failing = Layer.mergeAll(backend, Layer.effectDiscard(Effect.fail("boom"))) as unknown as Layer.Layer<
    Browser.Browser,
    string
  >
  const exit = await Effect.runPromiseExit(
    Effect.void.pipe(Effect.provide(VitestBrowser.layer(failing)), VitestBrowser.withTest(context))
  )
  assert.isTrue(Exit.isFailure(exit))
  assert.deepStrictEqual(events, ["acquire", "use", "release", "acquire", "release"])
})
