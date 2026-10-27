// A laid-out signature as HTML: highlighted by Shiki in the theme code blocks use (features/code/paper.json), with
// every linked span an `<a>`. Shiki merges neighboring tokens of one color, so its tokens are cut at each link's
// edges here, and a link never depends on where Shiki happened to end a token.
import type { Highlighter, ThemeRegistration } from "shiki"
import { createHighlighter } from "shiki"
import paper from "../code/paper.json"
import type { Laid } from "./doc.ts"

let highlighter: Promise<Highlighter> | undefined

const get = () => (highlighter ??= createHighlighter({ themes: [paper as ThemeRegistration], langs: ["ts"] }))

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const attribute = (text: string) => escape(text).replace(/"/g, "&quot;")

export const signatureHtml = async ({ code, links }: Laid): Promise<string> => {
  const { tokens } = (await get()).codeToTokens(code, { lang: "ts", theme: "strider-paper" })
  const sorted = [...links].sort((a, b) => a.start - b.start)
  const lines = tokens.map((line) =>
    line.map((token) => {
      const color = token.color === undefined ? "" : ` style="color:${token.color}"`
      // The token's text, cut where a link starts or ends inside it
      let html = ""
      let at = token.offset
      const end = token.offset + token.content.length
      while (at < end) {
        const link = sorted.find((l) => l.end > at && l.start < end)
        if (link === undefined || link.start >= end) {
          html += escape(code.slice(at, end))
          break
        }
        if (link.start > at) html += escape(code.slice(at, link.start))
        const stop = Math.min(link.end, end)
        html += `<a href="${attribute(link.href)}">${escape(code.slice(Math.max(link.start, at), stop))}</a>`
        at = stop
      }
      return `<span${color}>${html}</span>`
    }).join("")
  )
  return `<pre class="signature"><code>${lines.join("\n")}</code></pre>`
}
