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
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Events from "../src/internal/events.ts"
import * as Handles from "../src/internal/handles.ts"
import * as Snapshots from "../src/internal/snapshot.ts"
import * as ToolkitImpl from "../src/internal/toolkit.ts"
import { ToolFailure } from "../src/internal/tools.ts"
import * as PageNavigation from "../src/PageNavigation.ts"
import * as Url from "../src/Url.ts"

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
  // Refresh answers [] when context pages aren't discovered, so a page taken with control goes unlisted
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

describe("Session with default context discovery", () => {
  it.effect("lists controlled external tabs until release or closure, excluding uncontrolled tabs", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const local = yield* context.newPage
      const external = yield* Browser.newContext()
      const page = yield* external.newPage
      const uncontrolled = yield* external.newPage
      const session = yield* ToolkitImpl.makeSession({ context, browser, secrets: {}, capture: CapturePolicy.local })
      const assertPages = Effect.fnUntraced(
        function*(ids: ReadonlyArray<Target.NavigableId>, names: ReadonlyArray<string>) {
          assert.deepStrictEqual((yield* session.pages).map((each) => each.page.id), ids)
          const listed = yield* session.toolkit.handle("pages", {}).pipe(Effect.flatMap(Stream.runLast))
          const result = Option.getOrThrow(listed).result
          if (!("outcome" in result)) return assert.fail("pages did not return an outcome")
          assert.deepStrictEqual(result.outcome.map((each) => each.page), names)
        }
      )
      yield* assertPages([local.id], ["p1"])
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* assertPages([local.id, page.id], ["p1", "remote"])
      yield* session.toolkit.handle("release", { page: "remote" }).pipe(Effect.flatMap(Stream.runDrain))
      yield* assertPages([local.id], ["p1"])
      assert.includeMembers((yield* external.pages).map((each) => each.id), [page.id, uncontrolled.id])
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* assertPages([local.id, page.id], ["p1", "remote"])
      yield* page.close()
      yield* assertPages([local.id], ["p1"])
      assert.deepStrictEqual((yield* external.pages).map((each) => each.id), [uncontrolled.id])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})

describe("Session with explicit tab control, after the tab closes", () => {
  // With discovery off, refresh lists byName, which nothing prunes when a held tab closes
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

describe("Session held-tab retirement", () => {
  const setup = Effect.gen(function*() {
    const browser = yield* Browser.Browser
    const context = yield* Browser.newContext()
    const page = yield* context.newPage
    const counts = { taken: 0, released: 0 }
    const control = page.control
    Object.defineProperty(page, "control", {
      value: Effect.andThen(
        Effect.addFinalizer(() =>
          Effect.sync(() => {
            counts.released++
          })
        ),
        Effect.andThen(
          Effect.sync(() => {
            counts.taken++
          }),
          control
        )
      )
    })
    const session = yield* ToolkitImpl.makeSession({
      context,
      browser,
      secrets: {},
      capture: CapturePolicy.local,
      discoverContextPages: false
    })
    return { counts, page, session }
  })
  const take = (session: ToolkitImpl.Session, tab: string, name: string) =>
    session.toolkit.handle("control", { tab, name }).pipe(Effect.flatMap(Stream.runDrain))

  it.effect("reports a closed tab once, by its current name", () =>
    Effect.gen(function*() {
      const { page, session } = yield* setup
      yield* take(session, String(page.id), "remote")
      yield* session.rename("remote", "renamed")
      yield* page.close()
      yield* TestClock.adjust("1 millis")
      const first = yield* session.toolkit.handle("pages", {}).pipe(Effect.flatMap(Stream.runLast))
      const result = Option.getOrThrow(first).result
      if (result instanceof ToolFailure || !("sinceLast" in result)) return assert.fail("pages returned no digest")
      assert.deepStrictEqual(result.sinceLast.filter((line) => line.includes("closed")).length, 1)
      assert.isTrue(result.sinceLast.some((line) => line.startsWith("renamed closed: ")))
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("finishes retiring a grant when its release is interrupted", () =>
    Effect.gen(function*() {
      const { counts, page, session } = yield* setup
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const control = page.control
      Object.defineProperty(page, "control", {
        value: Effect.andThen(
          Effect.addFinalizer(() => Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(finish))),
          control
        )
      })
      yield* take(session, String(page.id), "remote")
      const release = yield* session.toolkit.handle("release", { page: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain),
        Effect.forkChild
      )
      yield* Deferred.await(started)
      const interrupted = yield* Effect.forkChild(Fiber.interrupt(release))
      yield* Effect.yieldNow
      assert.isUndefined(interrupted.pollUnsafe())
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(interrupted)
      assert.strictEqual(counts.released, 1)
      assert.deepStrictEqual(yield* session.pages, [])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  // The second concurrent control overwrites the first grant, which release then leaves held
  it.effect("retires every grant when one tab is taken twice at once", () =>
    Effect.gen(function*() {
      const { counts, page, session } = yield* setup
      const tab = String(page.id)
      yield* Effect.all([take(session, tab, "remote"), take(session, tab, "remote")], { concurrency: "unbounded" })
        .pipe(
          Effect.result
        )
      yield* session.toolkit.handle("release", { page: "remote" }).pipe(Effect.flatMap(Stream.runDrain))
      assert.deepStrictEqual(yield* session.pages, [])
      assert.strictEqual(counts.released, counts.taken)
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
  for (const command of ["goto", "back"] as const) {
    it.effect(`${command} reports its navigation even when event delivery is late, but preserves a later visit`, () =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
        const { page } = yield* session.open({ name: "main" })
        const navigation = {
          _tag: "Committed" as const,
          id: Schema.decodeUnknownSync(PageNavigation.Id)("own"),
          frame: page.id,
          url: Schema.decodeUnknownSync(Url.Url)("https://example.test/same"),
          document: Schema.decodeUnknownSync(Target.DocumentId)("document"),
          response: Option.none()
        }
        Object.defineProperty(page, command, {
          value: () => Effect.succeed(command === "back" ? Option.some(navigation) : navigation)
        })
        yield* session.toolkit.handle(command, { page: "main", url: navigation.url }).pipe(
          Effect.flatMap(Stream.runDrain)
        )
        const channel = Handles.page(page).entry.events.navigation
        const publish = (id: string) =>
          Effect.sync(() =>
            Events.publish(channel, {
              navigation: Schema.decodeUnknownSync(PageNavigation.Id)(id),
              frame: page.id,
              url: navigation.url,
              outcome: { _tag: "Committed" as const, document: navigation.document, response: Option.none() }
            })
          )
        yield* publish("own")
        yield* TestClock.adjust("1 millis")
        assert.deepStrictEqual(yield* sinceLast(session), [])
        yield* publish("later")
        yield* TestClock.adjust("1 millis")
        assert.deepStrictEqual(yield* sinceLast(session), [`main navigated to ${navigation.url}`])
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }

  it.effect("a navigation drained by an overlapping call is reported once and leaves nothing retained", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const { page } = yield* session.open({ name: "main" })
      const url = Schema.decodeUnknownSync(Url.Url)("https://example.test/same")
      const document = Schema.decodeUnknownSync(Target.DocumentId)("document")
      const id = (value: string) => Schema.decodeUnknownSync(PageNavigation.Id)(value)
      const channel = Handles.page(page).entry.events.navigation
      const publish = (value: string) =>
        Effect.sync(() =>
          Events.publish(channel, {
            navigation: id(value),
            frame: page.id,
            url,
            outcome: { _tag: "Committed" as const, document, response: Option.none() }
          })
        )
      const line = `main navigated to ${url}`
      // The event comes first, a concurrent call drains it, and then the navigation's own result arrives
      for (let n = 0; n < 5; n++) {
        const release = yield* Deferred.make<void>()
        Object.defineProperty(page, "goto", {
          configurable: true,
          value: () =>
            Effect.as(Deferred.await(release), {
              _tag: "Committed" as const,
              id: id(`n${n}`),
              frame: page.id,
              url,
              document,
              response: Option.none()
            })
        })
        const own = yield* Effect.forkChild(
          Effect.map(
            Effect.flatMap(session.toolkit.handle("goto", { page: "main", url }), Stream.runLast),
            (last) => (Option.getOrThrow(last).result as { readonly sinceLast: ReadonlyArray<string> }).sinceLast
          )
        )
        yield* TestClock.adjust("1 millis")
        yield* publish(`n${n}`)
        yield* TestClock.adjust("1 millis")
        assert.deepStrictEqual(yield* sinceLast(session), [line])
        yield* Deferred.succeed(release, undefined)
        assert.deepStrictEqual(yield* Fiber.join(own), [], "reported twice")
      }
      // Nothing is waiting for an event that already came
      assert.strictEqual(session.retainedNavigations, 0, "a delivered identity is still retained")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  for (const ending of ["failure", "interruption"] as const) {
    it.effect(`an overlapping call releases delivered identities on ${ending} and only a failure reports pending events`, () =>
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
        const { page } = yield* session.open({ name: "main" })
        const url = Schema.decodeUnknownSync(Url.Url)("https://example.test/same")
        const document = Schema.decodeUnknownSync(Target.DocumentId)("document")
        const id = (value: string) => Schema.decodeUnknownSync(PageNavigation.Id)(value)
        const channel = Handles.page(page).entry.events.navigation
        const publish = (value: string) =>
          Effect.sync(() =>
            Events.publish(channel, {
              navigation: id(value),
              frame: page.id,
              url,
              outcome: { _tag: "Committed" as const, document, response: Option.none() }
            })
          )
        const line = `main navigated to ${url}`
        const release = yield* Deferred.make<void>()
        Object.defineProperty(page, "goto", {
          value: () => Deferred.await(release).pipe(Effect.andThen(Effect.fail("navigation failed")))
        })
        const own = yield* Effect.forkChild(
          session.toolkit.handle("goto", { page: "main", url }).pipe(Effect.flatMap(Stream.runDrain), Effect.exit)
        )
        yield* TestClock.adjust("1 millis")
        yield* publish("delivered")
        yield* TestClock.adjust("1 millis")
        assert.deepStrictEqual(yield* sinceLast(session), [line])
        assert.strictEqual(session.retainedNavigations, 1)
        yield* publish("pending")
        yield* TestClock.adjust("1 millis")
        if (ending === "interruption") yield* Fiber.interrupt(own)
        else {
          yield* Deferred.succeed(release, undefined)
          yield* Fiber.join(own)
        }
        assert.strictEqual(session.retainedNavigations, 0)
        // A failed call reports the pending digest itself, as main does; an interrupted one drains nothing
        assert.deepStrictEqual(yield* sinceLast(session), ending === "failure" ? [] : [line])
        // Nothing is waiting for an event that already came
        assert.strictEqual(session.retainedNavigations, 0, "a delivered identity is still retained")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }

  it.effect("a failing call that delivers a held goto's navigation leaves nothing retained", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const { page } = yield* session.open({ name: "main" })
      const url = Schema.decodeUnknownSync(Url.Url)("https://example.test/same")
      const document = Schema.decodeUnknownSync(Target.DocumentId)("document")
      const id = Schema.decodeUnknownSync(PageNavigation.Id)("held")
      const release = yield* Deferred.make<void>()
      Object.defineProperty(page, "goto", {
        value: () =>
          Effect.as(Deferred.await(release), {
            _tag: "Committed" as const,
            id,
            frame: page.id,
            url,
            document,
            response: Option.none()
          })
      })
      const own = yield* Effect.forkChild(
        Effect.map(
          Effect.flatMap(session.toolkit.handle("goto", { page: "main", url }), Stream.runLast),
          (last) => (Option.getOrThrow(last).result as { readonly sinceLast: ReadonlyArray<string> }).sinceLast
        )
      )
      yield* TestClock.adjust("1 millis")
      Events.publish(Handles.page(page).entry.events.navigation, {
        navigation: id,
        frame: page.id,
        url,
        outcome: { _tag: "Committed" as const, document, response: Option.none() }
      })
      yield* TestClock.adjust("1 millis")
      const failed = yield* session.toolkit.handle("goto", { page: "missing", url: "https://example.test/" }).pipe(
        Effect.flatMap(Stream.runLast),
        Effect.map(Option.getOrThrow)
      )
      assert.isTrue(failed.isFailure)
      assert.include(
        (failed.result as { readonly sinceLast?: ReadonlyArray<string> }).sinceLast ?? [],
        `main navigated to ${url}`
      )
      assert.strictEqual(session.retainedNavigations, 1)
      yield* Deferred.succeed(release, undefined)
      assert.deepStrictEqual(yield* Fiber.join(own), [], "reported twice")
      assert.strictEqual(session.retainedNavigations, 0)
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("a direct session open retires a navigation delivered by an overlapping tool", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const release = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const url = Schema.decodeUnknownSync(Url.Url)("https://example.test/same")
      const document = Schema.decodeUnknownSync(Target.DocumentId)("document")
      const id = Schema.decodeUnknownSync(PageNavigation.Id)("opened")
      Object.defineProperty(context, "newPage", {
        value: Effect.map(context.newPage, (page) => {
          Object.defineProperty(page, "goto", {
            value: Effect.fnUntraced(function*() {
              yield* Deferred.succeed(started, undefined)
              yield* Deferred.await(release)
              return { _tag: "Committed" as const, id, frame: page.id, url, document, response: Option.none() }
            })
          })
          return page
        })
      })
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const opening = yield* Effect.forkChild(session.open({ name: "main", url }))
      yield* Deferred.await(started)
      const page = Option.getOrThrow(session.named("main"))
      Events.publish(Handles.page(page).entry.events.navigation, {
        navigation: id,
        frame: page.id,
        url,
        outcome: { _tag: "Committed", document, response: Option.none() }
      })
      yield* TestClock.adjust("1 millis")
      assert.deepStrictEqual(yield* sinceLast(session), [`main navigated to ${url}`])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(opening)
      assert.deepStrictEqual(yield* sinceLast(session), [])
      assert.strictEqual(session.retainedNavigations, 0, "the open result retained an already delivered identity")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("a failed call reports the pending digest, and the next call doesn't repeat it", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const { page } = yield* session.open({ name: "main" })
      yield* page.goto("https://example.test/pending")
      yield* TestClock.adjust("1 millis")
      const last = yield* session.toolkit.handle("goto", { page: "missing", url: "https://example.test/" }).pipe(
        Effect.flatMap(Stream.runLast),
        Effect.map(Option.getOrThrow)
      )
      assert.isTrue(last.isFailure)
      const failure = last.result as { readonly error: string; readonly sinceLast?: ReadonlyArray<string> }
      assert.strictEqual(failure.error, "PageNotFound")
      assert.include(failure.sinceLast ?? [], "main navigated to https://example.test/pending")
      assert.deepStrictEqual(yield* sinceLast(session), [])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("opening a page preserves another page's pending and later navigation", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const { page } = yield* session.open({ name: "main" })
      yield* page.goto("https://example.test/pending")
      yield* TestClock.adjust("1 millis")
      yield* session.open({ name: "other", url: "https://example.test/other" })
      yield* TestClock.adjust("1 millis")
      assert.include(yield* sinceLast(session), "main navigated to https://example.test/pending")
      yield* page.goto("https://example.test/later")
      yield* TestClock.adjust("1 millis")
      assert.include(yield* sinceLast(session), "main navigated to https://example.test/later")
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

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

describe("Session press refusals", () => {
  it.effect("reports and drains pending navigation on a bad modifier as on a bad key", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      for (const key of ["NotAKey", "Ctrl+k"]) {
        const url = Schema.decodeUnknownSync(Url.Url)(`https://example.test/${key}`)
        Events.publish(Handles.page(page).entry.events.navigation, {
          navigation: Schema.decodeUnknownSync(PageNavigation.Id)(key),
          frame: page.id,
          url,
          outcome: {
            _tag: "Committed",
            document: Schema.decodeUnknownSync(Target.DocumentId)(key),
            response: Option.none()
          }
        })
        yield* TestClock.adjust("1 millis")
        const last = yield* session.toolkit.handle("press", { page: "p1", key }).pipe(
          Effect.flatMap(Stream.runLast),
          Effect.map(Option.getOrThrow)
        )
        assert.isTrue(last.isFailure)
        assert.include((last.result as ToolFailure).sinceLast ?? [], `p1 navigated to ${url}`, key)
        const next = yield* session.toolkit.handle("pages", {}).pipe(
          Effect.flatMap(Stream.runLast),
          Effect.map(Option.getOrThrow)
        )
        assert.deepStrictEqual((next.result as { sinceLast: ReadonlyArray<string> }).sinceLast, [])
      }
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("conceals configured secret values in bad modifier failures as in bad key failures", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({
        context,
        secrets: { password: Redacted.make("private-value") },
        capture: CapturePolicy.local
      })
      for (const key of ["private-value", "private-value+k"]) {
        const last = yield* session.toolkit.handle("press", { page: "p1", key }).pipe(
          Effect.flatMap(Stream.runLast),
          Effect.map(Option.getOrThrow)
        )
        assert.isTrue(last.isFailure)
        const failure = last.result as ToolFailure
        assert.notInclude(failure.message, "private-value", key)
        assert.include(failure.message, "%password%")
      }
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))

  it.effect("identifies a bad modifier's locator the same way as a bad key", () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext()
      yield* context.newPage
      const session = yield* ToolkitImpl.makeSession({ context, secrets: {}, capture: CapturePolicy.local })
      const prefixes: Array<string> = []
      for (const key of ["NotAKey", "Ctrl+k"]) {
        const last = yield* session.toolkit.handle("press", { page: "p1", key, target: "css=#field" }).pipe(
          Effect.flatMap(Stream.runLast),
          Effect.map(Option.getOrThrow)
        )
        assert.isTrue(last.isFailure)
        const failure = last.result as ToolFailure
        assert.strictEqual(failure.error, "LocatorError")
        assert.strictEqual(failure.reason, "InvalidInput")
        prefixes.push(failure.message.split(": Invalid")[0]!)
      }
      assert.strictEqual(prefixes[1], prefixes[0])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
