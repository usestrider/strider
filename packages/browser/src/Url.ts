/**
 * URLs, URL patterns, origins and sites, as branded strings.
 *
 * A `Url` is an absolute URL after WHATWG parsing. Unlike `URL`, it's immutable and equal by value, so it works as
 * a key and with `Equal`. Outputs are always branded; inputs such as `goto(url)` also take a plain string, parsed
 * when it's used, which fails at once when it's bad.
 *
 * **Gotchas**
 *
 * `effect/http` also exports a `Url` module, for working with `URL` objects, which is how a `Url` is changed. A
 * file that needs both aliases one of them.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * Schema for an absolute URL after WHATWG parsing.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Url = Schema.String.pipe(Schema.brand("~@usestrider/browser/Url/Url"))

/**
 * An absolute URL after WHATWG parsing; immutable and equal by value.
 *
 * **Details**
 *
 * To work on one, use `effect/http`'s `Url` module: `Url.fromString(url)` gives a `URL`, its setters change it,
 * and `href` is a string again.
 *
 * **Example** (Reading the path of a page's URL)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect, Result } from "effect"
 * import { Url as HttpUrl } from "effect/http"
 *
 * const pathOf = Effect.fn("pathOf")(function*(page: Page.ObservedPage) {
 *   const url = yield* page.url
 *   return HttpUrl.fromString(url).pipe(Result.map((parsed) => parsed.pathname))
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Url = typeof Url.Type

/**
 * Schema for a URL pattern: a glob such as `https://*.example.com/api/**`, or a `URLPattern` string.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Pattern = Schema.String.pipe(Schema.brand("~@usestrider/browser/Url/Pattern"))

/**
 * A URL pattern, matched against URLs and never navigated to.
 *
 * **Details**
 *
 * The string's form decides how it matches:
 *
 * - With `*`, it's a glob over the whole URL: `**` matches anything, and `*` anything but `/`.
 * - Starting with a scheme and containing `:name` groups, it's a `URLPattern`.
 * - Anything else matches that exact URL.
 *
 * An invalid pattern fails with `InvalidInput` at once.
 *
 * **Example** (Matching with a glob and a `URLPattern`)
 *
 * ```ts import.meta.vitest
 * import { NetworkRequest, Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const productLoads = Effect.fn("productLoads")(function*(page: Page.Page) {
 *   const api = yield* NetworkRequest.next(page, { url: "https://*.example.com/api/**" })
 *   const product = yield* NetworkRequest.next(page, {
 *     url: "https://shop.example.com/products/:id"
 *   })
 *   yield* page.goto("https://shop.example.com/products/42")
 *   return { api: yield* api, product: yield* product }
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Pattern = typeof Pattern.Type

/**
 * Schema for an origin: scheme, host and port, such as `https://shop.example.com`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Origin = Schema.String.pipe(Schema.brand("~@usestrider/browser/Url/Origin"))

/**
 * An origin: scheme, host and port.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Origin = typeof Origin.Type

/**
 * Schema for a site: a scheme and registrable domain, such as `https://example.com`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Site = Schema.String.pipe(Schema.brand("~@usestrider/browser/Url/Site"))

/**
 * A site: a scheme and registrable domain, as used in storage partition keys.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Site = typeof Site.Type
