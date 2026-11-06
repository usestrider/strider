/**
 * Errors and leftover state reported by experimental browser claims.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Diagnostics from "../Diagnostics.ts"
import * as Reason from "../Reason.ts"

/**
 * The claimed tab or context no longer exists.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Claim } from "@usestrider/browser/experimental"
 *
 * const gone = new Claim.Gone({ hint: "The saved tab has closed" })
 * console.log(gone._tag, gone.message)
 * ```
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class Gone extends Schema.Error<Gone>("@usestrider/browser/experimental/Gone")({
  _tag: Schema.tag("Gone"),
  hint: Schema.String
}) {
  override get message(): string {
    return this.hint
  }
}

/**
 * The claim belongs to another browser process.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Claim } from "@usestrider/browser/experimental"
 *
 * const other = new Claim.OtherBrowser({
 *   hint: "Connect to the browser that issued this claim"
 * })
 * console.log(other._tag, other.message)
 * ```
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class OtherBrowser extends Schema.Error<OtherBrowser>("@usestrider/browser/experimental/OtherBrowser")({
  _tag: Schema.tag("OtherBrowser"),
  hint: Schema.String
}) {
  override get message(): string {
    return this.hint
  }
}

/**
 * An experimental claim operation failed, with its reason and diagnostics.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Browser, Page } from "@usestrider/browser/experimental"
 * import { Effect } from "effect"
 *
 * const restore = (saved: Page.Claim) =>
 *   Browser.reclaim(saved).pipe(
 *     Effect.catchTag("ClaimError", (error) => Effect.succeed(error.reason._tag))
 *   )
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class ClaimError extends Schema.TaggedError<ClaimError>()("ClaimError", {
  operation: Schema.String,
  reason: Schema.Union([
    Gone,
    OtherBrowser,
    Reason.NotPermitted,
    Reason.Unsupported,
    Reason.InvalidInput,
    Reason.BackendFailure
  ]),
  diagnostics: Diagnostics.Diagnostics
}) {
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}
