// Original action workloads. Timings include navigation, actions and result assertions.
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
  describe(`Action workloads / ${library} / sample ${sample}`, () => {
    const scenario = inputCase(library, () => site)
    for (const count of [1, 20]) {
      scenario(
        `checks and unchecks a native checkbox ${count} time(s)`,
        `<input type="checkbox" aria-label="Toggle" onchange="window.changes++"><script>window.changes=0</script>`,
        Effect.fn("actions.check")(function*(page) {
          const box = page.getByRole("checkbox", { name: "Toggle" })
          for (let i = 0; i < count; i++) {
            yield* box.check()
            yield* box.uncheck()
          }
          expect(yield* box.isChecked).toBe(false)
          expect(yield* page.evaluateInMainWorld(() => (window as any).changes)).toBe(count * 2)
        }),
        async (page) => {
          const box = page.getByRole("checkbox", { name: "Toggle" })
          for (let i = 0; i < count; i++) {
            await box.check()
            await box.uncheck()
          }
          expect(await box.isChecked()).toBe(false)
          expect(await page.evaluate(() => (window as any).changes)).toBe(count * 2)
        }
      )
      scenario(
        `fills a native text input ${count} time(s)`,
        `<input aria-label="Name" oninput="window.inputs++"><script>window.inputs=0</script>`,
        Effect.fn("actions.fill")(function*(page) {
          const input = page.getByLabel("Name")
          for (let i = 0; i < count; i++) yield* input.fill(`value ${i}`)
          expect(yield* input.readValue).toBe(`value ${count - 1}`)
          expect(yield* page.evaluateInMainWorld(() => (window as any).inputs)).toBe(count)
        }),
        async (page) => {
          const input = page.getByLabel("Name")
          for (let i = 0; i < count; i++) await input.fill(`value ${i}`)
          expect(await input.inputValue()).toBe(`value ${count - 1}`)
          expect(await page.evaluate(() => (window as any).inputs)).toBe(count)
        }
      )
    }
  })
}
