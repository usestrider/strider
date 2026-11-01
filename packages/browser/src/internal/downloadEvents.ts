/**
 * The downloads a page or a context starts (`Download`): which entries a filter takes. The handle each is
 * delivered as is `download.ts`.
 */
import * as Effect from "effect/Effect"
import type * as Download from "../Download.ts"
import type * as Page from "../Page.ts"
import type * as UserContext from "../UserContext.ts"
import * as EventModule from "./eventModule.ts"
import * as Filters from "./filters.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"

export const { history, next, stream } = EventModule.make<
  Page.Page | UserContext.UserContext,
  Download.Filter,
  Model.DownloadEntry,
  Download.Download
>({
  name: "Download",
  noun: "a download",
  prepare: (target, filter, operation) => {
    const found = Handles.target(target)
    const runtime = found.behind.runtime
    return Filters.requires(runtime, operation, "downloads").pipe(
      Effect.andThen(Filters.url(operation, filter?.url)),
      Effect.map((matches) => ({
        channel: found.behind.entry.events.download,
        accepts: (entry) => Filters.urlMatches(matches, entry.value.url),
        deliver: (entry) => runtime.download(entry)
      }))
    )
  }
})
