/** Configured viewport reads use no renderer evaluation. */
import { assert, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { TestClock } from "effect/testing"
import * as Handles from "../src/internal/handles.ts"
import * as PageImpl from "../src/internal/page.ts"
import * as Readable from "../src/internal/readable.ts"

it.effect("returns no configured viewport on an unset test page and fails after close", () =>
  Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    assert.deepStrictEqual(yield* page.viewportSize, Option.none())
    yield* page.close()
    const error = yield* page.viewportSize.pipe(Effect.flip)
    assert.strictEqual(error._tag, "TargetGone")
  })).pipe(Effect.provide(Browser.layerTest(""))))

it.effect("reads context options and releases a page override in the test layer", () =>
  Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
    assert.deepStrictEqual(yield* page.viewportSize, Option.some({ width: 640, height: 480 }))
    yield* Effect.scoped(Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 320, height: 240 } })
      assert.deepStrictEqual(yield* page.viewportSize, Option.some({ width: 320, height: 240 }))
    }))
    assert.deepStrictEqual(yield* page.viewportSize, Option.some({ width: 640, height: 480 }))
  })).pipe(Effect.provide(Browser.layerTest(""))))

it.effect("reads configuration while the page has no committed document", () =>
  Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const behind = Handles.page(page)
    const before = yield* behind.entry.state.get
    const state = yield* SubscriptionRef.make({
      ...before,
      status: { _tag: "Opening" as const, url: before.status.url }
    })
    const opening = PageImpl.make({
      ...behind,
      entry: { ...behind.entry, state: Readable.of(state) },
      context: page.context,
      upgrade: () => Effect.succeed(page)
    })
    const result = yield* opening.viewportSize.pipe(Effect.timeoutOption("10 millis"), TestClock.withLive)
    assert.deepStrictEqual(result, Option.some(Option.none()))
  })).pipe(Effect.provide(Browser.layerTest(""))))
