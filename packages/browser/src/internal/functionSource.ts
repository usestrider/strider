/**
 * A caller's function as the declaration an evaluation sends: its source, as a function expression.
 *
 * A method's source is what was written, `sum(a, b) { … }`, `async load() { … }`, `*items() { … }`,
 * `get size() { … }` or `[Symbol.iterator]() { … }`, which isn't an expression on its own, so the browser fails to
 * parse it. Such a source is sent as the single member of an object literal, and the declaration evaluates to that
 * member's function. The source is parsed here, never run.
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

const declarations = new WeakMap<Function, string>()

/**
 * The function expression that evaluates to `fn`: its source, if it is one; otherwise, for a method, an expression
 * that takes the method from an object literal. Any other source is sent as it is, so the browser's `SyntaxError` is
 * what the evaluation fails with.
 */
export const declaration = (fn: Function): string => {
  const known = declarations.get(fn)
  if (known !== undefined) return known
  const source = fn.toString()
  // A line break before the closing bracket ends a trailing line comment
  const found = parses(`return (${source}\n)`) || !parses(`return ({${source}\n})`)
    ? source
    : `(() => { const d = Object.getOwnPropertyDescriptors({${source}\n}); const p = d[Reflect.ownKeys(d)[0]]; return p.value ?? p.get ?? p.set })()`
  declarations.set(fn, found)
  return found
}
