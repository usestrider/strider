/**
 * Secrets' placeholders, which the agent toolkit puts values in for and the CLI's exported test builds from config:
 * a secret named `password` is written `%password%`. Only a name among the secrets is one, so other text between
 * `%` signs, such as the percent-escapes in `caf%C3%A9`, stays as written (QUIRKS.md, Q250).
 */

const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")

/**
 * Text split at the placeholders of the secrets named: the text before the first, then each placeholder's name and
 * the text after it, so the names are at the odd indexes. Text with none is one part.
 */
export const split = (text: string, names: Iterable<string>): ReadonlyArray<string> => {
  const known = [...names].filter((name) => name !== "")
  return known.length === 0 ? [text] : text.split(new RegExp(`%(${known.map(escape).join("|")})%`))
}
