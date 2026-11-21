/** Frames added and removed, loads, and closes, on a page or every page of a context. */
import { assert, describe, it } from "@effect/vitest"
import { Page, PageLifecycle, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

const setup = Effect.fnUntraced(function*() {
  const fold = yield* Fold.make({ release: () => Effect.void })
  const runtime = { model: fold } as unknown as Runtime.Runtime
  const addPage = (page: string, context: string) =>
    fold.sink({
      _tag: "PageAdded",
      page: page as Target.NavigableId,
      context: context as UserContext.Id,
      kind: "tab",
      origin: { _tag: "Created" },
      url: "about:blank" as Url.Url
    })
  const commit = Effect.fnUntraced(function*(navigable: string, document: string) {
    yield* fold.sink({
      _tag: "DocumentCommitted",
      document: document as Target.DocumentId,
      navigable: navigable as Target.NavigableId,
      url: `https://example.com/${document}` as Url.Url,
      replaced: Option.none()
    } as never)
    yield* fold.sink({ _tag: "DocumentReadiness", document: document as Target.DocumentId, readiness: "interactive" })
    yield* fold.sink({ _tag: "DocumentReadiness", document: document as Target.DocumentId, readiness: "complete" })
    // Reported again, as Chromium and WebKit can: no second event
    yield* fold.sink({ _tag: "DocumentReadiness", document: document as Target.DocumentId, readiness: "complete" })
  })
  const addFrame = (frame: string, page: string) =>
    fold.sink({
      _tag: "FrameAdded",
      frame: frame as Target.NavigableId,
      parent: page as Target.NavigableId,
      page: page as Target.NavigableId
    })
  const remove = (navigable: string) =>
    fold.sink({
      _tag: "NavigableRemoved",
      navigable: navigable as Target.NavigableId,
      reason: new Target.PageClosed({ by: "command" }),
      evidence: "test"
    } as never)
  yield* addPage("first", "context")
  const context = {} as UserContext.UserContext
  Handles.registerContext(context, {
    runtime,
    entry: yield* fold.context("context" as UserContext.Id, false),
    grant: Option.none()
  })
  const page = {} as Page.Page
  Handles.registerPage(page, {
    runtime,
    entry: Option.getOrThrow(fold.page("first" as Target.NavigableId)),
    grant: Option.none()
  })
  return { addFrame, addPage, commit, context, page, remove, fold }
})

const summary = (event: PageLifecycle.PageLifecycle) => `${event._tag} ${event.page} ${event.frame}`

describe("PageLifecycle", () => {
  it.effect("keeps a context's pages' frames, loads and closes, naming page and frame, and no other context's", () =>
    Effect.gen(function*() {
      const { addFrame, addPage, commit, context, page, remove } = yield* setup()
      yield* commit("first", "a")
      yield* addPage("second", "context")
      yield* addPage("elsewhere", "other")
      yield* commit("elsewhere", "x")
      yield* addFrame("child", "second")
      yield* commit("child", "c")
      yield* remove("child")
      yield* remove("second")
      assert.deepStrictEqual((yield* PageLifecycle.history(context)).entries.map(summary), [
        "DomContentLoaded first first",
        "Loaded first first",
        "FrameAdded second child",
        "FrameRemoved second child",
        "Closed second second"
      ])
      assert.deepStrictEqual(
        (yield* PageLifecycle.history(context, { frames: "all", events: ["Loaded"] })).entries.map(summary),
        ["Loaded first first", "Loaded second child"]
      )
      assert.deepStrictEqual((yield* PageLifecycle.history(page)).entries.map(summary), [
        "DomContentLoaded first first",
        "Loaded first first"
      ])
    }))

  it.effect("streams from when it subscribes, with a page's close before the context's stream ends", () =>
    Effect.gen(function*() {
      const { addPage, commit, context, remove } = yield* setup()
      yield* commit("first", "before")
      const events = yield* PageLifecycle.stream(context, { events: ["Loaded", "Closed"] })
      const collected = yield* Effect.forkScoped(Stream.runCollect(Stream.take(events, 3)))
      yield* addPage("later", "context")
      yield* commit("later", "after")
      yield* remove("later")
      yield* remove("first")
      assert.deepStrictEqual(Array.from(yield* Fiber.join(collected)).map(summary), [
        "Loaded later later",
        "Closed later later",
        "Closed first first"
      ])
    }))

  it.effect("delivers a page's Closed event to next before ending the page channel", () =>
    Effect.gen(function*() {
      const { page, remove } = yield* setup()
      const closed = yield* PageLifecycle.next(page, { events: "Closed" })
      yield* remove("first")
      assert.strictEqual((yield* closed)._tag, "Closed")
    }))

  it.effect("delivers a context's last Closed event to next when the context is removed", () =>
    Effect.gen(function*() {
      const { context, fold } = yield* setup()
      const closed = yield* PageLifecycle.next(context, { events: "Closed" })
      yield* fold.sink({ _tag: "UserContextRemoved", context: "context" as UserContext.Id })
      assert.strictEqual((yield* closed)._tag, "Closed")
    }))

  it.effect("drains a page's Closed event before its stream ends normally", () =>
    Effect.gen(function*() {
      const { page, remove } = yield* setup()
      const events = yield* PageLifecycle.stream(page)
      yield* remove("first")
      assert.deepStrictEqual(Array.from(yield* Stream.runCollect(events)).map(summary), ["Closed first first"])
    }))
})
