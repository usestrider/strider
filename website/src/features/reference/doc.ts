// A small Wadler-style pretty printer, which lays signatures out to a width: a document is text, possibly linked,
// line breaks that are a space (or nothing) when their group fits on the line, and groups. A group breaks only if it
// doesn't fit, so short types stay on one line and long ones break at their outermost groups first.

export type Doc =
  | string
  | { readonly _tag: "Link"; readonly text: string; readonly href: string }
  | { readonly _tag: "Concat"; readonly docs: ReadonlyArray<Doc> }
  | { readonly _tag: "Group"; readonly doc: Doc; readonly broken: boolean }
  | { readonly _tag: "Indent"; readonly doc: Doc }
  | { readonly _tag: "Line"; readonly flat: string }
  | { readonly _tag: "IfBreak"; readonly broken: string; readonly flat: string }
  | { readonly _tag: "Choice"; readonly flat: Doc; readonly alternatives: ReadonlyArray<Doc> }
  | { readonly _tag: "Flat"; readonly doc: Doc }

export const link = (text: string, href: string | undefined): Doc =>
  href === undefined ? text : { _tag: "Link", text, href }

export const concat = (...docs: ReadonlyArray<Doc>): Doc => ({ _tag: "Concat", docs })

/** A group that breaks only if it doesn't fit; `broken` breaks it always, as an interface's body is */
export const group = (doc: Doc, broken = false): Doc => ({ _tag: "Group", doc, broken })

export const indent = (doc: Doc): Doc => ({ _tag: "Indent", doc })

/** A space, or a line break when its group breaks */
export const line: Doc = { _tag: "Line", flat: " " }

/** Nothing, or a line break when its group breaks */
export const softline: Doc = { _tag: "Line", flat: "" }

export const ifBreak = (broken: string, flat = ""): Doc => ({ _tag: "IfBreak", broken, flat })

/**
 * `flat` with no line broken, if it fits; otherwise the first alternative whose first line fits, or else the last,
 * whose groups break as they need to
 */
export const choice = (flat: Doc, ...alternatives: ReadonlyArray<Doc>): Doc => ({ _tag: "Choice", flat, alternatives })

/** `doc` with none of its lines broken */
export const flat = (doc: Doc): Doc => ({ _tag: "Flat", doc })

export const join = (separator: Doc, docs: ReadonlyArray<Doc>): Doc =>
  concat(...docs.flatMap((doc, i) => (i === 0 ? [doc] : [separator, doc])))

/** A bracketed list: `(a, b)` on one line, or one item a line, indented, when it doesn't fit */
export const bracketed = (open: string, items: ReadonlyArray<Doc>, close: string, separator = ","): Doc =>
  items.length === 0
    ? `${open}${close}`
    : group(concat(open, indent(concat(softline, join(concat(separator, line), items))), softline, close))

export interface Laid {
  readonly code: string
  /** Where each linked span is in `code` */
  readonly links: ReadonlyArray<{ readonly start: number; readonly end: number; readonly href: string }>
}

type Frame = readonly [indent: number, broken: boolean, doc: Doc]

/** Lays a document out to `width` columns */
export const layout = (doc: Doc, width = 96): Laid => {
  let code = ""
  let column = 0
  const links: Array<Laid["links"][number]> = []
  const stack: Array<Frame> = [[0, true, doc]]

  // Whether `next`, flat, and what follows it up to the next line break fit in `remaining` columns
  const fits = (next: Frame, remaining: number): boolean => {
    const todo: Array<Frame> = [next]
    let rest = stack.length - 1
    while (remaining >= 0) {
      const frame = todo.pop() ?? (rest >= 0 ? stack[rest--] : undefined)
      if (frame === undefined) return true
      const [i, broken, d] = frame
      if (typeof d === "string") {
        remaining -= d.length
        continue
      }
      switch (d._tag) {
        case "Link":
          remaining -= d.text.length
          break
        case "Concat":
          for (let k = d.docs.length - 1; k >= 0; k--) todo.push([i, broken, d.docs[k]!])
          break
        case "Group":
          if (d.broken) return true
          todo.push([i, broken, d.doc])
          break
        case "Indent":
          todo.push([i + 2, broken, d.doc])
          break
        case "Line":
          if (broken) return true
          remaining -= d.flat.length
          break
        case "IfBreak":
          remaining -= (broken ? d.broken : d.flat).length
          break
        case "Choice":
          todo.push([i, broken, broken ? d.alternatives.at(-1) ?? d.flat : d.flat])
          break
        case "Flat":
          todo.push([i, false, d.doc])
          break
      }
    }
    return false
  }

  while (stack.length > 0) {
    const [i, broken, d] = stack.pop()!
    if (typeof d === "string") {
      code += d
      const newline = d.lastIndexOf("\n")
      column = newline === -1 ? column + d.length : d.length - newline - 1
      continue
    }
    switch (d._tag) {
      case "Link":
        links.push({ start: code.length, end: code.length + d.text.length, href: d.href })
        code += d.text
        column += d.text.length
        break
      case "Concat":
        for (let k = d.docs.length - 1; k >= 0; k--) stack.push([i, broken, d.docs[k]!])
        break
      case "Group":
        stack.push([i, d.broken || !fits([i, false, d.doc], width - column), d.doc])
        break
      case "Indent":
        stack.push([i + 2, broken, d.doc])
        break
      case "Line":
        if (broken) {
          code = code.replace(/ +$/, "")
          code += "\n" + " ".repeat(i)
          column = i
        } else {
          code += d.flat
          column += d.flat.length
        }
        break
      case "IfBreak": {
        const text = broken ? d.broken : d.flat
        code += text
        column += text.length
        break
      }
      case "Choice": {
        if (fits([i, false, d.flat], width - column)) {
          stack.push([i, false, d.flat])
          break
        }
        const last = d.alternatives.length - 1
        const chosen = d.alternatives.find((alternative, k) =>
          k === last || fits([i, true, alternative], width - column)
        )
        stack.push([i, true, chosen ?? d.flat])
        break
      }
      case "Flat":
        stack.push([i, false, d.doc])
        break
    }
  }
  return { code, links }
}
