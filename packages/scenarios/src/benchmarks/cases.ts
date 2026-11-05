import { ConsoleMessage, Expect, NetworkResponse, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as assert from "node:assert/strict"
import { inflateSync } from "node:zlib"
import type * as Playwright from "playwright-core"
import { responseBody } from "../site.ts"

export const viewport = { width: 1280, height: 720 }

export interface Case {
  readonly name: string
  readonly description: string
  readonly fixture?: string
  readonly strider: (page: Page.Page, origin: string) => Effect.Effect<unknown, unknown, Scope.Scope>
  readonly playwright: (page: Playwright.Page, origin: string) => Promise<unknown>
  readonly prepareStrider?: (page: Page.Page) => Effect.Effect<unknown, unknown>
  readonly preparePlaywright?: (page: Playwright.Page) => Promise<unknown>
  readonly verify: (value: unknown) => void
}

const equals = (expected: unknown) => (value: unknown) => assert.deepEqual(value, expected)

const bodyCase = (name: string, size: number): Case => {
  const expected = responseBody(size)
  return ({
    name,
    description:
      `Collect an uncached ${size}-byte binary fetch, including subscription readiness and transfer; exact verification excluded`,
    strider: (page, origin) =>
      Effect.scoped(Effect.gen(function*() {
        const url = `${origin}/benchmark/body?size=${size}`
        const next = yield* NetworkResponse.next(page, { url, body: (message) => message.arrayBuffer })
        yield* page.evaluateInMainWorld((url: string) => {
          void fetch(url).then((r) => r.arrayBuffer())
        }, url)
        const response = yield* next
        return new Uint8Array(response.body)
      })),
    playwright: async (page, origin) => {
      const url = `${origin}/benchmark/body?size=${size}`
      const next = page.waitForResponse(url)
      await page.evaluate((url) => {
        void fetch(url).then((r) => r.arrayBuffer())
      }, url)
      return (await next).body()
    },
    verify: (value) => {
      assert.ok(value instanceof Uint8Array)
      assert.ok(Buffer.from(value).equals(expected), "Response body bytes or length differ")
    }
  })
}

// One synchronous page-side turn: fields in a row share an observation moment.
const snapshot = () =>
  Array.from(document.querySelectorAll("input"), (input) => ({
    id: input.id,
    value: input.value,
    disabled: input.disabled,
    label: input.getAttribute("aria-label")
  }))

const snapshots: ReadonlyArray<Case> = [100, 1000].map((size) => ({
  name: `read-snapshot-${size}`,
  description:
    `One coherent main-world snapshot of ${size} inputs and four properties; includes query, serialization and decoding`,
  fixture: `/benchmark-reads?n=${size}`,
  strider: (page) => page.evaluateInMainWorld(snapshot),
  playwright: (page) => page.evaluate(snapshot),
  verify: equals(Array.from({ length: size }, (_, i) => ({
    id: `field-${i}`,
    value: `Value ${i} café`,
    disabled: i % 2 === 0,
    label: i % 3 === 0 ? null : `Field ${i}`
  })))
}))

export const cases: ReadonlyArray<Case> = [
  bodyCase("response-body-small", 4096),
  bodyCase("response-body-large", 4 * 1024 * 1024),
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
    name: "locator-values",
    description: "20 sequential independent input value reads across distinct elements (ms per batch)",
    fixture: "/benchmark-reads?n=20",
    strider: (page) =>
      Effect.forEach(Array.from({ length: 20 }, (_, i) => i), (i) => page.locator(`#field-${i}`).readValue),
    playwright: async (page) => {
      const values = []
      for (let i = 0; i < 20; i++) values.push(await page.locator(`#field-${i}`).inputValue())
      return values
    },
    verify: equals(Array.from({ length: 20 }, (_, i) => `Value ${i} café`))
  },
  ...snapshots,
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
    prepareStrider: (page) => page.evaluateInMainWorld(prepareViewportCapture),
    preparePlaywright: (page) => page.evaluate(prepareViewportCapture),
    verify: (value) => verifyViewportPng(value)
  }
]

const prepareCapture = () => {
  document.body.style.cssText = "margin:0;width:1280px;height:2880px;background:rgb(12,34,56)"
  document.body.innerHTML =
    "<div id=\"capture\" style=\"position:absolute;left:20px;top:30px;width:320px;height:180px;background:rgb(200,100,50)\"></div>"
}
const prepareDenseCapture = () => {
  document.body.style.cssText = "margin:0;width:1280px;height:2880px"
  document.body.innerHTML = "<canvas width=\"1280\" height=\"2880\" style=\"display:block\"></canvas>"
  const context = document.querySelector("canvas")!.getContext("2d")!
  const image = context.createImageData(1280, 2880)
  let seed = 42
  for (let at = 0; at < image.data.length; at += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    image.data[at] = seed & 255
    image.data[at + 1] = (seed >>> 8) & 255
    image.data[at + 2] = (seed >>> 16) & 255
    image.data[at + 3] = 255
  }
  image.data.set([12, 34, 56, 255], 0)
  context.putImageData(image, 0, 0)
}
const verifyPng = (width: number, height: number, rgb?: ReadonlyArray<number>) => (value: unknown) => {
  assert.ok(value instanceof Uint8Array)
  const bytes = Buffer.from(value)
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
  assert.equal(bytes.readUInt32BE(16), width)
  assert.equal(bytes.readUInt32BE(20), height)
  if (rgb !== undefined) {
    assert.equal(bytes[24], 8, "8-bit PNG")
    assert.ok(bytes[25] === 2 || bytes[25] === 6, "RGB or RGBA PNG")
    const chunks = []
    for (let at = 8; at < bytes.length;) {
      const length = bytes.readUInt32BE(at)
      if (bytes.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length))
      at += length + 12
    }
    // At the first pixel all PNG filter predictors are zero.
    const raw = inflateSync(Buffer.concat(chunks))
    assert.deepEqual([...raw.subarray(1, 4)], rgb)
  }
}
// Reconstruct every PNG row and compare every dense-fixture pixel, outside the timer. Chromium may
// choose RGB or RGBA and any of the five PNG row filters; compressed bytes themselves are not stable.
const verifyPngRows = (
  value: unknown,
  width: number,
  height: number,
  visit: (row: Uint8Array, y: number, channels: number) => void
) => {
  verifyPng(width, height)(value)
  const bytes = Buffer.from(value as Uint8Array)
  assert.equal(bytes[28], 0, "non-interlaced PNG")
  assert.equal(bytes[24], 8, "8-bit PNG")
  assert.ok(bytes[25] === 2 || bytes[25] === 6, "RGB or RGBA PNG")
  const channels = bytes[25] === 6 ? 4 : 3
  const chunks = []
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at)
    if (bytes.toString("ascii", at + 4, at + 8) === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  assert.equal(raw.length, (stride + 1) * height)
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1)
    const filter = raw[offset]!
    assert.ok(filter <= 4, "valid PNG filter")
    for (let x = 0; x < stride; x++) {
      const left = x < channels ? 0 : row[x - channels]!
      const up = previous[x]!
      const upperLeft = x < channels ? 0 : previous[x - channels]!
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = Math.floor((left + up) / 2)
      else if (filter === 4) {
        const p = left + up - upperLeft
        const a = Math.abs(p - left)
        const b = Math.abs(p - up)
        const c = Math.abs(p - upperLeft)
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft
      }
      row[x] = (raw[offset + 1 + x]! + predictor) & 255
    }
    visit(row, y, channels)
    const swap = previous
    previous = row
    row = swap
  }
}
const verifyDensePng = (value: unknown) => {
  let seed = 42
  verifyPngRows(value, 1280, 2880, (row, y, channels) => {
    for (let x = 0; x < 1280; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const at = x * channels
      const first = x === 0 && y === 0
      // Avoid millions of assertion allocations; report the first differing coordinate.
      if (
        row[at] !== (first ? 12 : seed & 255) || row[at + 1] !== (first ? 34 : (seed >>> 8) & 255) ||
        row[at + 2] !== (first ? 56 : (seed >>> 16) & 255) || (channels === 4 && row[at + 3] !== 255)
      ) {
        assert.fail(`Dense PNG differs at ${x},${y}`)
      }
    }
  })
}

// Static marker preparation is outside timing; no frames, waits or additional capture calls are added.
const prepareViewportCapture = () => {
  for (const [left, color] of [[0, "rgb(200,40,60)"], [600, "rgb(30,170,90)"], [1216, "rgb(50,80,220)"]] as const) {
    const marker = document.createElement("div")
    marker.style.cssText =
      `position:fixed;left:${left}px;top:650px;width:64px;height:64px;background:${color};z-index:2147483647;pointer-events:none`
    document.body.append(marker)
  }
}
const verifyViewportPng = (value: unknown) =>
  verifyPngRows(value, 1280, 720, (row, y, channels) => {
    if (y < 650 || y >= 714) return
    for (const [left, rgb] of [[0, [200, 40, 60]], [600, [30, 170, 90]], [1216, [50, 80, 220]]] as const) {
      for (let x = left; x < left + 64; x++) {
        const at = x * channels
        if (
          row[at] !== rgb[0] || row[at + 1] !== rgb[1] || row[at + 2] !== rgb[2] ||
          (channels === 4 && row[at + 3] !== 255)
        ) assert.fail(`Viewport PNG differs at ${x},${y}`)
      }
    }
  })
export const captureCases: ReadonlyArray<Case> = [
  {
    name: "screenshot-dense",
    description: "Capture a seeded dense 1280 by 2880 canvas full page as PNG; setup excluded",
    prepareStrider: (page) => page.evaluateInMainWorld(prepareDenseCapture),
    preparePlaywright: (page) => page.evaluate(prepareDenseCapture),
    strider: (page) => page.screenshot({ area: { _tag: "FullPage" } }),
    playwright: (page) => page.screenshot({ type: "png", fullPage: true }),
    verify: verifyDensePng
  },
  {
    name: "screenshot-repeated",
    prepareStrider: (page) => page.evaluateInMainWorld(prepareViewportCapture),
    preparePlaywright: (page) => page.evaluate(prepareViewportCapture),
    description: "Five sequential viewport PNG captures on one prepared page (ms per batch)",
    strider: (page) => Effect.forEach(Array.from({ length: 5 }), () => page.screenshot()),
    playwright: async (page) => {
      const images = []
      for (let i = 0; i < 5; i++) images.push(await page.screenshot({ type: "png" }))
      return images
    },
    verify: (value) => {
      assert.ok(Array.isArray(value))
      assert.equal(value.length, 5)
      value.forEach(verifyViewportPng)
    }
  },
  {
    name: "screenshot-large",
    description: "Capture a prepared 1280 by 2880 full page as PNG; fixture setup excluded",
    prepareStrider: (page) => page.evaluateInMainWorld(prepareCapture),
    preparePlaywright: (page) => page.evaluate(prepareCapture),
    strider: (page) => page.screenshot({ area: { _tag: "FullPage" } }),
    playwright: (page) => page.screenshot({ type: "png", fullPage: true }),
    verify: verifyPng(1280, 2880, [12, 34, 56])
  },
  {
    name: "screenshot-element",
    description: "Capture a prepared visible 320 by 180 element as PNG; fixture setup excluded",
    prepareStrider: (page) => page.evaluateInMainWorld(prepareCapture),
    preparePlaywright: (page) => page.evaluate(prepareCapture),
    strider: (page) => page.screenshot({ area: { _tag: "Element", locator: page.locator("#capture") } }),
    playwright: (page) => page.locator("#capture").screenshot({ type: "png" }),
    verify: verifyPng(320, 180, [200, 100, 50])
  }
]
