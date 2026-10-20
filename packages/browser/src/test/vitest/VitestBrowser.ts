/**
 * The Vitest adapter (`@usestrider/browser/test/vitest`; peer dependency: `@effect/vitest`).
 *
 * When etest ships, an etest adapter attaches the same layers with `Test.provide`.
 *
 * @stability unstable
 * @since 0.1.0
 */
import type * as Layer from "effect/Layer"
import type * as Browser from "../../Browser.ts"
import type * as TestRun from "../TestRun.ts"

/**
 * The backend you pass, unchanged, plus `TestRun` for the current test. One browser per layer block.
 *
 * **Example** (A test with an emulated-focus page)
 *
 * ```ts import.meta.vitest
 * import { Effect } from "effect"
 * import { Browser } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { VitestBrowser } from "@usestrider/browser/test/vitest"
 *
 * const test = Effect.scoped(Effect.gen(function*() {
 *   const page = yield* Browser.newPage({ focus: "emulated" })
 *   yield* page.goto("https://shop.example.com")
 * })).pipe(Effect.provide(VitestBrowser.layer(Chromium.layer({ executablePath: "/usr/bin/chromium" }))))
 * ```
 *
 * @stability unstable
 * @category layers
 * @since 0.1.0
 */
export declare const layer: <E, R>(
  backend: Layer.Layer<Browser.Browser, E, R>
) => Layer.Layer<Browser.Browser | TestRun.TestRun, E, R>
