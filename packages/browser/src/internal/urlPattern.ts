/**
 * `Url.Pattern` matching, for event filters. A pattern with `*` is a glob over the whole URL: `**` matches
 * anything and `*` anything but `/`. A pattern that starts with a scheme and has `:name` groups is a
 * `URLPattern`, matched by the runtime's own. Anything else is the exact URL.
 */
import type * as Url from "../Url.ts"

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\/]/g, "\\$&")

const glob = (pattern: string): RegExp =>
  new RegExp(`^${pattern.split("**").map((part) => part.split("*").map(escape).join("[^/]*")).join(".*")}$`)

interface UrlPatternLike {
  test(input: string): boolean
}

const urlPattern = (pattern: string): UrlPatternLike => {
  const URLPattern = (globalThis as { URLPattern?: new(pattern: string) => UrlPatternLike }).URLPattern
  if (URLPattern === undefined) throw new Error(`This runtime has no URLPattern to match ${pattern} with`)
  return new URLPattern(pattern)
}

/** A predicate over URLs for a pattern; an invalid one throws, which the caller reports as `InvalidInput`. */
export const compile = (pattern: Url.Pattern | string): (url: string) => boolean => {
  if (pattern.includes("*")) {
    const regex = glob(pattern)
    return (url) => regex.test(url)
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(pattern) && /:[a-zA-Z_]/.test(pattern.replace(/^[a-z][a-z0-9+.-]*:/i, ""))) {
    const compiled = urlPattern(pattern)
    return (url) => compiled.test(url)
  }
  return (url) => url === pattern
}
