import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { type Sample, validate } from "../benchmark/navigation-profile-model.ts"

const complete = (): Sample => {
  const sample: Sample = {
    library: "strider",
    index: 0,
    trace: true,
    phases: [10, 5, 1],
    titles: ["Shop", "Shop"],
    events: []
  }
  const mark = (name: string, at: number) => sample.events.push({ at, kind: "mark", name })
  const command = (method: string, at: number, id: number) => {
    sample.events.push({ at, kind: "wire", name: "send", message: { method, id, sessionId: "page" } })
    sample.events.push({ at: at + 0.1, kind: "wire", name: "receive", message: { id, sessionId: "page", result: {} } })
  }
  mark("goto.start", 0)
  command("Page.navigate", 1, 1)
  sample.events.push({ at: 9, kind: "wire", name: "receive", message: { method: "Page.lifecycleEvent" } })
  mark("goto.end", 10)
  mark("first.start", 11)
  mark("realm.start", 12)
  command("Page.createIsolatedWorld", 12.1, 2)
  mark("realm.end", 13)
  mark("install.start", 13.1)
  command("Runtime.callFunctionOn", 13.2, 3)
  mark("install.end", 14)
  command("Runtime.callFunctionOn", 14.1, 4)
  mark("first.end", 16)
  mark("second.start", 17)
  command("Runtime.callFunctionOn", 17.1, 5)
  mark("second.end", 18)
  return sample
}

describe("navigation attribution evidence", () => {
  it("accepts complete dependency evidence and rejects missing installation, replies and wrong titles", () => {
    expect(() => validate(complete())).not.toThrow()
    const missing = complete()
    missing.events = missing.events.filter((e) => e.name !== "install.end")
    expect(() => validate(missing)).toThrow("install.end")
    const reply = complete()
    reply.events = reply.events.filter((e) => !(e.name === "receive" && e.message?.["id"] === 2))
    expect(() => validate(reply)).toThrow("Missing successful reply")
    const wrong = complete()
    wrong.titles[1] = "Old document"
    expect(() => validate(wrong)).toThrow()
  })

  it("rejects stale hook sites and transforms each pinned source site exactly once", () => {
    const root = path.resolve(import.meta.dirname, "../../..")
    execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { transform } from './packages/scenarios/benchmark/navigation-profile-hooks.mjs';
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const require = createRequire(new URL('./packages/scenarios/package.json', import.meta.url));
      const files = ['packages/browser/src/chromium/Chromium.ts', 'packages/browser/src/internal/runtime.ts', require.resolve('playwright-core/package.json').replace('package.json', 'lib/coreBundle.js')];
      for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        assert.notEqual(transform(file, source), source);
        assert.throws(() => transform(file, 'stale'), /site not unique/);
      }
    `
    ], { cwd: root, stdio: "pipe" })
  })
})
