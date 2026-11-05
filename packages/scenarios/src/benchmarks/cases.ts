import { ConsoleMessage, Expect, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as assert from "node:assert/strict"
import type * as Playwright from "playwright-core"

export const viewport = { width: 1280, height: 720 }

export interface Case {
  readonly name: string
  readonly description: string
  readonly strider: (page: Page.Page, origin: string) => Effect.Effect<unknown, unknown>
  readonly playwright: (page: Playwright.Page, origin: string) => Promise<unknown>
  readonly verify: (value: unknown) => void
}

const equals = (expected: unknown) => (value: unknown) => assert.deepEqual(value, expected)

export const cases: ReadonlyArray<Case> = [
  {
    name: "navigate",
    description: "Navigate to a local document, wait for load, then read its title",
    strider: Effect.fnUntraced(function*(page, origin) {
      yield* page.goto(`${origin}/`, { waitUntil: "load" })
      return yield* page.title
    }),
    playwright: async (page, origin) => {
      await page.goto(`${origin}/`, { waitUntil: "load" })
      return page.title()
    },
    verify: equals("Shop")
  },
  {
    name: "resources",
    description: "Navigate to a document with 100 uncached images, wait for load, then count loaded images",
    strider: Effect.fnUntraced(function*(page, origin) {
      yield* page.goto(`${origin}/many?n=100`, { waitUntil: "load" })
      return yield* page.evaluateInMainWorld(() => [...document.images].filter((img) => img.naturalWidth > 0).length)
    }),
    playwright: async (page, origin) => {
      await page.goto(`${origin}/many?n=100`, { waitUntil: "load" })
      return page.evaluate(() => [...document.images].filter((img) => img.naturalWidth > 0).length)
    },
    verify: equals(100)
  },
  {
    name: "evaluate",
    description: "20 sequential main-world evaluations returning a small object (ms per batch)",
    strider: (page) =>
      Effect.forEach(Array.from({ length: 20 }), () => page.evaluateInMainWorld(() => ({ answer: 42 }))),
    playwright: async (page) => {
      const values = []
      for (let i = 0; i < 20; i++) values.push(await page.evaluate(() => ({ answer: 42 })))
      return values
    },
    verify: equals(Array.from({ length: 20 }, () => ({ answer: 42 })))
  },
  {
    name: "locator-read",
    description: "20 sequential role locator text reads (ms per batch)",
    strider: (page) => Effect.forEach(Array.from({ length: 20 }), () => page.getByRole("heading").readText),
    playwright: async (page) => {
      const values = []
      for (let i = 0; i < 20; i++) values.push(await page.getByRole("heading").textContent())
      return values
    },
    verify: equals(Array.from({ length: 20 }, () => "Benchmark"))
  },
  {
    name: "click",
    description: "Click a button with default actionability, then read its counter",
    strider: Effect.fnUntraced(function*(page) {
      yield* page.getByRole("button", { name: "Increment" }).click()
      return yield* page.locator("#count").readText
    }),
    playwright: async (page) => {
      await page.getByRole("button", { name: "Increment" }).click()
      return page.locator("#count").textContent()
    },
    verify: equals("1")
  },
  {
    name: "fill",
    description: "Fill a labeled input with default actionability, then read its value",
    strider: Effect.fnUntraced(function*(page) {
      yield* page.getByLabel("Name").fill("Strider benchmark")
      return yield* page.getByLabel("Name").readValue
    }),
    playwright: async (page) => {
      await page.getByLabel("Name").fill("Strider benchmark")
      return page.getByLabel("Name").inputValue()
    },
    verify: equals("Strider benchmark")
  },
  {
    name: "visible",
    description: "Wait for an already visible heading using each library's visibility wait",
    strider: (page) => page.getByRole("heading").pipe(Expect.toBeVisible, Effect.as(undefined)),
    playwright: (page) => page.getByRole("heading").waitFor({ state: "visible" }),
    verify: equals(undefined)
  },
  ...[1, 20].map((count): Case => ({
    name: count === 1 ? "visible-delayed" : "visible-many",
    description: `Arm a 100ms DOM update, then await ${count} concurrent visibility waits (ms per batch)`,
    strider: Effect.fnUntraced(function*(page) {
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          const element = document.createElement("p")
          element.id = "ready"
          element.textContent = "Ready"
          document.body.append(element)
        }, 100)
      })
      return yield* Effect.forEach(
        Array.from({ length: count }),
        () => page.locator("#ready").pipe(Expect.toBeVisible, Effect.as("Ready")),
        { concurrency: "unbounded" }
      )
    }),
    playwright: async (page) => {
      await page.evaluate(() => {
        setTimeout(() => {
          const element = document.createElement("p")
          element.id = "ready"
          element.textContent = "Ready"
          document.body.append(element)
        }, 100)
      })
      return Promise.all(Array.from({ length: count }, async () => {
        await page.locator("#ready").waitFor({ state: "visible" })
        return "Ready"
      }))
    },
    verify: equals(Array.from({ length: count }, () => "Ready"))
  })),
  {
    name: "console-many",
    description: "Register 20 one-shot console subscriptions, emit one event, await all and release subscriptions",
    strider: (page) =>
      Effect.scoped(Effect.gen(function*() {
        const waits = yield* Effect.forEach(Array.from({ length: 20 }), () =>
          ConsoleMessage.next(page, { text: "observation-ready" }))
        yield* page.evaluateInMainWorld(() =>
          console.log("observation-ready")
        )
        return yield* Effect.forEach(waits, (wait) => wait.pipe(Effect.map((message) => message.text)))
      })),
    playwright: async (page) => {
      const waits = Array.from(
        { length: 20 },
        () => page.waitForEvent("console", { predicate: (message) => message.text() === "observation-ready" })
      )
      await page.evaluate(() => console.log("observation-ready"))
      return Promise.all(waits.map(async (wait) => (await wait).text()))
    },
    verify: equals(Array.from({ length: 20 }, () => "observation-ready"))
  },
  {
    name: "screenshot",
    description: "Capture a 1280 by 720 viewport as PNG at device scale 1",
    strider: (page) => page.screenshot(),
    playwright: (page) => page.screenshot({ type: "png" }),
    verify: (value) => {
      assert.ok(value instanceof Uint8Array)
      const bytes = Buffer.from(value)
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
      assert.equal(bytes.readUInt32BE(16), viewport.width)
      assert.equal(bytes.readUInt32BE(20), viewport.height)
    }
  }
]
