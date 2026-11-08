import { describe, expect, it } from "@effect/vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { assertApiLink, assertDecision, assertValueGaps } from "../../tools/docs/src/matrix-evidence.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const matrix = JSON.parse(readFileSync(`${root}website/src/features/playwright/matrix.json`, "utf8"))
const rows: Array<any> = matrix.rows
const row = (id: string) => rows.find((row) => row.id === id)

describe("Playwright matrix", () => {
  // A deliberate difference cites the decision behind it, not a whole section of the decisions document.
  it("cites a specific decision for each deliberate difference", () => {
    const sections = ["principles", "the-public-api-l2", "the-browser-model-l1"]
    const unspecific = rows.filter((row) =>
      row.status === "different" && sections.includes(row.decision?.anchor) ||
      row.status === "different" && !row.decision?.quote
    )
    expect(unspecific.map((row) => row.id)).toEqual([])
  })

  // The reference renders an anchor for each member, so a link to a member names it rather than its module's top.
  it("links a member to its own reference anchor", () => {
    expect(row("method-locator-innertext").api[0].url)
      .toBe("/docs/api/browser/Locator#ReadonlyLocator.readText")
    expect(row("method-page-pdf").api[0].url)
      .toBe("/docs/api/browser/Page#ReadonlyPage.pdf")
  })

  // Locator.isEnabled answers isDisabled; a member answered by its complement is not missing.
  it("does not mark a member missing when its complement is built", () => {
    expect(row("method-locator-isenabled").status).toBe("has")
    expect(row("method-locator-isdisabled").status).not.toBe("missing")
  })
  it("makes unsupported option values discoverable as linked missing rows", () => {
    const parent = row("option-page-goto-waituntil")
    const gaps = (parent.gaps ?? []).map(row)
    expect(
      gaps.some((gap: any) => gap?.status === "missing" && gap.value === "networkidle" && gap.option === "waitUntil")
    ).toBe(true)
  })

  it("connects patched protocol dependencies to affected capabilities", () => {
    const frames = row("event-websocket-framereceived")
    expect(frames.patches).toContain("firefox-websocket")
  })

  it("records browser access requirements on API objects as well as their methods", () => {
    expect(row("property-page-mouse").requirements?.length).toBeGreaterThan(0)
    expect(row("property-page-mouse").browsers["webkit.attached"].status).toBe("missing")
  })
  it("rejects a declared symbol linked to another real member anchor", () => {
    expect(() =>
      assertApiLink({
        module: "Page",
        symbol: "ReadonlyPage.pdf",
        url: "/docs/api/browser/Page#ReadonlyPage.screenshot"
      })
    )
      .toThrow(/symbol\/anchor mismatch/)
  })

  it("rejects a whole-section citation even with a quotation", () => {
    expect(() =>
      assertDecision({
        file: "docs/decisions.md",
        anchor: "principles",
        quote: "A launch takes an executable path. There are no channels, no"
      })
    )
      .toThrow(/section heading/)
  })

  it("rejects a quotation taken from a different decision", () => {
    expect(() =>
      assertDecision({
        file: "docs/decisions.md",
        anchor: "composable-operation-deadlines",
        quote: "A launch takes an executable path. There are no channels, no"
      })
    )
      .toThrow(/Quotation is not in decision/)
  })

  it("rejects an undiscoverable unsupported value", () => {
    const altered = structuredClone(rows)
    altered.splice(altered.findIndex((row) => row.id === "navigation-networkidle"), 1)
    expect(() => assertValueGaps(altered)).toThrow(/invalid linked value gap/)
  })
  it("rejects another chapter heading that contains separate decisions", () => {
    expect(() =>
      assertDecision({
        file: "docs/decisions.md",
        anchor: "the-protocol-layer-l0",
        quote: "A target's initialization gate never waits on another target.",
        revision: "1e1cc9a79b79d3add569911248c8969acb662b1e"
      })
    ).toThrow(/section heading/)
  })
})
