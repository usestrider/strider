/**
 * What `ScreenshotBaseline` and `SnapshotBaseline` share: the key that names a baseline, where it and a failure's
 * files go, when it is written, how it is read, and how two images are judged.
 */
import * as Browser from "@usestrider/browser/Browser"
import * as FilePath from "@usestrider/browser/FilePath"
import { TestRun } from "@usestrider/browser/test"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { expect } from "vitest"
import { compare } from "./pixelmatch.ts"
import type * as Png from "./png.ts"

/** A baseline name: lower-case letters, digits, `.`, `_`, and `-`, starting with a letter or digit. */
export const namePattern = /^[a-z0-9][a-z0-9._-]*$/

/** The test file, the name, the browser engine, and the platform; only the name can contain `-`. */
export const Key = Schema.Struct({
  /** The test file's absolute path. */
  testFile: Schema.String,
  /** The name given to `toMatch`. */
  name: Schema.String.pipe(Schema.check(Schema.isPattern(namePattern))),
  /** The browser engine, with no version. */
  browser: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9_]+$/))),
  /** Node's `process.platform`. */
  platform: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9_]+$/)))
})

export type Key = typeof Key.Type

export type Update = "none" | "missing" | "all"

/** The settings both matchers read, each from its own reference and with its own defaults. */
export interface Settings {
  readonly update?: Update | undefined
  readonly path?: ((key: Key) => string) | undefined
  readonly outputDirectory?: string | undefined
}

/** How much two images may differ. */
export interface PixelOptions {
  readonly threshold?: number | undefined
  readonly maxDiffPixels?: number | undefined
  readonly maxDiffPixelRatio?: number | undefined
}

/**
 * The engine key of a browser's product, as each backend reports it: Chromium's `HeadlessChrome/<version>` or
 * `Chrome/<version>`, Firefox's `firefox`, stock WebKit's `MiniBrowser (stock WebKit)` or `WebKit (stock)`, and
 * Safari's `Safari`. Any other product keys under `other_`, with its letters and digits and a digest of its exact
 * name, so it can't take a known engine's key or another product's.
 */
export const engineOf = (product: string): string => {
  const exact = product.split("/")[0]!
  const name = exact.trim().toLowerCase()
  if (/^(headless)?chrome$|^chromium$/.test(name)) return "chromium"
  if (name === "firefox") return "firefox"
  if (name === "safari") return "safari"
  if (name.endsWith("(stock webkit)") || name === "webkit (stock)") return "webkit"
  return `other_${name.replace(/[^a-z0-9]+/g, "")}_${createHash("sha256").update(exact).digest("hex").slice(0, 8)}`
}

/** `vitest -u` is `all`, a local run `new`, CI `none`: Vitest's public snapshot state. */
const vitestUpdate = (): Update => {
  const state = expect.getState().snapshotState?.snapshotUpdateState
  return state === "all" ? "all" : state === "new" ? "missing" : "none"
}

/** A directory name for a test file: its name, then the first 8 hex digits of its absolute path's SHA-256. */
const fileIdentity = (testFile: string): string =>
  `${basename(testFile)}-${createHash("sha256").update(resolve(testFile)).digest("hex").slice(0, 8)}`

/** Where one comparison's baseline lives, when it is written, and the directory a failure writes its files to. */
export interface Located {
  readonly test: TestRun.TestRun
  readonly key: Key
  readonly path: string
  readonly update: Update
  readonly output: string
}

/** Keys `name` for the running test and browser; `decode` checks the key, `defaultPath` and `defaultOutput` apply
 * where `settings` say nothing. */
export const locate = (
  name: string,
  settings: Settings,
  decode: (key: Key) => Key,
  defaultPath: (key: Key) => string,
  defaultOutput: string
): Effect.Effect<Located, never, Browser.Browser | TestRun.TestRun> =>
  Effect.gen(function*() {
    const test = yield* TestRun.TestRun
    const browser = yield* Browser.Browser
    const key = decode({
      testFile: test.info.file,
      name,
      browser: engineOf(browser.info.product),
      platform: process.platform
    })
    return {
      test,
      key,
      path: resolve((settings.path ?? defaultPath)(key)),
      update: settings.update ?? vitestUpdate(),
      output: join(resolve(settings.outputDirectory ?? defaultOutput), fileIdentity(key.testFile))
    }
  })

export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

export const write = (path: string, bytes: Uint8Array) =>
  Effect.promise(async () => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  })

/** Writes a failure's image and attaches it to the test as a screenshot. */
export const writeImage = (test: TestRun.TestRun, path: string, bytes: Uint8Array) =>
  Effect.andThen(write(path, bytes), test.attach({ screenshot: FilePath.Local.make(path) }))

export type Stored =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Present"; readonly bytes: Uint8Array }

/** Reads a baseline's bytes: missing when there's no file, invalid when it can't be read. */
export const read = (path: string): Effect.Effect<Stored> =>
  Effect.promise(() =>
    readFile(path).then(
      (bytes): Stored => ({ _tag: "Present", bytes }),
      (error: NodeJS.ErrnoException): Stored =>
        error.code === "ENOENT" ? { _tag: "Missing" } : { _tag: "Invalid", detail: error.message }
    )
  )

export type Verdict =
  | { readonly _tag: "Match" }
  | { readonly _tag: "Size" }
  | { readonly _tag: "Pixels"; readonly diffPixels: number; readonly diff: Png.Image }

/** With neither limit, no pixel may differ; with either or both, each one given must hold. */
export const judge = (expected: Png.Image, actual: Png.Image, options: PixelOptions | undefined): Verdict => {
  if (actual.width !== expected.width || actual.height !== expected.height) return { _tag: "Size" }
  const { diff, diffPixels } = compare(expected, actual, options?.threshold ?? 0.2)
  const pixels = options?.maxDiffPixels
  const ratio = options?.maxDiffPixelRatio
  const total = actual.width * actual.height
  const passes = pixels === undefined && ratio === undefined
    ? diffPixels === 0
    : (pixels === undefined || diffPixels <= pixels) && (ratio === undefined || diffPixels / total <= ratio)
  return passes ? { _tag: "Match" } : { _tag: "Pixels", diffPixels, diff }
}
