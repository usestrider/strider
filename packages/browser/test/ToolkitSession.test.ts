/**
 * The pages a toolkit session names: `session.page` finds a page by a name it was given, not by a generated handle,
 * and the digest calls a page by the name it has as each line is noted.
 */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Snapshot, Target } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Snapshots from "../src/internal/snapshot.ts"
import * as ToolkitImpl from "../src/internal/toolkit.ts"

describe("Session with explicit tab control", () => {
  it.effect("keeps shared-context pages in tabs until control names one", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      assert.deepStrictEqual(yield* session.pages, [])
      const listed = yield* session.toolkit.handle("tabs", {}).pipe(Effect.flatMap(Stream.runLast))
      const listedResult = Option.getOrThrow(listed).result
      if (!("outcome" in listedResult)) return assert.fail("tabs did not return an outcome")
      assert.deepStrictEqual(listedResult.outcome, [{ tab: String(page.id), url: "about:blank" }])
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      assert.deepStrictEqual((yield* session.pages).map((each) => each.name), ["remote"])
      const remaining = yield* session.toolkit.handle("tabs", {}).pipe(Effect.flatMap(Stream.runLast))
      const remainingResult = Option.getOrThrow(remaining).result
      if (!("outcome" in remainingResult)) return assert.fail("tabs did not return an outcome")
      assert.deepStrictEqual(remainingResult.outcome, [])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session with explicit tab control, after control", () => {
  // ROOK-4: refresh answers [] when context pages aren't discovered, so a page taken with control goes unlisted
  it.effect("lists a tab taken with control in pages and in session.pages", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      const listed = yield* session.toolkit.handle("pages", {}).pipe(Effect.flatMap(Stream.runLast))
      const result = Option.getOrThrow(listed).result
      if (!("outcome" in result)) return assert.fail("pages did not return an outcome")
      assert.deepStrictEqual(result.outcome.map((each) => each.page), ["remote"])
      assert.deepStrictEqual((yield* session.pages).map((each) => each.name), ["remote"])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session with explicit tab control, after the tab closes", () => {
  // ROOK-4: with discovery off, refresh lists byName, which nothing prunes when a held tab closes
  it.effect("stops listing a held tab that closed", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* page.close()
      assert.deepStrictEqual((yield* session.pages).map((each) => each.name), [])
      const listed = yield* session.toolkit.handle("pages", {}).pipe(Effect.flatMap(Stream.runLast))
      const result = Option.getOrThrow(listed).result
      if (!("outcome" in result)) return assert.fail("pages did not return an outcome")
      assert.deepStrictEqual(result.outcome, [])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session closed-page cleanup", () => {
  for (const discoverContextPages of [false, true]) {
    it.effect(`retires a renamed closed tab and reuses its name (discovery ${discoverContextPages})`, () =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* Browser.newContext()
        const session = yield* ToolkitImpl.makeSession({
          context,
          browser,
          secrets: {},
          capture: CapturePolicy.local,
          discoverContextPages
        })
        const page = yield* context.newPage
        let released = 0
        const control = page.control
        Object.defineProperty(page, "control", {
          value: Effect.andThen(
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                released++
              })
            ),
            control
          )
        })
        const snapshot = new Snapshots.SnapshotImpl({
          document: Schema.decodeUnknownSync(Target.DocumentId)("document"),
          generation: Schema.decodeUnknownSync(Snapshot.Generation)(1),
          root: {
            ref: Option.none(),
            role: { _tag: "Aria", role: "document" },
            name: { _tag: "None" },
            states: new Set(),
            validationMessage: Option.none(),
            children: []
          },
          text: "document"
        })
        Object.defineProperty(page, "snapshot", { value: () => Effect.succeed(snapshot) })
        if (discoverContextPages) yield* session.name(page, "remote")
        else {yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
            Effect.flatMap(Stream.runDrain)
          )}
        yield* session.rename("remote", "renamed")
        yield* session.toolkit.handle("snapshot", { page: "renamed" }).pipe(Effect.flatMap(Stream.runDrain))
        assert.isTrue(Option.isSome(session.latest("renamed")))
        yield* page.close()
        // Exercise the close watcher independently of a listing's synchronous pruning.
        yield* TestClock.adjust("1 millis")
        assert.strictEqual(released, discoverContextPages ? 0 : 1)
        assert.isTrue(Option.isNone(session.named("remote")))
        assert.isTrue(Option.isNone(session.named("renamed")))
        assert.isTrue(Option.isNone(session.latest("renamed")))
        assert.deepStrictEqual(yield* session.pages, [])
        const replacement = yield* context.newPage
        if (discoverContextPages) yield* session.name(replacement, "renamed")
        else {yield* session.toolkit.handle("control", { tab: String(replacement.id), name: "renamed" }).pipe(
            Effect.flatMap(Stream.runDrain)
          )}
        assert.strictEqual((yield* session.page("renamed")).id, replacement.id)
        if (!discoverContextPages) {
          yield* session.toolkit.handle("release", { page: "renamed" }).pipe(Effect.flatMap(Stream.runDrain))
          assert.deepStrictEqual(yield* session.pages, [])
          assert.isTrue(Option.isNone(session.named("renamed")))
        }
        assert.strictEqual(released, discoverContextPages ? 0 : 1, "old grant retires exactly once")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }

  it.effect("does not cache an old snapshot after the name is reused", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const started = yield* Deferred.make<void>()
      const answer = yield* Deferred.make<Snapshots.SnapshotImpl>()
      Object.defineProperty(page, "snapshot", {
        value: () => Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(answer))
      })
      const session = yield* ToolkitImpl.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      const pending = yield* session.toolkit.handle("snapshot", { page: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain),
        Effect.forkChild
      )
      yield* Deferred.await(started)
      yield* page.close()
      const replacement = yield* context.newPage
      yield* session.toolkit.handle("control", { tab: String(replacement.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* Deferred.succeed(
        answer,
        new Snapshots.SnapshotImpl({
          document: Schema.decodeUnknownSync(Target.DocumentId)("old-document"),
          generation: Schema.decodeUnknownSync(Snapshot.Generation)(1),
          root: {
            ref: Option.none(),
            role: { _tag: "Aria", role: "document" },
            name: { _tag: "None" },
            states: new Set(),
            validationMessage: Option.none(),
            children: []
          },
          text: "old-document"
        })
      )
      yield* Fiber.join(pending)
      assert.isTrue(Option.isNone(session.latest("remote")))
      assert.strictEqual((yield* session.page("remote")).id, replacement.id)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("finishes cleanup when external close and release race", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      let released = 0
      const control = page.control
      Object.defineProperty(page, "control", {
        value: Effect.andThen(
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              released++
            })
          ),
          control
        )
      })
      const session = yield* ToolkitImpl.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* Effect.all([
        page.close(),
        session.toolkit.handle("release", { page: "remote" }).pipe(Effect.flatMap(Stream.runDrain), Effect.result)
      ], { concurrency: "unbounded" })
      yield* TestClock.adjust("1 millis")
      assert.strictEqual(released, 1)
      assert.deepStrictEqual(yield* session.pages, [])
      assert.isTrue(Option.isNone(session.named("remote")))
      const replacement = yield* context.newPage
      yield* session.toolkit.handle("control", { tab: String(replacement.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      assert.strictEqual((yield* session.page("remote")).id, replacement.id)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

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
