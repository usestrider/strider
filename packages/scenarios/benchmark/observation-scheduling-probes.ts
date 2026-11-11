/* eslint-disable no-eval -- Execute the exact serialized engine in a disposable diagnostic browser realm. */
// Diagnostic copies of the real engine. Never installed by production or used for performance claims.
import * as assert from "node:assert/strict"
import type { Browser } from "playwright-core"
import * as Engine from "../../browser/src/internal/engine.ts"

const replace = (source: string, before: string, after: string) => {
  assert.equal(source.split(before).length, 2, `Expected one scheduling probe site: ${before}`)
  return source.replace(before, after)
}

export const schedulingProbes = async (browser: Browser) => {
  const samples = []
  for (const variant of ["current", "skip-after-check", "no-frames"]) {
    let install = Engine.install
    install = replace(
      install,
      "const recheck = () => {",
      "let checkedSinceFrame = false; const recheck = () => { checkedSinceFrame = true;"
    )
    if (variant === "skip-after-check") {
      install = replace(
        install,
        "recheck()\n        onFrame(tick)",
        "      if (!checkedSinceFrame) recheck(); checkedSinceFrame = false;\n      onFrame(tick)"
      )
    }
    if (variant === "no-frames") {
      install = replace(install, "recheck()\n        onFrame(tick)", "      onFrame(tick)")
    }
    install = replace(
      install,
      "last = evaluate(request.steps, request.expectation)",
      "last = evaluate(request.steps, request.expectation); globalThis.__probeEvaluations.push(JSON.stringify(last))"
    )
    for (
      const probe of [
        "checked-transient",
        "attribute-checked-locator",
        "cssom-visible",
        "attribute-role-layout",
        "repeated-unrelated",
        "repeated-cssom",
        "attribute-shadow",
        "plain-attribute",
        "unchanged-between"
      ]
    ) {
      const page = await browser.newPage()
      try {
        await page.setContent(
          "<style id=\"sheet\">#target { display:none }</style><input id=\"target\" type=\"checkbox\" role=\"checkbox\" data-ready=\"Ready\"><div id=\"noise\"></div>"
        )
        const result = await page.evaluate(async ({ install, run, key, variant, probe }) => {
          const frames: Array<() => void> = []
          const timers = new Map<number, () => void>()
          let timerId = 0
          const log: Array<unknown> = []
          const evaluations: Array<string> = []
          ;(globalThis as unknown as { __probeEvaluations: Array<string> }).__probeEvaluations = evaluations
          const real = {
            requestAnimationFrame: (f: () => void) => {
              frames.push(f)
              return frames.length
            },
            setTimeout: (f: () => void) => {
              timers.set(++timerId, f)
              return timerId
            },
            clearTimeout: (id: number) => timers.delete(id),
            now: () => performance.now()
          }
          ;(globalThis as unknown as Record<symbol, unknown>)[Symbol.for("@usestrider/browser/clock/real")] = real
          ;(0, eval)(`(${install})`)()
          let target = document.querySelector<HTMLInputElement>("#target")!
          if (probe === "attribute-shadow") {
            target.remove()
            const host = document.createElement("div")
            document.body.append(host)
            const root = host.attachShadow({ mode: "open" })
            root.append(target)
            target.removeAttribute("data-ready")
          }
          const noise = document.querySelector("#noise")!
          const rule = document.querySelector<HTMLStyleElement>("#sheet")!.sheet!.cssRules[0] as CSSStyleRule
          const css = (selector: string) => [{ _tag: "Css", selector }]
          const attr = {
            _tag: "Attribute",
            name: "data-ready",
            expected: { _tag: "String", value: "Ready", exact: true }
          }
          let steps: unknown = css("#target")
          let expectation: unknown = { _tag: "Checked" }
          if (probe === "attribute-checked-locator") {
            steps = css("#target:checked")
            expectation = attr
          }
          if (probe === "cssom-visible" || probe === "repeated-cssom") expectation = { _tag: "Visible" }
          if (probe === "attribute-role-layout") {
            steps = [{ _tag: "Role", role: "checkbox", name: null, includeHidden: false }]
            expectation = attr
          }
          if (probe === "plain-attribute" || probe === "unchanged-between" || probe === "attribute-shadow") {
            target.removeAttribute("data-ready")
            expectation = attr
          }
          // Install the pending request only after fixture mutations have drained.
          await Promise.resolve()
          let settled = false
          const pending: Promise<string> = (0, eval)(`(${run})`)(
            JSON.stringify({ op: "expect", steps, expectation, cap: 1000 })
          )
          pending.then(() => {
            settled = true
          })
          const flush = async () => {
            await Promise.resolve()
            await Promise.resolve()
            await Promise.resolve()
          }
          const frame = async () => {
            const callbacks = frames.splice(0)
            for (const callback of callbacks) callback()
            await flush()
          }
          const mutate = async (i: number) => {
            noise.setAttribute("data-noise", String(i))
            await flush()
            log.push({ event: "unrelated-mutation", i, settled })
          }
          const change = () => {
            if (probe === "cssom-visible" || probe === "attribute-role-layout" || probe === "repeated-cssom") {
              rule.style.display = "block"
            } else target.checked = true
            log.push({
              event: "silent-state-change",
              checked: target.checked,
              display: getComputedStyle(target).display
            })
          }
          const rounds = ["repeated-unrelated", "repeated-cssom"].includes(probe) ? 4 : 1
          for (let i = 0; i < rounds; i++) {
            if (probe === "repeated-unrelated") target.checked = false
            if (probe === "repeated-cssom") rule.style.display = "none"
            await mutate(i)
            if (probe === "plain-attribute" || probe === "attribute-shadow") {
              target.setAttribute("data-ready", "Ready")
              await flush()
            } else if (probe !== "unchanged-between") change()
            await frame()
            log.push({ event: "after-frame", i, settled })
            if (probe === "checked-transient") {
              target.checked = false
              await frame()
              log.push({ event: "after-revert", settled })
            }
          }
          const detectedBeforeCap = settled
          for (const timer of timers.values()) timer()
          const response = JSON.parse(await pending)
          // Every diagnostic realm is discarded; no callbacks escape this page.
          delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("@usestrider/browser/clock/real")]
          return {
            evaluations,
            variant,
            probe,
            detectedBeforeCap,
            response,
            log,
            engineInstalled: (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(key)] !== undefined
          }
        }, { install, run: Engine.run, key: Engine.installKey, variant, probe })
        const shouldDetect = probe === "plain-attribute" || (variant === "current" && probe !== "unchanged-between")
        assert.equal(result.detectedBeforeCap, shouldDetect, `${variant}/${probe}`)
        assert.equal(result.response.passed, shouldDetect, `${variant}/${probe} response`)
        samples.push(result)
      } finally {
        await page.close()
      }
    }
  }
  return samples
}
