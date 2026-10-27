/**
 * A context's cookies: reading, setting and removing them.
 *
 * The jar is `context.cookies`. A `Cookie` is what a browser stores: Effect's cookie attributes, plus a partition
 * key and a priority. Cookie values are secrets, so they arrive `Redacted`; `toCookie` converts a cookie to
 * `effect/http`'s `Cookie`, unredacting its value.
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
import type * as Deadline from "./Deadline.ts"
import * as Diagnostics from "./Diagnostics.ts"
import * as ReasonCause from "./internal/reasonCause.ts"
import * as Reason from "./Reason.ts"
import type * as Target from "./Target.ts"
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
 * `expires` is `None` for a session cookie. The value is `Redacted`; `Redacted.value` reads it.
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
   * Where the cookie applies: a URL, or a domain and path.
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
 * **Gotchas**
 *
 * On WebKit, `list` and `listFor` give only the cookies the context's open pages were sent, and `remove` and
 * `clear` remove only those (`cookies` is partial there).
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface CookieJar {
  /**
   * Every cookie in the context.
   *
   * **Example** (Reading the session cookie)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect, Redacted } from "effect"
   *
   * const sessionId = Effect.fn("sessionId")(function*(page: Page.Page) {
   *   const cookies = yield* page.context.cookies.list
   *   const session = cookies.find((cookie) => cookie.name === "session")
   *   return session === undefined ? undefined : Redacted.value(session.value)
   * })
   * ```
   */
  readonly list: Effect.Effect<ReadonlyArray<Cookie>, CookieJarError | Target.TargetGone | Deadline.Timeout>
  /**
   * The cookies a request to `url` would send.
   *
   * **Example** (Listing what a request would send)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const sentNames = Effect.fn("sentNames")(function*(page: Page.Page) {
   *   const sent = yield* page.context.cookies.listFor("https://app.example.com/account")
   *   return sent.map((cookie) => cookie.name)
   * })
   * ```
   */
  listFor(
    url: Url.Url | string
  ): Effect.Effect<ReadonlyArray<Cookie>, CookieJarError | Target.TargetGone | Deadline.Timeout>
  /**
   * Sets a cookie. A change, not a declaration: it isn't undone when a scope closes.
   *
   * **Example** (Turning on a beta flag)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const enableBeta = Effect.fn("enableBeta")(function*(page: Page.Page) {
   *   yield* page.context.cookies.set({
   *     name: "beta",
   *     value: "1",
   *     scope: { _tag: "Url", url: "https://app.example.com" }
   *   })
   *   yield* page.goto("https://app.example.com")
   * })
   * ```
   */
  set(cookie: Input): Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes the cookies that match.
   *
   * **Example** (Forgetting a cookie consent)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const forgetConsent = Effect.fn("forgetConsent")(function*(page: Page.Page) {
   *   yield* page.context.cookies.remove({ name: "consent" })
   *   yield* page.goto("https://shop.example.com")
   * })
   * ```
   */
  remove(match: Match): Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>
  /**
   * Removes every cookie in the context.
   *
   * **Example** (Visiting an account page signed out)
   *
   * ```ts import.meta.vitest
   * import { Page } from "@usestrider/browser"
   * import { Effect } from "effect"
   *
   * const visitSignedOut = Effect.fn("visitSignedOut")(function*(page: Page.Page) {
   *   yield* page.context.cookies.clear
   *   yield* page.goto("https://app.example.com/account")
   * })
   * ```
   */
  readonly clear: Effect.Effect<void, CookieJarError | Target.TargetGone | Deadline.Timeout>
}

/**
 * Converts a browser cookie to `effect/http`'s `Cookie`, unredacting its value.
 *
 * **Example** (Calling an API with the page's session)
 *
 * ```ts import.meta.vitest
 * import { CookieJar, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 * import { Cookies, HttpClient, HttpClientRequest } from "effect/http"
 *
 * const fetchAccount = Effect.fn("fetchAccount")(function*(page: Page.Page) {
 *   const url = "https://app.example.com/api/account"
 *   const cookies = Cookies.fromIterable(
 *     (yield* page.context.cookies.listFor(url)).map(CookieJar.toCookie)
 *   )
 *   const header = Cookies.toCookieHeader(cookies)
 *   return yield* HttpClient.execute(
 *     HttpClientRequest.get(url).pipe(HttpClientRequest.setHeader("cookie", header))
 *   )
 * })
 * ```
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
  override get cause(): unknown {
    return ReasonCause.of(this.reason)
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
