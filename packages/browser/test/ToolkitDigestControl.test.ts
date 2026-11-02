/** Shared contexts publish events for every tab; only explicitly controlled tabs enter this session's digest. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, ConsoleMessage, Target, UncaughtException } from "@usestrider/browser"
import { CapturePolicy } from "@usestrider/browser/ai"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { TestClock } from "effect/testing"
import * as Adapter from "../src/internal/adapter.ts"
import * as Events from "../src/internal/events.ts"
import * as Handles from "../src/internal/handles.ts"
import * as Toolkit from "../src/internal/toolkit.ts"

const digest = (session: Toolkit.Session) =>
  session.toolkit.handle("pages", {}).pipe(
    Effect.flatMap(Stream.runLast),
    Effect.map((last) => {
      const result = Option.getOrThrow(last).result
      if (!("sinceLast" in result)) return assert.fail("pages returned no digest")
      return result.sinceLast
    })
  )

describe("Shared-context digest control", () => {
  it.effect("reports page and worker events only between control and release", () =>
    Effect.gen(function*() {
      const browser = yield* Browser.Browser
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const other = yield* context.newPage
      const session = yield* Toolkit.makeSession({
        context,
        browser,
        secrets: {},
        capture: CapturePolicy.local,
        discoverContextPages: false
      })
      const publish = (source: typeof page, label: string, worker = false) =>
        Effect.sync(() => {
          const entry = Handles.page(source).entry
          const origin: Target.EventOrigin = worker
            ? { _tag: "Worker", realm: Schema.decodeUnknownSync(Target.RealmId)("owned-worker") }
            : { _tag: "Page", page: source.id }
          const message = new ConsoleMessage.ConsoleMessage({
            level: "error",
            text: label,
            location: Option.none(),
            origin,
            at: Adapter.now()
          })
          const exception = new UncaughtException.UncaughtException({
            kind: "thrown",
            name: "Error",
            message: label,
            stack: Option.none(),
            origin,
            at: Adapter.now()
          })
          // Match fold.publish: the same event goes to the owning page and to its shared context.
          Events.publish(entry.events.console, message)
          Events.publish(entry.contextEntry.events.console, message)
          Events.publish(entry.events.exception, exception)
          Events.publish(entry.contextEntry.events.exception, exception)
        })
      yield* publish(page, "before-control")
      yield* TestClock.adjust("1 millis")
      assert.deepStrictEqual(yield* digest(session), [])
      yield* session.toolkit.handle("control", { tab: String(page.id), name: "remote" }).pipe(
        Effect.flatMap(Stream.runDrain)
      )
      yield* TestClock.adjust("1 millis")
      assert.deepStrictEqual(yield* digest(session), [], "control does not replay earlier messages")
      yield* publish(page, "during-control")
      yield* publish(page, "owned-worker-error", true)
      yield* publish(other, "uncontrolled-tab")
      yield* TestClock.adjust("1 millis")
      const during = yield* digest(session)
      assert.includeMembers([...during], [
        "console error on remote: during-control",
        "uncaught Error: during-control on remote",
        "console error on a worker: owned-worker-error",
        "uncaught Error: owned-worker-error on a worker"
      ])
      assert.isFalse(during.some((line) => line.includes("uncontrolled-tab")))
      yield* session.toolkit.handle("release", { page: "remote" }).pipe(Effect.flatMap(Stream.runDrain))
      yield* publish(page, "after-release")
      yield* publish(page, "released-worker", true)
      yield* TestClock.adjust("1 millis")
      assert.deepStrictEqual(yield* digest(session), [])
      assert.deepStrictEqual(yield* session.pages, [])
    }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
})
