// Adapted from vitejs/vite's MIT-licensed css-dynamic-import suite.
// The exact original, revision, fixtures and license are in ../../upstream/vite/ and sources.json.
import { Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { build, createServer, preview } from "vite"
import { describe, expect } from "vitest"
import { css, withFixture, withPlaywright, withStrider } from "./helpers.ts"
import { runs, test } from "./timing.ts"

const links = () =>
  Array.from(document.querySelectorAll("link"), (link) => ({
    pathname: new URL(link.href).pathname,
    rel: link.rel,
    as: link.as
  }))

for (const { library, sample } of runs) {
  describe(`Vite CSS dynamic imports / ${library} / sample ${sample}`, () => {
    for (const mode of ["built", "served"] as const) {
      for (const { base, label } of [{ base: "", label: "relative" }, { base: "/", label: "absolute" }]) {
        test(`doesn't duplicate dynamically imported css files when ${mode} with ${label} base`, async () => {
          await withFixture("vite", async (root) => {
            const config = {
              root,
              base,
              configFile: false as const,
              logLevel: "silent" as const,
              server: { host: "127.0.0.1", port: 0 },
              preview: { host: "127.0.0.1", port: 0 },
              build: { assetsInlineLimit: 0 }
            }
            if (mode === "built") await build(config)
            const server = mode === "built" ? await preview(config) : await createServer(config)
            try {
              if ("listen" in server) await server.listen()
              const origin = server.resolvedUrls!.local[0]!
              const checkLinks = (actual: ReturnType<typeof links>) => {
                if (mode === "built") {
                  const urls = actual.map((link) => link.pathname)
                  expect(urls).toStrictEqual([...new Set(urls)])
                } else {
                  expect(actual).toEqual([{ pathname: "/dynamic.css", rel: "preload", as: "style" }])
                }
              }
              if (library === "playwright") {
                await withPlaywright(async (page) => {
                  await page.goto(origin)
                  await page.waitForSelector(".loaded", { state: "attached" })
                  expect(await page.locator(".css-dynamic-import").evaluate((el) => getComputedStyle(el).color))
                    .toBe("rgb(0, 128, 0)")
                  checkLinks(await page.evaluate(links))
                })
              } else {
                await withStrider(
                  Effect.fn("vite.cssDynamicImport")(function*(page) {
                    yield* page.goto(origin, { waitUntil: "load" })
                    yield* page.locator(".loaded").pipe(Expect.toHaveCount(1))
                    yield* css(page.locator(".css-dynamic-import"), "color", "rgb(0, 128, 0)")
                    checkLinks(yield* page.evaluate(links))
                  })
                )
              }
            } finally {
              await server.close()
            }
          })
        })
      }
    }
  })
}
