/**
 * A context's `baseURL` (`UserContext.Options.baseURL`), and how what its pages are given relative resolves against
 * it. One function for each kind of input, so every operation resolves alike:
 *
 * - A URL to navigate to that parses as absolute is used as given; any other resolves as a link in a document at
 *   the base does: `/a` replaces the base's path, and `a` its last segment.
 * - A URL pattern that starts with `*` or with a scheme is used as given. Any other resolves against the base, its
 *   `*`, `**` and `URLPattern` syntax kept as written, before it is read as a glob, a `URLPattern` or an exact URL.
 * - A WebSocket route's pattern resolves the same way against the base with its `http:` made `ws:` and its `https:`
 *   made `wss:`.
 *
 * Without a base, a URL that isn't absolute doesn't parse, and a pattern is used as given.
 */
import type * as Model from "./model.ts"

const scheme = /^[a-z][a-z0-9+.-]*:/i

/** What a URL parser would encode or rewrite in a pattern's path, and the pattern means: globs, groups, escapes. */
const syntax = /[*{}()\\]/g

/** The base URL of a context, or of the context a page is in. */
export const of = (entry: Model.ContextEntry | Model.PageEntry): string | undefined =>
  ("contextEntry" in entry ? entry.contextEntry : entry).state.getUnsafe().settings.baseURL

/** A URL to navigate to, resolved against the base; `undefined` when it doesn't parse. */
export const url = (input: string, base: string | undefined): URL | undefined =>
  URL.parse(input) ?? (base === undefined ? null : URL.parse(input, base)) ?? undefined

/** A URL pattern resolved against the base, or as given when it starts with `*` or a scheme, or there is none. */
export const pattern = (input: string, base: string | undefined): string => {
  if (base === undefined || input.startsWith("*") || scheme.test(input)) return input
  // The pattern's own syntax is set aside for the resolution under numbered marks, which the parser keeps as they
  // are in a path, query or fragment. A mark starts absent from the input and the base, in any case and with
  // percent-escapes decoded, since a host is lowercased and decoded. The result is accepted only when it holds no
  // mark twice and none that wasn't set: otherwise the parser made one, and a longer mark is tried. A mark can go
  // only with a segment a `..` removes.
  const seen = decoded(`${input} ${base}`.toLowerCase())
  let mark = "zq"
  while (seen.includes(mark)) mark += "q"
  for (;;) {
    const kept: Array<string> = []
    const marked = input.replace(syntax, (char) => `${mark}${kept.push(char) - 1}${mark}`)
    const resolved = URL.parse(marked, base)
    if (resolved === null) return input
    const found = new RegExp(`${mark}(\\d+)${mark}`, "g")
    const indexes = Array.from(resolved.href.matchAll(found), (match) => Number(match[1]))
    if (indexes.every((index) => index < kept.length) && new Set(indexes).size === indexes.length) {
      return resolved.href.replace(found, (_, index: string) => kept[Number(index)]!)
    }
    mark += "q"
  }
}

/** Text with its percent-escapes decoded, where they decode. */
const decoded = (text: string): string =>
  text.replace(/(?:%[0-9a-f]{2})+/gi, (escapes) => {
    try {
      return decodeURIComponent(escapes)
    } catch {
      return escapes
    }
  })

/** A WebSocket route's pattern, resolved against the base with its HTTP scheme made the WebSocket one. */
export const webSocketPattern = (input: string, base: string | undefined): string => {
  const parsed = base === undefined ? null : URL.parse(base)
  if (parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
    parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:"
  }
  return pattern(input, parsed?.href)
}
