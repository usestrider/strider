/**
 * Secrets' placeholders, which the agent toolkit puts values in for and the CLI's exported test builds from config:
 * a secret named `password` is written `%password%`. Only a name among the secrets is one, so other text between
 * `%` signs, such as the percent-escapes in `caf%C3%A9`, stays as written (QUIRKS.md, Q250).
 */
import * as RegExp_ from "effect/RegExp"

/**
 * Text split at the placeholders of the secrets named: the text before the first, then each placeholder's name and
 * the text after it, so the names are at the odd indexes. Text with none is one part.
 */
export const split = (text: string, names: Iterable<string>): ReadonlyArray<string> => {
  const known = [...names].filter((name) => name !== "")
  return known.length === 0 ? [text] : text.split(new RegExp(`%(${known.map(RegExp_.escape).join("|")})%`))
}

/** One insertion, deletion or substitution; ties deliberately have no suggestion. */
const close = (left: string, right: string): boolean => {
  if (Math.abs(left.length - right.length) > 1) return false
  if (left.length > right.length) return close(right, left)
  let a = 0
  let b = 0
  let edits = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      a++
      b++
    } else {
      if (++edits > 1) return false
      if (left.length === right.length) a++
      b++
    }
  }
  return edits + (right.length - b) <= 1
}

/** Inspect original inputs only: never the values produced by secret substitution. */
export const diagnostics = (input: unknown, names: Iterable<string>): ReadonlyArray<string> => {
  const known = [...new Set(names)].filter((name) => name !== "")
  const unknown = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      // Skip configured placeholders whole, including names outside the diagnostic grammar.
      const parts = split(value, known)
      for (let index = 0; index < parts.length; index += 2) {
        const pattern = /%([A-Za-z][A-Za-z0-9_-]*)%/g
        let match: RegExpExecArray | null
        while ((match = pattern.exec(parts[index]!)) !== null) {
          const name = match[1]!
          const next = parts[index]!.slice(pattern.lastIndex, pattern.lastIndex + 2)
          if (
            /^[A-Fa-f][0-9A-Fa-f]$/.test(name) ||
            (/^[A-Fa-f][0-9A-Fa-f]/.test(name) && /^[0-9A-Fa-f]{2}$/.test(next) &&
              !known.some((candidate) => close(name, candidate)))
          ) {
            // Two hex digits are a URL escape. Also preserve escaped bytes followed by text
            // up to the next escape, as in %ACtext%20, unless a configured name is close.
            // This ambiguous syntax gives plausible typos precedence over longer escape-like text.
            // Revisit the closing percent.
            pattern.lastIndex--
          } else unknown.add(match[1]!)
        }
      }
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(visit)
    }
  }
  visit(input)
  return [...unknown].map((name) => {
    const candidates = known.filter((candidate) => close(name, candidate))
    // JSON quoting keeps arbitrary configured names on one line, including in exported comments.
    const configured = known.length === 0
      ? "none"
      : known.map((name) => JSON.stringify(name).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")).join(", ")
    const suggestion = candidates.length === 1 && /^[A-Za-z][A-Za-z0-9_-]*$/.test(candidates[0]!)
      ? ` Did you mean %${candidates[0]}%?`
      : ""
    return `%${name}% names no secret; kept as written in the input; configured: ${configured}.${suggestion}`
  })
}
