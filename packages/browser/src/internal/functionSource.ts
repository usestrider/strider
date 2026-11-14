/**
 * A caller's function as the declaration an evaluation sends: its source, as a function expression.
 *
 * A method's source is what was written, `sum(a, b) { … }`, `async load() { … }`, `*items() { … }`,
 * `get size() { … }` or `[Symbol.iterator]() { … }`, which isn't an expression on its own, so the browser fails to
 * parse it. Such a source is sent as the method itself, an anonymous function expression: its key, and `get` or
 * `set`, are dropped, and `async` and `*` are kept, so `sum(a, b) { … }` is sent as `function (a, b) { … }`. Its
 * strictness, `this` and arguments are the method's own, and the declaration is one function expression, as WebKit's
 * check of a declaration staged in parts requires. Where the method's key ends is left to the parser, so a comment
 * or a bracket in its key is never taken for its parameters. The source is parsed here, never run.
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
const word = /[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*/uy

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

/**
 * Whether `key` is one property name on its own. A cut at a `(` before the real key's end can't pass: it ends inside
 * a string, template, comment, regular expression or computed key's expression, which the `: 0 })` after it doesn't
 * close. Nor can a cut after it: the parser reads the real key, then a `(`, so a method, whose body and the object
 * around it the single `}` after it can't both close.
 */
const isKey = (key: string): boolean =>
  key.startsWith("#") ? parses(`return (class { ${key} = 0 })`) : parses(`return ({ ${key}: 0 })`)

/**
 * Whether the method whose head is `head`, everything before its parameter list, is of the kind whose body `body`
 * needs: `await 0` parses only in an async method, and `yield 0` only in a generator, however the head is spelled.
 * A private name's head parses only in a class, and a head such as `async constructor` only in an object literal, so
 * either may pass; in both, the body parses only for that kind.
 */
const isKind = (head: string, body: string): boolean =>
  parses(`return ({ ${head}() { ${body} } })`) || parses(`return (class { ${head}() { ${body} } })`)

/**
 * A method's source as an anonymous function expression, or `undefined` where there is none, as for a method that
 * uses `super`, or a source whose head doesn't read as a method's. The words before the key, `async`, `*`, `get` or
 * `set`, are skipped to find where the key starts, each only where the next token isn't the `(` that would make it the
 * key. The key is the text up to the first `(` that parses on its own as a property name, and the parameter list and
 * body run from that `(` to the end. Whether the function is async or a generator is left to the parser too: it is
 * read from the whole head, so a word spelled with escapes, such as `async\u0061`, is never taken for a modifier.
 */
const fromMethod = (source: string): string | undefined => {
  let i = skipTrivia(source, 0)
  if (i === -1) return undefined
  const modifier = (at: number, words: ReadonlyArray<string>, sameLine: boolean) => {
    word.lastIndex = at
    if (!word.test(source) || !words.includes(source.slice(at, word.lastIndex))) return undefined
    const end = word.lastIndex
    const next = skipTrivia(source, end)
    if (next === -1 || source[next] === "(") return undefined
    if (sameLine && lineTerminator.test(source.slice(end, next))) return undefined
    return next
  }
  const afterAsync = modifier(i, ["async"], true)
  if (afterAsync !== undefined) i = afterAsync
  if (source[i] === "*") i = skipTrivia(source, i + 1)
  else if (afterAsync === undefined) i = modifier(i, ["get", "set"], false) ?? i
  if (i === -1) return undefined
  for (let at = source.indexOf("(", i); at !== -1; at = source.indexOf("(", at + 1)) {
    if (!isKey(source.slice(i, at))) continue
    const head = source.slice(0, at)
    const async = isKind(head, "await 0")
    const generator = isKind(head, "yield 0")
    const candidate = `${async ? "async " : ""}function${generator ? "*" : ""} ${source.slice(at)}`
    return isExpression(candidate) ? candidate : undefined
  }
  return undefined
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
