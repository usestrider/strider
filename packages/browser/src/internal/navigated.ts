/**
 * What a navigation's event needs and `Page` doesn't (review 14, candidate 6): a navigation that got somewhere as a
 * `PageNavigation`, and the wait for the readiness `waitUntil` asks of the document it committed. `PageNavigation`
 * imports it, so it imports no `Page`.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import type * as Target from "../Target.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import type * as Model from "./model.ts"

/** A navigation that got somewhere, at `at` (where it ended); `None` for one that didn't. */
export const succeeded = (
  model: Model.Model,
  navigation: PageNavigation.Id,
  frame: Target.NavigableId,
  at: string,
  outcome: Adapter.NavigationOutcome
): Option.Option<PageNavigation.PageNavigation> => {
  const url = at as Url.Url
  switch (outcome._tag) {
    case "Committed":
      return Option.some({
        _tag: "Committed",
        id: navigation,
        frame,
        url,
        document: outcome.document,
        response: Option.flatMap(outcome.response, model.response)
      })
    case "SameDocument":
      return Option.some({
        _tag: "SameDocument",
        id: navigation,
        frame,
        url,
        document: outcome.document,
        via: outcome.via
      })
    case "Restored":
      return Option.some({ _tag: "Restored", id: navigation, frame, url, document: outcome.document })
    case "Activated":
      return Option.some({ _tag: "Activated", id: navigation, frame, url, document: outcome.document })
    default:
      return Option.none()
  }
}

/**
 * Waits for a committed document to reach `waitUntil`: `true` once it has or was replaced first, `false` at the
 * deadline, when one is given. Any other navigation needs no wait.
 */
export const reached = (
  model: Model.Model,
  result: PageNavigation.PageNavigation,
  waitUntil: PageNavigation.LoadState,
  deadline: Option.Option<MonotonicInstant.MonotonicInstant>
): Effect.Effect<boolean> => {
  if (waitUntil === "commit" || result._tag !== "Committed") return Effect.succeed(true)
  const document = model.documents.get(result.document)
  if (document === undefined) return Effect.succeed(true)
  const ready = (readiness: string) =>
    waitUntil === "load" ? readiness === "complete" : readiness === "interactive" || readiness === "complete"
  const wait = SubscriptionRef.changes(document.readiness).pipe(
    Stream.filter(ready),
    Stream.runHead,
    Effect.raceFirst(Effect.map(Deferred.await(document.ended), () => Option.none<string>())),
    Effect.as(true)
  )
  return Option.match(deadline, {
    onNone: () => wait,
    onSome: (at) => wait.pipe(BrowserClock.until(at), Effect.map(Option.getOrElse(() => false)))
  })
}
