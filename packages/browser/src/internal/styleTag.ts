/**
 * `addStyleTag`: a stylesheet inserted by one call in a document's main world, which settles on the element's
 * `load` or `error`, or on the page's policy refusing it.
 *
 * Every backend reports a refusal with a `securitypolicyviolation` event before anything else: for a `<style>`, at
 * the element, followed by `error` on Chromium and WebKit and by nothing on Firefox; for a `<link>`, at the
 * document, naming the URL, followed by `error`. The call listens for it only while it waits, so nothing is set up
 * before it.
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import type * as Runtime from "./runtime.ts"

/** What the page inserts: CSS text for a `<style>`, or a URL for a `<link>`. */
export type Inserted =
  | { readonly _tag: "Inline"; readonly text: string }
  | { readonly _tag: "Url"; readonly url: string }

/** How the insertion settled, as the page reports it. */
type Settled =
  | { readonly _tag: "Applied" }
  | { readonly _tag: "Refused"; readonly directive: string }
  | { readonly _tag: "Failed" }

/** The stylesheet to insert: a path is read now, and its text names the file with `sourceURL`. */
export const resolve = Effect.fnUntraced(function*(runtime: Runtime.Runtime, tag: Page.StyleTag) {
  if ("source" in tag) return { _tag: "Inline", text: tag.source } satisfies Inserted
  if ("url" in tag) return { _tag: "Url", url: tag.url } satisfies Inserted
  if (Option.isNone(runtime.fileSystem) || Option.isNone(runtime.path)) {
    return yield* Effect.fail(
      new Reason.InvalidInput({
        input: "path",
        expected: "a stylesheet's source, where the layer has no FileSystem to read a path with",
        hint: "Provide a FileSystem and Path to the layer, or pass { source }"
      })
    )
  }
  const path = runtime.path.value.resolve(tag.path)
  const text = yield* runtime.fileSystem.value.readFileString(path).pipe(
    Effect.mapError((error) =>
      new Reason.InvalidInput({ input: "path", expected: "a readable stylesheet", hint: `${path}: ${error.message}` })
    )
  )
  return { _tag: "Inline", text: `${text}\n/*# sourceURL=${path.replaceAll("*/", "*%2F")} */` } satisfies Inserted
})

/** Runs in the page: inserts the element and settles on the first of its refusal, its load, or its error. */
export function insert(tag: Inserted): Promise<Settled> {
  return new Promise((resolve) => {
    const element = tag._tag === "Inline" ? document.createElement("style") : document.createElement("link")
    let href = ""
    if (element instanceof HTMLLinkElement && tag._tag === "Url") {
      element.rel = "stylesheet"
      element.href = tag.url
      href = element.href
    } else if (tag._tag === "Inline") {
      element.textContent = tag.text
    }
    const done = (settled: Settled) => {
      document.removeEventListener("securitypolicyviolation", refused, true)
      resolve(settled)
    }
    // A `<style>`'s refusal is dispatched at it; a `<link>`'s at the document, naming the URL, or its origin
    const refused = (event: SecurityPolicyViolationEvent) => {
      if (event.target === element || (href !== "" && event.blockedURI !== "" && href.startsWith(event.blockedURI))) {
        done({ _tag: "Refused", directive: event.effectiveDirective })
      }
    }
    document.addEventListener("securitypolicyviolation", refused, true)
    element.addEventListener("load", () => done({ _tag: "Applied" }))
    element.addEventListener("error", () => done({ _tag: "Failed" }))
    ;(document.head ?? document.documentElement).appendChild(element)
  })
}

/** The insertion's outcome, as the reason it failed with. */
export const settle = (
  tag: Inserted,
  value: unknown
): Effect.Effect<void, Reason.RefusedByPolicy | Reason.ResourceFailed> => {
  const settled = value as Settled
  switch (settled._tag) {
    case "Applied":
      return Effect.void
    case "Refused":
      return Effect.fail(
        new Reason.RefusedByPolicy({
          directive: settled.directive,
          hint: "the page's policy applies to inserted stylesheets; use a URL or source it allows"
        })
      )
    case "Failed":
      return Effect.fail(
        new Reason.ResourceFailed({
          url: tag._tag === "Url" ? tag.url : "",
          hint: "the stylesheet's element reported an error"
        })
      )
  }
}
