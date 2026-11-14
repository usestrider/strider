/**
 * A caller's function as the declaration an evaluation sends: its source, as a function expression.
 *
 * A method's source is what was written, `sum(a, b) { … }`, `async load() { … }`, `*items() { … }`,
 * `get size() { … }` or `[Symbol.iterator]() { … }`, which isn't an expression on its own, so the browser fails to
 * parse it. Such a source is sent as the method itself, an anonymous function expression: its key, and `get` or
 * `set`, are dropped, and `async` and `*` are kept, so `sum(a, b) { … }` is sent as `function (a, b) { … }`. Its
 * strictness, `this` and arguments are the method's own, and the declaration is one function expression, as WebKit's
 * check of a declaration staged in parts requires. The source is parsed here, never run.
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

// A line break before the closing bracket ends a trailing line comment
const isExpression = (source: string) => parses(`return (${source}\n)`)

/**
 * A method's source as an anonymous function expression, or `undefined` where there is none, as for a method that
 * uses `super`. The parameter list is the first `(` from which the rest parses as a function; what comes before it is
 * the method's head, from which `async`, where it is a modifier rather than the key, and `*` are kept.
 */
const fromMethod = (source: string): string | undefined => {
  for (let at = source.indexOf("("); at !== -1; at = source.indexOf("(", at + 1)) {
    let head = source.slice(0, at).trimStart()
    const async = /^async\s+(?=[^\s(])/.test(head)
    if (async) head = head.replace(/^async\s+/, "")
    const generator = head.startsWith("*")
    const candidate = `${async ? "async " : ""}function${generator ? "*" : ""} ${source.slice(at)}`
    if (isExpression(candidate)) return candidate
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
