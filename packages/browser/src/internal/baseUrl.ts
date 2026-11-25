/**
 * A context's `baseURL` (`UserContext.Options.baseURL`), and how what its pages are given relative resolves against
 * it. One function for each kind of input, so every operation resolves alike:
 *
 * - A URL to navigate to that parses as absolute is used as given; any other resolves as a link in a document at
 *   the base does: `/a` replaces the base's path, and `a` its last segment.
 * - A URL pattern that starts with `*` or with a scheme is used as given. Any other is joined to the part of the
 *   base it replaces, by how it starts: `//host…` takes the base's scheme, `/…` its scheme and host, `?…` the base
 *   without its query, `#…` the base without its fragment, the empty pattern the base without its fragment, keeping
 *   its path and query, and anything else the base's path up to its last `/`. Then the `.` and `..` segments of the
 *   path, before any `?` or `#`, are removed. The pattern's own text is kept as written, so its `*`, `**` and
 *   `URLPattern` syntax mean what they did. A host after `//` is written as a URL writes it, in lower case and
 *   decoded, only when that adds no pattern syntax: none of `*{}()\`, and no `:` before a letter or `_` that the
 *   written host didn't have. Otherwise it is kept as written, so a literal host means what it would in an absolute
 *   pattern: `//%2A.example/a` matches no other host. The pattern is then read as a glob, a `URLPattern` or an exact
 *   URL, as an absolute pattern is.
 * - A WebSocket route's pattern resolves the same way against the base with its `http:` made `ws:` and its `https:`
 *   made `wss:`.
 *
 * Without a base, a URL that isn't absolute doesn't parse, and a pattern is used as given.
 */
import type * as Model from "./model.ts"

const scheme = /^[a-z][a-z0-9+.-]*:/i

/** A pattern's own syntax, which a host must not hold, written or normalised, to be written as a URL writes it. */
const syntax = /[*{}()\\]/

/** A `URLPattern` named group's start, which normalising a host must not add. */
const named = /:[A-Za-z_]/g

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
    return `${parsed.protocol}//${normalised(host, parsed.protocol)}${withoutDotSegments(rest)}`
  }
  if (input.startsWith("/")) return `${authority}${withoutDotSegments(input)}`
  if (input.startsWith("?")) return `${authority}${parsed.pathname}${input}`
  // An empty pattern is the base itself, as an empty reference is in a URL
  if (input === "" || input.startsWith("#")) return `${authority}${parsed.pathname}${parsed.search}${input}`
  const directory = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)
  return `${authority}${withoutDotSegments(`${directory}${input}`)}`
}

/**
 * An authority as a URL writes it, when that adds no pattern syntax; otherwise as written, so a literal host means
 * what it would in an absolute pattern. Decoding can add syntax: `%2A` and a full-width asterisk both become `*`.
 */
const normalised = (host: string, protocol: string): string => {
  if (syntax.test(host)) return host
  const written = URL.parse(`${protocol}//${host}/`)?.host
  if (written === undefined || syntax.test(written)) return host
  return (written.match(named)?.length ?? 0) > (host.match(named)?.length ?? 0) ? host : written
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
