/**
 * Strider's versions of the helpers Playwright's tests share (`tests/config/utils.ts`), for the Playwright ports.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Locator, type Page } from "@usestrider/browser"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Result from "effect/Result"
import * as path from "node:path"

/** Every frame in a page's tree, the page's own included: Playwright's `page.frames().length`. */
export const frameCount = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const count = (tree: Page.FrameTree): number => 1 + tree.children.reduce((sum, child) => sum + count(child), 0)
  return count(yield* page.frames)
})

/**
 * Playwright's `attachFrame(page, id, url)`: appends an iframe with `id` showing `url` and waits for its load, in the
 * page's main world as the original does, so it runs on stock WebKit too. The frame is entered by its element, as
 * Strider enters frames.
 */
export const attachFrame = Effect.fnUntraced(function*(page: Page.Page, id: string, url: string) {
  yield* page.evaluateInMainWorld(
    async (id, url) => {
      const frame = document.createElement("iframe")
      frame.src = url
      frame.id = id
      document.body.appendChild(frame)
      await new Promise((resolve) => frame.onload = resolve)
    },
    id,
    url
  )
  return page.frame(page.locator(`#${id}`))
})

/**
 * Playwright's `rafraf(target, count)`: `count` pairs of animation frames, so what was drawn has been painted. A page
 * waits in its main world, which every backend has; a frame waits in Strider's isolated world, the only one a frame
 * offers, which stock WebKit lacks.
 */
export const rafraf = Effect.fnUntraced(function*(
  frame: Page.Page | ReturnType<Page.ReadonlyPage["frame"]>,
  count = 1
) {
  for (let i = 0; i < count; i++) {
    if ("evaluateInMainWorld" in frame) {
      yield* frame.evaluateInMainWorld(() =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      )
    } else {
      yield* frame.locator(":root").evaluate(() =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      )
    }
  }
})

/**
 * A wait the original holds across steps (a promise it awaits later): it starts at once, `done` says whether it has
 * finished, and joining `fiber` gives its result.
 */
export const startWaiting = Effect.fnUntraced(function*<A, E, R>(wait: Effect.Effect<A, E, R>) {
  const finished = yield* Ref.make(false)
  const fiber = yield* Effect.forkChild(wait.pipe(Effect.tap(() => Ref.set(finished, true))), {
    startImmediately: true
  })
  return { fiber, done: Ref.get(finished) }
})

/**
 * The error of a call the original expects to fail (its `.catch(e => e)`): a call that succeeds fails the test,
 * naming `what`.
 */
export const failureOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>, what = "the call") {
  const result = yield* Effect.result(effect)
  assert(Result.isFailure(result), `${what} succeeded, where Playwright's fails`)
  return result.failure
})

/** A vendored asset's path on disk, for an API that takes a file: `assetPath("playwright", "file-to-upload.txt")`. */
export const assetPath = (source: string, relative: string) =>
  path.resolve(import.meta.dirname, "../../sources", source, "assets", relative)

/**
 * Playwright's `{ force: true }` as Strider's checks: the ones Playwright's force skips (visible, enabled, stable,
 * non-inert, hit target) are off, and `inViewport` stays on, since Playwright's force still scrolls the element into
 * view and fails for a point outside the viewport. `rendered` is Strider's own wait for a drawn frame, which Playwright's
 * actions have no counterpart of, so it's off too.
 */
export const forceChecks: Locator.Checks = {
  rendered: false,
  visible: false,
  enabled: false,
  notInert: false,
  receivesPointer: false,
  stable: false
}

/**
 * What a failed expectation observed, in order. For `Expect.that` over a read, the failure's `last` is the check still
 * running at the deadline, not the last value seen, so assert on these instead.
 */
export const observedValues = (failure: Expect.ExpectationFailed): ReadonlyArray<unknown> =>
  failure.history.map((observed) => observed.value)

/** The failure of an expectation the original expects to fail: an `ExpectationFailed`, or the test fails. */
export const expectationFailure = Effect.fnUntraced(function*(effect: Effect.Effect<void, unknown>) {
  const failure = yield* failureOf(effect, "the expectation")
  assert(Expect.isExpectationFailed(failure), String(failure))
  return failure
})

/**
 * Playwright's `setDefaultTimeout(ms)` or `setDefaultNavigationTimeout(ms)` for one call: a default budget for the
 * operations no deadline encloses. The harness encloses every test in its 30 seconds, under which a default budget never
 * applies, so the call runs with that deadline cleared. The harness's end of the test still bounds it.
 */
export const defaultTimeout = (duration: Duration.Input) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Deadline.withDefaultBudget(duration), Effect.provideService(Deadline.CurrentDeadline, Option.none()))
