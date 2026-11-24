/**
 * Script tags: a `<script>` element a caller adds to a page's or a frame's current document, once, with
 * `page.addScriptTag` or `frameLocator.addScriptTag`.
 *
 * - **Where.** The element is appended to the document's `<head>`, or to its root when it has none, from the
 *   document's main world, so it runs among the page's own scripts and the page's Content Security Policy applies
 *   to it. A document `goto` has returned into before its parser
 *   made a root element, while the page's HTML is still arriving, has neither: the call waits for the parser to
 *   add the root, until the operation's deadline, and appends the element there.
 * - **What the call waits for.** A script from a URL: its `load` event. A classic inline script runs inside the
 *   call. An inline module: until the browser has accepted it, not until it has run, since its top-level `await`
 *   can hold it; wait on something it sets. A `type` that isn't JavaScript or a module, such as `importmap` or a
 *   data block: only the append.
 * - **How it fails.** A URL that doesn't load fails with `ResourceFailed`; a script the page's policy refuses, from
 *   a URL or inline, fails with `RefusedByPolicy`, naming the directive. Either way the element stays in the
 *   document. An inline script that throws doesn't fail the call: the page reports it as its own
 *   `UncaughtException`.
 *
 * **Gotchas**
 *
 * Unlike an init script, a script tag runs once, in the current document: a navigation doesn't bring it back.
 * On WebKit, a refusal names no script, so when an inline script that the policy allows adds another inline
 * script that it refuses, the call can't tell the refusal isn't its own: it fails with `Timeout` at its deadline,
 * though the script ran. Chromium and Firefox name the refused script and return.
 *
 * The element's text is the source given, so a policy that allows it by its hash allows it here; a `{ path }`
 * adds its `sourceURL` comment. A report-only policy refuses nothing. Page scripts can see and tamper with the
 * element, as with anything in the main world.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as FilePath from "./FilePath.ts"

/**
 * Where a script tag's code comes from; which kind is always stated.
 *
 * **Details**
 *
 * - `{ url }` sets the element's `src`, resolved against the document's URL.
 * - `{ source }` is JavaScript source text, set as the element's text.
 * - `{ path }` is a file on this machine, read when the call runs, and set as the element's text followed by a
 *   `//# sourceURL=` comment that names it. It fails with `InvalidInput` unless the browser's layer was built with
 *   `FileSystem` and `Path`.
 *
 * **Example** (A library from a URL, and a local helper)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const prepare = Effect.fn("prepare")(function*(page: Page.Page) {
 *   yield* page.addScriptTag({ url: "https://cdn.example.com/charts.js" })
 *   yield* page.addScriptTag({ path: "./fixtures/chart-helpers.js" })
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

/**
 * Settings for a script tag.
 *
 * **Example** (A module with an id)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const loadWidget = Effect.fn("loadWidget")(function*(page: Page.Page) {
 *   yield* page.addScriptTag(
 *     { source: "import { mount } from '/widget.js'; mount()" },
 *     { type: "module", id: "widget-loader" }
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options {
  /** The element's `type`, such as `"module"`. @default a classic script, with no `type` */
  readonly type?: string | undefined
  /** The element's `id`. @default none */
  readonly id?: string | undefined
}
