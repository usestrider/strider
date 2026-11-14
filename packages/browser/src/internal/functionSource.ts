/**
 * A caller's function as the declaration an evaluation sends: its source, as a function expression.
 *
 * A method's source is what was written, `sum(a, b) { … }`, `async load() { … }`, `*items() { … }`,
 * `get size() { … }` or `[Symbol.iterator]() { … }`, which isn't an expression on its own, so the browser fails to
 * parse it. Such a source is sent as the method itself, an anonymous function expression: its key, and `get` or
 * `set`, are dropped, and `async` and `*` are kept, so `sum(a, b) { … }` is sent as `function (a, b) { … }`. Its
 * strictness, `this` and arguments are the method's own, and the declaration is one function expression, as WebKit's
 * check of a declaration staged in parts requires. The method's head is read as JavaScript's tokens, so a comment in
 * it, or a bracket in its key, is never taken for its parameters. The source is parsed here, never run.
 */

const parses = (body: string): boolean => {
  try {
    // Compiles the body without calling it
    new Function(body)
    return true
  } catch {
    return false
  }
}

// Callers wrap the declaration in brackets with nothing between, so this accepts what the browser compiles
const isExpression = (source: string) => parses(`return (${source})`)

const lineTerminator = /[\n\r\u2028\u2029]/
const whitespace = /[\s\uFEFF]/
const escape = String.raw`\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})`
const identifierName = new RegExp(
  String.raw`#?(?:[\p{ID_Start}$_]|${escape})(?:[\p{ID_Continue}$\u200C\u200D]|${escape})*`,
  "uy"
)
const numeric =
  /(?:0[xX][\da-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)n?/y
// After these words, as after punctuation, a `/` starts a regular expression rather than dividing
const beforeExpression = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield"
])
const closing: Record<string, string> = { "(": ")", "[": "]", "{": "}" }

/** Where the sticky pattern matches at `at`, the index after the match; otherwise -1. */
const sticky = (pattern: RegExp, source: string, at: number): number => {
  pattern.lastIndex = at
  return pattern.test(source) ? pattern.lastIndex : -1
}

/** The index after the whitespace, line terminators and comments from `at`, or -1 at an unclosed comment. */
const skipTrivia = (source: string, at: number): number => {
  let i = at
  while (i < source.length) {
    if (whitespace.test(source[i]!)) i++
    else if (source.startsWith("//", i)) {
      while (i < source.length && !lineTerminator.test(source[i]!)) i++
    } else if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2)
      if (end === -1) return -1
      i = end + 2
    } else break
  }
  return i
}

/** The index after the string literal whose quote is at `at`, or -1. */
const skipString = (source: string, at: number): number => {
  const quote = source[at]
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i]!
    if (c === "\\") i++
    else if (c === quote) return i + 1
    else if (c === "\n" || c === "\r") return -1
  }
  return -1
}

/** The index after the template literal whose backtick is at `at`, its substitutions included, or -1. */
const skipTemplate = (source: string, at: number): number => {
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i]!
    if (c === "\\") i++
    else if (c === "`") return i + 1
    else if (c === "$" && source[i + 1] === "{") {
      i = skipTo(source, i + 2, "}")
      if (i === -1) return -1
      i--
    }
  }
  return -1
}

/** The index after the regular expression literal whose `/` is at `at`, its flags included, or -1. */
const skipRegExp = (source: string, at: number): number => {
  let inClass = false
  for (let i = at + 1; i < source.length; i++) {
    const c = source[i]!
    if (c === "\\") i++
    else if (lineTerminator.test(c)) return -1
    else if (c === "[") inClass = true
    else if (c === "]") inClass = false
    else if (c === "/" && !inClass) {
      const flags = sticky(identifierName, source, i + 1)
      return flags === -1 ? i + 1 : flags
    }
  }
  return -1
}

/**
 * The index after the `close` that ends the code from `at`, across nested brackets, strings, templates, comments
 * and regular expressions, or -1 where the code doesn't read.
 */
const skipTo = (source: string, at: number, close: string): number => {
  let i = at
  let regExpAllowed = true
  while (true) {
    i = skipTrivia(source, i)
    if (i === -1 || i >= source.length) return -1
    const c = source[i]!
    if (c === close) return i + 1
    if (c in closing) {
      i = skipTo(source, i + 1, closing[c]!)
      regExpAllowed = false
    } else if (c === ")" || c === "]" || c === "}") return -1
    else if (c === "\"" || c === "'") {
      i = skipString(source, i)
      regExpAllowed = false
    } else if (c === "`") {
      i = skipTemplate(source, i)
      regExpAllowed = false
    } else if (c === "/") {
      if (regExpAllowed) {
        i = skipRegExp(source, i)
        regExpAllowed = false
      } else {
        i++
        regExpAllowed = true
      }
    } else {
      const number = sticky(numeric, source, i)
      const word = number === -1 ? sticky(identifierName, source, i) : -1
      if (number !== -1) {
        i = number
        regExpAllowed = false
      } else if (word !== -1) {
        regExpAllowed = beforeExpression.has(source.slice(i, word))
        i = word
      } else {
        i++
        regExpAllowed = true
      }
    }
    if (i === -1) return -1
  }
}

/** The index after the method key at `at`: a name, a private name, a string, a number or a computed key; or -1. */
const skipKey = (source: string, at: number): number => {
  const c = source[at]
  if (c === undefined) return -1
  if (c === "\"" || c === "'") return skipString(source, at)
  if (c === "[") return skipTo(source, at + 1, "]")
  const number = sticky(numeric, source, at)
  return number !== -1 ? number : sticky(identifierName, source, at)
}

/**
 * A method's source as an anonymous function expression, or `undefined` where there is none, as for a method that
 * uses `super`, or a source whose head doesn't read as a method's. The head is read token by token: `async` (with no
 * line break after it) and `*`, which are kept, or `get` or `set`, which are dropped; each only where the next token
 * isn't the `(` that would make it the key. Then the key, which is dropped, and the parameter list, which begins at
 * the `(` that follows it.
 */
const fromMethod = (source: string): string | undefined => {
  let i = skipTrivia(source, 0)
  if (i === -1) return undefined
  const wordAt = (at: number) => {
    const end = sticky(identifierName, source, at)
    return end === -1 ? undefined : { word: source.slice(at, end), end }
  }
  const modifier = (at: number, words: ReadonlyArray<string>, sameLine: boolean) => {
    const found = wordAt(at)
    if (found === undefined || !words.includes(found.word)) return undefined
    const next = skipTrivia(source, found.end)
    if (next === -1 || source[next] === "(") return undefined
    if (sameLine && lineTerminator.test(source.slice(found.end, next))) return undefined
    return next
  }
  const afterAsync = modifier(i, ["async"], true)
  const async = afterAsync !== undefined
  if (afterAsync !== undefined) i = afterAsync
  const generator = source[i] === "*"
  if (generator) i = skipTrivia(source, i + 1)
  else if (!async) i = modifier(i, ["get", "set"], false) ?? i
  if (i === -1) return undefined
  const key = skipKey(source, i)
  if (key === -1) return undefined
  const parameters = skipTrivia(source, key)
  if (parameters === -1 || source[parameters] !== "(") return undefined
  const candidate = `${async ? "async " : ""}function${generator ? "*" : ""} ${source.slice(parameters)}`
  return isExpression(candidate) ? candidate : undefined
}

const declarations = new WeakMap<Function, string>()

/**
 * The function expression that runs `fn`: its source, if it is one, or else, for a method, the method as an
 * anonymous function. Any other source is sent as it is, so the browser's `SyntaxError` is what the evaluation fails
 * with.
 */
export const declaration = (fn: Function): string => {
  const known = declarations.get(fn)
  if (known !== undefined) return known
  const source = fn.toString()
  const found = isExpression(source) ? source : fromMethod(source) ?? source
  declarations.set(fn, found)
  return found
}
