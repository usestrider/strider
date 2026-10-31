// Adapted from withastro/astro's MIT-licensed astro-component suite.
// The exact original, revision, fixtures and license are in ../../upstream/astro/ and sources.json.
import { ConsoleMessage, Expect } from "@usestrider/browser"
import { dev } from "astro"
import * as Effect from "effect/Effect"
import * as path from "node:path"
import type { Page } from "playwright-core"
import { describe, expect } from "vitest"
import { css, edit, withFixture, withPlaywright, withStrider } from "./helpers.ts"
import { runs, test } from "./timing.ts"

const style = (page: Page, selector: string, property: string, expected: string) =>
  expect.poll(() =>
    page.locator(selector).evaluate(
      (element, property) => getComputedStyle(element).getPropertyValue(property),
      property
    ), { timeout: 30000 }).toBe(expected)

for (const { library, sample } of runs) {
  describe(`Astro component HMR / ${library} / sample ${sample}`, () => {
    const withApp = async (run: (root: string, origin: string) => Promise<void>) => {
      await withFixture("astro", async (root) => {
        const server = await dev({
          root: path.join(root, "astro-component"),
          configFile: false,
          logLevel: "silent",
          devToolbar: { enabled: false },
          server: { host: "127.0.0.1", port: 0 }
        })
        try {
          await run(root, `http://127.0.0.1:${server.address.port}`)
        } finally {
          await server.stop()
        }
      })
    }

    test("component styles", async () => {
      await withApp(async (root, origin) => {
        const update = () =>
          edit(root, "astro-component/src/components/Hero.astro", "background: white", "background: rgb(230, 230, 230)")
        if (library === "playwright") {
          await withPlaywright(async (page) => {
            await page.goto(origin)
            await style(page, "section", "background-color", "rgb(255, 255, 255)")
            await style(page, "section", "color", "rgb(0, 0, 0)")
            update()
            await style(page, "section", "background-color", "rgb(230, 230, 230)")
          })
        } else {
          await withStrider(
            Effect.fn("astro.componentStyles")(function*(page) {
              yield* page.goto(origin, { waitUntil: "load" })
              const hero = page.locator("section")
              yield* css(hero, "background-color", "rgb(255, 255, 255)")
              yield* css(hero, "color", "rgb(0, 0, 0)")
              yield* Effect.sync(update)
              yield* css(hero, "background-color", "rgb(230, 230, 230)")
            })
          )
        }
      })
    })

    for (
      const { name, initial, updated } of [
        { name: "Scripts", initial: "Hello, Astro!", updated: "Hello, updated Astro!" },
        { name: "inline scripts", initial: "Hello, inline Astro!", updated: "Hello, updated inline Astro!" }
      ]
    ) {
      test(name, async () => {
        await withApp(async (root, origin) => {
          const update = () => edit(root, "astro-component/src/pages/index.astro", initial, updated)
          if (library === "playwright") {
            await withPlaywright(async (page) => {
              const initialLog = page.waitForEvent("console", (message) => message.text() === initial)
              await page.goto(origin)
              await initialLog
              if (name === "Scripts") {
                expect(await page.locator("#hoisted-script").innerText()).toContain("Hoisted success")
              }
              const updatedLog = page.waitForEvent("console", (message) => message.text() === updated)
              update()
              await updatedLog
            })
          } else {
            await withStrider(
              Effect.fn("astro.scripts")(function*(page) {
                const initialLog = yield* ConsoleMessage.next(
                  page,
                  undefined,
                  (message) => Effect.succeed(message.text === initial)
                )
                yield* page.goto(origin, { waitUntil: "load" })
                yield* initialLog
                if (name === "Scripts") {
                  yield* page.locator("#hoisted-script").pipe(Expect.toContainText("Hoisted success"))
                }
                const updatedLog = yield* ConsoleMessage.next(
                  page,
                  undefined,
                  (message) => Effect.succeed(message.text === updated)
                )
                yield* Effect.sync(update)
                yield* updatedLog
              })
            )
          }
        })
      })
    }

    test("update linked dep Astro html", async () => {
      await withApp(async (root, origin) => {
        const update = () =>
          edit(root, "_deps/astro-linked-lib/Component.astro", ">astro-linked-lib<", ">astro-linked-lib-update<")
        if (library === "playwright") {
          await withPlaywright(async (page) => {
            await page.goto(origin)
            expect(await page.locator("#astro-linked-lib").textContent()).toBe("astro-linked-lib")
            update()
            await expect.poll(() => page.locator("#astro-linked-lib").textContent(), { timeout: 30000 })
              .toBe("astro-linked-lib-update")
          })
        } else {
          await withStrider(
            Effect.fn("astro.linkedHtml")(function*(page) {
              yield* page.goto(origin, { waitUntil: "load" })
              const heading = page.locator("#astro-linked-lib")
              yield* heading.pipe(Expect.toHaveText("astro-linked-lib"))
              yield* Effect.sync(update)
              yield* heading.pipe(Expect.toHaveText("astro-linked-lib-update"))
            })
          )
        }
      })
    })

    test("update linked dep Astro style", async () => {
      await withApp(async (root, origin) => {
        const update = () => edit(root, "_deps/astro-linked-lib/Component.astro", "color: red", "color: green")
        if (library === "playwright") {
          await withPlaywright(async (page) => {
            await page.goto(origin)
            await style(page, "#astro-linked-lib", "color", "rgb(255, 0, 0)")
            update()
            await style(page, "#astro-linked-lib", "color", "rgb(0, 128, 0)")
          })
        } else {
          await withStrider(
            Effect.fn("astro.linkedStyle")(function*(page) {
              yield* page.goto(origin, { waitUntil: "load" })
              const heading = page.locator("#astro-linked-lib")
              yield* css(heading, "color", "rgb(255, 0, 0)")
              yield* Effect.sync(update)
              yield* css(heading, "color", "rgb(0, 128, 0)")
            })
          )
        }
      })
    })
  })
}
