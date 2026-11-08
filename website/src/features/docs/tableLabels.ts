// Give static table scroll regions the context of their preceding heading, without client-side scripting.
import type { Element, Root, RootContent } from "hast"

const text = (node: RootContent): string =>
  node.type === "text" ? node.value : "children" in node ? node.children.map(text).join("") : ""

export const tableLabels = () => (tree: Root) => {
  let heading = ""
  const walk = (parent: Root | Element): void => {
    for (const node of parent.children) {
      if (node.type !== "element") continue
      if (/^h[1-6]$/.test(node.tagName)) heading = text(node)
      if (node.tagName === "table" && heading) node.properties["data-scroll-label"] = `${heading}: table`
      walk(node)
    }
  }
  walk(tree)
}
