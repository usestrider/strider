import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { transformScenarios } from "../benchmark/session-profile-config.ts"

const source = fs.readFileSync(new URL("../src/scenarios.ts", import.meta.url), "utf8")
describe("session profile instrumentation", () => {
  it("marks every canonical fill/click and keeps unrelated scenarios unchanged", () => {
    const result = transformScenarios(source)
    const start = source.indexOf("// #region many-pages/strider")
    const end = source.indexOf("export const scenarios:")
    expect(result.slice(0, start)).toBe(source.slice(0, start))
    expect(result.slice(result.indexOf("export const scenarios:"))).toBe(source.slice(end))
    expect(result.match(/sessionProfile\.effect\("strider.fill"/g)).toHaveLength(2)
    expect(result.match(/sessionProfile\.promise\("playwright.click"/g)).toHaveLength(3)
    expect(result).toContain(
      "sessionProfile.effect(\"strider.fill\", page.getByRole(\"textbox\", { name: \"Name\" }).fill(`value-${i}`))"
    )
  })
  it("loads the real transformed modules and pinned Playwright bundle without browser startup", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-session-profile-"))
    try {
      execFileSync(process.execPath, [
        "--import",
        "./packages/scenarios/benchmark/session-profile-loader.mjs",
        "--input-type=module",
        "-e",
        `
        await import("./packages/scenarios/src/scenarios.ts");
        await import("./packages/scenarios/src/runner.ts");
        await import("./packages/browser/src/internal/protocolClient.ts");
        await import("./packages/scenarios/node_modules/playwright-core/index.mjs");
      `
      ], { env: { ...process.env, STRIDER_SESSION_PROFILE: path.join(directory, "raw.jsonl") }, stdio: "pipe" })
      expect(fs.readFileSync(path.join(directory, "raw.jsonl"), "utf8")).toBe("")
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  it("rejects missing regions and missing action probes rather than publishing partial attribution", () => {
    expect(() => transformScenarios(source.replace("// #region many-pages/strider", ""))).toThrow("anchors")
    expect(() =>
      transformScenarios(
        source.replace("page.getByRole(\"textbox\", { name: \"Name\" }).fill(`value-${i}`)", "other()")
      )
    ).toThrow("count")
  })
})
