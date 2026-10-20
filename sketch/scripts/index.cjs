// Writes INDEX.md: every exported declaration and member of the sketch, one line each, grouped by area.
// Run with `npm run index` from sketch/. Generated, so it can't drift from the declarations.
const { execFileSync } = require("child_process")
const fs = require("fs")
const groups = [
  ["Entry and settings", [["Browser and backends", ["src/Browser.ts"]], ["Deadline", ["src/Deadline.ts"]], ["Diagnostics", ["src/Diagnostics.ts"]], ["Brands and ids", ["src/Brand.ts"]]]],
  ["Pages and contexts", [["Pages", ["src/Page.ts"]], ["UserContext, emulation, cookies", ["src/UserContext.ts"]]]],
  ["Finding and acting", [["Locators and frames", ["src/Locator.ts"]], ["Keyboard and mouse", ["src/Input.ts"]]]],
  ["Reading", [["Snapshot", ["src/Snapshot.ts"]], ["Serialized, JSHandle", ["src/Handle.ts"]], ["Capability", ["src/Capability.ts"]]]],
  ["State and events", [["Watchable", ["src/Watchable.ts"]], ["Event modules", ["src/Events.ts"]], ["ReadonlyDeferred (proposed upstream)", ["src/upstream.ts"]]]],
  ["Expectations", [["Expect, Condition, AriaPattern", ["src/Expect.ts"]]]],
  ["Network and time", [["Routes and declarations", ["src/Network.ts"]], ["PageClock", ["src/PageClock.ts"]]]],
  ["Recordings", [["Trace, Har", ["src/Recordings.ts"]]]],
  ["Surfaces", [["BrowserToolkit (effect-browser/ai)", ["src/ai.ts"]], ["BrowserTest, VitestBrowser (effect-browser/test)", ["src/test.ts", "src/test-vitest.ts"]], ["CurrentSession (effect-browser/cli)", ["src/cli.ts"]]]],
  ["Errors", [["Errors", ["src/Errors.ts"]]]],
]
module.exports = { groups }
if (require.main === module) {
  const data = JSON.parse(execFileSync("node", [__dirname + "/extract.cjs", JSON.stringify(groups)], { encoding: "utf8", maxBuffer: 1 << 24 }))
  const md = s => s                                    // list items, not table cells: nothing to escape
  let out = "# effect-browser API index\n\nGenerated from `src/` by `npm run index`; don't edit by hand. One line per declaration and member. ● marks what is new in the sketch, beyond API.md.\n"
  for (const g of data) {
    out += `\n## ${g.name}\n`
    for (const m of g.modules) {
      out += `\n### ${m.name} (${m.files.map(f => "`" + f + "`").join(", ")})\n\n`
      for (const d of m.decls) {
        out += `- ${d.n ? "● " : ""}\`${d.k} ${md(d.name)}${md(d.extra)}\`\n`
        for (const x of d.m) out += `  - ${x.n ? "● " : ""}\`${md(x.t)}\`\n`
      }
    }
  }
  fs.writeFileSync("INDEX.md", out)
}
