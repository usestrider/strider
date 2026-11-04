/**
 * What page content may reach a model.
 *
 * Snapshots, screenshots and digests are page-derived, and a page can contain secrets or instructions aimed
 * at the model. A policy states what may leave the process before anything does.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * What snapshots, screenshots and digests may contain before they reach a model.
 *
 * **Details**
 *
 * - `screenshots`: whether images may be sent at all; `"denied"` fails the `screenshot` tool with `NotPermitted`.
 * - `snapshotText`: `"redacted"` masks names and text inside editable fields, including semantic and
 *   plaintext-only contenteditables, and names containing field content copied through descendants,
 *   embedded values, referenced controls, nearby fields or image-alt inference. Field editability is
 *   independent of semantic role. Public labels, roles, refs and states remain visible; validation messages become
 *   `•••`. Both snapshot output and `find` use this redacted tree, so hidden content cannot match a query.
 *   `"full"` keeps content, validation messages and matching against them.
 * - `consoleText`: `"full"` sends console text and exception names/messages; `"redacted"` says a message
 *   was logged without its text; `"omitted"` also leaves console errors out of `sinceLast`. Both non-full
 *   modes replace exception details in digests and history with `uncaught exception at <time>`, retaining
 *   occurrence time in monotonic nanoseconds and sending no exception name, message, stack or origin text.
 *
 * Strict capture is a bounded policy, not a secrecy or inference guarantee. Labels and ordinary page text,
 * URLs, dialogs, network and download metadata, tool arguments and failures may still contain page content.
 * A page can put sensitive text in a label or another unmasked channel. Assertions such as `expect --text`
 * and action selectors still match original content and can confirm guesses at masked values. Choose what
 * pages and tools to expose.
 * `strict` denies screenshots, redacts snapshots and omits console text. `local` keeps full capture and search.
 *
 * **Example** (Allowing screenshots but masking text)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { BrowserToolkit, CapturePolicy } from "@usestrider/browser/ai"
 * import { Effect } from "effect"
 *
 * const reviewTools = Effect.fn("reviewTools")(function*(page: Page.Page) {
 *   return yield* BrowserToolkit.make({
 *     context: page.context,
 *     secrets: {},
 *     capture: new CapturePolicy.CapturePolicy({
 *       screenshots: "allowed",
 *       snapshotText: "redacted",
 *       consoleText: "redacted"
 *     })
 *   })
 * })
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class CapturePolicy extends Schema.Class<CapturePolicy>("@usestrider/browser/ai/CapturePolicy")({
  screenshots: Schema.Literals(["allowed", "denied"]),
  snapshotText: Schema.Literals(["full", "redacted"]),
  consoleText: Schema.Literals(["full", "redacted", "omitted"])
}) {}

/**
 * No screenshots, redacted snapshots and no console text: for production and untrusted pages.
 *
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export const strict: CapturePolicy = new CapturePolicy({
  screenshots: "denied",
  snapshotText: "redacted",
  consoleText: "omitted"
})

/**
 * Everything allowed: for local development against pages you trust.
 *
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export const local: CapturePolicy = new CapturePolicy({
  screenshots: "allowed",
  snapshotText: "full",
  consoleText: "full"
})
