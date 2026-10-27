/**
 * A console call's text from its arguments, as the Console Standard's formatter makes it (QUIRKS.md,
 * Q33): `%s`, `%d`, `%i`, `%f`, `%o`, `%O` and `%c` in a first argument that is a string take the arguments after
 * it, and the rest follow, separated by spaces. Firefox applies them itself; CDP and WebKit give the arguments as
 * the page passed them, so their adapters format with this.
 */

/** One argument: how it prints, and its value where `%d`, `%i` and `%f` read it. */
export interface Argument {
  /** A string as it is; anything else as the browser describes it. */
  readonly text: string
  /** The value, where it is a string or a number. */
  readonly value: string | number | undefined
  /** Whether it is a string, which is the only kind a format can be. */
  readonly string: boolean
}

const specifier = /%[sdifoOc]/g

/** `%d` and `%i` as `parseInt` reads the value, `%f` as `parseFloat` does: anything else is `NaN`. */
const numeric = (argument: Argument, parse: (text: string) => number): string =>
  String(argument.value === undefined ? Number.NaN : parse(String(argument.value)))

/** The call's text. */
export const format = (args: ReadonlyArray<Argument>): string => {
  const [first, ...rest] = args
  if (first === undefined) return ""
  if (!first.string || rest.length === 0) return args.map((argument) => argument.text).join(" ")
  let next = 0
  const formatted = first.text.replace(specifier, (found) => {
    const argument = rest[next]
    // A specifier with no argument left stays as it is
    if (argument === undefined) return found
    next++
    switch (found) {
      case "%d":
      case "%i":
        return numeric(argument, (text) => Number.parseInt(text, 10))
      case "%f":
        return numeric(argument, Number.parseFloat)
      case "%c":
        // Styling, which text has none of
        return ""
      default:
        return argument.text
    }
  })
  return [formatted, ...rest.slice(next).map((argument) => argument.text)].join(" ")
}
