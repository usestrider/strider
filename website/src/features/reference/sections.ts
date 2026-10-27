// How the reference's navigation groups modules: by the entry point they're imported from. The generated protocol
// domains come last, each closed until opened, since few readers need them and they are two thirds of the modules.

export interface Section {
  readonly title: string
  readonly description: string
  /** Shown closed in the navigation */
  readonly collapsed: boolean
}

const section = (title: string, description: string, collapsed = false): Section => ({ title, description, collapsed })

export const sections = {
  core: section("Core", "Browsers, contexts, pages, locators, expectations, events and declarations."),
  backends: section(
    "Backends",
    "A layer for each browser engine: Chromium, Firefox and WebKit, and one for any WebDriver BiDi endpoint."
  ),
  testing: section("Testing", "Support for tests under any runner, and the Vitest adapter."),
  agents: section("Agents and the CLI", "The agent toolkit, and what the `strider` command gives a segment."),
  protocol: section("Protocol", "The raw protocol: transports, connections and the client every backend runs on."),
  cdp: section("Chrome DevTools Protocol", "Generated from Chrome's protocol, one module per domain.", true),
  bidi: section(
    "WebDriver BiDi",
    "Generated from the WebDriver BiDi specification, one module for each of its modules.",
    true
  ),
  webkitAutomation: section(
    "WebKit Automation",
    "Generated from WebKit's Automation protocol in WebKitGTK's source, which drives a launched WebKit.",
    true
  ),
  webkitStock: section("WebKit inspector", "Generated from the inspector protocol in WebKitGTK's source.", true)
} as const

export type SectionKey = keyof typeof sections

export const sectionOrder: ReadonlyArray<SectionKey> = [
  "core",
  "backends",
  "testing",
  "agents",
  "protocol",
  "cdp",
  "bidi",
  "webkitAutomation",
  "webkitStock"
]

const byEntryPoint: Record<string, SectionKey> = {
  chromium: "backends",
  firefox: "backends",
  webkit: "backends",
  bidi: "backends",
  test: "testing",
  ai: "agents",
  cli: "agents",
  protocol: "protocol",
  cdp: "cdp",
  "bidi-protocol": "bidi",
  "webkit-automation-protocol": "webkitAutomation",
  "webkit-stock-protocol": "webkitStock"
}

/** The section of a module, from its package and export path (`./Page`, `./chromium/Chromium`) */
export const sectionOf = (packageName: string, exportPath: string): SectionKey => {
  if (packageName === "@usestrider/vitest") return "testing"
  const segments = exportPath.replace(/^\.\//, "").split("/")
  if (segments.length === 1) return "core"
  return byEntryPoint[segments[0]!] ?? "core"
}
