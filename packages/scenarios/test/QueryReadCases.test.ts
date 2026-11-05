import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Playwright from "playwright-core"
import { describe, expect, it } from "vitest"
import { cases } from "../src/benchmarks/cases.ts"
import { start } from "../src/site.ts"

describe("query/read fixtures and case verification", () => {
  for (const name of ["locator-values", "read-snapshot-100", "read-snapshot-1000"]) {
    it(`checks ${name} against its served fixture in both case paths`, async () => {
      const entry = cases.find((entry) => entry.name === name)!
      const site = await start()
      try {
        const response = await fetch(`${site.origin}${entry.fixture}`)
        expect(response.status).toBe(200)
        const html = await response.text()
        const inputs = [...html.matchAll(/<input\b([^>]*)>/g)].map(([, attributes]) => {
          const attribute = (key: string) => new RegExp(`(?:^|\\s)${key}="([^"]*)"`).exec(attributes!)?.[1] ?? null
          return {
            id: attribute("id")!,
            value: attribute("value")!,
            disabled: /(?:^|\s)disabled(?:\s|$)/.test(attributes!),
            getAttribute: attribute
          }
        })
        const size = name === "locator-values" ? 20 : name === "read-snapshot-100" ? 100 : 1000
        expect(inputs).toHaveLength(size)
        expect(inputs.map((input) => input.id)).toEqual(Array.from({ length: size }, (_, i) => `field-${i}`))
        const queries: Array<string> = []
        // Execute the actual page callback against nodes derived from the HTTP fixture. This is a callback/
        // fixture contract test, not a browser DOM or protocol integration test.
        const evaluate = (fn: () => unknown) =>
          new Function("document", `return (${fn.toString()})()`)({
            querySelectorAll: (selector: string) => {
              expect(selector).toBe("input")
              return inputs
            }
          })
        const page = {
          evaluateInMainWorld: (fn: () => unknown) => Effect.sync(() => evaluate(fn)),
          evaluate: async (fn: () => unknown) => evaluate(fn),
          locator: (selector: string) => {
            queries.push(selector)
            const input = inputs.find((input) => `#${input.id}` === selector)!
            expect(input).toBeDefined()
            return { readValue: Effect.sync(() => input.value), inputValue: async () => input.value }
          }
        }
        const strider = await Effect.runPromise(entry.strider(page as unknown as Page.Page, site.origin))
        entry.verify(strider)
        const playwright = await entry.playwright(page as unknown as Playwright.Page, site.origin)
        entry.verify(playwright)
        expect(strider).toEqual(playwright)
        if (name === "locator-values") {
          expect(queries).toEqual([...inputs, ...inputs].map((input) => `#${input.id}`))
          const wrong = [...strider as Array<string>]
          wrong[19] = "wrong"
          expect(() => entry.verify(wrong)).toThrow()
        } else {
          const rows = strider as Array<Record<string, unknown>>
          for (const field of ["id", "value", "disabled", "label"]) {
            const wrong = rows.map((row) => ({ ...row }))
            wrong[size - 1]![field] = "wrong"
            expect(() => entry.verify(wrong)).toThrow()
          }
          expect(() => entry.verify(rows.slice(1))).toThrow()
          expect(() => entry.verify([...rows].reverse())).toThrow()
        }
      } finally {
        await site.close()
      }
    })
  }
})
