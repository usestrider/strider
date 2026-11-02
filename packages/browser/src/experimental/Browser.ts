/**
 * Experimental recovery of Chromium pages for session hosts.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Claims from "../internal/claims.ts"
import type * as Page from "../Page.ts"
import type * as ClaimedPage from "./Page.ts"

/**
 * The dialogs observed on the reclaimed page, without dismissing them.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Claim } from "@usestrider/browser/experimental"
 *
 * const ErrorSchema = Claim.ClaimError
 * void ErrorSchema
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Found = Schema.Struct({
  dialogs: Schema.Array(Schema.Struct({
    kind: Schema.String,
    message: Schema.String
  }))
})

/**
 * The leftover state observed while reclaiming a page.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Claim } from "@usestrider/browser/experimental"
 *
 * const ErrorSchema = Claim.ClaimError
 * void ErrorSchema
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Found = typeof Found.Type

/**
 * A reclaimed page and the state found on it. The page closes when its acquiring scope ends.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Claim } from "@usestrider/browser/experimental"
 *
 * const ErrorSchema = Claim.ClaimError
 * void ErrorSchema
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Reclaimed {
  readonly page: Page.Page
  readonly found: Found
}

/**
 * Takes ownership of a claimed Chromium tab for this scope.
 *
 * **Details**
 *
 * Identity is the browser WebSocket GUID and tab target, so page-target replacement does not lose the tab.
 * Firefox, stock WebKit and Chromium pipe connections without a WebSocket identity fail with Unsupported.
 * Leases and expiry are not provided; hosts must arrange them before enabling persistent contexts.
 *
 * **Gotchas**
 *
 * An open dialog can block Chromium's inspector enable command. Reclaim then fails at its deadline rather than
 * reporting an empty dialog list or dismissing the dialog; it has not acquired ownership when observation fails.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Browser, Page } from "@usestrider/browser/experimental"
 *
 * const restore = (saved: Page.Claim) => Browser.reclaim(saved)
 * void restore
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const reclaim = (claim: ClaimedPage.Claim) => Claims.reclaimPage(claim)
