/**
 * Visual comparison: a page's screenshot checked against a PNG baseline kept beside the test file.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Browser from "@usestrider/browser/Browser"
import type * as Deadline from "@usestrider/browser/Deadline"
import * as Operation from "@usestrider/browser/Operation"
import type * as Page from "@usestrider/browser/Page"
import type * as Target from "@usestrider/browser/Target"
import type { TestRun } from "@usestrider/browser/test"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { dual } from "effect/Function"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import { basename, dirname, join } from "node:path"
import * as Baseline from "./internal/baseline.ts"
import * as Png from "./internal/png.ts"

/**
 * Settings for one comparison: what to capture, and how much may differ.
 *
 * **Details**
 *
 * `area`, `scale`, and `omitBackground` are `Page.screenshot`'s; the image is always PNG. With neither
 * `maxDiffPixels` nor `maxDiffPixelRatio`, no pixel may differ; with either or both, each one given must hold.
 *
 * **Example** (Allowing a few pixels to differ)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const options: ScreenshotBaseline.Options = { threshold: 0.1, maxDiffPixels: 20 }
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(ScreenshotBaseline.toMatch("header", options))
 * })
 * ```
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
 * **Example** (Never writing baselines)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const update: ScreenshotBaseline.Update = "none"
 * const readOnly = Effect.provideService(ScreenshotBaseline.CurrentSettings, { update })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Update = "none" | "missing" | "all"

/**
 * Schema for what names a baseline: the test file, the name given to `toMatch`, the browser engine, and the
 * platform.
 *
 * **Details**
 *
 * Every part is a valid file name as it is, and nothing is rewritten: the name matches `^[a-z0-9][a-z0-9._-]*$`,
 * and the browser and platform match `^[a-z0-9_]+$`, so they never contain `-` and
 * `<name>-<browser>-<platform>` reads one way from the right. Names are lower-case so that two never share a file
 * on a case-insensitive filesystem. The browser is `"chromium"` for Chrome and Chromium, `"firefox"`,
 * `"webkit"` for stock WebKit, or `"safari"`; any other product is
 * `other_<its letters and digits, lower-case>_<the first 8 hex digits of the SHA-256 of its name>`, its name being
 * the product without the version after `/`. The platform is Node's `process.platform`, such as `"linux"`.
 *
 * **Example** (Keeping baselines per browser)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 *
 * const path = (key: ScreenshotBaseline.Key) =>
 *   ScreenshotBaseline.defaultPath(key).replace(
 *     "__screenshots__",
 *     `baselines/${key.browser}`
 *   )
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Key = Baseline.Key

/**
 * What names a baseline; `Key` checks it.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Key = typeof Key.Type

/**
 * Where baselines live, when they are written, and where failures leave their images.
 *
 * **Details**
 *
 * Every field is optional and has a default, so a suite that never compares screenshots configures nothing.
 *
 * **Example** (Writing failure images elsewhere)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const settings: ScreenshotBaseline.Settings = { outputDirectory: ".data/screenshots" }
 * const withSettings = Effect.provideService(ScreenshotBaseline.CurrentSettings, settings)
 * ```
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
   * The baseline's path for a key. Return a distinct path for each key, or baselines overwrite each other;
   * `defaultPath` does.
   *
   * @default `defaultPath`: `<test file's directory>/__screenshots__/<test file's name>/<name>-<browser>-<platform>.png`
   */
  readonly path?: ((key: Key) => string) | undefined
  /**
   * The directory a failure writes its images to, under `<test file's name>-<digest>/<name>-<browser>-<platform>-`
   * followed by `actual.png`, `expected.png`, or `diff.png`, where the digest is 8 hex digits of the SHA-256 of the
   * test file's absolute path, so test files of the same name don't share images. The name, browser, and platform
   * are written as in `defaultPath`. A pixel mismatch writes all three images, a size mismatch the actual and
   * expected ones, and a missing or invalid baseline none. Relative paths resolve from the working directory.
   *
   * @default ".vitest-screenshots"
   */
  readonly outputDirectory?: string | undefined
}

/**
 * Reference to the comparison settings, read by each `toMatch`; by default `{}`, every setting at its default.
 *
 * **Example** (Keeping baselines in one directory)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const withBaselines = Effect.provideService(ScreenshotBaseline.CurrentSettings, {
 *   path: (key) =>
 *     ScreenshotBaseline.defaultPath(key).replace("__screenshots__", "baselines"),
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
 * **Example** (Logging how many pixels differed)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("header"),
 *     Effect.tapError((error) =>
 *       ScreenshotBaseline.isScreenshotBaselineError(error) &&
 *         error.reason._tag === "Mismatch"
 *         ? Effect.log(
 *           `${error.reason.diffPixels} pixels differ; see ${error.reason.diff}`
 *         )
 *         : Effect.void
 *     )
 *   )
 * })
 * ```
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
 * **Example** (Reporting a size change)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("header"),
 *     Effect.tapError((error) =>
 *       ScreenshotBaseline.isScreenshotBaselineError(error) &&
 *         error.reason._tag === "SizeMismatch"
 *         ? Effect.log(
 *           `now ${error.reason.actualSize.width} wide, was ${error.reason.expectedSize.width}`
 *         )
 *         : Effect.void
 *     )
 *   )
 * })
 * ```
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
 * **Example** (Noting a newly written baseline)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("header"),
 *     Effect.tapError((error) =>
 *       ScreenshotBaseline.isScreenshotBaselineError(error) &&
 *         error.reason._tag === "MissingBaseline" &&
 *         error.reason.written
 *         ? Effect.log(`review ${error.reason.baseline}`)
 *         : Effect.void
 *     )
 *   )
 * })
 * ```
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

const namePattern = Baseline.namePattern

/**
 * The name given to `toMatch` isn't a baseline name: lower-case letters, digits, `.`, `_`, and `-`, starting with a
 * letter or digit. It fails before anything is captured.
 *
 * **Example** (Naming a baseline)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const checkout = Effect.fn("checkout")(function*(page: Page.ReadonlyPage) {
 *   // "Checkout page" would fail with InvalidName
 *   yield* page.pipe(ScreenshotBaseline.toMatch("checkout-page"))
 * })
 * ```
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class InvalidName extends Schema.Error<InvalidName>("@usestrider/vitest/ScreenshotBaseline/InvalidName")({
  _tag: Schema.tag("InvalidName"),
  name: Schema.String
}) {
  override get message(): string {
    return `${
      JSON.stringify(this.name)
    } isn't a baseline name: use lower-case letters, digits, ".", "_", and "-", starting with a letter or digit (${namePattern.source})`
  }
}

/**
 * The baseline isn't a PNG Strider reads: 8-bit and not interlaced.
 *
 * **Example** (Reporting an unreadable baseline)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("header"),
 *     Effect.tapError((error) =>
 *       ScreenshotBaseline.isScreenshotBaselineError(error) &&
 *         error.reason._tag === "InvalidBaseline"
 *         ? Effect.logWarning(`${error.reason.baseline}: ${error.reason.detail}`)
 *         : Effect.void
 *     )
 *   )
 * })
 * ```
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
 * **Example** (Recovering from a failed comparison)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const header = Effect.fn("header")(function*(page: Page.ReadonlyPage) {
 *   yield* page.pipe(
 *     ScreenshotBaseline.toMatch("header"),
 *     Effect.catchTag(
 *       "ScreenshotBaselineError",
 *       (error) => Effect.logWarning(error.message)
 *     )
 *   )
 * })
 * ```
 *
 * @stability unstable
 * @category errors
 * @since 0.1.0
 */
export class ScreenshotBaselineError
  extends Schema.TaggedError<ScreenshotBaselineError>(ScreenshotBaselineErrorTypeId)("ScreenshotBaselineError", {
    name: Schema.String,
    reason: Schema.Union([Mismatch, SizeMismatch, MissingBaseline, InvalidBaseline, InvalidName])
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
 * **Example** (Telling a comparison failure from others)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 *
 * const describe = (error: unknown) =>
 *   ScreenshotBaseline.isScreenshotBaselineError(error) ? error.reason._tag : "other"
 * ```
 *
 * @stability unstable
 * @category guards
 * @since 0.1.0
 */
export const isScreenshotBaselineError = (u: unknown): u is ScreenshotBaselineError =>
  Predicate.hasProperty(u, ScreenshotBaselineErrorTypeId)

/** A key's file name without the extension, its parts as they are: only the name can contain `-`. */
const stem = (key: Key): string => `${key.name}-${key.browser}-${key.platform}`

/**
 * The default baseline path for a key: `__screenshots__/<test file's name>/<name>-<browser>-<platform>.png` in
 * the test file's directory.
 *
 * **Details**
 *
 * The parts are used as they are, never rewritten, and a key that doesn't satisfy `Key` is refused: `defaultPath`
 * throws its `Schema` error, as for `browser: "foo-bar"`. So two distinct keys never share a path.
 *
 * **Example** (Moving baselines under one directory)
 *
 * ```ts import.meta.vitest
 * import { ScreenshotBaseline } from "@usestrider/vitest"
 * import { Effect } from "effect"
 *
 * const withBaselines = Effect.provideService(ScreenshotBaseline.CurrentSettings, {
 *   path: (key) =>
 *     ScreenshotBaseline.defaultPath(key).replace("__screenshots__", "baselines")
 * })
 * ```
 *
 * @stability unstable
 * @category constructors
 * @since 0.1.0
 */
export const defaultPath = (key: Key): string => {
  const valid = decodeKey(key)
  return join(dirname(valid.testFile), "__screenshots__", basename(valid.testFile), `${stem(valid)}.png`)
}

const decodeKey = Schema.decodeUnknownSync(Key)

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
    if (!namePattern.test(name)) {
      return yield* Effect.fail(new ScreenshotBaselineError({ name, reason: new InvalidName({ name }) }))
    }
    const { key, output: directory, path, test, update } = yield* Baseline.locate(
      name,
      settings,
      decodeKey,
      defaultPath,
      ".vitest-screenshots"
    )
    const output = join(directory, stem(key))
    const capture = page.screenshot({
      area: options?.area,
      scale: options?.scale,
      omitBackground: options?.omitBackground
    })
    const fail = (reason: ScreenshotBaselineError["reason"]) =>
      Effect.fail(new ScreenshotBaselineError({ name, reason }))
    const artifacts = Effect.fnUntraced(function*(images: ReadonlyArray<readonly [string, Uint8Array]>) {
      for (const [suffix, bytes] of images) yield* Baseline.writeImage(test, `${output}-${suffix}.png`, bytes)
    })
    // Captures until two in a row are the same image.
    const stable = (previous: Uint8Array): Effect.Effect<
      Uint8Array,
      Page.PageError | Target.TargetGone | Deadline.Timeout
    > => Effect.flatMap(capture, (next) => Baseline.sameBytes(previous, next) ? Effect.succeed(next) : stable(next))

    const stored = yield* Baseline.read(path)
    const baseline = stored._tag === "Present" ? decodePng(stored.bytes) : stored
    if (baseline._tag !== "Present") {
      if (baseline._tag === "Invalid" && update !== "all") {
        return yield* fail(new InvalidBaseline({ baseline: path, detail: baseline.detail }))
      }
      if (update === "none") return yield* fail(new MissingBaseline({ baseline: path, written: false }))
      yield* Baseline.write(path, yield* Effect.flatMap(capture, stable))
      if (update === "all") return
      return yield* fail(new MissingBaseline({ baseline: path, written: true }))
    }
    // Captures until one matches, or until two in a row are the same image and don't.
    let previous: Uint8Array | undefined
    while (true) {
      const bytes = yield* capture
      const actual = Png.decode(bytes)
      const verdict = Baseline.judge(baseline.image, actual, options)
      if (verdict._tag === "Match") return
      if (previous === undefined || !Baseline.sameBytes(previous, bytes)) {
        previous = bytes
        continue
      }
      if (update === "all") return yield* Baseline.write(path, bytes)
      if (verdict._tag === "Size") {
        yield* artifacts([["actual", bytes], ["expected", baseline.bytes]])
        return yield* fail(
          new SizeMismatch({
            baseline: path,
            expectedSize: { width: baseline.image.width, height: baseline.image.height },
            actualSize: { width: actual.width, height: actual.height },
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

/** A baseline's image, or why it can't be read. */
const decodePng = (bytes: Uint8Array) => {
  try {
    return { _tag: "Present" as const, bytes, image: Png.decode(bytes) }
  } catch (error) {
    return { _tag: "Invalid" as const, detail: (error as Error).message }
  }
}

/**
 * Expects the page's screenshot to match the baseline named `name`, capturing until one matches or two captures
 * in a row are the same image and differ from it.
 *
 * **Details**
 *
 * `name` is the baseline's file name as written: lower-case letters, digits, `.`, `_`, and `-`, starting with a
 * letter or digit; any other name fails with `InvalidName` before anything is captured. The baseline is a PNG keyed
 * by test file, `name`, browser engine, and platform (`Key`), at `defaultPath`'s
 * `__screenshots__/<test file>/<name>-<browser>-<platform>.png` beside the test file unless `CurrentSettings`
 * says otherwise. Each attempt captures the page, and it passes as soon as one matches. When two captures in a row
 * are byte-identical and still differ, it fails: with `Mismatch`, writing the actual, expected, and diff images,
 * or with `SizeMismatch`, writing the actual and expected ones, to the output directory and attaching them to the
 * test. Identical captures mean only that two screenshots agreed, not that rendering has stopped. A page whose
 * captures keep changing fails with the operation's `Deadline.Timeout`. Pixels differ by YIQ colour distance past
 * `threshold`, ignoring anti-aliasing.
 *
 * A missing baseline is written, once two captures in a row agree, under the `"missing"` and `"all"` updates;
 * under `"missing"`, Vitest's default locally, the assertion still fails with `MissingBaseline`, so a first run
 * never passes unseen. Under `"all"` (`vitest -u`), a differing or unreadable baseline is rewritten the same way
 * and it passes. Under `"none"`, Vitest's default on CI, nothing is written. A missing or invalid baseline writes
 * no failure images. Errors from `page.screenshot`, such as an unsupported `scale`, pass through unchanged.
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
 *     ScreenshotBaseline.toMatch("dialog", {
 *       area: { element: dialog },
 *       maxDiffPixels: 20
 *     })
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
