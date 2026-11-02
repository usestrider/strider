/**
 * Experimental page claims issued only for owned pages.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as Claims from "../internal/claims.ts"
import type * as Base from "../Page.ts"

/**
 * An opaque, serializable page claim. Store its encoded value without interpreting it.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const decode = Schema.decodeUnknownSync(Page.Claim)
 * void decode
 * ```
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Claim = Schema.String.pipe(Schema.brand("~@usestrider/browser/experimental/Page/Claim"))

/**
 * The opaque value of a page claim.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser/experimental"
 * import { Schema } from "effect"
 *
 * const decode = Schema.decodeUnknownSync(Page.Claim)
 * void decode
 * ```
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Claim = typeof Claim.Type

/**
 * Issues a claim for a page this connection owns. Control access alone does not give ownership.
 *
 * **Example** (Using claims)
 *
 * ```ts import.meta.vitest
 * import type { Page as Base } from "@usestrider/browser"
 * import { Page } from "@usestrider/browser/experimental"
 *
 * const save = (value: Base.Page) => Page.claim(value)
 * void save
 * ```
 *
 * @stability experimental
 * @category claims
 * @since 0.1.0
 */
export const claim = (value: Base.Page) => Claims.claimPage(value)
