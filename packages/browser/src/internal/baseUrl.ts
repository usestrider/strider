/**
 * A context's `baseURL` (`UserContext.Options.baseURL`), and how what its pages are given relative resolves against
 * it. One function for each kind of input, so every operation resolves alike:
 *
 * - A URL to navigate to that parses as absolute is used as given; any other resolves as a link in a document at
 *   the base does: `/a` replaces the base's path, and `a` its last segment.
 * - A URL pattern that starts with `*` or with a scheme is used as given. Any other is joined to the part of the
 *   base it replaces, by how it starts: `//host…` takes the base's scheme, `/…` its scheme and host, `?…` the base
 *   without its query, `#…` the base without its fragment, and anything else the base's path up to its last `/`.
 *   Then the `.` and `..` segments of the path, before any `?` or `#`, are removed. The pattern's own text is kept
 *   as written, so its `*`, `**` and `URLPattern` syntax mean what they did; only a host with none of that syntax
 *   is written as a URL writes it, in lower case and decoded. It is then read as a glob, a `URLPattern` or an exact
 *   URL, as an absolute pattern is.
 * - A WebSocket route's pattern resolves the same way against the base with its `http:` made `ws:` and its `https:`
 *   made `wss:`.
 *
 * Without a base, a URL that isn't absolute doesn't parse, and a pattern is used as given.
 */
import type * as Model from "./model.ts"

const scheme = /^[a-z][a-z0-9+.-]*:/i

/** A pattern's own syntax, which a host must not hold to be written as a URL writes it. */
const syntax = /[*{}()\\]/

/** The base URL of a context, or of the context a page is in. */
export const of = (entry: Model.ContextEntry | Model.PageEntry): string | undefined =>
  ("contextEntry" in entry ? entry.contextEntry : entry).state.getUnsafe().settings.baseURL

/** A URL to navigate to, resolved against the base; `undefined` when it doesn't parse. */
export const url = (input: string, base: string | undefined): URL | undefined =>
  URL.parse(input) ?? (base === undefined ? null : URL.parse(input, base)) ?? undefined

/** A URL pattern resolved against the base, or as given when it starts with `*` or a scheme, or there is none. */
export const pattern = (input: string, base: string | undefined): string => {
  const parsed = base === undefined ? null : URL.parse(base)
  if (parsed === null || input.startsWith("*") || scheme.test(input)) return input
  const authority = `${parsed.protocol}//${parsed.host}`
  if (input.startsWith("//")) {
    const end = input.slice(2).search(/[/?#]/)
    const host = end === -1 ? input.slice(2) : input.slice(2, end + 2)
    const rest = end === -1 ? "" : input.slice(end + 2)
    const written = syntax.test(host) ? null : URL.parse(`${parsed.protocol}//${host}/`)?.host
    return `${parsed.protocol}//${written ?? host}${withoutDotSegments(rest)}`
  }
  if (input.startsWith("/")) return `${authority}${withoutDotSegments(input)}`
  if (input.startsWith("?")) return `${authority}${parsed.pathname}${input}`
  // An empty pattern is the base itself, as an empty reference is in a URL
  if (input === "" || input.startsWith("#")) return `${authority}${parsed.pathname}${parsed.search}${input}`
  const directory = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)
  return `${authority}${withoutDotSegments(`${directory}${input}`)}`
}

/** A path with its `.` and `..` segments removed (RFC 3986, 5.2.4), up to its first `?` or `#`, which stay as written. */
const withoutDotSegments = (pathAndRest: string): string => {
  const end = pathAndRest.search(/[?#]/)
  const path = end === -1 ? pathAndRest : pathAndRest.slice(0, end)
  const rest = end === -1 ? "" : pathAndRest.slice(end)
  const segments = path.split("/")
  const output: Array<string> = []
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === ".") {
      if (last) output.push("")
    } else if (segment === "..") {
      if (output.length > 1) output.pop()
      if (last) output.push("")
    } else {
      output.push(segment)
    }
  })
  return `${output.join("/")}${rest}`
}

/** A WebSocket route's pattern, resolved against the base with its HTTP scheme made the WebSocket one. */
export const webSocketPattern = (input: string, base: string | undefined): string => {
  const parsed = base === undefined ? null : URL.parse(base)
  if (parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
    parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:"
  }
  return pattern(input, parsed?.href)
}
