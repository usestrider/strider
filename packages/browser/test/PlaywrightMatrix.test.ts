import { describe, expect, it } from "@effect/vitest"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const matrix = JSON.parse(readFileSync(`${root}website/src/features/playwright/matrix.json`, "utf8"))
const rows: Array<any> = matrix.rows
const row = (id: string) => rows.find((row) => row.id === id)

describe("Playwright matrix", () => {
  // A deliberate difference cites the decision behind it, not a whole section of the decisions document.
  it("cites a specific decision for each deliberate difference", () => {
    const sections = ["principles", "the-public-api-l2", "the-browser-model-l1"]
    const unspecific = rows.filter((row) => row.status === "different" && sections.includes(row.decision.anchor))
    expect(unspecific.map((row) => row.id)).toEqual([])
  })

  // The reference renders an anchor for each member, so a link to a member names it rather than its module's top.
  it("links a member to its own reference anchor", () => {
    const reference = (module: string) => `${root}website/dist/docs/api/browser/${module}/index.html`
    const imprecise = rows.flatMap((row) =>
      row.api
        .filter((api: any) => api.symbol !== api.url.split("#")[1] && existsSync(reference(api.module)))
        .filter((api: any) =>
          new RegExp(`id="[A-Za-z]+\\.${api.symbol}"`).test(readFileSync(reference(api.module), "utf8"))
        )
        .map((api: any) => `${row.id} -> ${api.url} (${api.symbol})`)
    )
    expect(imprecise).toEqual([])
  })

  // Locator.isEnabled answers isDisabled; a member answered by its complement is not missing.
  it("does not mark a member missing when its complement is built", () => {
    expect(row("method-locator-isenabled").status).toBe("has")
    expect(row("method-locator-isdisabled").status).not.toBe("missing")
  })
})
