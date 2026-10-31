// Modified port of microsoft/playwright tests/page/page-check.spec.ts.
// Copyright 2018 Google Inc. Modifications copyright Microsoft Corporation.
// Apache-2.0; original source, license and NOTICE: ../../upstream/playwright/.
// Diagnostic differences: ROOK-116 (trial), ROOK-117 (ARIA), ROOK-118 (labels).
import * as Effect from "effect/Effect"
import { afterAll, beforeAll, describe, expect } from "vitest"
import { inputCase, type InputSite } from "./inputCase.ts"
import { inputSite } from "./inputSite.ts"
import { runs } from "./timing.ts"

let site: InputSite
beforeAll(async () => {
  site = await inputSite()
})
afterAll(async () => {
  await site?.close()
})

for (const { library, sample } of runs) {
  describe(`Playwright check / ${library} / sample ${sample}`, () => {
    const scenario = inputCase(library, () => site)

    for (
      const [id, name, initial, checked] of [
        ["CH-001", "should check the box", false, true],
        ["CH-002", "should not check the checked box", true, true],
        ["CH-003", "should uncheck the box", true, false],
        ["CH-004", "should not uncheck the unchecked box", false, false]
      ] as const
    ) {
      scenario(
        `${id} ${name}`,
        `<input id='checkbox' type='checkbox' ${initial ? "checked" : ""}></input>`,
        Effect.fn(id)(function*(page) {
          const input = page.locator("input")
          yield* checked ? input.check() : input.uncheck()
          expect(yield* input.evaluate((el) => (el as HTMLInputElement).checked)).toBe(checked)
        }),
        async (page) => {
          await (checked ? page.check("input") : page.uncheck("input"))
          expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(checked)
        }
      )
    }

    scenario(
      "CH-005 should check radio",
      `<input type='radio'>one</input><input id='two' type='radio'>two</input><input type='radio'>three</input>`,
      Effect.fn("CH-005")(function*(page) {
        yield* page.locator("#two").check()
        expect(yield* page.locator("#two").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
      }),
      async (page) => {
        await page.check("#two")
        expect(await page.locator("#two").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
      }
    )

    for (const [id, checked] of [["CH-006", true], ["CH-007", false]] as const) {
      scenario(
        `${id} should ${checked ? "check" : "uncheck"} radio by aria role`,
        `<div role='radio' id='checkbox' ${checked ? "" : "aria-checked=\"true\""}>CHECKBOX</div>
        <script>checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', '${checked}'));</script>`,
        Effect.fn(id)(function*(page) {
          const radio = page.locator("div")
          yield* checked ? radio.check() : radio.uncheck()
          expect(yield* radio.evaluate((el) => el.getAttribute("aria-checked"))).toBe(String(checked))
        }),
        async (page) => {
          await (checked ? page.check("div") : page.uncheck("div"))
          expect(await page.locator("div").getAttribute("aria-checked")).toBe(String(checked))
        }
      )
    }

    // Expanded upstream role loops: failures identify the exact role rather than stopping at the first one.
    for (const role of ["checkbox", "menuitemcheckbox", "option", "radio", "switch", "menuitemradio", "treeitem"]) {
      for (const [id, checked] of [["CH-008", true], ["CH-009", false]] as const) {
        scenario(
          `${id} should ${checked ? "check" : "uncheck"} the box by aria role: ${role}`,
          `<div role='${role}' id='checkbox' ${checked ? "" : "aria-checked=\"true\""}>CHECKBOX</div>
          <script>checkbox.addEventListener('click', () => checkbox.setAttribute('aria-checked', '${checked}'));</script>`,
          Effect.fn(id)(function*(page) {
            const checkbox = page.locator("div")
            yield* checked ? checkbox.check() : checkbox.uncheck()
            expect(yield* checkbox.evaluate((el) => el.getAttribute("aria-checked"))).toBe(String(checked))
          }),
          async (page) => {
            await (checked ? page.check("div") : page.uncheck("div"))
            expect(await page.locator("div").getAttribute("aria-checked")).toBe(String(checked))
          }
        )
      }
    }

    for (const [id, html] of [["CH-010", "<div>Check me</div>"], ["CH-011", "<div role=button>Check me</div>"]]) {
      scenario(
        `${id} should throw when not a checkbox`,
        html!,
        Effect.fn(id!)(function*(page) {
          const error = yield* Effect.flip(page.locator("div").check())
          expect(error).toMatchObject({ _tag: "LocatorError", reason: { _tag: "WrongElement" } })
        }),
        async (page) => {
          await expect(page.check("div")).rejects.toThrow("Not a checkbox or radio button")
        }
      )
    }

    scenario(
      "CH-012 should check the box inside a button",
      "<div role='button'><input type='checkbox'></div>",
      Effect.fn("CH-012")(function*(page) {
        const input = page.locator("input")
        yield* input.check()
        expect(yield* input.evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
        expect(yield* input.isChecked).toBe(true)
      }),
      async (page) => {
        await page.check("input")
        expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
        expect(await page.isChecked("input")).toBe(true)
        expect(await (await page.$("input"))!.isChecked()).toBe(true)
      }
    )

    scenario(
      "CH-013 should check the label with position",
      () => `
      <input id='checkbox' type='checkbox' style='width: 5px; height: 5px;'>
      <label for='checkbox'><a href=${
        JSON.stringify(site.origin + "/empty.html")
      }>I am a long link that goes away so that nothing good will happen if you click on me</a> Click me</label>`,
      Effect.fn("CH-013")(function*(page) {
        const label = page.getByText("Click me")
        const width = yield* label.evaluate((el) => el.getBoundingClientRect().width)
        yield* label.check({ position: { x: width - 10, y: 2 } })
        expect(yield* page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
      }),
      async (page) => {
        const label = page.getByText("Click me")
        const box = await label.boundingBox()
        await label.check({ position: { x: box!.width - 10, y: 2 } })
        expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
      }
    )

    for (const [id, checked] of [["CH-014", true], ["CH-015", false]] as const) {
      scenario(
        `${id} trial run should not ${checked ? "check" : "uncheck"}`,
        `<input id='checkbox' type='checkbox' ${checked ? "" : "checked"}></input>`,
        Effect.fn(id)(function*(page) {
          const input = page.locator("input")
          yield* checked ? input.check({ trial: true }) : input.uncheck({ trial: true })
          expect(yield* input.evaluate((el) => (el as HTMLInputElement).checked)).toBe(!checked)
        }),
        async (page) => {
          await (checked ? page.check("input", { trial: true }) : page.uncheck("input", { trial: true }))
          expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(!checked)
        }
      )
    }

    scenario(
      "CH-016 should check the box using setChecked",
      "<input id='checkbox' type='checkbox'></input>",
      Effect.fn("CH-016")(function*(page) {
        const input = page.locator("input")
        yield* input.check()
        expect(yield* input.evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
        yield* input.uncheck()
        expect(yield* input.evaluate((el) => (el as HTMLInputElement).checked)).toBe(false)
      }),
      async (page) => {
        await page.setChecked("input", true)
        expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(true)
        await page.setChecked("input", false)
        expect(await page.locator("input").evaluate((el) => (el as HTMLInputElement).checked)).toBe(false)
      }
    )

    scenario(
      "CH-017 should throw when trying to uncheck radio button",
      "<input type='radio' name='test' checked id='radio'>",
      Effect.fn("CH-017")(function*(page) {
        const error = yield* Effect.flip(page.locator("#radio").uncheck())
        expect(error).toMatchObject({ _tag: "LocatorError", reason: { _tag: "StateUnchanged" } })
        expect(yield* page.locator("#radio").isChecked).toBe(true)
      }),
      async (page) => {
        await expect(page.uncheck("#radio")).rejects.toThrow("Cannot uncheck radio button")
        expect(await page.isChecked("#radio")).toBe(true)
      }
    )
  })
}
