import { assert, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Layer } from "effect"
import { it, vi } from "vitest"

const captured = new Map<object, { info: TestRun.TestInfo; path: string | undefined }>()
vi.mock("@usestrider/browser/Trace", async () => {
  const { Effect } = await import("effect")
  return {
    record: Effect.fnUntraced(function*(target: object) {
      const run = yield* TestRun.TestRun
      const entry = { info: run.info, path: undefined as string | undefined }
      captured.set(target, entry)
      return {
        remove: Effect.void,
        exportTrace: (path: string) =>
          Effect.sync(() => {
            entry.path = path
            return "test/ConcurrentTracing.test.ts"
          })
      }
    })
  }
})

let builds = 0
const backend = Layer.sync(Browser.Browser, () => {
  builds++
  return { newContext: () => Effect.succeed({}) } as never
})
const browser = VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } })
let arrived = 0
let release!: () => void
const ready = new Promise<void>((resolve) => {
  release = resolve
})
layer(browser, { concurrent: true })("traced shared browser", (it) => {
  for (const name of ["first", "second"]) {
    it.effect(name, (context) => {
      let target: object
      return Effect.scoped(Effect.gen(function*() {
        target = yield* Browser.newContext()
        if (++arrived === 2) release()
        yield* Effect.promise(() => ready)
        return yield* Effect.die(name)
      })).pipe(
        VitestBrowser.withTest(context),
        Effect.exit,
        Effect.tap(() =>
          Effect.sync(() => {
            const entry = captured.get(target!)!
            assert.include(entry.info.id, name)
            assert.include(entry.path, VitestBrowser.traceFileName(entry.info))
            assert.equal(context.task.artifacts.filter((a) => a.type === "@usestrider/browser").length, 1)
            assert.equal(builds, 1)
          })
        )
      )
    })
  }
})

const memo = Layer.makeMemoMapUnsafe()
const attempts: Array<TestRun.TestInfo> = []
it("records a fresh identity and filename for every retry", { retry: 1 }, async (context) => {
  const attempt = context.task.result?.retryCount ?? 0
  await Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const services = yield* Layer.buildWithMemoMap(browser, memo, yield* Effect.scope)
      const target = yield* Browser.newContext().pipe(Effect.provideContext(services))
      attempts.push(captured.get(target)!.info)
      return yield* Effect.fail("traced failure")
    })).pipe(VitestBrowser.withTest(context), Effect.exit)
  )
  assert.equal(attempts[attempt]!.attempt, attempt)
  assert.equal(context.task.artifacts.filter((a) => a.type === "@usestrider/browser").length, attempt + 1)
  if (attempt === 0) throw new Error("exercise retry")
  assert.notEqual(VitestBrowser.traceFileName(attempts[0]!), VitestBrowser.traceFileName(attempts[1]!))
})
