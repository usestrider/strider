/** A context's navigations: every page's in it, from when a subscription starts, and no other context's. */
import { assert, describe, it } from "@effect/vitest"
import { Page, PageNavigation, Target, Url, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
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
  const navigate = Effect.fnUntraced(function*(page: string, navigation: string, url: string) {
    yield* fold.sink({
      _tag: "NavigationStarted",
      navigation: navigation as PageNavigation.Id,
      navigable: page as Target.NavigableId,
      url: url as Url.Url,
      initiatedAs: "crossDocument"
    })
    yield* fold.sink({
      _tag: "NavigationEnded",
      navigation: navigation as PageNavigation.Id,
      outcome: { _tag: "Committed", document: `${navigation}.document` as Target.DocumentId, response: Option.none() },
      evidence: "test"
    })
  })
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
  return { addPage, context, navigate, page }
})

describe("PageNavigation on a context", () => {
  it.effect("keeps every page's navigations in the context, naming the page, and none of another context's", () =>
    Effect.gen(function*() {
      const { addPage, context, navigate, page } = yield* setup()
      yield* navigate("first", "before", "https://example.com/before")
      yield* addPage("second", "context")
      yield* addPage("elsewhere", "other")
      yield* navigate("second", "later", "https://example.com/later")
      yield* navigate("elsewhere", "foreign", "https://example.com/foreign")
      yield* navigate("first", "again", "https://example.com/again")
      const seen = (yield* PageNavigation.history(context)).entries.map((each) => [each.page, each.id])
      assert.deepStrictEqual(seen, [["first", "before"], ["second", "later"], ["first", "again"]])
      // A page's own subscription sees the page's navigation as well, once
      const own = (yield* PageNavigation.history(page)).entries.map((each) => each.id)
      assert.deepStrictEqual(own, ["before", "again"])
    }))
})
