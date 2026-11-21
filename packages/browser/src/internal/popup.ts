/**
 * The popups a page opens (`Popup`): which entries a filter takes and how one is delivered.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Page from "../Page.ts"
import type * as Popup from "../Popup.ts"
import * as Reason from "../Reason.ts"
import * as EventModule from "./eventModule.ts"
import type * as Events from "./events.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

const accepts =
  (matches: Option.Option<(url: string) => boolean>) => (entry: Events.Entry<Model.PopupEvent>): boolean => {
    if (matches._tag === "None") return true
    const url = entry.value.url.getUnsafe()
    return url._tag === "Some" && matches.value(url.value)
  }

// A popup is delivered as its handle: a `Page` when the connection controls it for life, as it does an owned page's
// popups, and an observed page otherwise, `LeaveOpen`
export const { history, next, stream } = EventModule.make<
  Page.ObservedPage,
  Popup.Filter,
  Model.PopupEvent,
  Page.Page
>({
  name: "Popup",
  noun: "a popup",
  prepare: (target, filter, operation) => {
    const behind = Handles.page(target)
    // A backend that can't say which page opened a page reports no popups (QUIRKS.md, Q212)
    return Filters.requires(behind.runtime, operation, "popups.opener").pipe(
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.map((matches) => ({
        channel: behind.entry.events.popup,
        accepts: accepts(matches),
        deliver: (event: Model.PopupEvent) => behind.runtime.observed(event.page) as Page.Page
      }))
    )
  }
})

// The opener as an observed page: a popup taken over with `control` can have an opener the caller doesn't control.
// `None` once the opener closed, and once its context ended, but not after the opener alone crashed, whose handle
// still says so through `closed`
export const opener = (target: Page.ObservedPage): Effect.Effect<Option.Option<Page.ObservedPage>, Page.PageError> => {
  const behind = Handles.page(target)
  return Effect.flatMap(SubscriptionRef.get(behind.runtime.model.adapter.capabilities), (capabilities) => {
    const capability = capabilities.entries.find((each) => each.name === "popups.opener")
    // A backend that can't say which page opened a page can't tell a popup from a page no page opened (QUIRKS.md, Q212)
    if (capability !== undefined && capability.status === "unsupported") {
      return Effect.fail(
        new Page.PageError({
          operation: "Popup.opener",
          reason: new Reason.Unsupported({
            capability: "popups.opener",
            backend: behind.runtime.backend,
            hint: capability.limitations.length > 0
              ? capability.limitations.join("; ")
              : `${behind.runtime.backend} doesn't say which page opened another`
          }),
          diagnostics: Operation.diagnosticsNow()
        })
      )
    }
    const entry = behind.entry.opener
    if (entry === undefined) return Effect.succeed(Option.none())
    const status = entry.state.getUnsafe().status
    return Effect.succeed(
      status._tag === "Closed" &&
        (status.reason._tag !== "PageCrashed" || Deferred.isDoneUnsafe(entry.contextEntry.closed))
        ? Option.none()
        : Option.some(behind.runtime.observed(entry))
    )
  }).pipe(Operation.named("Popup.opener", { attributes: { "browser.page.id": behind.entry.id } }))
}
