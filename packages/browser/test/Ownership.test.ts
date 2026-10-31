/**
 * A page's release: done once the page ends, whether or not the browser has answered the close, under a budget of
 * its own; it warns halfway through naming what it waits on, and the close it sends runs to its own end.
 */
import { assert, describe, it } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Logger from "effect/Logger"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { TestClock } from "effect/testing"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import type * as Model from "../src/internal/model.ts"
import * as Ownership from "../src/internal/ownership.ts"
import * as Readable from "../src/internal/readable.ts"
import * as Target from "../src/Target.ts"

const id = "page-1" as Target.NavigableId

/** An open page, owned by nobody in particular, with only what a release reads. */
const openPage = Effect.gen(function*() {
  const state = yield* SubscriptionRef.make({ status: { _tag: "Open" }, owner: Option.none() })
  const closed = yield* Deferred.make<Target.CloseReason>()
  return { id, state: Readable.of(state), closed } as unknown as Model.PageEntry
})

/**
 * Releases a page through an adapter whose `closePage` is `closePage`, on the test clock, collecting the warnings
 * logged; the test drives it with `TestClock.adjust`.
 */
const releasing = Effect.fnUntraced(function*(
  closePage: Adapter.AdapterConnection["closePage"],
  wrap: (release: Effect.Effect<void>) => Effect.Effect<void> = (release) => release
) {
  const warnings: Array<string> = []
  const logger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push((options.message as ReadonlyArray<string>).join(" "))
  })
  const page = yield* openPage
  const ownership = yield* Ownership.make()
  yield* ownership.attach({ closePage } as unknown as Adapter.AdapterConnection)
  const release = yield* wrap(ownership.release(page)).pipe(
    Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(yield* Clock.Clock)),
    Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
    Effect.forkChild({ startImmediately: true })
  )
  return { page, release, warnings }
})

const ends = (page: Model.PageEntry) => Deferred.succeed(page.closed, new Target.PageClosed({ by: "command" }))

describe("Ownership.release", () => {
  it.effect("is done once the page ends, though the browser never answers the close, which it doesn't cut short", () =>
    Effect.gen(function*() {
      const interrupted = yield* Deferred.make<void>()
      const { page, release, warnings } = yield* releasing(() =>
        Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)))
      )
      yield* TestClock.adjust("14 seconds")
      assert.deepStrictEqual(warnings, [])
      yield* TestClock.adjust("1 second")
      assert.deepStrictEqual(warnings, [
        "Page page-1 is still closing after 15s: the browser hasn't answered the command to close it; its release " +
        "waits up to 30s for the page to end"
      ])
      assert.isUndefined(release.pollUnsafe())
      yield* ends(page)
      yield* Fiber.join(release)
      assert.isFalse(yield* Deferred.isDone(interrupted))
      assert.strictEqual(warnings.length, 1)
    }).pipe(Effect.scoped))

  it.effect("is done at once when the page ends before the close is answered, with no warning", () =>
    Effect.gen(function*() {
      const reply = yield* Deferred.make<void>()
      const { page, release, warnings } = yield* releasing(() => Deferred.await(reply))
      yield* TestClock.adjust("1 second")
      yield* ends(page)
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))

  it.effect("names the page's end as what it waits on once the close is answered, and stops at its budget", () =>
    Effect.gen(function*() {
      const { release, warnings } = yield* releasing(() => Effect.void)
      yield* TestClock.adjust("15 seconds")
      assert.deepStrictEqual(warnings, [
        "Page page-1 is still closing after 15s: the browser answered the command to close it, and the page hasn't " +
        "ended; its release waits up to 30s for the page to end"
      ])
      yield* TestClock.adjust("15 seconds")
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings.slice(1), [
        "Page page-1 didn't end within 30s of its release: the browser answered the command to close it, and the " +
        "page hasn't ended; its release stopped waiting"
      ])
    }).pipe(Effect.scoped))

  it.effect("stops waiting once the browser refuses the close, which nothing else will end, and says so", () =>
    Effect.gen(function*() {
      const refusal = new Adapter.AdapterError({
        reason: { _tag: "Unsupported", capability: "close", hint: "refused in the test" }
      })
      const { release, warnings } = yield* releasing(() => Effect.fail(refusal))
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings, [
        "Page page-1 wasn't closed: the browser refused the command to close it (Unsupported: close (refused in the " +
        "test))"
      ])
    }).pipe(Effect.scoped))

  it.effect("waits under a budget of its own, not the deadline of the operation its finalizer was added in", () =>
    Effect.gen(function*() {
      const { page, release, warnings } = yield* releasing(() => Effect.void, Deadline.within("1 second"))
      yield* TestClock.adjust("2 seconds")
      assert.isUndefined(release.pollUnsafe())
      yield* ends(page)
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))
})
