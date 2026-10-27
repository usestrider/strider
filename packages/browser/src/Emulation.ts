/**
 * Emulated settings: viewport, locale, time zone, media features, network conditions and more.
 *
 * The same settings have two lifetimes. `UserContext.Options.emulation` holds them for a context's whole life, and
 * `emulate(settings)` on a page or context holds them until its registration is removed. Fields you leave unset are
 * untouched. Removing an override restores the previous value when it's known and your access allows, and a page's
 * overrides win over its context's.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Duration from "effect/Duration"
import * as Schema from "effect/Schema"

/**
 * Schema for a BCP 47 locale, such as `de-DE`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Locale = Schema.String.pipe(Schema.brand("~@usestrider/browser/Emulation/Locale"))

/**
 * A BCP 47 locale, such as `de-DE`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type Locale = typeof Locale.Type

/**
 * Schema for an IANA time zone, such as `Europe/Berlin`.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const TimeZoneId = Schema.String.pipe(Schema.brand("~@usestrider/browser/Emulation/TimeZoneId"))

/**
 * An IANA time zone, such as `Europe/Berlin`.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export type TimeZoneId = typeof TimeZoneId.Type

/**
 * The viewport, in CSS pixels.
 *
 * **Example** (A phone-sized page)
 *
 * ```ts import.meta.vitest
 * import { Browser } from "@usestrider/browser"
 *
 * const phonePage = Browser.newPage({
 *   emulation: {
 *     viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }
 *   }
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Viewport {
  readonly width: number
  readonly height: number
  /**
   * Device pixels per CSS pixel.
   *
   * @default 1
   */
  readonly deviceScaleFactor?: number | undefined
  /**
   * Whether the page is told it is on a mobile device, which changes viewport meta handling.
   *
   * @default false
   */
  readonly mobile?: boolean | undefined
}

/**
 * Emulated CSS media features.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Media {
  readonly type?: "screen" | "print" | undefined
  readonly colorScheme?: "light" | "dark" | "noPreference" | undefined
  readonly reducedMotion?: "reduce" | "noPreference" | undefined
  readonly forcedColors?: "active" | "none" | undefined
  readonly contrast?: "more" | "less" | "custom" | "noPreference" | undefined
}

/**
 * Emulated network conditions: throughput in bytes per second, and added latency.
 *
 * **Example** (Loading over a slow connection)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const slowLoad = Effect.fn("slowLoad")(function*(page: Page.Page) {
 *   yield* page.emulate({
 *     network: { download: 50_000, upload: 20_000, latency: "400 millis" }
 *   })
 *   yield* page.goto("https://shop.example.com")
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface NetworkConditions {
  readonly download: number
  readonly upload: number
  readonly latency: Duration.Input
}

/**
 * An emulated position, in degrees and metres.
 *
 * **Example** (Finding stores near Berlin)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const nearBerlin = Effect.fn("nearBerlin")(function*(page: Page.Page) {
 *   yield* page.context.grant(["geolocation"], { origin: "https://shop.example.com" })
 *   yield* page.emulate({ geolocation: { latitude: 52.52, longitude: 13.405 } })
 *   yield* page.goto("https://shop.example.com/stores")
 *   yield* page.getByRole("button", { name: "Stores near me" }).click()
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Geolocation {
  readonly latitude: number
  readonly longitude: number
  /**
   * Accuracy in metres.
   *
   * @default 0
   */
  readonly accuracy?: number | undefined
}

/**
 * Settings to emulate; unset fields are untouched.
 *
 * **Details**
 *
 * One call is one registration: removing it, or closing its scope, removes every field it set. Each field is
 * a capability named for it (`emulation.viewport`, `emulation.media`, …); the call fails with `Unsupported`
 * naming the first the backend can't apply, before anything is applied. Most fields apply to a loaded page at
 * once; JavaScript and touch handlers apply at its next document.
 *
 * - Firefox can't emulate `media`, `touch`, `javaScript`, a mobile `viewport`, network throttling, a CPU
 *   slowdown or an unavailable position.
 * - WebKit can emulate only `media`, `javaScript` and a `viewport`, which sizes the window, at a device scale of
 *   1 and not mobile. Attached, it can emulate nothing.
 * - Chromium can emulate every field.
 *
 * **Example** (Going dark and offline for one step)
 *
 * ```ts import.meta.vitest
 * import { Page } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const offlineDark = Effect.fn("offlineDark")(function*(page: Page.Page) {
 *   yield* page.emulate({ media: { colorScheme: "dark" }, network: "offline" })
 *   yield* page.reload()
 * })
 * ```
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export interface Emulation {
  readonly viewport?: Viewport | undefined
  readonly userAgent?: string | undefined
  readonly locale?: Locale | string | undefined
  readonly timezone?: TimeZoneId | string | undefined
  /**
   * A position, or `"unavailable"` to make position requests fail. A page still needs the `geolocation`
   * permission to ask (`UserContext.grant`).
   */
  readonly geolocation?: Geolocation | "unavailable" | undefined
  readonly media?: Media | undefined
  readonly network?: NetworkConditions | "offline" | undefined
  /**
   * A CPU slowdown factor, 1 or more; CDP only.
   */
  readonly cpuSlowdown?: number | undefined
  /**
   * Whether the page's scripts run, from its next document.
   */
  readonly javaScript?: "enabled" | "disabled" | undefined
  /**
   * Whether the page is told it has a touch screen (five touch points); CDP only.
   */
  readonly touch?: boolean | undefined
}
