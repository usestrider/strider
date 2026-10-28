// Expressive Code renders every code block, guides' fences and reference examples, configured as effect.website
// configures it but drawn as the site's design draws code: highlighted in a theme of the paper palette
// (src/features/code/paper.json), framed by 1px rules, no shadow or rounding, with a mono title bar that names the file
// on the left and the language on the right. Signatures are highlighted in the same theme by
// src/features/reference/html.ts.
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections"
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers"
import { defineEcConfig, definePlugin } from "astro-expressive-code"
import night from "./src/features/code/night.json" with { type: "json" }
import paper from "./src/features/code/paper.json" with { type: "json" }

const languages = { ts: "TypeScript", tsx: "TSX", js: "JavaScript", jsx: "JSX", json: "JSON", css: "CSS", html: "HTML" }
const terminals = new Set(["sh", "bash", "shell", "zsh", "console", "powershell", "ps"])

// Every block has a title bar: an untitled one is titled with its language, or "Terminal". A titled block names its
// language at the right of the bar: "Example 1-1. first.ts … TypeScript".
const pluginTitleBar = () =>
  definePlugin({
    name: "Title bar",
    hooks: {
      preprocessMetadata: ({ codeBlock }) => {
        if (codeBlock.props.title !== undefined && codeBlock.props.title !== "") return
        const title = terminals.has(codeBlock.language) ? "Terminal" : languages[codeBlock.language]
        if (title !== undefined) codeBlock.props.title = title
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const label = languages[codeBlock.language]
        if (label === undefined || codeBlock.props.title === label) return
        const header = renderData.blockAst.children.find((child) =>
          child.type === "element" && child.tagName === "figcaption"
        )
        if (header === undefined || header.type !== "element") return
        header.children.push({
          type: "element",
          tagName: "span",
          properties: { className: ["language"] },
          children: [{ type: "text", value: label }]
        })
      }
    }
  })

export default defineEcConfig({
  plugins: [pluginCollapsibleSections(), pluginLineNumbers(), pluginTitleBar()],
  // A long line wraps, keeping its indentation, rather than scrolling
  defaultProps: { showLineNumbers: false, wrap: true, preserveIndent: true },
  // Paper by day, night.json on night paper, chosen by the data-theme BaseLayout sets
  themes: [paper, night],
  useDarkModeMediaQuery: false,
  themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
  styleOverrides: {
    borderRadius: "0",
    borderWidth: "1px",
    borderColor: "var(--ink)",
    codeFontFamily: "var(--mono)",
    codeFontSize: "0.8125rem",
    codeLineHeight: "1.65",
    codePaddingBlock: "1rem",
    codePaddingInline: "1.25rem",
    uiFontFamily: "var(--mono)",
    uiFontSize: "0.75rem",
    scrollbarThumbColor: "var(--hairline)",
    scrollbarThumbHoverColor: "var(--labels)",
    frames: {
      frameBoxShadowCssValue: "none",
      editorTabBarBackground: "var(--paper)",
      editorTabBarBorderColor: "var(--ink)",
      editorTabBarBorderBottomColor: "var(--ink)",
      editorActiveTabBackground: "transparent",
      editorActiveTabForeground: "var(--ink)",
      editorActiveTabBorderColor: "transparent",
      editorActiveTabIndicatorHeight: "0",
      editorTabBorderRadius: "0",
      editorTabsMarginBlockStart: "0",
      editorTabsMarginInlineStart: "0",
      terminalTitlebarBackground: "var(--paper)",
      terminalTitlebarForeground: "var(--ink)",
      terminalTitlebarBorderBottomColor: "var(--ink)",
      terminalTitlebarDotsOpacity: "0",
      terminalWindowFallbackTitle: "Terminal",
      inlineButtonBorder: "transparent",
      inlineButtonBackground: "transparent",
      inlineButtonForeground: "var(--labels)",
      tooltipSuccessBackground: "var(--ink)",
      tooltipSuccessForeground: "var(--paper)"
    }
  }
})
