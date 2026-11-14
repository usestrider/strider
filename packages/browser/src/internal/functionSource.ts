/**
 * A caller's function as the declaration an evaluation sends: its source, as a function expression.
 *
 * A method's source is what was written, `sum(a, b) { … }`, `async load() { … }`, `*items() { … }`,
 * `get size() { … }` or `[Symbol.iterator]() { … }`, which isn't an expression on its own, so the browser fails to
 * parse it. Such a source is sent inside a function expression that, when called, takes the method from an object
 * literal holding that source and calls it with the same `this` and arguments. The object literal is the argument to
 * the function that takes the method out, so the method sees no name of the wrapper's own but `arguments`, which
 * every method shadows; and the declaration is one function expression, as WebKit's check of a declaration staged in
 * parts requires. The source is parsed here, never run.
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
 * The function expression that runs `fn`: its source, if it is one; otherwise, for a method, a function that calls
 * the method it takes from an object literal. Any other source is sent as it is, so the browser's `SyntaxError` is
 * what the evaluation fails with.
 */
export const declaration = (fn: Function): string => {
  const known = declarations.get(fn)
  if (known !== undefined) return known
  const source = fn.toString()
  // A line break before the closing bracket ends a trailing line comment
  const found = parses(`return (${source}\n)`) || !parses(`return ({${source}\n})`)
    ? source
    : `function() { return Reflect.apply(((o) => { const d = Object.getOwnPropertyDescriptors(o); const p = d[Reflect.ownKeys(d)[0]]; return p.value ?? p.get ?? p.set })({${source}\n}), this, arguments) }`
  declarations.set(fn, found)
  return found
}
