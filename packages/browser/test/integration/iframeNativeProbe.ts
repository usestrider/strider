/** Temporary investigation, selected by test identity, never a page/fixture readiness barrier. */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { randomUUID } from "node:crypto"
import * as path from "node:path"
import { TestRunner } from "vitest"
import type { RunnerTestCase } from "vitest"
import * as BrowserClock from "../../src/internal/browserClock.ts"
import { checkpoint } from "./failureTrace.ts"
import { NativeInputCapture } from "./nativeInputCapture.ts"
import { selectProcessCapture } from "./nativeInputProcess.ts"

const testName = "names an iframe's frame, passes a node across worlds, and sends input into a frame"
export const selected = () => TestRunner.getCurrentTest<RunnerTestCase | undefined>()?.name === testName

export const prepare = Effect.fnUntraced(function*() {
  const capture = yield* Effect.sync(() => {
    try {
      const directory = path.resolve(
        import.meta.dirname,
        "../../../../.data/integration-failures",
        `iframe-native-${process.pid}-${randomUUID()}`
      )
      return new NativeInputCapture(directory)
    } catch (error) {
      console.error("Native input capture unavailable", String(error))
      return undefined
    }
  })
  if (capture === undefined) return
  selectProcessCapture(capture)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      selectProcessCapture(undefined)
      capture.dispose()
    })
  )
  return capture
})

const diagnostic = <A, E, R>(capture: NativeInputCapture, effect: Effect.Effect<A, E, R>, millis: number) =>
  effect.pipe(
    Effect.interruptible,
    BrowserClock.timeoutOn(BrowserClock.live, millis),
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result._tag === "None") {
          capture.error(`Native input capture exceeded its ${millis}ms diagnostic cleanup/start budget`)
        }
      })
    ),
    Effect.catchCause((cause) => Effect.sync(() => capture.error(Cause.pretty(cause)))),
    Effect.asVoid
  )

/** Registered after launch but before adapter connection, so its existing graceful close precedes stderr EOF. */
export const keepStderr = Effect.fnUntraced(function*(capture: NativeInputCapture, done: Effect.Effect<void>) {
  yield* Effect.addFinalizer(() => diagnostic(capture, done, 2000))
})

export const start = Effect.fnUntraced(function*(capture: NativeInputCapture) {
  // The adapter's sole message reader is already running. No second transport consumer is introduced.
  yield* Effect.addFinalizer((exit) => {
    const outcome = Exit.isFailure(exit)
      ? { status: "failure", cause: Cause.pretty(exit.cause) }
      : { status: "success" }
    return Effect.sync(() => {
      let recorderCheckpoint: string | undefined
      try {
        recorderCheckpoint = checkpoint("before-native-drain")
      } catch (error) {
        capture.error(error)
      }
      capture.checkpoint(outcome, recorderCheckpoint)
    }).pipe(
      Effect.andThen(diagnostic(capture, capture.finish(), 10_000)),
      Effect.ensuring(Effect.sync(() => capture.saveMetadata())),
      Effect.catchCause((cause) => Effect.sync(() => capture.error(Cause.pretty(cause))))
    )
  })
  // The wrapper was installed before adapter bootstrap; capture starts before backend.connect returns,
  // hence before this test creates its page, navigates or submits a child frame.
  yield* diagnostic(capture, capture.start(), 5000)
  console.error(`Iframe native diagnostics: ${capture.directory}`)
})
