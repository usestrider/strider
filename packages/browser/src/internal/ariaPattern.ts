/**
 * `AriaPattern`s as data the engine reads (review 18, candidate 4). The public values carry no members, so their
 * data is kept here, by value.
 */
import type * as AriaPattern from "../AriaPattern.ts"
import type * as Engine from "./engine.ts"

const patterns = new WeakMap<object, Engine.Pattern>()
const children = new WeakMap<object, Engine.PatternChildren>()

export const registerPattern = <A extends AriaPattern.AriaPattern>(pattern: A, data: Engine.Pattern): A => {
  patterns.set(pattern, data)
  return pattern
}

export const registerChildren = <A extends AriaPattern.Children>(value: A, data: Engine.PatternChildren): A => {
  children.set(value, data)
  return value
}

/** A pattern's data; one this package didn't make is a bug in the caller's types, a defect. */
export const pattern = (value: AriaPattern.AriaPattern): Engine.Pattern => {
  const data = patterns.get(value)
  if (data === undefined) throw new Error("Not an AriaPattern this package made")
  return data
}

export const childrenOf = (value: AriaPattern.Children): Engine.PatternChildren => {
  const data = children.get(value)
  if (data === undefined) throw new Error("Not an AriaPattern.Children this package made")
  return data
}

const quote = (matcher: Engine.TextMatcher) =>
  matcher._tag === "String" ? JSON.stringify(matcher.value) : `/${matcher.source}/${matcher.flags}`

/** How a pattern reads in code, for an expectation's condition. */
export const describe = (data: Engine.Pattern): string => {
  if (data._tag === "Text") return `text(${quote(data.value)})`
  const inner = data.children
  const list = inner._tag === "Unchecked"
    ? "unchecked"
    : `${inner._tag === "Exactly" ? "exactly" : "including"}(${inner.patterns.map(describe).join(", ")})`
  return `node(${JSON.stringify(data.role)}, ${quote(data.name)}, ${list})`
}
