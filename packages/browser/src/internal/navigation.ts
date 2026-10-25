/**
 * A navigation's outcome as callers see it, shared by `goto`, `reload`, `back` and `forward` and by
 * `PageNavigation.next` (review 14, candidate 6), so recovery reads the same whichever way the navigation came:
 * a `PageNavigation` for one that got somewhere, and the `PageError` reason `goto` gives for one that didn't.
 * `PageNavigation` reaches it through `Runtime.settle`, since importing `Page` there would be a load cycle;
 * what needs no `Page` is in `navigated.ts`.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Diagnostics from "../Diagnostics.ts"
import * as Page from "../Page.ts"
import * as PageNavigation from "../PageNavigation.ts"
import type * as Url from "../Url.ts"
import type * as Adapter from "./adapter.ts"
import type * as Model from "./model.ts"
import * as Navigated from "./navigated.ts"
import * as Operation from "./operation.ts"

const pageError = (operation: string, reason: Page.PageErrorReason, id: Diagnostics.OperationId) =>
  new Page.PageError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/**
 * A navigation's outcome: the navigation, at `at` (where it ended), or why the page didn't get there, going to
 * `url` if that is known. A download or a 204 the caller accepts is a navigation too.
 */
export const settle = (
  model: Model.Model,
  operation: string,
  navigation: PageNavigation.Id,
  url: Option.Option<Url.Url>,
  at: string,
  outcome: Adapter.NavigationOutcome,
  id: Diagnostics.OperationId,
  accept: ReadonlyArray<"download" | "noContent"> = []
): Effect.Effect<PageNavigation.PageNavigation, Page.PageError> => {
  switch (outcome._tag) {
    case "Committed":
    case "SameDocument":
    case "Restored":
    case "Activated":
      return Effect.succeed(Option.getOrThrow(Navigated.succeeded(model, navigation, at, outcome)))
    case "Download":
      // `goto({ accept })` (review 20, candidate 1): the outcomes the caller asked for are navigations
      if (accept.includes("download")) {
        return Effect.succeed({ _tag: "BecameDownload", id: navigation, url: at as Url.Url })
      }
      return Effect.fail(pageError(
        operation,
        new PageNavigation.BecameDownload({
          url,
          hint: "The response was a download, so the page stayed where it was"
        }),
        id
      ))
    case "NoContent":
      if (accept.includes("noContent")) {
        return Effect.succeed({
          _tag: "NoContent",
          id: navigation,
          url: at as Url.Url,
          response: Option.flatMap(outcome.response, model.response)
        })
      }
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NoContent({
          url,
          hint: "The server answered without content, so the page stayed where it was"
        }),
        id
      ))
    case "Failed":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationFailed({
          url,
          netError: outcome.error,
          hint: "The browser couldn't load the page"
        }),
        id
      ))
    case "Superseded":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationSuperseded({
          url,
          by: outcome.by,
          hint: "Another navigation of the page replaced this one before it committed"
        }),
        id
      ))
    case "Canceled":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationCanceled({
          url,
          why: outcome.reason,
          hint: "The page or the browser canceled the navigation"
        }),
        id
      ))
    case "NoOp":
      return Effect.fail(pageError(
        operation,
        new PageNavigation.NavigationFailed({
          url,
          netError: `noop: ${outcome.reason}`,
          hint: "The navigation did nothing: a javascript: URL that returned no document"
        }),
        id
      ))
  }
}
