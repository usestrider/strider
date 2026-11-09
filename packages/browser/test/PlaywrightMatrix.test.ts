import { describe, expect, it } from "@effect/vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { assertApiLink, assertDecision, assertValueGaps } from "../../tools/docs/src/matrix-evidence.ts"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const output = mkdtempSync(`${tmpdir()}/strider-matrix-capabilities-`)
let matrix: any
try {
  execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import { capabilities } from "./packages/tools/docs/src/capabilities.mjs"
    import { deriveMatrix, loadCuratedMatrix } from "./scripts/playwright-matrix/data.mjs"
    import { readFileSync, writeFileSync } from "node:fs"
    const output = process.argv[1]
    await capabilities(process.cwd(), output)
    writeFileSync(output + "/matrix.json", JSON.stringify(deriveMatrix(loadCuratedMatrix(),
      JSON.parse(readFileSync(output + "/capabilities.json", "utf8")))))
  `,
    output
  ], { cwd: root })
  matrix = JSON.parse(readFileSync(`${output}/matrix.json`, "utf8"))
} finally {
  rmSync(output, { recursive: true, force: true })
}
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
  it("recognizes navigation attribution already present in request snapshots", () => {
    expect(row("method-request-isnavigationrequest").status).toBe("has")
    expect(
      row("method-request-isnavigationrequest").api.some((api: any) =>
        api.module === "NetworkRequest" && api.symbol === "Initiator"
      )
    ).toBe(true)
  })
  it("maps cancellation only for implemented parents and preserves browser limits", () => {
    const implemented = row("option-locator-click-signal")
    expect(implemented.status).toBe("has")
    expect(implemented.api.some((api: any) => api.package === "effect" && api.symbol === "interrupt")).toBe(true)
    expect(implemented.browsers["webkit.attached"].status).toBe("missing")
    expect(implemented.notes).toMatch(/cooperative/)
    expect(implemented.notes).toMatch(/does not undo/)
    expect(row("option-apirequestcontext-delete-signal").status).toBe("missing")
    for (const signal of rows.filter((row) => row.option === "signal")) {
      const parent = rows.find((row) => !row.option && !row.parent && row.upstream[0] === signal.upstream[0])
      expect(signal.status).toBe(parent.status === "missing" ? "missing" : "has")
      for (const mode of Object.keys(parent.browsers)) {
        if (parent.browsers[mode].status === "missing") expect(signal.browsers[mode].status).toBe("missing")
      }
    }
  })
  it("backs caller delays with Effect.sleep and its fiber clock", () => {
    for (const owner of ["page", "frame"]) {
      const delay = row(`method-${owner}-waitfortimeout`)
      expect(delay.status).toBe("has")
      expect(delay.api.some((api: any) => api.package === "effect" && api.symbol === "sleep")).toBe(true)
      expect(delay.notes).toMatch(/TestClock/)
    }
  })
  it("accounts for every wait state with count and visibility compositions", () => {
    for (
      const method of [
        "locator-waitfor",
        "page-waitforselector",
        "frame-waitforselector",
        "elementhandle-waitforselector"
      ]
    ) {
      const state = row(`option-${method}-state`)
      expect(state.status).toBe("has")
      expect(state.valueCoverage.map((entry: any) => [entry.value, entry.status])).toEqual([
        ["attached", "has"],
        ["detached", "has"],
        ["hidden", "has"],
        ["visible", "has"]
      ])
      expect(state.api.some((api: any) => api.symbol === "toHaveCount")).toBe(true)
      expect(state.notes).toMatch(/strict/)
      expect(state.notes).toMatch(/identity/)
    }
  })

  it("rejects an Effect source link for the wrong module", () => {
    const api = row("method-page-waitfortimeout").api[0]
    expect(() => assertApiLink({ ...api, url: "https://unpkg.com/effect@4.1.2/src/Fiber.ts" }))
      .toThrow()
  })
})
