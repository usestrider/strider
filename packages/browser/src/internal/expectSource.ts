/** Identity metadata for direct library expectation sources; user transformations produce new identities. */
const sources = new WeakMap<object, "SourceURL" | "SourceTitle">()

/** Register the exact value returned to the caller, without changing its public shape. */
export const mark = <A extends object>(source: A, kind: "SourceURL" | "SourceTitle"): A => {
  sources.set(source, kind)
  return source
}

/** No value inspection or inference from an operation name. */
export const kind = (source: object | undefined): "SourceURL" | "SourceTitle" | undefined =>
  source === undefined ? undefined : sources.get(source)
