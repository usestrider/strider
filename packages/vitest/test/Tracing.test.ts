import { Browser, Trace } from "@usestrider/browser"
import { VitestBrowser } from "@usestrider/vitest"
import { Effect, Exit, Layer } from "effect"
import { assert, it, vi } from "vitest"

vi.mock("@usestrider/browser/Trace", async (original) => ({ ...await original<typeof Trace>(), record: vi.fn() }))
vi.mock("node:fs/promises", () => ({ rm: vi.fn(async () => {}) }))

it("records bound failures before context cleanup and preserves the assertion", async (context) => {
  const events: Array<string> = []
  const target = {} as never
  const record = vi.mocked(Trace.record)
  record.mockImplementation(() =>
    Effect.acquireRelease(
      Effect.sync(() => {
        events.push("record")
        return {
          remove: Effect.sync(() => {
            events.push("remove")
          }),
          exportTrace: (_path: string) =>
            Effect.sync(() => {
              events.push("export")
              return "test/Tracing.test.ts" as never
            })
        }
      }),
      () =>
        Effect.sync(() => {
          events.push("stop")
        })
    )
  )
  const backend = Layer.succeed(Browser.Browser, {
    newContext: () =>
      Effect.acquireRelease(Effect.succeed(target), () =>
        Effect.sync(() => {
          events.push("close")
        }))
  } as never)
  const failure = new Error("assertion")
  const exit = await Effect.runPromiseExit(
    Effect.scoped(Effect.gen(function*() {
      yield* Browser.newContext()
      return yield* Effect.die(failure)
    })).pipe(
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
    )
  )
  assert.isTrue(Exit.isFailure(exit))
  assert.deepEqual(events, ["record", "export", "stop", "close", "remove"])
  assert.deepEqual(record.mock.calls[0]?.[1], {
    screenshots: "perAction",
    screencast: "off",
    domSnapshots: true,
    network: true
  })
  assert.equal(context.task.artifacts.filter((a) => a.type === "@usestrider/browser").length, 1)
})

it("does not record without opt-in, or without a bound callback", async (context) => {
  const record = vi.mocked(Trace.record)
  record.mockClear()
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  for (const bound of [true, false]) {
    const effect = Effect.scoped(Browser.newContext())
    await Effect.runPromise((bound ? effect.pipe(VitestBrowser.withTest(context)) : effect).pipe(
      Effect.provide(VitestBrowser.layer(backend, bound ? undefined : { trace: { directory: ".data/traces" } }))
    ))
  }
  assert.equal(record.mock.calls.length, 0)
})

it("releases successful recordings without exporting, including newPage contexts", async (context) => {
  const events: Array<string> = []
  const target = {}
  vi.mocked(Trace.record).mockImplementation((actual) => {
    assert.equal(actual, target)
    return Effect.acquireRelease(
      Effect.succeed({
        remove: Effect.sync(() => {
          events.push("remove")
        }),
        exportTrace: () => Effect.die("must not export")
      }),
      () =>
        Effect.sync(() => {
          events.push("stop")
        })
    )
  })
  const backend = Layer.succeed(Browser.Browser, {
    newPage: () => Effect.succeed({ context: target })
  } as never)
  await Effect.runPromise(
    Effect.scoped(Browser.newPage()).pipe(
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
    )
  )
  assert.deepEqual(events, ["stop", "remove"])
})

for (
  const mode of [
    "typed failure",
    "assertion",
    "export failure",
    "export defect",
    "attachment failure",
    "interruption",
    "late failure"
  ] as const
) {
  it(`preserves ${mode} and releases the recording`, async (context) => {
    const events: Array<string> = []
    vi.mocked(Trace.record).mockImplementation(() =>
      Effect.acquireRelease(
        Effect.succeed({
          remove: Effect.sync(() => {
            events.push("remove")
          }),
          exportTrace: () =>
            Effect.sync(() => {
              events.push("export")
            }).pipe(Effect.andThen(
              mode === "export failure" ?
                Effect.fail({ _tag: "TraceError", message: "disk full" } as Trace.TraceError) :
                mode === "export defect"
                ? Effect.die("disk defect")
                : Effect.succeed(
                  (mode === "attachment failure" ? "missing-trace.zip" : "test/Tracing.test.ts") as never
                )
            ))
        }),
        () =>
          Effect.sync(() => {
            events.push("stop")
          })
      )
    )
    const backend = Layer.succeed(Browser.Browser, {
      newContext: () =>
        Effect.acquireRelease(Effect.succeed({}), () =>
          Effect.sync(() => {
            events.push("close")
          }))
    } as never)
    const failure = mode === "interruption" ? Effect.interrupt : mode === "assertion"
      ? Effect.sync(() => assert.fail("original assertion")) :
      Effect.fail("original failure")
    const body = mode === "late failure"
      ? Effect.scoped(Browser.newContext()).pipe(Effect.andThen(failure))
      : Effect.scoped(Browser.newContext().pipe(Effect.andThen(failure)))
    const exit = await Effect.runPromiseExit(body.pipe(
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, {
        trace: { directory: ".data/traces", screenshots: "off", domSnapshots: false, network: false }
      }))
    ))
    assert.isTrue(Exit.isFailure(exit))
    assert.include(
      String(exit),
      mode === "interruption" ? "Interrupt" : mode === "assertion" ? "original assertion" : "original failure"
    )
    assert.equal(events.filter((event) => event === "export").length, 1)
    assert.equal(events.filter((event) => event === "remove").length, 1)
    assert.deepEqual(
      events,
      mode === "late failure" ? ["stop", "close", "export", "remove"] : ["export", "stop", "close", "remove"]
    )
  })
}

it("discards a staged trace when a failing scope is recovered by a successful callback", async (context) => {
  const { rm } = await import("node:fs/promises")
  vi.mocked(rm).mockClear()
  vi.mocked(Trace.record).mockReturnValue(Effect.succeed({
    remove: Effect.void,
    exportTrace: () => Effect.succeed("staged.zip" as never)
  }))
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  await Effect.runPromise(
    Effect.scoped(Browser.newContext().pipe(Effect.andThen(Effect.fail("recovered")))).pipe(
      Effect.catch(() => Effect.void),
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
    )
  )
  assert.equal(context.task.artifacts.length, 0)
  assert.deepEqual(vi.mocked(rm).mock.calls, [["staged.zip", { force: true }]])
})

it("does not start recordings from services retained after the callback ends", async (context) => {
  vi.mocked(Trace.record).mockClear()
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  const services = await Effect.runPromise(
    Effect.context<Browser.Browser>().pipe(
      VitestBrowser.withTest(context),
      Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
    )
  )
  await Effect.runPromise(Effect.scoped(Browser.newContext()).pipe(Effect.provideContext(services)))
  assert.equal(vi.mocked(Trace.record).mock.calls.length, 0)
})

for (const interrupted of [false, true]) {
  it(`releases the target when recording acquisition ${interrupted ? "is interrupted" : "fails"}`, async (context) => {
    let closed = false
    vi.mocked(Trace.record).mockReturnValue(
      interrupted
        ? Effect.interrupt
        : Effect.fail({ _tag: "TraceError", message: "record failed" } as Trace.TraceError)
    )
    const backend = Layer.succeed(Browser.Browser, {
      newContext: () =>
        Effect.acquireRelease(Effect.succeed({}), () =>
          Effect.sync(() => {
            closed = true
          }))
    } as never)
    const exit = await Effect.runPromiseExit(
      Effect.scoped(Browser.newContext()).pipe(
        VitestBrowser.withTest(context),
        Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } }))
      )
    )
    assert.equal(Exit.isFailure(exit), interrupted)
    assert.isTrue(closed)
    assert.equal(context.task.artifacts.length, 0)
  })
}

it("does not export from an outer scope that fails after the binding has returned", async (context) => {
  let exports = 0
  vi.mocked(Trace.record).mockReturnValue(Effect.succeed({
    remove: Effect.void,
    exportTrace: () =>
      Effect.sync(() => {
        exports++
        return "trace.zip" as never
      })
  }))
  const backend = Layer.succeed(Browser.Browser, { newContext: () => Effect.succeed({}) } as never)
  await Effect.runPromiseExit(
    Effect.scoped(Effect.gen(function*() {
      yield* Browser.newContext().pipe(VitestBrowser.withTest(context))
      return yield* Effect.fail("outside binding")
    })).pipe(Effect.provide(VitestBrowser.layer(backend, { trace: { directory: ".data/traces" } })))
  )
  assert.equal(exports, 0)
})
