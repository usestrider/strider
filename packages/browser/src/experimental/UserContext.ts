/**
 * Experimental context persistence and recovery for session hosts.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Reports from "../internal/claimReports.ts"
import * as Claims from "../internal/claims.ts"
import * as Target from "../Target.ts"
import type * as Base from "../UserContext.ts"
import type * as Browser from "./Browser.ts"

/**
 * An opaque, serializable context claim. Store its encoded value without interpreting it.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const read = (json: string): UserContext.Claim =>
 *   Schema.decodeUnknownSync(UserContext.Claim)(JSON.parse(json))
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Claim = Schema.String.pipe(Schema.brand("~@usestrider/browser/experimental/UserContext/Claim"))

/**
 * The opaque value of a usercontext claim.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const read = (json: string): UserContext.Claim =>
 *   Schema.decodeUnknownSync(UserContext.Claim)(JSON.parse(json))
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Claim = typeof Claim.Type

/**
 * Issues a claim for a non-default reclaimable context this connection owns.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import type { UserContext as Base } from "@usestrider/browser"
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * import { Effect, Schema } from "effect"
 *
 * const save = Effect.fn("save")(function*(value: Base.UserContext) {
 *   const claim = yield* UserContext.claim(value)
 *   return JSON.stringify(Schema.encodeSync(UserContext.Claim)(claim))
 * })
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const claim = (value: Base.UserContext) => Claims.claimUserContext(value)

/**
 * Creates a Chromium context that survives client disconnect. Its scope still removes it on ordinary exit.
 *
 * **Gotchas**
 *
 * Session hosts must provide expiry cleanup before enabling persistence. Pipe connections without a browser
 * WebSocket identity, Firefox, and stock WebKit fail with Unsupported.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * import { Effect } from "effect"
 *
 * const create = Effect.gen(function*() {
 *   const context = yield* UserContext.create({ reclaimable: true })
 *   const claim = yield* UserContext.claim(context)
 *   return { context, claim }
 * })
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const create = (options: Base.Options & { readonly reclaimable: true }) => Claims.createContext(options)

/**
 * Takes ownership of a surviving context for this scope and applies its settings again.
 *
 * **Details**
 *
 * Returns the context and per-page observations from before setup. Redeclare routes and init scripts in the new
 * scope. The default context cannot be reclaimed for removal. Observation defaults to 1000 milliseconds per page,
 * all charged to the caller's deadline; settings application also remains within that deadline. Setup that cannot
 * complete fails without acquiring destruction ownership or deleting surviving targets. Empty contexts and contexts
 * with only Observed pages receive normal setup, including defaults when settings are omitted.
 *
 * With no settings requested and at least one Unknown page, recovery instead adopts the entire context without
 * session setup. All pages, including healthy siblings and future pages, lack automatic dialog decisions, unrouted
 * HTTP challenge forwarding, file chooser interception/cancellation, and a managed temporary download directory
 * with an allow declaration. Native browser behavior is not replaced with these defaults, and recovery does not
 * restore them automatically later. Supplied settings are all refused before ownership moves if any page is Unknown,
 * even local settings such as `eventLog` or `dialogs`, with a `UserContext.reclaim.settings` backend rejection.
 * Observation and handoff metadata options do not count as settings.
 * Pass `lastKnown` to deliver a matching context handoff snapshot; historical events stay separate from current state.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * import { Effect } from "effect"
 *
 * const restore = Effect.fn("restore")(function*(saved: UserContext.Claim) {
 *   const { context, found } = yield* UserContext.reclaim(saved, {
 *     emulation: { locale: "en-US" }
 *   })
 *   for (const page of found.pages) console.log(page.page, page.found._tag)
 *   return context
 * })
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const reclaim = (
  claim: Claim,
  options?:
    | Base.Options & {
      /** Milliseconds for each page observation, within the caller deadline. @default 1000 */
      readonly observationTimeout?: number | undefined
      /** Historical context handoff information; its claim must match this context. */
      readonly lastKnown?: Browser.LastKnown | undefined
    }
    | undefined
) => Claims.reclaimContext(claim, options)

/**
 * The pages found in a reclaimed context, each with an observed or unknown state.
 *
 * **Example** (Read context observations)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const empty = Schema.decodeUnknownSync(UserContext.Found)({ pages: [] })
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Found = Schema.Struct({
  pages: Schema.Array(Schema.Struct({ page: Target.NavigableId, found: Reports.Found }))
})

/**
 * Per-page observations from context recovery.
 *
 * **Example** (Inspect page states)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * const unknownPages = (found: UserContext.Found) =>
 *   found.pages.filter((page) => page.found._tag === "Unknown")
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Found = typeof Found.Type

/**
 * A scope-owned context and the per-page observations made before applying its settings.
 *
 * **Example** (Recover a context)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 * import { Effect } from "effect"
 *
 * const restore = Effect.fn("restore")(function*(saved: UserContext.Claim) {
 *   const { context, found } = yield* UserContext.reclaim(saved)
 *   console.log(found.pages)
 *   return context
 * })
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Reclaimed {
  readonly context: Base.UserContext
  readonly found: Found
  readonly handoff?: Browser.Handoff | undefined
  readonly lastKnown?: Browser.LastKnown | undefined
}
