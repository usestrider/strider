/**
 * `Url.Pattern` matching, for event filters. A pattern with `*` is a glob over the whole URL: `**` matches
 * anything and `*` anything but `/`. A pattern that starts with a scheme and has `:name` groups is a
 * `URLPattern`, matched by the runtime's own. Anything else is the exact URL, written as the browser writes a URL
 * (`normalize`).
 */
import * as RegExp_ from "effect/RegExp"
import type * as Url from "../Url.ts"

const glob = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("**").map((part) => part.split("*").map(RegExp_.escape).join("[^/]*")).join(".*")}$`)

interface UrlPatternLike {
  test(input: string): boolean
}

const urlPattern = (pattern: string): UrlPatternLike => {
  const URLPattern = (globalThis as { URLPattern?: new(pattern: string) => UrlPatternLike }).URLPattern
  if (URLPattern === undefined) throw new Error(`This runtime has no URLPattern to match ${pattern} with`)
  return new URLPattern(pattern)
}

const isUrlPattern = (pattern: string): boolean =>
  /^[a-z][a-z0-9+.-]*:/i.test(pattern) && /:[a-zA-Z_]/.test(pattern.replace(/^[a-z][a-z0-9+.-]*:/i, ""))

/**
 * A pattern with its exact URL written as the browser writes it, which is how the browser reports every URL: `ws://h`
 * becomes `ws://h/`, `HTTP://H:80/` becomes `http://h/`, and a space becomes `%20`. A glob, a `URLPattern`, and an
 * exact pattern that isn't an absolute URL are returned as they are.
 */
export const normalize = (pattern: Url.Pattern | string): string =>
  pattern.includes("*") || isUrlPattern(pattern) ? pattern : URL.parse(pattern)?.href ?? pattern

/** A predicate over URLs for a pattern; an invalid one throws, which the caller reports as `InvalidInput`. */
export const compile = (pattern: Url.Pattern | string): (url: string) => boolean => {
  if (pattern.includes("*")) {
    const regex = glob(pattern)
    return (url) => regex.test(url)
  }
  if (isUrlPattern(pattern)) {
    const compiled = urlPattern(pattern)
    return (url) => compiled.test(url)
  }
  const exact = normalize(pattern)
  return (url) => url === exact
}
