import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { Browser } from "../packages/browser/src/index.ts"
import { Chromium } from "../packages/browser/src/chromium/index.ts"
const base = "http://127.0.0.1:4391/docs/playwright-matrix/"
const run = (label: string, emulation: any, hash: string) => Effect.gen(function*() {
  const ctx = yield* Browser.newContext({ emulation })
  const page = yield* ctx.newPage()
  const t0 = Date.now()
  yield* page.goto(base + hash, { waitUntil: "load" })
  const loadMs = Date.now() - t0
  const info = yield* page.evaluateInMainWorld(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    const el = id ? document.getElementById(id) : null
    const r = el?.getBoundingClientRect()
    return {
      rows: document.querySelectorAll("[data-matrix-row]").length,
      groups: document.querySelectorAll(".matrix-group").length,
      open: document.querySelectorAll(".matrix-group[open]").length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      tableOverflow: [...document.querySelectorAll(".playwright-matrix table")].some((t) => (t as HTMLElement).scrollWidth > (t.parentElement as HTMLElement).clientWidth),
      target: el ? { inOpen: !!el.closest("details[open]"), top: r!.top, h: innerHeight } : "no element",
      nodes: document.getElementsByTagName("*").length
    }
  })
  console.log(label, "loadMs", loadMs, JSON.stringify(info))
  writeFileSync(`/tmp/rook307rev/${label}.png`, yield* page.screenshot())
  if (emulation.javaScript !== "disabled") {
    const f = yield* page.evaluateInMainWorld(() => {
      const s = document.querySelector<HTMLInputElement>("[data-matrix-search]")!
      s.value = "Page.screenshot"; s.dispatchEvent(new Event("input", { bubbles: true }))
      const a = document.querySelectorAll("[data-matrix-row]:not([hidden])").length
      const st = document.querySelector<HTMLSelectElement>("[data-matrix-status]")!
      st.value = "missing"; st.dispatchEvent(new Event("change", { bubbles: true }))
      const vis = [...document.querySelectorAll<HTMLElement>("[data-matrix-row]:not([hidden])")]
      const b = vis.length, allMissing = vis.every((r) => r.dataset.statuses!.includes("missing"))
      s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true }))
      const c = document.querySelectorAll("[data-matrix-row]:not([hidden])").length
      const opts = [...st.options].map((o) => o.value)
      st.value = ""; st.dispatchEvent(new Event("change", { bubbles: true }))
      return { searchRows: a, searchPlusMissing: b, allMissing, missingOnly: c, opts, reset: document.querySelectorAll("[data-matrix-row]:not([hidden])").length, openAfterReset: document.querySelectorAll(".matrix-group[open]").length }
    })
    console.log(label, "filters", JSON.stringify(f))
  }
})
const program = Effect.scoped(Effect.gen(function*() {
  const desk = { viewport: { width: 1366, height: 900 } }
  const narrow = { viewport: { width: 375, height: 800 } }
  yield* run("desktop", desk, "")
  yield* run("narrow", narrow, "")
  yield* run("deeplink-js", desk, "#method-worker-evaluate")
  yield* run("deeplink-nojs", { ...desk, javaScript: "disabled" }, "#method-worker-evaluate")
  yield* run("nojs-narrow", { ...narrow, javaScript: "disabled" }, "")
})).pipe(Effect.provide(Chromium.layer({ executablePath: "/etc/profiles/per-user/jpowers/bin/chromium" })), Effect.provide(NodeServices.layer))
Effect.runPromise(program).catch((e) => { console.error(e); process.exitCode = 1 })
