/** A wait whose event came just before its target ended gets the event, not `TargetGone`. */
import { assert, describe, it } from "@effect/vitest"
import { ConsoleMessage, Page, Target, Url, UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"
import * as Handles from "../src/internal/handles.ts"
import type * as Runtime from "../src/internal/runtime.ts"

describe("Event waits at their target's end", () => {
  it.effect("delivers a console message that came just before its page closed", () =>
    Effect.gen(function*() {
      const fold = yield* Fold.make({ release: () => Effect.void })
      const id = "page" as Target.NavigableId
      yield* fold.sink({
        _tag: "PageAdded",
        page: id,
        context: "context" as UserContext.Id,
        kind: "tab",
        origin: { _tag: "Created" },
        url: "about:blank" as Url.Url
      })
      const page = {} as Page.Page
      Handles.registerPage(page, {
        runtime: { model: fold } as unknown as Runtime.Runtime,
        entry: Option.getOrThrow(fold.page(id)),
        grant: Option.none()
      })
      const message = yield* ConsoleMessage.next(page)
      yield* fold.sink({
        _tag: "ConsoleMessage",
        realm: Option.none(),
        message: new ConsoleMessage.ConsoleMessage({
          level: "log",
          text: "last words",
          location: Option.none(),
          origin: { _tag: "Page", page: id },
          source: { _tag: "Page" },
          at: 0 as ConsoleMessage.ConsoleMessage["at"],
          timestamp: DateTime.makeUnsafe(0)
        })
      })
      yield* fold.sink({
        _tag: "NavigableRemoved",
        navigable: id,
        reason: new Target.PageClosed({ by: "command" }),
        evidence: "test"
      })
      assert.strictEqual((yield* message).text, "last words")
    }))
})
