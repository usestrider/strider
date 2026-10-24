/**
 * A context's cookies.
 *
 * The jar is a sub-handle bound to its context (`context.cookies`). A `Cookie` is what a browser stores:
 * Effect's cookie attributes plus the browser-only fields, partition key and priority. Cookie values are
 * classified, so they arrive `Redacted`; `toCookie` converts to `effect/http`'s `Cookie`, unredacting the
 * value explicitly.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as DateTime from "effect/DateTime"
import type * as Effect from "effect/Effect"
import * as Cookies from "effect/http/Cookies"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Diagnostics from "./Diagnostics.ts"
import * as Reason from "./Reason.ts"
import * as Url from "./Url.ts"

/**
 * Schema for a cookie name.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Name = Schema.String.pipe(Schema.brand("~@usestrider/browser/CookieJar/Name"))

/**
 * A cookie name.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Name = typeof Name.Type

/**
 * Schema for a cookie domain, such as `.example.com`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Domain = Schema.String.pipe(Schema.brand("~@usestrider/browser/CookieJar/Domain"))

/**
 * A cookie domain, such as `.example.com`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Domain = typeof Domain.Type

/**
 * Schema for which storage partition a cookie belongs to.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const PartitionKey = Schema.Union([
  Schema.TaggedStruct("Unpartitioned", {}),
  Schema.TaggedStruct("Partitioned", {
    topLevelSite: Url.Site,
    crossSiteAncestor: Schema.Option(Schema.Boolean)
  })
])

/**
 * Which storage partition a cookie belongs to.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type PartitionKey = typeof PartitionKey.Type

/**
 * A cookie as a browser stores it.
 *
 * **Details**
 *
 * `expires` is `None` for a session cookie. The value is `Redacted`: cookie values are classified.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class Cookie extends Schema.Class<Cookie>("@usestrider/browser/CookieJar/Cookie")({
  name: Name,
  value: Schema.Redacted(Schema.String),
  domain: Domain,
  path: Schema.String,
  expires: Schema.Option(Schema.DateTimeUtc),
  httpOnly: Schema.Boolean,
  secure: Schema.Boolean,
  sameSite: Schema.Option(Schema.Literals(["strict", "lax", "none"])),
  partitionKey: PartitionKey,
  priority: Schema.Option(Schema.Literals(["low", "medium", "high"]))
}) {}

/**
 * A cookie to set.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Input {
  readonly name: Name | string
  readonly value: string | Redacted.Redacted<string>
  /**
   * Where the cookie applies, stated as a URL or as a domain and path; which one is always stated.
   */
  readonly scope:
    | { readonly _tag: "Url"; readonly url: Url.Url | string }
    | { readonly _tag: "Domain"; readonly domain: Domain | string; readonly path: string }
  /**
   * When it expires.
   *
   * @default a session cookie
   */
  readonly expires?: DateTime.DateTime.Input | undefined
  /**
   * Hide the cookie from page scripts.
   *
   * @default false
   */
  readonly httpOnly?: boolean | undefined
  /**
   * Send the cookie over HTTPS only.
   *
   * @default false
   */
  readonly secure?: boolean | undefined
  /**
   * Which cross-site requests send the cookie.
   *
   * @default "lax"
   */
  readonly sameSite?: "strict" | "lax" | "none" | undefined
  /**
   * The storage partition the cookie belongs to.
   *
   * @default Unpartitioned
   */
  readonly partitionKey?: PartitionKey | undefined
}

/**
 * Which cookies to remove.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Match {
  readonly name: Name | string
  /**
   * Remove only cookies for this domain.
   *
   * @default any domain
   */
  readonly domain?: Domain | string | undefined
  /**
   * Remove only cookies for this path.
   *
   * @default any path
   */
  readonly path?: string | undefined
}

/**
 * A context's cookies.
 *
 * **Example** (What a request would send, and setting a flag)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Page } from "@usestrider/browser"
 *
 * const enableBeta = Effect.fn("enableBeta")(function*(page: Page.Page) {
 *   const sent = yield* page.context.cookies.listFor("https://app.example.com")
 *   yield* page.context.cookies.set({ name: "beta", value: "1", scope: { _tag: "Url", url: "https://app.example.com" } })
 *   return sent.length
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieJar {
  /**
   * Every cookie in the context.
   */
  readonly list: Effect.Effect<ReadonlyArray<Cookie>, CookieJarError>
  /**
   * The cookies a request to `url` would send.
   */
  listFor(url: Url.Url | string): Effect.Effect<ReadonlyArray<Cookie>, CookieJarError>
  /**
   * Sets a cookie. A change, not a declaration: it isn't undone when a scope closes.
   */
  set(cookie: Input): Effect.Effect<void, CookieJarError>
  /**
   * Removes the cookies that match.
   */
  remove(match: Match): Effect.Effect<void, CookieJarError>
  /**
   * Removes every cookie in the context.
   */
  readonly clear: Effect.Effect<void, CookieJarError>
}

/**
 * Converts a browser cookie to `effect/http`'s `Cookie`, unredacting its value.
 *
 * @stability unstable
 * @category converting
 * @since 0.1.0
 */
export const toCookie = (cookie: Cookie): Cookies.Cookie =>
  Cookies.makeCookieUnsafe(cookie.name, Redacted.value(cookie.value), {
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    partitioned: cookie.partitionKey._tag === "Partitioned",
    ...(Option.isSome(cookie.expires) ? { expires: DateTime.toDateUtc(cookie.expires.value) } : {}),
    ...(Option.isSome(cookie.sameSite) ? { sameSite: cookie.sameSite.value } : {}),
    ...(Option.isSome(cookie.priority) ? { priority: cookie.priority.value } : {})
  })

/**
 * Schema for the reasons a cookie operation can fail.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const CookieJarErrorReason = Schema.Union([
  Reason.InvalidInput,
  Reason.NotPermitted,
  Reason.Unsupported,
  Reason.BackendFailure
])

/**
 * The reasons a cookie operation can fail.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type CookieJarErrorReason = typeof CookieJarErrorReason.Type

const CookieJarErrorTypeId = "~@usestrider/browser/CookieJar/CookieJarError"

/**
 * Error for a cookie operation that failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class CookieJarError extends Schema.TaggedError<CookieJarError>(CookieJarErrorTypeId)("CookieJarError", {
  operation: Schema.String,
  reason: CookieJarErrorReason,
  diagnostics: Diagnostics.Diagnostics
}) {
  readonly [CookieJarErrorTypeId] = CookieJarErrorTypeId
  override get message(): string {
    return `${this.operation}: ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `CookieJarError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isCookieJarError = (u: unknown): u is CookieJarError => Predicate.hasProperty(u, CookieJarErrorTypeId)
