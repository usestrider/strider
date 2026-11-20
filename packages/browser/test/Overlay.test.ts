/** Recording overlays cost nothing on a page that never acquires them. */
import { assert, it } from "@effect/vitest"
import { Browser, Capability, Deadline } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { vi } from "vitest"
import * as BrowserClock from "../src/internal/browserClock.ts"
import type * as Engine from "../src/internal/engine.ts"
import * as Execution from "../src/internal/execution.ts"
import type { LocatorImpl } from "../src/internal/locator.ts"
import * as Operation from "../src/internal/operation.ts"
import * as Overlays from "../src/internal/overlays.ts"
import * as Runtime from "../src/internal/runtime.ts"
import type * as MonotonicInstant from "../src/MonotonicInstant.ts"

it.effect("leaves a page without overlays on the ordinary dispatch, with no navigation listener", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const entry = (page.locator("body") as LocatorImpl).owner.page
    yield* page.goto("about:blank")
    assert.strictEqual(entry.execution, Execution.ordinary)
    assert.isFalse(Overlays.listening(entry))
    // The test backend paints nothing, so acquiring fails before anything is installed
    const error = yield* page.capability(Capability.Overlay).pipe(Effect.flip)
    assert.strictEqual(error._tag, "CapabilityError")
    if (error._tag === "CapabilityError") assert.strictEqual(error.reason._tag, "Unsupported")
    assert.strictEqual(entry.execution, Execution.ordinary)
    assert.isFalse(Overlays.listening(entry))
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("composes an annotation with a locator handler's dispatch, and goes back to ordinary after both", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const entry = (page.locator("body") as LocatorImpl).owner.page
    const annotate: Execution.Annotate = () => Effect.void
    for (const handlerFirst of [true, false]) {
      const handler = yield* Scope.make()
      yield* page.addLocatorHandler(page.locator("#never"), () => Effect.void).pipe(Scope.provide(handler))
      Execution.annotateWith(entry, annotate)
      assert.strictEqual(entry.execution.annotate, annotate)
      assert.notStrictEqual(entry.execution.action, Execution.ordinary.action)
      if (handlerFirst) {
        yield* Scope.close(handler, Exit.void)
        assert.strictEqual(entry.execution.annotate, annotate)
        assert.strictEqual(entry.execution.action, Execution.ordinary.action)
        Execution.annotateWith(entry, undefined)
      } else {
        Execution.annotateWith(entry, undefined)
        assert.isUndefined(entry.execution.annotate)
        assert.notStrictEqual(entry.execution.action, Execution.ordinary.action)
        yield* Scope.close(handler, Exit.void)
      }
      assert.strictEqual(entry.execution, Execution.ordinary)
    }
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("does not let an in-flight draw from a released acquisition overwrite its successor", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let rendered: ReadonlyArray<Engine.OverlayItem> = []
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (request.op === "overlay") {
          if (request.overlays.some((item) => item._tag === "Html" && item.html === "old")) {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(resume)
          }
          rendered = request.overlays
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const held = yield* Scope.make()
    const acquire = Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(Operation.named("test.acquire"))
    const old = yield* acquire.pipe(Scope.provide(held))
    const pending = yield* old.add("old").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const release = yield* Scope.close(held, Exit.void).pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    const replacement = yield* Effect.gen(function*() {
      const current = yield* acquire
      yield* current.add("current")
    }).pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.await(pending)
    yield* Fiber.join(release)
    yield* Fiber.join(replacement)
    assert.deepStrictEqual(rendered.map((item) => item._tag === "Html" ? item.html : item._tag), ["current"])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("restores ordinary dispatch when actions registration is interrupted during its draw", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const send = vi.spyOn(Runtime, "send").mockImplementation(() =>
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire")
    )
    const pending = yield* overlay.actions().pipe(Effect.scoped, Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(pending)
    assert.strictEqual(owner.page.execution, Execution.ordinary)
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("a delayed release clear cannot erase a newly acquired overlay", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const clearing = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let rendered: ReadonlyArray<Engine.OverlayItem> = []
    let pauseClear = true
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (request.op === "overlay") {
          if (pauseClear && request.overlays.length === 0) {
            pauseClear = false
            yield* Deferred.succeed(clearing, undefined)
            yield* Deferred.await(resume)
          }
          rendered = request.overlays
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const held = yield* Scope.make()
    const acquire = Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(Operation.named("test.acquire"))
    const old = yield* acquire.pipe(Scope.provide(held))
    yield* old.add("old")
    const release = yield* Scope.close(held, Exit.void).pipe(Effect.forkChild)
    yield* Deferred.await(clearing)
    const replacement = yield* Effect.gen(function*() {
      const current = yield* acquire
      yield* current.add("current")
    }).pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(release)
    yield* Fiber.join(replacement)
    assert.deepStrictEqual(rendered.map((item) => item._tag === "Html" ? item.html : item._tag), ["current"])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("reads the annotation budget after its box lookup and draw", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    let now = 0
    const sleeps: Array<number> = []
    const clock: BrowserClock.BrowserClock = {
      now: () => now as MonotonicInstant.MonotonicInstant,
      sleep: (millis) =>
        Effect.sync(() => {
          sleeps.push(millis)
          now += millis * 1e6
        })
    }
    let drawingAction = false
    const send = vi.spyOn(Runtime, "send").mockImplementation(() =>
      Effect.sync(() => {
        if (drawingAction) now += 100e6
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire")
    )
    yield* overlay.actions({ duration: "1 second", style: { highlight: "outline:1px solid red" } })
    drawingAction = true
    yield* owner.page.execution.annotate!({
      title: "click button",
      point: null,
      box: Effect.sync(() => {
        now += 800e6
        return Option.none()
      })
    }).pipe(
      Operation.named("test.action"),
      Deadline.within("1 second"),
      Effect.provideService(BrowserClock.CurrentClock, clock)
    )
    assert.deepStrictEqual(sleeps, [100])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("bounds the wait for another overlay draw by the waiting operation deadline", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let first = true
    const send = vi.spyOn(Runtime, "send").mockImplementation(() =>
      Effect.gen(function*() {
        if (first) {
          first = false
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(resume)
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire")
    )
    const occupying = yield* overlay.hide.pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const waiting = yield* overlay.show.pipe(Deadline.within("100 millis"), Effect.forkChild)
    yield* TestClock.adjust("200 millis")
    const atDeadline = waiting.pollUnsafe()
    // Release the first draw before asserting so even the broken implementation can finish its cleanup.
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.await(occupying)
    yield* Fiber.await(waiting)
    assert.isDefined(atDeadline)
    assert.isTrue(Exit.isFailure(atDeadline!))
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("orders a release clear before successor draws while the navigation watch is closing", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const closing = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const changes = owner.page.state.changes
    let first = true
    Object.defineProperty(owner.page.state, "changes", {
      configurable: true,
      value: changes.pipe(Stream.ensuring(Effect.suspend(() => {
        if (!first) return Effect.void
        first = false
        return Deferred.succeed(closing, undefined).pipe(Effect.andThen(Deferred.await(resume)))
      })))
    })
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Object.defineProperty(owner.page.state, "changes", { configurable: true, value: changes })
      })
    )
    let rendered: ReadonlyArray<Engine.OverlayItem> = []
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.sync(() => {
        if (request.op === "overlay") rendered = request.overlays
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const held = yield* Scope.make()
    const acquire = Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(Operation.named("test.acquire"))
    const old = yield* acquire.pipe(Scope.provide(held))
    yield* old.add("old")
    yield* TestClock.adjust(0)
    const release = yield* Scope.close(held, Exit.void).pipe(Effect.forkChild)
    yield* Deferred.await(closing)
    const replacement = yield* Effect.gen(function*() {
      const current = yield* acquire
      yield* current.add("current")
    }).pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(release)
    yield* Fiber.join(replacement)
    assert.deepStrictEqual(rendered.map((item) => item._tag === "Html" ? item.html : item._tag), ["current"])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("a draw that gives up at its deadline never sends and doesn't hold up the next", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const applied: Array<boolean> = []
    let hold = false
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (request.op === "overlay") {
          if (hold) {
            hold = false
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(resume)
          }
          applied.push(request.hidden)
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire")
    )
    hold = true
    const first = yield* overlay.add("held").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    const gaveUp = yield* overlay.hide.pipe(Deadline.within("100 millis"), Effect.flip, Effect.forkChild)
    yield* TestClock.adjust(200)
    assert.strictEqual((yield* Fiber.join(gaveUp))._tag, "Timeout")
    const next = yield* overlay.show.pipe(Effect.forkChild)
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(first)
    yield* Fiber.join(next)
    // The held draw, then the show; the hide that gave up never reached the page
    assert.deepStrictEqual(applied, [false, false])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("a release completes while its navigation watch has a redraw queued", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let rendered: ReadonlyArray<Engine.OverlayItem> = []
    let hold = false
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (request.op === "overlay") {
          if (hold) {
            hold = false
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(resume)
          }
          rendered = request.overlays
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const held = yield* Scope.make()
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire"),
      Scope.provide(held)
    )
    yield* overlay.add("kept").pipe(Scope.provide(held))
    hold = true
    const drawing = yield* overlay.show.pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    // The navigation's redraw queues behind the held draw, and the release's clear behind it
    yield* page.goto("about:blank")
    const release = yield* Scope.close(held, Exit.void).pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(drawing)
    yield* Fiber.join(release)
    assert.deepStrictEqual(rendered, [])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("several cancelled turns still wait for their unfinished predecessor", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const applied: Array<boolean> = []
    let first = true
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (first) {
          first = false
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(resume)
        }
        if (request.op === "overlay") applied.push(request.hidden)
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire")
    )
    const held = yield* overlay.show.pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    for (let i = 0; i < 3; i++) {
      const cancelled = yield* overlay.hide.pipe(Deadline.within("100 millis"), Effect.flip, Effect.forkChild)
      yield* TestClock.adjust(200)
      assert.strictEqual((yield* Fiber.join(cancelled))._tag, "Timeout")
    }
    const last = yield* overlay.show.pipe(Effect.forkChild)
    yield* TestClock.adjust(0)
    const beforeResume = [...applied]
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(held)
    yield* Fiber.join(last)
    assert.deepStrictEqual(beforeResume, [])
    assert.deepStrictEqual(applied, [false, false])
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

it.effect("bounds the clear send inside an uninterruptible capability finalizer", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const owner = (page.locator("body") as LocatorImpl).owner
    const entered = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const send = vi.spyOn(Runtime, "send").mockImplementation((_runtime, _page, request) =>
      Effect.gen(function*() {
        if (request.op === "overlay" && request.overlays.length === 0) {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(resume)
        }
        return { _tag: "Overlaid" } as const
      })
    )
    yield* Effect.addFinalizer(() => Effect.sync(() => send.mockRestore()))
    const scope = yield* Scope.make()
    const overlay = yield* Overlays.acquire(owner.runtime, owner.page, owner.grant).pipe(
      Operation.named("test.acquire"),
      Scope.provide(scope)
    )
    yield* overlay.add("visible")
    const closing = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* TestClock.adjust("6 seconds")
    const bounded = closing.pollUnsafe()
    yield* Deferred.succeed(resume, undefined)
    yield* Fiber.join(closing)
    assert.isDefined(bounded)
    assert.isTrue(Exit.isSuccess(bounded!))
    assert.isFalse(Overlays.listening(owner.page))
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
