/**
 * The popups a page opens (`Popup`): which entries a filter takes and how one is delivered.
 */
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import type * as Page from "../Page.ts"
import type * as Popup from "../Popup.ts"
import * as EventModule from "./eventModule.ts"
import type * as Events from "./events.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

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
