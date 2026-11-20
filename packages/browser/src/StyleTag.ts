/**
 * Style tags: a stylesheet a caller adds to a page's or a frame's current document, once, with `page.addStyleTag`
 * or `frameLocator.addStyleTag`.
 *
 * - **Where.** The element is appended to the document's `<head>`, or to its root when it has none, from the
 *   document's main world, so the page's Content Security Policy applies to it.
 * - **What the call waits for.** A `<link rel="stylesheet">` from a URL: its `load` event. A `<style>` from source
 *   or a file: its `load` event too, which comes once its rules apply.
 * - **How it fails.** A URL that doesn't load fails with `ResourceFailed`; a stylesheet the page's policy refuses,
 *   from a URL or inline, fails with `RefusedByPolicy`, naming the directive. Either way the element stays in the
 *   document.
 *
 * **Gotchas**
 *
 * Unlike an init script, a style tag is added once, to the current document: a navigation doesn't bring it back.
 * The element belongs to the document, so it stays until the page's scripts remove it or the document is replaced,
 * whatever becomes of the handle. Its order among the page's own stylesheets decides which rules win. A
 * report-only policy refuses nothing.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as FilePath from "./FilePath.ts"

/**
 * Where a style tag's rules come from; which kind is always stated.
 *
 * **Details**
 *
 * - `{ url }` adds a `<link rel="stylesheet">` whose `href` is the URL, resolved against the document's.
 * - `{ source }` is CSS text, set as a `<style>` element's text.
 * - `{ path }` is a file on this machine, read when the call runs, and set as a `<style>` element's text followed
 *   by a `/*# sourceURL=… *\/` comment that names it, so developer tools show where the rules came from. It fails
 *   with `InvalidInput` unless the browser's layer was built with `FileSystem` and `Path`.
 *
 * **Example** (A theme from a URL, and a local stylesheet)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const theme = Effect.fn("theme")(function*(page: Page.Page) {
 *   yield* page.addStyleTag({ url: "https://cdn.example.com/theme.css" })
 *   yield* page.addStyleTag({ path: "./fixtures/print.css" })
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Source =
  | { readonly url: string }
  | { readonly source: string }
  | { readonly path: FilePath.Local | string }
