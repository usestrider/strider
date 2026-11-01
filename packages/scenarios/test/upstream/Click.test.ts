// Original Strider click workloads, using the shared upstream benchmark runner and reporting.
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

const counter =
  `<button onclick="document.getElementById('count').textContent = String(++window.clicks)">Increment</button><output id="count">0</output><script>window.clicks = 0</script>`

for (const { library, sample } of runs) {
  describe(`Click workloads / ${library} / sample ${sample}`, () => {
    const scenario = inputCase(library, () => site)
    for (const count of [1, 20]) {
      scenario(
        `clicks an immediately ready button ${count} time(s)`,
        counter,
        Effect.fn("click.ready")(function*(page) {
          const button = page.getByRole("button", { name: "Increment" })
          for (let i = 0; i < count; i++) yield* button.click()
          expect(yield* page.locator("#count").readText).toBe(String(count))
        }),
        async (page) => {
          const button = page.getByRole("button", { name: "Increment" })
          for (let i = 0; i < count; i++) await button.click()
          expect(await page.locator("#count").textContent()).toBe(String(count))
        }
      )
    }
    scenario(
      "clicks a role locator in a large document",
      `${counter}<div>${"<span>Unrelated content</span>".repeat(5000)}</div>`,
      Effect.fn("click.largeDocument")(function*(page) {
        yield* page.getByRole("button", { name: "Increment" }).click()
        expect(yield* page.locator("#count").readText).toBe("1")
      }),
      async (page) => {
        await page.getByRole("button", { name: "Increment" }).click()
        expect(await page.locator("#count").textContent()).toBe("1")
      }
    )
    scenario(
      "clicks inside an iframe",
      () => `<iframe src="${site.render(counter)}"></iframe>`,
      Effect.fn("click.iframe")(function*(page) {
        const frame = page.frame(page.locator("iframe"))
        yield* frame.getByRole("button", { name: "Increment" }).click()
        expect(yield* frame.locator("#count").readText).toBe("1")
      }),
      async (page) => {
        const frame = page.frameLocator("iframe")
        await frame.getByRole("button", { name: "Increment" }).click()
        expect(await frame.locator("#count").textContent()).toBe("1")
      }
    )
  })
}
