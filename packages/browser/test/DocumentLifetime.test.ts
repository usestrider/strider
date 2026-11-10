/** Document-end signals used by cleanup must settle when the owning page closes. */
import { assert, it } from "@effect/vitest"
import { Target, Url, UserContext } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Fold from "../src/internal/fold.ts"

it.effect("ends a frame document when its page closes before the frame removal arrives", () =>
  Effect.gen(function*() {
    const fold = yield* Fold.make({ release: () => Effect.void })
    const page = "page" as Target.NavigableId
    const frame = "frame" as Target.NavigableId
    const document = "frame-document" as Target.DocumentId
    yield* fold.sink({
      _tag: "PageAdded",
      page,
      context: "context" as UserContext.Id,
      kind: "tab",
      origin: { _tag: "Created" },
      url: "about:blank" as Url.Url
    })
    yield* fold.sink({ _tag: "FrameAdded", frame, parent: page, page })
    yield* fold.sink({
      _tag: "DocumentCommitted",
      document,
      navigable: frame,
      url: "https://example.test/child" as Url.Url,
      origin: "https://example.test",
      createdBy: { _tag: "Adopted" },
      replaced: Option.none(),
      evidence: "test"
    })
    const entry = Option.getOrThrow(fold.document(document))
    yield* fold.sink({
      _tag: "NavigableRemoved",
      navigable: page,
      reason: new Target.PageClosed({ by: "command" }),
      evidence: "test"
    })
    const endedAtPageClose = Deferred.isDoneUnsafe(entry.ended)
    // Backends may report a child removal after its page has already ended.
    yield* fold.sink({
      _tag: "NavigableRemoved",
      navigable: frame,
      reason: new Target.FrameDetached({}),
      evidence: "test"
    })
    assert.deepStrictEqual({
      endedAtPageClose,
      endedAfterFrameRemoval: Deferred.isDoneUnsafe(entry.ended),
      retained: Option.isSome(fold.document(document))
    }, {
      endedAtPageClose: true,
      endedAfterFrameRemoval: true,
      retained: false
    })
  }))
