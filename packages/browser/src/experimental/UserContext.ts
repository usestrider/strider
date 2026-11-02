/**
 * Experimental context persistence and recovery for session hosts.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Claims from "../internal/claims.ts"
import type * as Base from "../UserContext.ts"

/**
 * An opaque, serializable context claim. Store its encoded value without interpreting it.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const decode = Schema.decodeUnknownSync(UserContext.Claim)
 * void decode
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
 * const decode = Schema.decodeUnknownSync(UserContext.Claim)
 * void decode
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Claim = typeof Claim.Type

/**
 * Issues a claim for a non-default context this connection owns.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import type { UserContext as Base } from "@usestrider/browser"
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * const save = (value: Base.UserContext) => UserContext.claim(value)
 * void save
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
 * WebSocket identity, Firefox and stock WebKit fail with Unsupported.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * const create = UserContext.create({ reclaimable: true })
 * void create
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
 * Redeclare routes and init scripts in the new scope. The default context cannot be reclaimed for removal.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { UserContext } from "@usestrider/browser/experimental"
 *
 * const restore = (saved: UserContext.Claim) =>
 *   UserContext.reclaim(saved, { emulation: { locale: "en-US" } })
 * void restore
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const reclaim = (claim: Claim, options?: Base.Options | undefined) => Claims.reclaimContext(claim, options)
