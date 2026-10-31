/**
 * A page's release and a context's removal: each done once its target ends, whether or not the browser has answered
 * the command, under a budget of its own; each warns halfway through naming what it waits on, and the command it
 * sends runs to its own end. A target that ended already, as everything has once the connection is lost, isn't
 * waited for.
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
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Target from "../src/Target.ts"
import type * as UserContext from "../src/UserContext.ts"

const id = "page-1" as Target.NavigableId

/** An open page, owned by nobody in particular, with only what a release reads. */
const openPage = Effect.gen(function*() {
  const state = yield* SubscriptionRef.make({ status: { _tag: "Open" }, owner: Option.none() })
  const closed = yield* Deferred.make<Target.CloseReason>()
  return { id, state: Readable.of(state), closed } as unknown as Model.PageEntry
})

/** An open context with `pages` open in it, with only what a removal reads. */
const openContext = Effect.fnUntraced(function*(pages: ReadonlyArray<string>) {
  const state = yield* SubscriptionRef.make({ pages: pages.map((page) => ({ id: page })), closed: Option.none() })
  const closed = yield* Deferred.make<Target.CloseReason>()
  return { id: "U2" as UserContext.Id, state: Readable.of(state), closed } as unknown as Model.ContextEntry
})

/**
 * Runs what `run` asks of ownership over an adapter of only `adapter`'s methods, on the test clock, collecting the
 * warnings logged; the test drives it with `TestClock.adjust`.
 */
const running = Effect.fnUntraced(function*(
  adapter: Partial<Adapter.AdapterConnection>,
  run: (ownership: Ownership.Ownership) => Effect.Effect<void>
) {
  const warnings: Array<string> = []
  const logger = Logger.make((options) => {
    if (options.logLevel === "Warn") warnings.push((options.message as ReadonlyArray<string>).join(" "))
  })
  const ownership = yield* Ownership.make()
  yield* ownership.attach(adapter as Adapter.AdapterConnection)
  const fiber = yield* run(ownership).pipe(
    Effect.provideService(BrowserClock.CurrentClock, BrowserClock.fromClock(yield* Clock.Clock)),
    Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
    Effect.forkChild({ startImmediately: true })
  )
  return { fiber, warnings }
})

type Wrap = (effect: Effect.Effect<void>) => Effect.Effect<void>

/** Releases a page through an adapter whose `closePage` is `closePage`. */
const releasing = Effect.fnUntraced(function*(
  closePage: Adapter.AdapterConnection["closePage"],
  wrap: Wrap = (release) => release
) {
  const page = yield* openPage
  const { fiber, warnings } = yield* running({ closePage }, (ownership) => wrap(ownership.release(page)))
  return { page, release: fiber, warnings }
})

/** Removes a context with `pages` open through an adapter whose `removeUserContext` is `removeUserContext`. */
const removing = Effect.fnUntraced(function*(
  removeUserContext: Adapter.AdapterConnection["removeUserContext"],
  options: { readonly pages?: ReadonlyArray<string>; readonly wrap?: Wrap } = {}
) {
  const context = yield* openContext(options.pages ?? [])
  const { fiber, warnings } = yield* running(
    { removeUserContext },
    (ownership) => (options.wrap ?? ((removal) => removal))(ownership.remove(context))
  )
  return { context, removal: fiber, warnings }
})

const ends = (page: Model.PageEntry) => Deferred.succeed(page.closed, new Target.PageClosed({ by: "command" }))

const removed = (context: Model.ContextEntry) => Deferred.succeed(context.closed, new Target.UserContextRemoved({}))

const refusal = new Adapter.AdapterError({
  reason: { _tag: "Unsupported", capability: "close", hint: "refused in the test" }
})

/** The failure of a command whose connection was lost. */
const lost = new Adapter.AdapterError({
  reason: {
    _tag: "Protocol",
    error: new Protocol.ProtocolError({ reason: new Protocol.SessionEnded({ why: "connectionLost" }) })
  }
})

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
      const { release, warnings } = yield* releasing(() => Effect.fail(refusal))
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings, [
        "Page page-1 wasn't closed: the browser refused the command to close it (Unsupported: close (refused in the " +
        "test))"
      ])
    }).pipe(Effect.scoped))

  it.effect("stops without a word when the close fails because the connection is lost, whose loss ends the page", () =>
    Effect.gen(function*() {
      const { release, warnings } = yield* releasing(() => Effect.fail(lost))
      yield* Fiber.join(release)
      assert.deepStrictEqual(warnings, [])
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

describe("Ownership.remove", () => {
  it.effect("stops waiting at its budget, warning halfway and as it stops, and never cuts the removal short", () =>
    Effect.gen(function*() {
      const interrupted = yield* Deferred.make<void>()
      const { removal, warnings } = yield* removing(
        () => Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))),
        { pages: ["N1"] }
      )
      yield* TestClock.adjust("14 seconds")
      assert.deepStrictEqual(warnings, [])
      yield* TestClock.adjust("1 second")
      assert.deepStrictEqual(warnings, [
        "Context U2 is still being removed after 15s: the browser hasn't answered the command to remove it; its " +
        "removal waits up to 30s for the context to end"
      ])
      yield* TestClock.adjust("15 seconds")
      yield* Fiber.join(removal)
      assert.deepStrictEqual(warnings.slice(1), [
        "Context U2 didn't end within 30s of its removal: the browser hasn't answered the command to remove it; its " +
        "removal stopped waiting"
      ])
      assert.isFalse(yield* Deferred.isDone(interrupted))
    }).pipe(Effect.scoped))

  it.effect("names the pages that haven't ended once the browser has answered, and is done when the context ends", () =>
    Effect.gen(function*() {
      const { context, removal, warnings } = yield* removing(() => Effect.void, { pages: ["N1", "N2", "N3"] })
      yield* TestClock.adjust("15 seconds")
      assert.deepStrictEqual(warnings, [
        "Context U2 is still being removed after 15s: the browser answered the command to remove it, and its pages " +
        "N1, N2 and N3 haven't ended; its removal waits up to 30s for the context to end"
      ])
      yield* removed(context)
      yield* Fiber.join(removal)
      assert.strictEqual(warnings.length, 1)
    }).pipe(Effect.scoped))

  it.effect("is done at once when the context ends before the removal is answered, with no warning", () =>
    Effect.gen(function*() {
      const reply = yield* Deferred.make<void>()
      const { context, removal, warnings } = yield* removing(() => Deferred.await(reply))
      yield* TestClock.adjust("1 second")
      yield* removed(context)
      yield* Fiber.join(removal)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))

  it.effect("waits under a budget of its own, not the deadline of the operation its finalizer was added in", () =>
    Effect.gen(function*() {
      const { context, removal, warnings } = yield* removing(() => Effect.void, { wrap: Deadline.within("1 second") })
      yield* TestClock.adjust("2 seconds")
      assert.isUndefined(removal.pollUnsafe())
      yield* removed(context)
      yield* Fiber.join(removal)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))

  it.effect("sends nothing and waits for nothing once the context has ended, as it has when the connection is lost", () =>
    Effect.gen(function*() {
      let sent = 0
      const context = yield* openContext(["N1"])
      yield* Deferred.succeed(context.closed, new Target.ConnectionLost({}))
      const { fiber, warnings } = yield* running({
        removeUserContext: () => Effect.sync(() => void sent++)
      }, (ownership) => ownership.remove(context))
      yield* Fiber.join(fiber)
      assert.strictEqual(sent, 0)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))

  it.effect("stops without a word when the removal fails because the connection is lost", () =>
    Effect.gen(function*() {
      const { removal, warnings } = yield* removing(() => Effect.fail(lost), { pages: ["N1"] })
      yield* Fiber.join(removal)
      assert.deepStrictEqual(warnings, [])
    }).pipe(Effect.scoped))

  it.effect("stops waiting once the browser refuses the removal, and says so", () =>
    Effect.gen(function*() {
      const { removal, warnings } = yield* removing(() => Effect.fail(refusal))
      yield* Fiber.join(removal)
      assert.deepStrictEqual(warnings, [
        "Context U2 wasn't removed: the browser refused the command to remove it (Unsupported: close (refused in " +
        "the test))"
      ])
    }).pipe(Effect.scoped))
})
