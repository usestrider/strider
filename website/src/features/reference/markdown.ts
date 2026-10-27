// Renders the reference's Markdown (JSDoc sections, module comments) as blocks: HTML for prose, and code apart, so a
// page renders code through Expressive Code, as guides do. Inline code that names a declaration links to it. The
// pipeline is remark's, as effect.website's reference renders its JSDoc.
import type { Element, ElementContent, Root as HastRoot } from "hast"
import type { Root as MdastRoot, RootContent } from "mdast"
import rehypeStringify from "rehype-stringify"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"

export type Block =
  | { readonly _tag: "Html"; readonly html: string }
  | { readonly _tag: "Code"; readonly lang: string; readonly code: string; readonly title: string | undefined }

/** Where inline code such as `` `ReadonlyPage` `` or `` `Locator.click` `` links, if it names a declaration */
export type Resolve = (name: string) => string | undefined

const parser = unified().use(remarkParse).use(remarkGfm)

const toHtml = (children: Array<RootContent>, resolve: Resolve) => {
  const processor = unified().use(remarkRehype).use(() => (tree: HastRoot) => linkCode(tree, resolve)).use(
    rehypeStringify
  )
  const mdast: MdastRoot = { type: "root", children }
  return processor.stringify(processor.runSync(mdast) as HastRoot)
}

// `**Example** (Logging in)` before a fence titles it, as the JSDoc contract writes examples
const exampleTitle = (node: RootContent | undefined) => {
  if (node?.type !== "paragraph") return undefined
  const [first, second] = node.children
  if (first?.type !== "strong" || first.children[0]?.type !== "text" || first.children[0].value !== "Example") {
    return undefined
  }
  if (second === undefined) return "Example"
  return second.type === "text" ? /^\s*\((.*)\)\s*$/.exec(second.value)?.[1] : undefined
}

export const renderBlocks = (markdown: string | null | undefined, resolve: Resolve): Array<Block> => {
  if (markdown === null || markdown === undefined || markdown.trim() === "") return []
  const tree = parser.parse(markdown)
  const blocks: Array<Block> = []
  let prose: Array<RootContent> = []
  const flush = () => {
    if (prose.length > 0) blocks.push({ _tag: "Html", html: toHtml(prose, resolve) })
    prose = []
  }
  for (const node of tree.children) {
    if (node.type !== "code") {
      prose.push(node)
      continue
    }
    const title = exampleTitle(prose.at(-1))
    if (title !== undefined) prose.pop()
    flush()
    // `ts import.meta.vitest` marks an example for doctest; the language is what comes first
    blocks.push({ _tag: "Code", lang: node.lang ?? "text", code: node.value, title })
  }
  flush()
  return blocks
}

/** Inline Markdown, as one fragment of HTML: a heading's or a list's text */
export const renderInline = (markdown: string, resolve: Resolve) => {
  const tree = parser.parse(markdown)
  const html = toHtml(tree.children, resolve)
  return html.replace(/^<p>([\s\S]*)<\/p>$/, "$1")
}

const linkCode = (tree: HastRoot, resolve: Resolve) => {
  const visit = (node: HastRoot | Element, inLink: boolean) => {
    node.children = node.children.map((child): typeof child => {
      if (child.type !== "element") return child
      if (child.tagName === "pre") return child
      if (child.tagName === "code" && !inLink) {
        const text = child.children.length === 1 && child.children[0]?.type === "text" ? child.children[0].value : null
        const href = text === null ? undefined : resolve(text.replace(/\(\)$/, ""))
        if (href !== undefined) {
          const anchor: Element = { type: "element", tagName: "a", properties: { href }, children: [child] }
          return anchor as ElementContent
        }
        return child
      }
      visit(child, inLink || child.tagName === "a")
      return child
    })
  }
  visit(tree, false)
}
