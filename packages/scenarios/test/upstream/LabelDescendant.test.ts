import * as Effect from "effect/Effect"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { inputCase, type InputSite } from "./inputCase.ts"
import { inputSite } from "./inputSite.ts"

let site: InputSite
beforeAll(async () => {
  site = await inputSite()
})
afterAll(async () => {
  await site?.close()
})

// Compatibility probes, not an approved expansion of Strider's contract.
for (const library of ["playwright", "strider"] as const) {
  describe(`label descendant / ${library}`, () => {
    const scenario = inputCase(library, () => site)
    for (const association of ["explicit", "wrapping"] as const) {
      for (const checked of [true, false]) {
        for (const kind of ["span", "position", "already", "button", "link", "own-aria", "own-input"] as const) {
          const initial = kind === "already" ? checked : !checked
          const input = `<input id="box" type="checkbox" ${initial ? "checked" : ""}>`
          const target = kind === "button" ?
            "<button id=\"target\"><span>Toggle</span></button>"
            : kind === "link" ?
            "<a id=\"target\" href=\"#destination\"><span>Toggle</span></a>"
            : kind === "own-input" ?
            `<input id="target" type="checkbox" ${initial ? "checked" : ""}>`
            : `<span id="target" ${
              kind === "own-aria" ? `role="checkbox" aria-checked="${initial}"` : ""
            }>Toggle</span>`
          const html =
            `<style>label{margin-left:80px} #target{${
              kind === "position" ? "display:inline-block;width:140px;height:30px;margin-left:40px" : ""
            }}</style>`
            + (association === "explicit"
              ? `${input}<label for="box">${target}</label>`
              : `<label>${input}${target}</label>`)
            + `<output id="out"></output><script>
              document.addEventListener('pointerdown', e => {
                const r = document.querySelector('#target').getBoundingClientRect();
                document.querySelector('#out').textContent = JSON.stringify({target:e.target.id || e.target.tagName,x:e.clientX-r.left,y:e.clientY-r.top});
              });
              ${
              kind === "own-aria"
                ? "document.querySelector('#target').onclick = e => { e.preventDefault(); e.currentTarget.setAttribute('aria-checked', String(e.currentTarget.getAttribute('aria-checked') !== 'true')); };"
                : ""
            }
            </script>`
          const name = `${association} ${kind} ${checked ? "check" : "uncheck"}`
          scenario(
            name,
            html,
            Effect.fn(name)(function*(page) {
              const target = kind === "own-input" ? page.locator("#target") : page.getByText("Toggle")
              const options = kind === "position" ? { position: { x: 7, y: 9 } } : undefined
              const result = yield* Effect.result(checked ? target.check(options) : target.uncheck(options))
              const state = yield* page.locator("#box").evaluate((el) => (el as HTMLInputElement).checked)
              const pointer = yield* page.locator("#out").evaluate((el) => el.textContent)
              const own = yield* page.locator("#target").evaluate((el) =>
                el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked")
              )
              console.log(name, JSON.stringify({ result, state, own, pointer }))
              // Observed boundary behavior; no compatibility expansion proposed here.
              if (kind === "button" || kind === "link") {
                expect(result).toMatchObject({ _tag: "Failure", failure: { reason: { _tag: "WrongElement" } } })
                expect(state).toBe(initial)
                expect(pointer).toBe("")
              }
              if (kind === "own-aria" || kind === "own-input") {
                expect(result).toMatchObject({ _tag: "Success" })
                expect(own).toBe(kind === "own-input" ? checked : String(checked))
                expect(state).toBe(initial)
              }
              // The simple span cases deliberately expose the compatibility gap.
              if (kind === "span" || kind === "position" || kind === "already") {
                expect(result).toMatchObject({ _tag: "Success" })
                expect(state).toBe(checked)
                if (kind === "already") expect(pointer).toBe("")
                else {
                  expect(JSON.parse(pointer!)).toMatchObject({ target: "target" })
                  if (kind === "position") expect(JSON.parse(pointer!)).toMatchObject({ x: 7, y: 9 })
                }
              }
            }),
            async (page) => {
              const target = kind === "own-input" ? page.locator("#target") : page.getByText("Toggle")
              let error: string | undefined
              try {
                const options = kind === "position" ? { position: { x: 7, y: 9 } } : {}
                await (checked ? target.check(options) : target.uncheck(options))
              } catch (cause) {
                error = String(cause).split("\n")[0]
              }
              const state = await page.locator("#box").evaluate((el) => (el as HTMLInputElement).checked)
              const own = await page.locator("#target").evaluate((el) =>
                el instanceof HTMLInputElement ? el.checked : el.getAttribute("aria-checked")
              )
              const pointer = await page.locator("#out").textContent()
              console.log(name, JSON.stringify({ error, state, own, pointer }))
              // Playwright treats a button ancestor differently from an anchor ancestor.
              if (kind === "button" || kind === "link") {
                expect(error).toContain(
                  kind === "button"
                    ? "Not a checkbox or radio button"
                    : "Clicking the checkbox did not change its state"
                )
                expect(state).toBe(initial)
                if (kind === "button") expect(pointer).toBe("")
                else expect(JSON.parse(pointer!)).toMatchObject({ target: "SPAN" })
              }
              if (kind === "own-aria" || kind === "own-input") {
                expect(error).toBeUndefined()
                expect(own).toBe(kind === "own-input" ? checked : String(checked))
                expect(state).toBe(initial)
              }
              if (kind === "span" || kind === "position" || kind === "already") {
                expect(error).toBeUndefined()
                expect(state).toBe(checked)
                if (kind === "already") expect(pointer).toBe("")
                else {
                  expect(JSON.parse(pointer!)).toMatchObject({ target: "target" })
                  if (kind === "position") expect(JSON.parse(pointer!)).toMatchObject({ x: 7, y: 9 })
                }
              }
            }
          )
        }
      }
    }
  })
}
