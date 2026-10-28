/** The pages a toolkit session names: `session.page` finds a page by a name it was given, not by a generated handle. */
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as ToolkitImpl from "../src/internal/toolkit.ts"

describe("Session.page", () => {
  it.effect("fails PageNotFound for a generated handle no one kept", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.newPage
      yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      // The pages are named p1 and p2 by the first lookup; neither was given a name with keep.
      const result = yield* Effect.result(session.page("p2"))
      if (result._tag === "Success") return assert.fail(`session.page("p2") returned page ${result.success.id}`)
      assert.strictEqual(result.failure.error, "PageNotFound")
      assert.include(result.failure.message, "generated handle")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session.page, a name that spells a handle", () => {
  it.effect("finds a page that was kept under the name its own generated handle spells", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opened = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      // The page is p1 by the first lookup; keeping it as "p1" is a name given, though it spells the handle.
      yield* session.pages
      yield* session.name(opened, "p1")
      const result = yield* Effect.result(session.page("p1"))
      if (result._tag === "Failure") return assert.fail(`session.page("p1") failed: ${result.failure.message}`)
      assert.strictEqual(result.success.id, opened.id)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session.page, an ordinary name", () => {
  it.effect("finds a page kept under a name", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const opened = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      // Listed as p1 first, then kept as "checkout": the name finds it, and the handle no longer does.
      yield* session.pages
      yield* session.name(opened, "checkout")
      const found = yield* session.page("checkout")
      assert.strictEqual(found.id, opened.id)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
