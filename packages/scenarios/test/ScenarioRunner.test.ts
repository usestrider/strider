import * as fs from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { describe, expect, it } from "vitest"

// Exercise the runner's scenario loop without a browser: a scenario can pass its
// initial check and reject during a timed repetition regardless of its backend.
const source = fs.readFileSync(new URL("../src/bin.ts", import.meta.url), "utf8")
const loop = stripTypeScriptTypes(
  source.slice(source.indexOf("const normalize ="), source.indexOf("// ── Q82:"))
)
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor

describe("scenario runner", () => {
  it.each(["strider", "playwright"])("continues after a timed %s failure", async (library) => {
    const calls = { strider: 0, playwright: 0 }
    const run = (name: "strider" | "playwright") => async () => {
      calls[name]++
      if (name === library && calls[name] === 2) throw new Error("timed attempt failed")
      return "42 sold"
    }
    const later = { strider: 0, playwright: 0 }
    const chosen = [{ name: "har", strider: run("strider"), playwright: run("playwright") }, {
      name: "later",
      strider: async () => {
        later.strider++
        return "later"
      },
      playwright: async () => {
        later.playwright++
        return "later"
      }
    }]
    const execute = new AsyncFunction(
      "chosen",
      "runs",
      "strider",
      "browser",
      "origin",
      "files",
      "elapsed",
      "stats",
      "log",
      `${loop}\nreturn results;`
    )
    await expect(execute(
      chosen,
      10,
      (value: unknown) => value,
      {},
      "http://local",
      {},
      async (run: () => Promise<unknown>) => {
        await run()
        return 1
      },
      (values: Array<number>) => values,
      () => {}
    )).resolves.toHaveLength(2)
    expect(later.strider).toBeGreaterThan(0)
    expect(later.playwright).toBeGreaterThan(0)
  })
})
