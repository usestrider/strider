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
 * - `screenshots`: whether images may be sent at all.
 * - `snapshotText`: `"redacted"` masks input values and classified text.
 * - `consoleText`: console messages in full, masked, or left out.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class CapturePolicy extends Schema.Class<CapturePolicy>("effect-browser/ai/CapturePolicy")({
  screenshots: Schema.Literals(["allowed", "denied"]),
  snapshotText: Schema.Literals(["full", "redacted"]),
  consoleText: Schema.Literals(["full", "redacted", "omitted"])
}) {}

/**
 * No screenshots, redacted snapshots, and no console text: for production and untrusted pages.
 *
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export declare const strict: CapturePolicy

/**
 * Everything allowed: for local development against pages you trust.
 *
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export declare const local: CapturePolicy
