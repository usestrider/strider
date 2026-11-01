/**
 * The navigations of a page (`PageNavigation`): which entries a filter takes, and, for `next`, settling the
 * navigation until its document reaches the load state asked for.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Page from "../Page.ts"
import type * as PageNavigation from "../PageNavigation.ts"
import * as EventModule from "./eventModule.ts"
import type * as Events from "./events.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Navigated from "./navigated.ts"
import * as Operation from "./operation.ts"

const succeeded = (event: Model.NavigationEvent) =>
  event.outcome._tag === "Committed" || event.outcome._tag === "SameDocument" || event.outcome._tag === "Restored" ||
  event.outcome._tag === "Activated"

export const { history, next, stream } = EventModule.make<
  Page.ObservedPage,
  PageNavigation.NextFilter,
  Model.NavigationEvent,
  PageNavigation.PageNavigation,
  Page.PageError
>({
  name: "PageNavigation",
  noun: "a navigation",
  prepare: (target, filter, operation) => {
    const behind = Handles.page(target)
    const all = filter?.frames === "all"
    const waitUntil = filter?.waitUntil ?? "commit"
    const { model } = behind.runtime
    return Effect.map(Filters.url(operation, filter?.url), (matches) => {
      const ours = (entry: Events.Entry<Model.NavigationEvent>) => all || entry.value.frame === behind.entry.id
      return {
        channel: behind.entry.events.navigation,
        accepts: (entry: Events.Entry<Model.NavigationEvent>) =>
          ours(entry) && succeeded(entry.value) && Filters.urlMatches(matches, entry.value.url),
        // `next` also waits for a navigation that didn't get anywhere, which fails it
        waitsFor: (entry: Events.Entry<Model.NavigationEvent>) =>
          ours(entry) && Filters.urlMatches(matches, entry.value.url),
        // Only a navigation that got somewhere is delivered as one (`succeeded` accepts nothing else)
        deliver: (event: Model.NavigationEvent) =>
          Option.getOrThrow(Navigated.succeeded(model, event.navigation, event.frame, event.url, event.outcome)),
        delivery: {
          deliver: Effect.fnUntraced(function*(event: Model.NavigationEvent) {
            const result = yield* behind.runtime.settle(
              "PageNavigation.next",
              event.navigation,
              event.frame,
              Option.some(event.url),
              event.url,
              event.outcome,
              Operation.idNow()
            )
            // The deadline is `next`'s, which bounds the whole wait
            yield* Navigated.reached(model, result, waitUntil, Option.none())
            return result
          }),
          unfinished: (event: Model.NavigationEvent) =>
            `A navigation to ${event.url} committed, but its document hadn't reached ${waitUntil}`
        }
      }
    })
  },
  attributes: (filter) => ({ "browser.navigation.wait_until": filter?.waitUntil ?? "commit" })
})
