import { assert, describe, it } from "@effect/vitest"
import { Browser, type Page } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { ScreenshotBaseline } from "@usestrider/vitest"
import * as Effect from "effect/Effect"
import { pipeArguments } from "effect/Pipeable"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { crc32, deflateSync } from "node:zlib"
import { compare } from "../src/internal/pixelmatch.ts"
import * as Png from "../src/internal/png.ts"

const solid = (width: number, height: number, rgba: readonly [number, number, number, number]): Png.Image => {
  const data = new Uint8Array(width * height * 4)
  for (let index = 0; index < width * height; index++) data.set(rgba, index * 4)
  return { width, height, data }
}

const paint = (image: Png.Image, x: number, y: number, rgba: readonly [number, number, number, number]) => {
  const data = new Uint8Array(image.data)
  data.set(rgba, (y * image.width + x) * 4)
  return { ...image, data }
}

const white = [255, 255, 255, 255] as const
const black = [0, 0, 0, 255] as const

describe("png", () => {
  it("round-trips RGBA", () => {
    const image = paint(paint(solid(3, 2, white), 1, 0, [10, 20, 30, 40]), 2, 1, black)
    const decoded = Png.decode(Png.encode(image))
    assert.deepStrictEqual(decoded, image)
  })

  it("decodes each filter and the palette colour type", () => {
    // A 2×2 palette image, rows filtered with Sub then Up, and a transparent second entry
    const chunk = (type: string, body: Uint8Array) => {
      const out = Buffer.alloc(12 + body.length)
      out.writeUInt32BE(body.length, 0)
      out.write(type, 4, "latin1")
      Buffer.from(body).copy(out, 8)
      out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
      return out
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0)
    header.writeUInt32BE(2, 4)
    header.set([8, 3, 0, 0, 0], 8)
    const raw = Uint8Array.of(1, 0, 1, 2, 0, 0)
    const bytes = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("PLTE", Uint8Array.of(255, 0, 0, 0, 255, 0)),
      chunk("tRNS", Uint8Array.of(255, 0)),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", new Uint8Array())
    ])
    assert.deepStrictEqual(
      [...Png.decode(bytes).data],
      [255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0]
    )
  })

  it("refuses a PNG with a corrupt chunk checksum", () => {
    const bytes = Uint8Array.from(Png.encode(solid(1, 1, white)))
    // Damage only the IHDR checksum, leaving the image and header readable.
    bytes[29] = bytes[29]! ^ 1
    assert.throws(() => Png.decode(bytes), Png.PngError)
  })

  it("refuses what it doesn't read", () => {
    assert.throws(() => Png.decode(Uint8Array.of(1, 2, 3)), /signature/)
    const sixteen = Buffer.from(Png.encode(solid(1, 1, white)))
    sixteen[24] = 16 // IHDR's bit depth
    assert.throws(() => Png.decode(sixteen), /bit depth 16/)
  })
})

describe("pixelmatch", () => {
  it("counts a pixel past the threshold, and none within it", () => {
    const base = solid(5, 5, white)
    assert.strictEqual(compare(base, paint(base, 2, 2, black), 0.2).diffPixels, 1)
    assert.strictEqual(compare(base, paint(base, 2, 2, [250, 250, 250, 255]), 0.2).diffPixels, 0)
    assert.strictEqual(compare(base, paint(base, 2, 2, [250, 250, 250, 255]), 0).diffPixels, 1)
  })

  it("doesn't count anti-aliasing at an edge", () => {
    // Black left half, white right half; the actual image greys one pixel on the edge
    let base = solid(6, 6, white)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 3; x++) base = paint(base, x, y, black)
    const smoothed = paint(base, 3, 3, [128, 128, 128, 255])
    const result = compare(base, smoothed, 0.1)
    assert.strictEqual(result.diffPixels, 0)
    assert.deepStrictEqual([...result.diff.data.subarray((3 * 6 + 3) * 4, (3 * 6 + 3) * 4 + 4)], [255, 255, 0, 255])
  })
})

/** A page whose captures are the given images in turn, the last repeating. */
const fakePage = (images: ReadonlyArray<Png.Image>) => {
  let index = 0
  return {
    screenshot: () => Effect.sync(() => Png.encode(images[Math.min(index++, images.length - 1)]!)),
    pipe() {
      return pipeArguments(this, arguments)
    }
  } as unknown as Page.ReadonlyPage
}

const harness = (info = { protocol: "cdp", product: "Chrome/155.0" }) => {
  const directory = mkdtempSync(join(tmpdir(), "strider-screenshots-"))
  const attached: Array<string> = []
  const testRun: TestRun.TestRun = {
    info: new TestRun.TestInfo({
      project: "",
      file: join(directory, "checkout.test.ts"),
      id: "checkout",
      attempt: 0,
      repeat: 0,
      worker: "",
      shard: ""
    }),
    attach: (artifact) => Effect.sync(() => attached.push((artifact as { screenshot: string }).screenshot))
  }
  const browser = { info } as unknown as Browser.Browser
  const provide = (update: ScreenshotBaseline.Update) =>
  <A, E>(
    effect: Effect.Effect<A, E, Browser.Browser | TestRun.TestRun>
  ) =>
    effect.pipe(
      Effect.provideService(Browser.Browser, browser),
      Effect.provideService(TestRun.TestRun, testRun),
      Effect.provideService(ScreenshotBaseline.CurrentSettings, {
        update,
        outputDirectory: join(directory, "results")
      })
    )
  const baseline = join(directory, "__screenshots__", "checkout.test.ts", `cart-chromium-${process.platform}.png`)
  return { attached, baseline, directory, provide }
}

const reasonOf = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.flip(effect).pipe(
    Effect.map((error) => (error as ScreenshotBaseline.ScreenshotBaselineError).reason)
  )

describe("ScreenshotBaseline.toMatch", () => {
  it.effect("writes a missing baseline and fails under missing", () =>
    Effect.gen(function*() {
      const { attached, baseline, provide } = harness()
      const image = solid(4, 4, white)
      const reason = yield* reasonOf(
        fakePage([solid(4, 4, black), image]).pipe(ScreenshotBaseline.toMatch("cart"), provide("missing"))
      )
      assert.deepInclude(reason, { _tag: "MissingBaseline", baseline, written: true })
      // Written only once two captures agree
      assert.deepStrictEqual(Png.decode(readFileSync(baseline)), image)
      assert.deepStrictEqual(attached, [])
      yield* fakePage([image]).pipe(ScreenshotBaseline.toMatch("cart"), provide("none"))
    }))

  it.effect("writes nothing under none", () =>
    Effect.gen(function*() {
      const { baseline, provide } = harness()
      const reason = yield* reasonOf(
        fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("none"))
      )
      assert.deepInclude(reason, { _tag: "MissingBaseline", written: false })
      assert.isFalse(existsSync(baseline))
    }))

  it.effect("passes once a capture matches", () =>
    Effect.gen(function*() {
      const { attached, baseline, provide } = harness()
      yield* fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      assert.isTrue(existsSync(baseline))
      // A moving first capture, then the settled page
      yield* fakePage([solid(4, 4, black), solid(4, 4, white)]).pipe(
        ScreenshotBaseline.toMatch("cart"),
        provide("none")
      )
      assert.deepStrictEqual(attached, [])
    }))

  it.effect("fails a settled mismatch, writing and attaching its images, within the pixel limits", () =>
    Effect.gen(function*() {
      const { attached, baseline, provide } = harness()
      const base = solid(10, 10, white)
      yield* fakePage([base]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      const changed = paint(paint(base, 1, 1, black), 8, 8, black)
      const reason = yield* reasonOf(fakePage([changed]).pipe(ScreenshotBaseline.toMatch("cart"), provide("none")))
      assert.deepInclude(reason, { _tag: "Mismatch", baseline, diffPixels: 2, diffPixelRatio: 0.02 })
      const mismatch = reason as ScreenshotBaseline.Mismatch
      assert.deepStrictEqual(attached, [mismatch.actual, mismatch.expected, mismatch.diff])
      assert.deepStrictEqual(Png.decode(readFileSync(mismatch.actual)), changed)
      assert.deepStrictEqual(Png.decode(readFileSync(mismatch.expected)), base)
      assert.strictEqual(Png.decode(readFileSync(mismatch.diff)).width, 10)
      const check = (options: ScreenshotBaseline.Options) =>
        fakePage([changed]).pipe(ScreenshotBaseline.toMatch("cart", options), provide("none"), Effect.exit)
      assert.strictEqual((yield* check({ maxDiffPixels: 2 }))._tag, "Success")
      assert.strictEqual((yield* check({ maxDiffPixelRatio: 0.02 }))._tag, "Success")
      assert.strictEqual((yield* check({ maxDiffPixels: 2, maxDiffPixelRatio: 0.01 }))._tag, "Failure")
      assert.strictEqual((yield* check({ maxDiffPixels: 1 }))._tag, "Failure")
    }))

  it.effect("fails a size mismatch, and rewrites under all", () =>
    Effect.gen(function*() {
      const { baseline, provide } = harness()
      yield* fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      const reason = yield* reasonOf(
        fakePage([solid(5, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("missing"))
      )
      assert.deepInclude(reason, {
        _tag: "SizeMismatch",
        expectedSize: { width: 4, height: 4 },
        actualSize: { width: 5, height: 4 }
      })
      yield* fakePage([solid(5, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      assert.strictEqual(Png.decode(readFileSync(baseline)).width, 5)
    }))

  it.effect("refuses an unreadable baseline unless updating all", () =>
    Effect.gen(function*() {
      const { baseline, provide } = harness()
      yield* fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      writeFileSync(baseline, "not a png")
      const reason = yield* reasonOf(
        fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("missing"))
      )
      assert.deepInclude(reason, { _tag: "InvalidBaseline", baseline })
      yield* fakePage([solid(4, 4, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
      assert.strictEqual(Png.decode(readFileSync(baseline)).width, 4)
    }))

  it.effect("keeps Safari and Firefox baselines separate over BiDi", () =>
    Effect.gen(function*() {
      const keys: Array<string> = []
      for (const product of ["firefox", "Safari"]) {
        const { provide } = harness({ protocol: "bidi", product })
        yield* fakePage([solid(1, 1, white)]).pipe(
          ScreenshotBaseline.toMatch("cart"),
          Effect.provideService(ScreenshotBaseline.CurrentSettings, {
            update: "none",
            path: (key) => {
              keys.push(key.browser)
              return ScreenshotBaseline.defaultPath(key)
            }
          }),
          provide("none"),
          Effect.exit
        )
      }
      assert.notStrictEqual(keys[0], keys[1])
    }))

  it.effect("keeps failure artifacts from different test files separate", () =>
    Effect.gen(function*() {
      const outputDirectory = mkdtempSync(join(tmpdir(), "strider-shared-results-"))
      const paths: Array<string> = []
      // Each harness has a different directory but the same test-file basename.
      for (let index = 0; index < 2; index++) {
        const { attached, provide } = harness()
        yield* fakePage([solid(1, 1, white)]).pipe(ScreenshotBaseline.toMatch("cart"), provide("all"))
        yield* fakePage([solid(1, 1, black)]).pipe(
          ScreenshotBaseline.toMatch("cart"),
          Effect.provideService(ScreenshotBaseline.CurrentSettings, { update: "none", outputDirectory }),
          provide("none"),
          Effect.exit
        )
        assert.strictEqual(attached.length, 3)
        paths.push(...attached)
      }
      assert.strictEqual(new Set(paths).size, 6)
    }))

  it("keeps distinct baseline names separate", () => {
    const key = { testFile: "/r/a.test.ts", browser: "chromium", platform: "linux" }
    assert.notStrictEqual(
      ScreenshotBaseline.defaultPath({ ...key, name: "cart/total" }),
      ScreenshotBaseline.defaultPath({ ...key, name: "cart-total" })
    )
  })

  it("keys the default path by file, name, browser and platform", () => {
    assert.strictEqual(
      ScreenshotBaseline.defaultPath({
        testFile: "/r/a.test.ts",
        name: "cart/total",
        browser: "firefox",
        platform: "linux"
      }),
      "/r/__screenshots__/a.test.ts/cart-total-firefox-linux.png"
    )
  })

  it.effect("reads Vitest's update state by default", () =>
    Effect.gen(function*() {
      const { baseline, provide } = harness()
      // This run isn't `-u`; locally Vitest's state is "new", on CI "none"
      const reason = yield* reasonOf(
        fakePage([solid(4, 4, white)]).pipe(
          ScreenshotBaseline.toMatch("cart"),
          Effect.provideService(ScreenshotBaseline.CurrentSettings, {}),
          provide("none")
        )
      )
      assert.deepInclude(reason, { _tag: "MissingBaseline", written: !process.env["CI"] })
      assert.strictEqual(existsSync(baseline), !process.env["CI"])
    }))
})
