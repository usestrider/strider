/**
 * The public `Url`, minted from what a browser or the model holds as a plain string.
 *
 * `Url.Url` checks what it holds, so a string becomes one here and nowhere by a cast.
 */
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Url from "../Url.ts"
import * as Spans from "./spans.ts"

/**
 * A URL a browser reported, as a `Url.Url`.
 *
 * A browser names a document it hasn't navigated by `about:blank` or, before its first commit, by an empty string,
 * which some Chromium builds write as `":"` for a popup's first frame (#207). The model treats them as one
 * placeholder, and so does this: `""` and `":"` are `about:blank`. Other strings that are not absolute URLs also
 * become `about:blank`, with a warning and a `browser.url.malformed` event on its own short-lived span unless tracing is suppressed.
 * Both diagnostics carry the original string as `browser.url.reported`.
 */
export const reported = (url: string): Url.Url => {
  if (url === "" || url === ":") return blank
  const parsed = reportedOption(url)
  if (Option.isSome(parsed)) return parsed.value
  // Event folds are synchronous inside the ingestion fiber. Keep its logger, annotations and parent span;
  // a fresh default runtime would silently send these diagnostics somewhere else.
  const diagnostic = Effect.gen(function*() {
    const attributes = { "browser.url.reported": url }
    yield* Effect.logWarning("Malformed browser-reported URL; using about:blank").pipe(Effect.annotateLogs(attributes))
    yield* Spans.event("browser.url.malformed", attributes)
  })
  const fiber = Fiber.getCurrent()
  if (fiber === undefined) Effect.runSync(diagnostic)
  else Effect.runSyncWith(fiber.context)(diagnostic)
  return blank
}

const blank = Url.Url.make("about:blank")

/**
 * A URL a browser reported where a URL is optional, such as a stack frame's script: `None` for one that isn't a URL,
 * as the name of a script run from a string is not.
 */
export const reportedOption = (url: string): Option.Option<Url.Url> => Schema.decodeUnknownOption(Url.Url)(url)
