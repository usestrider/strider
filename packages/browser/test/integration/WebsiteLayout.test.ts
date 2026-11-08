/** Built-site layout regression. First run pnpm reference && pnpm website:build. */
import { NodeServices } from "@effect/platform-node"
import { Browser } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Effect } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, expect, it } from "vitest"
import { assertPinned, chromium } from "./browsers.ts"

const dist = new URL("../../../../website/dist/", import.meta.url)
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url!, "http://localhost").pathname
  const file = new URL(`.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`, dist)
  try {
    const body = await readFile(file)
    const extension = fileURLToPath(file).split(".").pop()
    response.setHeader(
      "Content-Type",
      ({ html: "text/html", css: "text/css", js: "text/javascript", woff2: "font/woff2" } as Record<string, string>)[
        extension!
      ] ?? "application/octet-stream"
    )
    response.end(body)
  } catch {
    response.writeHead(404).end()
  }
})
let base: string
beforeAll(async () => {
  await readFile(new URL("docs/index.html", dist))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("Missing server address")
  base = `http://127.0.0.1:${address.port}`
})
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))

for (const javaScript of ["enabled", "disabled"] as const) {
  // Include the former name breakpoint and both sides of the mobile/desktop arrangement.
  for (
    const viewport of [
      { width: 320, height: 800 },
      { width: 375, height: 800 },
      { width: 379, height: 800 },
      { width: 380, height: 800 },
      { width: 390, height: 844 },
      { width: 412, height: 915 },
      { width: 639, height: 800 },
      { width: 640, height: 800 },
      { width: 641, height: 800 },
      { width: 767, height: 800 },
      { width: 768, height: 800 },
      { width: 769, height: 800 },
      { width: 1366, height: 900 }
    ]
  ) {
    for (const path of ["introduction", "playwright"]) {
      it(
        `${path} contains document, header controls and tables at ${viewport.width}×${viewport.height} (${javaScript} JavaScript)`,
        async () => {
          await Effect.runPromise(
            Effect.scoped(Effect.gen(function*() {
              const browser = yield* Browser.Browser
              assertPinned("Chromium", browser.info.version, chromium.version)
              const context = yield* Browser.newContext({ emulation: { viewport, javaScript } })
              const page = yield* context.newPage
              yield* page.goto(`${base}/docs/${path === "introduction" ? "" : `${path}/`}`, { waitUntil: "load" })
              yield* page.evaluateInMainWorld(() => document.fonts.ready.then(() => true))
              const measurement = yield* page.evaluateInMainWorld(() => {
                const width = document.documentElement.clientWidth
                const bounds = (element: Element) => {
                  const rect = element.getBoundingClientRect()
                  return { left: rect.left, right: rect.right, width: rect.width }
                }
                const article = document.querySelector(".prose")!
                return {
                  width,
                  scrollWidth: document.documentElement.scrollWidth,
                  controls: [...document.querySelectorAll("header a, header button")].map((element) => ({
                    label: element.getAttribute("aria-label") ?? element.textContent?.trim(),
                    ...bounds(element)
                  })),
                  article: bounds(article),
                  tables: [...article.querySelectorAll("table")].map((table) => {
                    let container: HTMLElement | null = table.parentElement
                    while (
                      container && container !== article &&
                      !["auto", "scroll"].includes(getComputedStyle(container).overflowX)
                    ) container = container.parentElement
                    const scrollWidth = container?.scrollWidth ?? 0
                    const clientWidth = container?.clientWidth ?? 0
                    if (container && container !== article) container.scrollLeft = 40
                    const scrolled = container?.scrollLeft ?? 0
                    if (container) container.scrollLeft = 0
                    return {
                      label: container?.getAttribute("aria-label"),
                      scrollWidth,
                      clientWidth,
                      scrolled,
                      table: bounds(table),
                      container: bounds(container ?? article),
                      scrollable: container !== article && container !== null
                    }
                  })
                }
              })
              console.log(
                JSON.stringify({ path, viewport, javaScript, browser: browser.info, headless: true, measurement })
              )
              const screenshots = new URL("../../../../.data/website-layout/", import.meta.url)
              yield* Effect.promise(() => mkdir(screenshots, { recursive: true }))
              const screenshot = yield* page.screenshot()
              yield* Effect.promise(() =>
                writeFile(
                  new URL(`${path}-${viewport.width}-${javaScript}.png`, screenshots),
                  screenshot
                )
              )
              expect.soft(measurement.scrollWidth, "document width").toBeLessThanOrEqual(measurement.width)
              for (const control of measurement.controls) {
                expect.soft(control.left, `${control.label} left`).toBeGreaterThanOrEqual(0)
                expect.soft(control.right, `${control.label} right`).toBeLessThanOrEqual(measurement.width)
              }
              if (path === "playwright") {
                expect(measurement.tables.length).toBeGreaterThan(0)
                const labels = measurement.tables.map((table) => table.label)
                expect(labels.every((label) => label && label !== "Table"), "table regions have context").toBe(true)
                expect(new Set(labels).size, "table region names are distinct").toBe(labels.length)
              }
              for (const table of measurement.tables) {
                if (table.scrollWidth > table.clientWidth && table.scrollable) {
                  expect.soft(table.scrolled, "wide table actually scrolls").toBeGreaterThan(0)
                }
                expect.soft(table.container.left, "table container left").toBeGreaterThanOrEqual(
                  measurement.article.left - 1
                )
                expect.soft(table.container.right, "table container right").toBeLessThanOrEqual(
                  measurement.article.right + 1
                )
                expect.soft(
                  table.table.right <= measurement.article.right + 1 || table.scrollable,
                  "wide table has horizontal scrolling container"
                ).toBe(true)
              }
            })).pipe(
              Effect.provide(Chromium.layer({ executablePath: chromium.executable, headless: true })),
              Effect.provide(NodeServices.layer)
            )
          )
        },
        30_000
      )
    }
  }
}

// Exercise every integer viewport width, rather than relying on selected phone sizes.
for (const javaScript of ["enabled", "disabled"] as const) {
  it(`header fits every width from 320–640px (${javaScript} JavaScript)`, async () => {
    await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assertPinned("Chromium", browser.info.version, chromium.version)
        const context = yield* Browser.newContext({ emulation: { javaScript } })
        const page = yield* context.newPage
        for (const path of ["", "playwright/"]) {
          yield* page.goto(`${base}/docs/${path}`, { waitUntil: "load" })
          yield* page.evaluateInMainWorld(() => document.fonts.ready.then(() => true))
          for (let width = 320; width <= 640; width++) {
            yield* Effect.scoped(Effect.gen(function*() {
              yield* page.emulate({ viewport: { width, height: 800 } })
              const measurement = yield* page.evaluateInMainWorld(() => {
                const header = document.querySelector("header")!.getBoundingClientRect()
                return {
                  width: document.documentElement.clientWidth,
                  scrollWidth: document.documentElement.scrollWidth,
                  controls: [...document.querySelectorAll("header a, header button")].map((element) => {
                    const rect = element.getBoundingClientRect()
                    return {
                      left: rect.left,
                      right: rect.right,
                      width: rect.width,
                      height: rect.height,
                      insideHeader: rect.top >= header.top && rect.bottom <= header.bottom
                    }
                  })
                }
              })
              expect(measurement.scrollWidth, `${path} document at ${width}px`).toBeLessThanOrEqual(measurement.width)
              expect(measurement.controls).toHaveLength(7)
              for (const control of measurement.controls) {
                expect(control.left, `${path} control left at ${width}px`).toBeGreaterThanOrEqual(0)
                expect(control.right, `${path} control right at ${width}px`).toBeLessThanOrEqual(measurement.width)
                expect(control.width).toBeGreaterThan(0)
                expect(control.height).toBeGreaterThan(0)
                expect(control.insideHeader).toBe(true)
              }
            }))
          }
        }
        console.log(`Checked all 321 widths on both pages (${javaScript} JavaScript)`)
      })).pipe(
        Effect.provide(Chromium.layer({ executablePath: chromium.executable, headless: true })),
        Effect.provide(NodeServices.layer)
      )
    )
  }, 120_000)
}
