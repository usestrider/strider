import { assert, describe, it } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { TestRun } from "@usestrider/browser/test"
import { SnapshotBaseline } from "@usestrider/vitest"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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
const text = (value: string) => new TextEncoder().encode(value)

const harness = (info = { protocol: "cdp", product: "Chrome/155.0" }) => {
  const directory = mkdtempSync(join(tmpdir(), "strider-snapshots-"))
  const attached: Array<string> = []
  const testRun: TestRun.TestRun = {
    info: new TestRun.TestInfo({
      project: "",
      file: join(directory, "invoice.test.ts"),
      id: "invoice",
      attempt: 0,
      repeat: 0,
      worker: "",
      shard: ""
    }),
    attach: (artifact) => Effect.sync(() => attached.push((artifact as { screenshot: string }).screenshot))
  }
  const browser = { info } as unknown as Browser.Browser
  const provide = (update: SnapshotBaseline.Update) =>
  <A, E>(
    effect: Effect.Effect<A, E, Browser.Browser | TestRun.TestRun>
  ) =>
    effect.pipe(
      Effect.provideService(Browser.Browser, browser),
      Effect.provideService(TestRun.TestRun, testRun),
      Effect.provideService(SnapshotBaseline.CurrentSettings, {
        update,
        outputDirectory: join(directory, "results")
      })
    )
  const baselineOf = (stem: string, extension: string) =>
    join(directory, "__baselines__", "invoice.test.ts", `${stem}-chromium-${process.platform}.${extension}`)
  return { attached, baselineOf, directory, provide }
}

const reasonOf = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.flip(effect).pipe(
    Effect.map((error) => (error as SnapshotBaseline.SnapshotBaselineError).reason)
  )

describe("SnapshotBaseline.toMatch", () => {
  it("keeps a test file ending in .snap apart from another test's Vitest snapshot", () => {
    const directory = mkdtempSync(join(tmpdir(), "strider-snapshot-paths-"))
    try {
      // A suite can include custom test file extensions; Key accepts these paths too.
      const vitestSnapshot = join(directory, "__snapshots__", "invoice.test.ts.snap")
      mkdirSync(dirname(vitestSnapshot), { recursive: true })
      writeFileSync(vitestSnapshot, "// Vitest Snapshot v1\n")
      const baseline = SnapshotBaseline.defaultPath({
        testFile: join(directory, "invoice.test.ts.snap"),
        name: "invoice.pdf",
        browser: "chromium",
        platform: "linux"
      })
      assert.doesNotThrow(() => mkdirSync(dirname(baseline), { recursive: true }))
      writeFileSync(baseline, "%PDF-1")
      assert.strictEqual(readFileSync(vitestSnapshot, "utf8"), "// Vitest Snapshot v1\n")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it.effect("writes a missing baseline with the name's extension, failing under missing and passing under all", () =>
    Effect.gen(function*() {
      const { attached, baselineOf, provide } = harness()
      const baseline = baselineOf("invoice", "pdf")
      const reason = yield* reasonOf(SnapshotBaseline.toMatch(text("%PDF-1"), "invoice.pdf").pipe(provide("missing")))
      assert.deepInclude(reason, { _tag: "MissingBaseline", baseline, written: true })
      assert.deepStrictEqual(readFileSync(baseline, "utf8"), "%PDF-1")
      assert.deepStrictEqual(attached, [])
      yield* pipe(text("%PDF-1"), SnapshotBaseline.toMatch("invoice.pdf"), provide("none"))
      yield* SnapshotBaseline.toMatch(text("%PDF-2"), "receipt.pdf").pipe(provide("all"))
      assert.strictEqual(readFileSync(baselineOf("receipt", "pdf"), "utf8"), "%PDF-2")
    }))

  it.effect("writes nothing under none", () =>
    Effect.gen(function*() {
      const { baselineOf, provide } = harness()
      const reason = yield* reasonOf(SnapshotBaseline.toMatch(text("a"), "data.bin").pipe(provide("none")))
      assert.deepInclude(reason, { _tag: "MissingBaseline", written: false })
      assert.isFalse(existsSync(baselineOf("data", "bin")))
    }))

  it.effect("compares any other extension byte for byte, writing the actual and expected files", () =>
    Effect.gen(function*() {
      const { attached, baselineOf, provide } = harness()
      const baseline = baselineOf("data", "bin")
      yield* SnapshotBaseline.toMatch(Uint8Array.of(1, 2, 3, 4), "data.bin").pipe(provide("all"))
      const reason = yield* reasonOf(
        SnapshotBaseline.toMatch(Uint8Array.of(1, 2, 9), "data.bin").pipe(provide("none"))
      )
      assert.deepInclude(reason, {
        _tag: "BytesMismatch",
        baseline,
        firstDifference: 2,
        actualLength: 3,
        expectedLength: 4
      })
      const mismatch = reason as SnapshotBaseline.BytesMismatch
      assert.match(mismatch.actual, /data-chromium-[a-z0-9_]+-actual\.bin$/)
      assert.deepStrictEqual([...readFileSync(mismatch.actual)], [1, 2, 9])
      assert.deepStrictEqual([...readFileSync(mismatch.expected)], [1, 2, 3, 4])
      // Only images are attached
      assert.deepStrictEqual(attached, [])
      yield* SnapshotBaseline.toMatch(Uint8Array.of(1, 2, 9), "data.bin").pipe(provide("all"))
      assert.deepStrictEqual([...readFileSync(baseline)], [1, 2, 9])
    }))

  it.effect("compares a JPEG byte for byte", () =>
    Effect.gen(function*() {
      const { provide } = harness()
      yield* SnapshotBaseline.toMatch(Uint8Array.of(0xff, 0xd8, 1), "photo.jpg").pipe(provide("all"))
      const reason = yield* reasonOf(
        SnapshotBaseline.toMatch(Uint8Array.of(0xff, 0xd8, 2), "photo.jpg").pipe(provide("none"))
      )
      assert.strictEqual(reason._tag, "BytesMismatch")
    }))

  it.effect("compares a PNG by pixels within the limits, writing and attaching its images", () =>
    Effect.gen(function*() {
      const { attached, baselineOf, provide } = harness()
      const baseline = baselineOf("chart", "png")
      const base = solid(10, 10, white)
      yield* SnapshotBaseline.toMatch(Png.encode(base), "chart.png").pipe(provide("all"))
      // Different bytes, but no pixel past the threshold
      yield* SnapshotBaseline.toMatch(Png.encode(paint(base, 0, 0, [250, 250, 250, 255])), "chart.png").pipe(
        provide("none")
      )
      const changed = paint(paint(base, 1, 1, black), 8, 8, black)
      const reason = yield* reasonOf(SnapshotBaseline.toMatch(Png.encode(changed), "chart.png").pipe(provide("none")))
      assert.deepInclude(reason, { _tag: "Mismatch", baseline, diffPixels: 2, diffPixelRatio: 0.02 })
      const mismatch = reason as SnapshotBaseline.Mismatch
      assert.deepStrictEqual(attached, [mismatch.actual, mismatch.expected, mismatch.diff])
      assert.deepStrictEqual(Png.decode(readFileSync(mismatch.actual)), changed)
      assert.deepStrictEqual(Png.decode(readFileSync(mismatch.expected)), base)
      const check = (options: SnapshotBaseline.Options) =>
        SnapshotBaseline.toMatch(Png.encode(changed), "chart.png", options).pipe(provide("none"), Effect.exit)
      assert.strictEqual((yield* check({ maxDiffPixels: 2 }))._tag, "Success")
      assert.strictEqual((yield* check({ maxDiffPixelRatio: 0.02 }))._tag, "Success")
      assert.strictEqual((yield* check({ maxDiffPixels: 2, maxDiffPixelRatio: 0.01 }))._tag, "Failure")
      assert.strictEqual((yield* check({ maxDiffPixels: 1 }))._tag, "Failure")
    }))

  it.effect("fails a PNG size mismatch, and rewrites under all", () =>
    Effect.gen(function*() {
      const { attached, baselineOf, provide } = harness()
      yield* SnapshotBaseline.toMatch(Png.encode(solid(4, 4, white)), "chart.png").pipe(provide("all"))
      const reason = yield* reasonOf(
        SnapshotBaseline.toMatch(Png.encode(solid(5, 4, white)), "chart.png").pipe(provide("none"))
      )
      assert.deepInclude(reason, {
        _tag: "SizeMismatch",
        expectedSize: { width: 4, height: 4 },
        actualSize: { width: 5, height: 4 }
      })
      assert.strictEqual(attached.length, 2)
      yield* SnapshotBaseline.toMatch(Png.encode(solid(5, 4, white)), "chart.png").pipe(provide("all"))
      assert.strictEqual(Png.decode(readFileSync(baselineOf("chart", "png"))).width, 5)
    }))

  it.effect("refuses a value that isn't a PNG for a .png name, writing nothing", () =>
    Effect.gen(function*() {
      const { baselineOf, provide } = harness()
      const reason = yield* reasonOf(SnapshotBaseline.toMatch(text("not an image"), "chart.png").pipe(provide("all")))
      assert.deepInclude(reason, { _tag: "InvalidValue" })
      assert.isFalse(existsSync(baselineOf("chart", "png")))
    }))

  it.effect("refuses an unreadable PNG baseline unless updating all", () =>
    Effect.gen(function*() {
      const { baselineOf, provide } = harness()
      const baseline = baselineOf("chart", "png")
      yield* SnapshotBaseline.toMatch(Png.encode(solid(2, 2, white)), "chart.png").pipe(provide("all"))
      writeFileSync(baseline, "garbage")
      const reason = yield* reasonOf(
        SnapshotBaseline.toMatch(Png.encode(solid(2, 2, white)), "chart.png").pipe(provide("none"))
      )
      assert.deepInclude(reason, { _tag: "InvalidBaseline", baseline })
      yield* SnapshotBaseline.toMatch(Png.encode(solid(2, 2, white)), "chart.png").pipe(provide("all"))
      assert.strictEqual(Png.decode(readFileSync(baseline)).width, 2)
    }))

  it.effect("refuses a name without an extension, or outside the name rule", () =>
    Effect.gen(function*() {
      const { directory, provide } = harness()
      for (const name of ["invoice", "invoice.", ".pdf", "Invoice.pdf", "invoice.p-f", "a/b.pdf"]) {
        const reason = yield* reasonOf(SnapshotBaseline.toMatch(text("x"), name).pipe(provide("all")))
        assert.deepInclude(reason, { _tag: "InvalidName", name })
      }
      assert.isFalse(existsSync(join(directory, "__baselines__")))
    }))

  it("keys the default path by file, name, browser and platform, keeping the extension", () => {
    assert.strictEqual(
      SnapshotBaseline.defaultPath({
        testFile: "/r/a.test.ts",
        name: "report.v2.pdf",
        browser: "firefox",
        platform: "linux"
      }),
      "/r/__baselines__/a.test.ts/report.v2-firefox-linux.pdf"
    )
    // A Vitest snapshot file sits beside the directory, never in it
    assert.notStrictEqual(
      SnapshotBaseline.defaultPath({ testFile: "/r/a.test.ts", name: "a.snap", browser: "firefox", platform: "linux" }),
      "/r/__snapshots__/a.test.ts.snap"
    )
    assert.throws(() =>
      SnapshotBaseline.defaultPath({ testFile: "/r/a.test.ts", name: "report", browser: "firefox", platform: "linux" })
    )
    assert.throws(() =>
      SnapshotBaseline.defaultPath({ testFile: "/r/a.test.ts", name: "a.pdf", browser: "fire-fox", platform: "linux" })
    )
  })

  it.effect("keys the browser by its engine, as screenshots do", () =>
    Effect.gen(function*() {
      const { directory, provide } = harness({ protocol: "bidi", product: "firefox" })
      yield* SnapshotBaseline.toMatch(text("a"), "a.txt").pipe(provide("all"))
      assert.isTrue(
        existsSync(join(directory, "__baselines__", "invoice.test.ts", `a-firefox-${process.platform}.txt`))
      )
    }))

  it.effect("reads Vitest's update state by default", () =>
    Effect.gen(function*() {
      const { baselineOf, provide } = harness()
      const reason = yield* reasonOf(
        SnapshotBaseline.toMatch(text("a"), "a.txt").pipe(
          Effect.provideService(SnapshotBaseline.CurrentSettings, {}),
          provide("none")
        )
      )
      assert.deepInclude(reason, { _tag: "MissingBaseline", written: !process.env["CI"] })
      assert.strictEqual(existsSync(baselineOf("a", "txt")), !process.env["CI"])
    }))
})
