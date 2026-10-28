/**
 * The pages a toolkit session names: `session.page` finds a page by a name it was given, not by a generated handle,
 * and the digest calls a page by the name it has as each line is noted.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
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

/** What the session's tools give since the last call: the digest, from a call that reads nothing new. */
const sinceLast = (session: ToolkitImpl.Session) =>
  Effect.map(
    Effect.flatMap(session.toolkit.handle("pages", {}), Stream.runLast),
    (last) => (Option.getOrThrow(last).result as { readonly sinceLast: ReadonlyArray<string> }).sinceLast
  )

describe("Session's digest", () => {
  it.effect("names a page by its name now, after page name renamed it", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      // Seen as p1, kept as shop, then renamed: every line after says store
      yield* session.name(page, "shop")
      yield* session.rename("shop", "store")
      yield* page.goto("https://example.test/cart")
      // The timeline then opens a popup, shows a dialog and closes the page
      yield* TestClock.adjust("40 millis")
      const lines: Array<string> = []
      for (let turn = 0; turn < 20 && !lines.some((line) => line.includes("closed")); turn++) {
        yield* Effect.yieldNow
        lines.push(...(yield* sinceLast(session)))
      }
      assert.includeMembers(lines, [
        "store navigated to https://example.test/cart",
        "popup p2 opened from store",
        "dialog alert on store",
        "store closed: PageClosed"
      ])
      assert.isFalse(lines.some((line) => /\b(p1|shop)\b/.test(line)), lines.join("\n"))
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest("-popup-dialog(alert)-|"))))
})

describe("Session.open", () => {
  it.effect("checks the name before it opens a page, so a name that's taken opens none", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      yield* session.open({ name: "shop" })
      const before = (yield* context.pages).length
      const result = yield* Effect.result(session.open({ name: "shop" }))
      if (result._tag === "Success") return assert.fail(`open gave a second page named shop: ${result.success.name}`)
      assert.strictEqual(result.failure.error, "InvalidInput")
      assert.strictEqual((yield* context.pages).length, before)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("closes a page whose navigation fails and frees its name, which the digest leaves out", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const result = yield* Effect.result(session.open({ name: "refused", url: "not a URL" }))
      if (result._tag === "Success") return assert.fail("open navigated to a URL that doesn't parse")
      assert.strictEqual(result.failure.error, "PageError")
      assert.deepStrictEqual(yield* context.pages, [])
      assert.isTrue(Option.isNone(session.named("refused")))
      assert.deepStrictEqual(yield* sinceLast(session), [])
      // The name is free again
      const opened = yield* session.open({ name: "refused", url: "https://example.test/" })
      assert.strictEqual(opened.name, "refused")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
