/**
 * effect-browser/test/vitest: the Vitest adapter (peer dependency: @effect/vitest). When etest ships, an etest
 * adapter attaches the same Layers with Test.provide.
 */
import type { Layer } from "effect"
import type { Browser } from "./Browser.ts"
import type { TestRun } from "./test.ts"

export declare const VitestBrowser: {
  /** The backend you pass, unchanged, plus TestRun from the current test. One browser per layer block. */
  layer<E, R>(backend: Layer.Layer<Browser, E, R>): Layer.Layer<Browser | TestRun, E, R>
}
