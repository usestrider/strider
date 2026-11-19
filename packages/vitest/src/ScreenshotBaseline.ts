/**
 * Visual comparison: a page's screenshot checked against a PNG baseline kept beside the test file.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Browser from "@usestrider/browser/Browser"
import type * as Deadline from "@usestrider/browser/Deadline"
import * as FilePath from "@usestrider/browser/FilePath"
import * as Operation from "@usestrider/browser/Operation"
import type * as Page from "@usestrider/browser/Page"
import type * as Target from "@usestrider/browser/Target"
import { TestRun } from "@usestrider/browser/test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { expect } from "vitest"
import { compare } from "./internal/pixelmatch.ts"
import * as Png from "./internal/png.ts"

/**
 * Settings for one comparison: what to capture, and how much may differ.
 *
 * **Details**
 *
 * `area`, `scale`, and `omitBackground` are `Page.screenshot`'s; the image is always PNG. With neither
 * `maxDiffPixels` nor `maxDiffPixelRatio`, no pixel may differ; with either or both, each one given must hold.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Options extends Pick<Page.ScreenshotOptions, "area" | "scale" | "omitBackground"> {
  /** How far, in YIQ colour distance from 0 to 1, a pixel may move before it counts as different. @default 0.2 */
  readonly threshold?: number | undefined
  /** How many pixels may differ. @default undefined */
  readonly maxDiffPixels?: number | undefined
  /** What fraction of the pixels, from 0 to 1, may differ. @default undefined */
  readonly maxDiffPixelRatio?: number | undefined
}

/**
 * When baselines are written: `"none"`, never; `"missing"`, when there is none, failing the assertion all the
 * same; `"all"`, whenever the capture differs, passing it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Update = "none" | "missing" | "all"

/**
 * What names a baseline: the test file, the name given to `toMatch`, the browser engine, and the platform.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Key {
  /** The test file's absolute path. */
  readonly testFile: string
  /** The name given to `toMatch`. */
  readonly name: string
  /** `"chromium"`, `"firefox"`, or `"webkit"`, from the browser's protocol; no version. */
  readonly browser: string
  /** Node's `process.platform`, such as `"linux"` or `"darwin"`. */
  readonly platform: string
}

/**
 * Where baselines live, when they are written, and where failures leave their images.
 *
 * **Details**
 *
 * Every field is optional and has a default, so a suite that never compares screenshots configures nothing.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Settings {
  /**
   * When baselines are written. By default, Vitest's snapshot update state: `vitest -u` is `"all"`, a local run
   * `"missing"`, and a run on CI (Vitest's `CI` detection) `"none"`.
   *
   * @default Vitest's snapshot update state
   */
  readonly update?: Update | undefined
  /**
   * The baseline's path for a key.
   *
   * @default `<test file's directory>/__screenshots__/<test file's name>/<name>-<browser>-<platform>.png`
   */
  readonly path?: ((key: Key) => string) | undefined
  /**
   * The directory a failure writes its actual, expected, and diff images to, under
   * `<test file's name>/<name>-<browser>-<platform>-{actual,expected,diff}.png`; relative paths resolve from
   * the working directory.
   *
   * @default ".vitest-screenshots"
   */
  readonly outputDirectory?: string | undefined
}

/**
 * Reference to the comparison settings, read by each `toMatch`.
 *
 * **Example** (Keeping baselines in one directory)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const withBaselines = Effect.provideService(ScreenshotBaseline.CurrentSettings, {
 *   path: (key) => `baselines/${key.browser}/${key.name}.png`,
 *   outputDirectory: ".data/screenshots"
 * })
 * ```
 *
 * @stability unstable
 * @category references
 * @since 0.1.0
 */
export const CurrentSettings: Context.Reference<Settings> = Context.Reference<Settings>(
  "@usestrider/vitest/ScreenshotBaseline/CurrentSettings",
  { defaultValue: () => ({}) }
)

const Size = Schema.Struct({ width: Schema.Int, height: Schema.Int })

/**
 * The capture differs from the baseline by more than the options allow.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Mismatch extends Schema.Error<Mismatch>("@usestrider/vitest/ScreenshotBaseline/Mismatch")({
  _tag: Schema.tag("Mismatch"),
  baseline: Schema.String,
  diffPixels: Schema.Int,
  diffPixelRatio: Schema.Number,
  actual: Schema.String,
  expected: Schema.String,
  diff: Schema.String
}) {
  override get message(): string {
    return `${this.diffPixels} pixels (ratio ${
      this.diffPixelRatio.toFixed(4)
    }) differ from ${this.baseline}; see ${this.diff}`
  }
}

/**
 * The capture and the baseline differ in size.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class SizeMismatch extends Schema.Error<SizeMismatch>("@usestrider/vitest/ScreenshotBaseline/SizeMismatch")({
  _tag: Schema.tag("SizeMismatch"),
  baseline: Schema.String,
  expectedSize: Size,
  actualSize: Size,
  actual: Schema.String,
  expected: Schema.String
}) {
  override get message(): string {
    return `the capture is ${this.actualSize.width}×${this.actualSize.height}, the baseline ${this.baseline} ${this.expectedSize.width}×${this.expectedSize.height}`
  }
}

/**
 * There is no baseline. `written` says whether the capture was written as one, so the next run compares with it.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class MissingBaseline
  extends Schema.Error<MissingBaseline>("@usestrider/vitest/ScreenshotBaseline/MissingBaseline")({
    _tag: Schema.tag("MissingBaseline"),
    baseline: Schema.String,
    written: Schema.Boolean
  })
{
  override get message(): string {
    return this.written
      ? `${this.baseline} was missing, and the capture was written as the baseline`
      : `${this.baseline} is missing; run Vitest with -u to write it`
  }
}

/**
 * The baseline isn't a PNG Strider reads: 8-bit and not interlaced.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class InvalidBaseline
  extends Schema.Error<InvalidBaseline>("@usestrider/vitest/ScreenshotBaseline/InvalidBaseline")({
    _tag: Schema.tag("InvalidBaseline"),
    baseline: Schema.String,
    detail: Schema.String
  })
{
  override get message(): string {
    return `${this.baseline} can't be read: ${this.detail}`
  }
}

const ScreenshotBaselineErrorTypeId = "~@usestrider/vitest/ScreenshotBaseline/ScreenshotBaselineError"

/**
 * The error of a failed comparison; `reason` says which way it failed.
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ScreenshotBaselineError
  extends Schema.TaggedError<ScreenshotBaselineError>(ScreenshotBaselineErrorTypeId)("ScreenshotBaselineError", {
    name: Schema.String,
    reason: Schema.Union([Mismatch, SizeMismatch, MissingBaseline, InvalidBaseline])
  })
{
  readonly [ScreenshotBaselineErrorTypeId] = ScreenshotBaselineErrorTypeId
  override get message(): string {
    return `Screenshot "${this.name}": ${this.reason.message}`
  }
}

/**
 * Checks whether a value is a `ScreenshotBaselineError`.
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isScreenshotBaselineError = (u: unknown): u is ScreenshotBaselineError =>
  Predicate.hasProperty(u, ScreenshotBaselineErrorTypeId)

const engines: Readonly<Record<Browser.Info["protocol"], string>> = {
  cdp: "chromium",
  bidi: "firefox",
  webkit: "webkit",
  fake: "fake"
}

const safe = (part: string): string => part.replace(/[^a-zA-Z0-9._-]+/g, "-")

/** `vitest -u` is `all`, a local run `new`, CI `none`: Vitest's public snapshot state. */
const vitestUpdate = (): Update => {
  const state = expect.getState().snapshotState?.snapshotUpdateState
  return state === "all" ? "all" : state === "new" ? "missing" : "none"
}

/**
 * The default baseline path for a key: Vitest's screenshot layout.
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const defaultPath = (key: Key): string =>
  join(
    dirname(key.testFile),
    "__screenshots__",
    basename(key.testFile),
    `${safe(key.name)}-${safe(key.browser)}-${safe(key.platform)}.png`
  )

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

const write = (path: string, bytes: Uint8Array) =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  })

type Baseline =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Present"; readonly bytes: Uint8Array; readonly image: Png.Image }

const readBaseline = (path: string): Effect.Effect<Baseline> =>
  Effect.promise(() =>
    readFile(path).then(
      (bytes): Baseline => {
        try {
          return { _tag: "Present", bytes, image: Png.decode(bytes) }
        } catch (error) {
          return { _tag: "Invalid", detail: (error as Error).message }
        }
      },
      (error: NodeJS.ErrnoException): Baseline =>
        error.code === "ENOENT" ? { _tag: "Missing" } : { _tag: "Invalid", detail: error.message }
    )
  )

type Verdict =
  | { readonly _tag: "Match" }
  | { readonly _tag: "Size"; readonly actual: Png.Image }
  | { readonly _tag: "Pixels"; readonly diffPixels: number; readonly diff: Png.Image }

const judge = (expected: Png.Image, bytes: Uint8Array, options: Options | undefined): Verdict => {
  const actual = Png.decode(bytes)
  if (actual.width !== expected.width || actual.height !== expected.height) return { _tag: "Size", actual }
  const { diff, diffPixels } = compare(expected, actual, options?.threshold ?? 0.2)
  const pixels = options?.maxDiffPixels
  const ratio = options?.maxDiffPixelRatio
  const total = actual.width * actual.height
  const passes = pixels === undefined && ratio === undefined
    ? diffPixels === 0
    : (pixels === undefined || diffPixels <= pixels) && (ratio === undefined || diffPixels / total <= ratio)
  return passes ? { _tag: "Match" } : { _tag: "Pixels", diffPixels, diff }
}

const run = (
  page: Page.ReadonlyPage,
  name: string,
  options: Options | undefined
): Effect.Effect<
  void,
  ScreenshotBaselineError | Page.PageError | Target.TargetGone | Deadline.Timeout,
  Browser.Browser | TestRun.TestRun
> =>
  Effect.gen(function*() {
    const settings = yield* CurrentSettings
    const test = yield* TestRun.TestRun
    const browser = yield* Browser.Browser
    const key: Key = {
      testFile: test.info.file,
      name,
      browser: engines[browser.info.protocol],
      platform: process.platform
    }
    const path = resolve((settings.path ?? defaultPath)(key))
    const update = settings.update ?? vitestUpdate()
    const output = join(
      resolve(settings.outputDirectory ?? ".vitest-screenshots"),
      basename(key.testFile),
      `${safe(name)}-${safe(key.browser)}-${safe(key.platform)}`
    )
    const capture = page.screenshot({
      area: options?.area,
      scale: options?.scale,
      omitBackground: options?.omitBackground
    })
    const fail = (reason: ScreenshotBaselineError["reason"]) => Effect.fail(new ScreenshotBaselineError({ name, reason }))
    const artifacts = Effect.fnUntraced(function*(images: ReadonlyArray<readonly [string, Uint8Array]>) {
      for (const [suffix, bytes] of images) {
        const file = `${output}-${suffix}.png`
        yield* write(file, bytes)
        yield* test.attach({ screenshot: FilePath.Local.make(file) })
      }
    })
    // Captures until two in a row are the same image: the page has settled.
    const stable = (previous: Uint8Array): Effect.Effect<
      Uint8Array,
      Page.PageError | Target.TargetGone | Deadline.Timeout
    > =>
      Effect.flatMap(capture, (next) => sameBytes(previous, next) ? Effect.succeed(next) : stable(next))

    const baseline = yield* readBaseline(path)
    if (baseline._tag !== "Present") {
      if (baseline._tag === "Invalid" && update !== "all") {
        return yield* fail(new InvalidBaseline({ baseline: path, detail: baseline.detail }))
      }
      if (update === "none") return yield* fail(new MissingBaseline({ baseline: path, written: false }))
      yield* write(path, yield* Effect.flatMap(capture, stable))
      if (update === "all") return
      return yield* fail(new MissingBaseline({ baseline: path, written: true }))
    }
    // Captures until one matches, or until the page settles on an image that doesn't.
    let previous: Uint8Array | undefined
    while (true) {
      const bytes = yield* capture
      const verdict = judge(baseline.image, bytes, options)
      if (verdict._tag === "Match") return
      if (previous === undefined || !sameBytes(previous, bytes)) {
        previous = bytes
        continue
      }
      if (update === "all") return yield* write(path, bytes)
      if (verdict._tag === "Size") {
        yield* artifacts([["actual", bytes], ["expected", baseline.bytes]])
        return yield* fail(
          new SizeMismatch({
            baseline: path,
            expectedSize: { width: baseline.image.width, height: baseline.image.height },
            actualSize: { width: verdict.actual.width, height: verdict.actual.height },
            actual: `${output}-actual.png`,
            expected: `${output}-expected.png`
          })
        )
      }
      yield* artifacts([["actual", bytes], ["expected", baseline.bytes], ["diff", Png.encode(verdict.diff)]])
      return yield* fail(
        new Mismatch({
          baseline: path,
          diffPixels: verdict.diffPixels,
          diffPixelRatio: verdict.diffPixels / (baseline.image.width * baseline.image.height),
          actual: `${output}-actual.png`,
          expected: `${output}-expected.png`,
          diff: `${output}-diff.png`
        })
      )
    }
  }).pipe(Operation.named("ScreenshotBaseline.toMatch", { attributes: { "browser.screenshot.name": name } }))

/**
 * Expects the page's screenshot to match the baseline named `name`, capturing until one matches or the page
 * settles on an image that doesn't.
 *
 * **Details**
 *
 * The baseline is a PNG keyed by test file, `name`, browser engine, and platform (`Key`), at
 * `__screenshots__/<test file>/<name>-<browser>-<platform>.png` beside the test file unless `CurrentSettings`
 * says otherwise. Each attempt captures the page; it passes as soon as one matches. Two identical captures in a
 * row that still differ fail with `Mismatch` or `SizeMismatch`, writing the actual, expected, and (for pixels)
 * diff images to the output directory and attaching them to the test. A page that never settles fails with the
 * operation's `Deadline.Timeout`. Pixels differ by YIQ colour distance past `threshold`, ignoring
 * anti-aliasing.
 *
 * A missing baseline is written from a settled capture under the `"missing"` and `"all"` updates; under
 * `"missing"`, Vitest's default locally, the assertion still fails with `MissingBaseline`, so a first run never
 * passes unseen. Under `"all"` (`vitest -u`), a differing or unreadable baseline is rewritten and it passes.
 * Under `"none"`, Vitest's default on CI, nothing is written. Errors from `page.screenshot`, such as an
 * unsupported `scale`, pass through unchanged.
 *
 * **Gotchas**
 *
 * Fonts, rendering, and device scale differ across machines, which is why the platform is part of the key: write
 * the baselines CI compares with on CI's platform.
 *
 * **Example** (Checking a page and one element)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const checkout = Effect.fn("checkout")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(ScreenshotBaseline.toMatch("checkout"))
 *   const dialog = page.getByRole("dialog")
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("dialog", { area: { element: dialog }, maxDiffPixels: 20 })
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category matchers
 * @since 0.1.0
 */
export const toMatch: {
  (name: string, options?: Options | undefined): (
    page: Page.ReadonlyPage
  ) => Effect.Effect<
    void,
    ScreenshotBaselineError | Page.PageError | Target.TargetGone | Deadline.Timeout,
    Browser.Browser | TestRun.TestRun
  >
  (page: Page.ReadonlyPage, name: string, options?: Options | undefined): Effect.Effect<
    void,
    ScreenshotBaselineError | Page.PageError | Target.TargetGone | Deadline.Timeout,
    Browser.Browser | TestRun.TestRun
  >
} = dual(
  (args) => typeof args[0] !== "string",
  (page: Page.ReadonlyPage, name: string, options?: Options | undefined) => run(page, name, options)
)
