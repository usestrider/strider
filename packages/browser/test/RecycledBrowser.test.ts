import { assert, describe, it } from "@effect/vitest"
import { Browser, ConsoleMessage, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as Hash from "effect/Hash"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { TestClock } from "effect/testing"
import { appendFileSync } from "node:fs"
import { vi } from "vitest"
import * as Handles from "../src/internal/handles.ts"
import { Recycler, recycling } from "./integration/slice/recycledBrowser.ts"
import * as SharedContext from "./integration/slice/sharedContext.ts"

vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  appendFileSync: vi.fn()
}))

const backend = recycling(Browser.layerTest(""))

const pages = Effect.fnUntraced(function*(count: number) {
  const browser = yield* Browser.Browser
  for (let i = 0; i < count; i++) {
    yield* Effect.scoped(Effect.flatMap(browser.defaultContext.control, (context) => context.newPage))
  }
})

describe("slice browser recycling", () => {
  it.effect("a popup alone blocks recycling until it closes", () => {
    let original!: Browser.Browser
    const captured = Layer.effect(
      Browser.Browser,
      Effect.tap(Browser.Browser, (browser) =>
        Effect.sync(() => {
          original = browser
        }))
    ).pipe(Layer.provide(Browser.layerTest("-popup")))
    return Effect.gen(function*() {
      const recycler = yield* Recycler
      // Use the underlying context so no proxy handle can mask the page-owner check.
      const context = yield* original.defaultContext.control
      const opener = yield* context.newPage
      const next = yield* Popup.next(opener)
      yield* TestClock.adjust("10 millis")
      const popup = yield* next
      yield* opener.close()
      assert.strictEqual((yield* recycler.stats).pages, 1)
      assert.isFalse(yield* recycler.due, "the popup is the only remaining owned page")
      assert.isFalse(yield* recycler.run)
      yield* popup.close()
      assert.isTrue(yield* recycler.run)
      assert.strictEqual((yield* recycler.stats).launches, 2)
    }).pipe(Effect.scoped, Effect.provide(recycling(captured, 1)))
  })

  it.effect("a refused restart preserves its result when diagnostic writing fails", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(100)
      yield* browser.defaultContext.control
      const previous = process.env["STRIDER_TRACE_RETAIN_PASSES"]
      process.env["STRIDER_TRACE_RETAIN_PASSES"] = "1"
      vi.mocked(appendFileSync).mockImplementation(() => {
        throw new Error("diagnostic destination is unavailable")
      })
      try {
        const result = yield* Effect.exit(recycler.due)
        assert.deepStrictEqual(result, Exit.succeed(false))
        assert.isFalse(yield* recycler.run)
        yield* browser.newContext()
        assert.isFalse(yield* recycler.due)
        assert.strictEqual(vi.mocked(appendFileSync).mock.calls.length, 1)
      } finally {
        if (previous === undefined) delete process.env["STRIDER_TRACE_RETAIN_PASSES"]
        else process.env["STRIDER_TRACE_RETAIN_PASSES"] = previous
        vi.mocked(appendFileSync).mockReset()
      }
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("logs changed refusal reasons up to 200 entries and one limit marker", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(100)
      const previous = process.env["STRIDER_TRACE_RETAIN_PASSES"]
      process.env["STRIDER_TRACE_RETAIN_PASSES"] = "1"
      vi.mocked(appendFileSync).mockReset()
      try {
        for (let index = 0; index < 205; index++) {
          yield* Effect.scoped(Effect.gen(function*() {
            yield* browser.newContext()
            assert.isFalse(yield* recycler.due)
            assert.isFalse(yield* recycler.run)
            assert.isFalse(yield* recycler.due)
          }))
          assert.strictEqual(vi.mocked(appendFileSync).mock.calls.length, Math.min(index + 1, 201))
        }
        const entries = vi.mocked(appendFileSync).mock.calls.map((call) => JSON.parse(String(call[1])))
        assert.isTrue(entries.slice(0, 200).every((entry) => entry.held.length === 1 && entry.pages === 100))
        assert.strictEqual(entries[200].limit, 200)
        assert.isUndefined(entries[200].held)
      } finally {
        if (previous === undefined) delete process.env["STRIDER_TRACE_RETAIN_PASSES"]
        else process.env["STRIDER_TRACE_RETAIN_PASSES"] = previous
        vi.mocked(appendFileSync).mockReset()
      }
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("keeps the observed default context usable by public event modules", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      const original = Handles.target(browser.defaultContext).behind.runtime
      for (let generation = 0; generation < 2; generation++) {
        const observed = browser.defaultContext
        const behind = Handles.target(observed).behind
        if (generation === 1) assert.notStrictEqual(behind.runtime, original)
        const history = yield* ConsoleMessage.history(observed)
        assert.deepStrictEqual(history.entries, [])
        yield* Effect.scoped(Effect.gen(function*() {
          const context = yield* observed.control
          const page = yield* context.newPage
          assert.isTrue(Equal.equals(page.context, browser.defaultContext))
          assert.isTrue(Equal.equals(browser.defaultContext, page.context))
          assert.strictEqual(Hash.hash(page.context), Hash.hash(browser.defaultContext))
          assert.strictEqual(Handles.target(page.context).behind.entry, behind.entry)
          assert.strictEqual(Handles.target(browser.defaultContext).behind.runtime, behind.runtime)
        }))
        if (generation === 0) assert.isTrue(yield* recycler.run)
      }
    }).pipe(Effect.scoped, Effect.provide(recycling(Browser.layerTest(""), 1))))

  it.effect("relaunches after the 100th page when the case boundary requests it", () =>
    Effect.gen(function*() {
      const recycler = yield* Recycler
      yield* pages(99)
      assert.isFalse(yield* recycler.run)
      yield* pages(1)
      assert.strictEqual((yield* recycler.stats).launches, 1)
      assert.isTrue(yield* recycler.run)
      assert.deepStrictEqual(yield* recycler.stats, { launches: 2, pages: 0, limit: 100 })
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not relaunch while a handed-out context is open", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      const scope = yield* Scope.make()
      yield* browser.newContext().pipe(Scope.provide(scope))
      yield* pages(100)
      assert.isFalse(yield* recycler.run)
      yield* Scope.close(scope, Exit.void)
      assert.isTrue(yield* recycler.run)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not close a live default-context page when the case opens a context", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(99)
      yield* (yield* browser.defaultContext.control).newPage
      yield* browser.newContext()
      assert.strictEqual((yield* recycler.stats).launches, 1)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not treat a second newContext call in the same case as a case boundary", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* Effect.scoped(Effect.gen(function*() {
        const context = yield* browser.newContext()
        for (let i = 0; i < 100; i++) yield* Effect.scoped(context.newPage)
      }))
      yield* browser.newContext()
      assert.strictEqual((yield* recycler.stats).launches, 1)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not close a live page acquired through browser.newPage", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(99)
      yield* browser.newPage()
      yield* browser.newContext()
      assert.strictEqual((yield* recycler.stats).launches, 1)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("still detects leaked declarations after rebuilding the shared context on a new browser", () =>
    Effect.gen(function*() {
      const shared = yield* SharedContext.Shared
      const recycler = yield* Recycler
      const original = yield* shared.current
      const firstScope = yield* Scope.make()
      yield* original.addInitScript(() => {}).pipe(Scope.provide(firstScope))
      assert.isTrue((yield* shared.settle).some((entry) => entry.includes("InitScript")))
      yield* Scope.close(firstScope, Exit.void)
      const beforeRestart = yield* shared.current
      for (let i = 0; i < 100; i++) yield* Effect.scoped(beforeRestart.newPage)
      assert.deepStrictEqual(yield* shared.settle, [])
      assert.strictEqual((yield* recycler.stats).launches, 2)
      const fresh = yield* shared.current
      assert.notStrictEqual(fresh, original)
      const declarationScope = yield* Scope.make()
      yield* fresh.addInitScript(() => {}).pipe(Scope.provide(declarationScope))
      const leftovers = yield* shared.settle
      yield* Scope.close(declarationScope, Exit.void)
      assert.isTrue(leftovers.some((entry) => entry.includes("InitScript")), JSON.stringify(leftovers))
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(SharedContext.layer(backend), backend))))

  it.effect("awaits the old browser's finalizer before making the next launch available", () => {
    const events: Array<string> = []
    const tracked = Layer.effect(
      Browser.Browser,
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        events.push("launch")
        yield* Effect.addFinalizer(() =>
          Effect.yieldNow.pipe(Effect.andThen(Effect.sync(() => {
            events.push("closed")
          })))
        )
        return browser
      })
    ).pipe(Layer.provide(Browser.layerTest("")))
    return Effect.gen(function*() {
      const recycler = yield* Recycler
      yield* pages(100)
      assert.isTrue(yield* recycler.run)
      assert.deepStrictEqual(events, ["launch", "closed", "launch"])
    }).pipe(Effect.scoped, Effect.provide(recycling(tracked)))
  })

  it.effect("does not recycle a browser.newPage context after its page closes but its owner remains open", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(99)
      const owner = yield* Scope.fork(yield* Effect.scope)
      const page = yield* browser.newPage().pipe(Scope.provide(owner))
      assert.isFalse(yield* recycler.run)
      yield* page.close()
      const restarted = yield* recycler.run
      yield* Scope.close(owner, Exit.void)
      assert.isFalse(restarted)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not recycle while a page-free default context is controlled in an open scope", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(100)
      const owner = yield* Scope.fork(yield* Effect.scope)
      yield* browser.defaultContext.control.pipe(Scope.provide(owner))
      const restarted = yield* recycler.run
      yield* Scope.close(owner, Exit.void)
      assert.isFalse(restarted)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("does not block on a page the harness did not create", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(100)
      const before = (yield* browser.pages.waitFor(() => true)).length
      assert.isAtLeast(before, 0)
      assert.isTrue(yield* recycler.run)
    }).pipe(Effect.scoped, Effect.provide(backend)))

  it.effect("blocks while an owned page stays open and releases when it closes", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const recycler = yield* Recycler
      yield* pages(99)
      const owner = yield* Scope.fork(yield* Effect.scope)
      const context = yield* browser.defaultContext.control.pipe(Scope.provide(owner))
      const page = yield* context.newPage.pipe(Scope.provide(owner))
      yield* Scope.close(owner, Exit.void)
      yield* page.close().pipe(Effect.ignore)
      yield* pages(1)
      assert.isTrue(yield* recycler.run)
    }).pipe(Effect.scoped, Effect.provide(backend)))
})
