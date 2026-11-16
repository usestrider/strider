/** Closing a Chromium context with a viewport declared at its creation. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import { assertPinned, chromium } from "../browsers.ts"

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))

/** Runs a scope to its close, returning how long it took and the warnings logged meanwhile. */
const closing = Effect.fnUntraced(function*<E, R>(body: Effect.Effect<void, E, R>) {
  const warnings: Array<unknown> = []
  const loggers = yield* Logger.CurrentLoggers
  const logger = Logger.make((entry) => {
    if (entry.logLevel === "Warn") warnings.push(entry.message)
    for (const existing of loggers) existing.log(entry)
  })
  const started = Date.now()
  yield* Effect.scoped(body).pipe(Effect.provideService(Logger.CurrentLoggers, new Set([logger])))
  return { elapsed: Date.now() - started, warnings }
})

describe("Chromium viewport release on context close", () => {
  layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
    it.effect("closes a context with a declared viewport at once", () =>
      Effect.gen(function*() {
        assertPinned("Chromium", (yield* Browser.Browser).info.version, chromium.version)
        const { elapsed, warnings } = yield* closing(Effect.gen(function*() {
          const context = yield* Browser.newContext({ emulation: { viewport: { width: 1280, height: 900 } } })
          const page = yield* context.newPage
          yield* page.goto("data:text/html,<body>x</body>")
        }))
        assert.deepStrictEqual(warnings, [])
        assert.isBelow(elapsed, 5_000)
      }), 60_000)

    it.effect(
      "closes a context with a declared viewport whose renderer is blocked at once",
      () =>
        Effect.gen(function*() {
          const { elapsed, warnings } = yield* closing(Effect.gen(function*() {
            const context = yield* Browser.newContext({ emulation: { viewport: { width: 1280, height: 720 } } })
            const page = yield* context.newPage
            yield* page.goto("data:text/html,<body>x</body>")
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                for (;;) { /* blocks the renderer until its page is removed */ }
              }, 0)
              return true
            })
          }))
          assert.deepStrictEqual(warnings, [])
          assert.isBelow(elapsed, 5_000)
        }),
      60_000
    )
  })
})
