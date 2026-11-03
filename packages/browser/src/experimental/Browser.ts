/**
 * Experimental recovery of Chromium pages for session hosts.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Reports from "../internal/claimReports.ts"
import * as Claims from "../internal/claims.ts"
import type * as Page from "../Page.ts"
import type * as ClaimedPage from "./Page.ts"

/**
 * Distinguishes observed dialog state from unknown state, without guessing why observation could not complete.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const found = Schema.decodeUnknownSync(Browser.Found)({ _tag: "Unknown" })
 * if (found._tag === "Observed") console.log(found.dialogs)
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Found = Reports.Found

/**
 * The leftover state observed while reclaiming a page.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 *
 * const messages = (found: Browser.Found) =>
 *   found._tag === "Observed" ? found.dialogs.map((dialog) => dialog.message) : undefined
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
 * import { Browser, Page } from "@usestrider/browser/experimental"
 * import { Effect } from "effect"
 *
 * const restore = Effect.fn("restore")(function*(saved: Page.Claim) {
 *   const { page, found } = yield* Browser.reclaim(saved)
 *   if (found._tag === "Unknown") yield* page.close()
 * })
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Reclaimed {
  readonly page: Page.Page
  readonly found: Found
  readonly handoff?: Handoff | undefined
  readonly lastKnown?: LastKnown | undefined
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
 * Observation has a default bound of 1000 milliseconds, charged to the caller's deadline. If observation cannot
 * complete within that bound, ownership is acquired with Unknown state, without inferring its cause or dismissing
 * anything. Caller deadline expiry and interruption still fail without acquiring ownership.
 * Last-known details and confirmed handoff dismissal events are historical data, never confirmation of current
 * state. Planned handoff may dismiss residual dialogs on the original session; reclaim never does.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Browser, Page } from "@usestrider/browser/experimental"
 * import { Effect } from "effect"
 *
 * const restore = Effect.fn("restore")(function*(saved: Page.Claim) {
 *   const { page, found, lastKnown } = yield* Browser.reclaim(saved, {
 *     observationTimeout: 1000
 *   })
 *   if (found._tag === "Observed") console.log(found.dialogs)
 *   else console.log("Current state unknown", lastKnown)
 *   return page
 * })
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const reclaim = (
  claim: ClaimedPage.Claim,
  options?: {
    /** Milliseconds available for observation, within the caller's deadline. @default 1000 */
    readonly observationTimeout?: number | undefined
    /** A snapshot captured by internal planned handoff, bound to this exact claim. */
    readonly lastKnown?: LastKnown | undefined
  } | undefined
) => Claims.reclaimPage(claim, options)

/**
 * Serializable last-known dialog details and handoff results, bound to the saved claim.
 *
 * **Example** (Store handoff details)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const encode = Schema.encodeSync(Browser.LastKnown)
 * const store = (snapshot: Browser.LastKnown) => JSON.stringify(encode(snapshot))
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const LastKnown = Reports.LastKnown

/**
 * A saved snapshot from a planned handoff.
 *
 * **Example** (Read handoff details)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const read = (json: string): Browser.LastKnown =>
 *   Schema.decodeUnknownSync(Browser.LastKnown)(JSON.parse(json))
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type LastKnown = typeof LastKnown.Type

/**
 * Confirmed dialog-dismissal events from planned handoff, separate from the reclaimed page's current state.
 *
 * **Details**
 *
 * Complete means the bounded handoff dismissal finished. Unknown means it failed or timed out; events contain
 * only dismissals already confirmed by both command reply and the dialog closing. No event means no confirmation.
 * Caller handlers may answer normally; the finalizer itself never accepts, including beforeunload dialogs.
 *
 * **Example** (Read handoff events)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const report = Schema.decodeUnknownSync(Browser.Handoff)({
 *   _tag: "Complete",
 *   events: [
 *     { _tag: "DialogDismissed", kind: "confirm", message: "Continue?" }
 *   ]
 * })
 * console.log(report.events)
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Handoff = Reports.Handoff

/**
 * A planned-handoff result containing only confirmed dismissal events.
 *
 * **Example** (Inspect handoff outcomes)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser/experimental"
 *
 * const completed = (report: Browser.Handoff) => report._tag === "Complete"
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Handoff = typeof Handoff.Type
