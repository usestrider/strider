/**
 * The `Browser` service's tag, apart from the module that documents it, so the layer that provides it
 * (`browser.ts`) needn't load `Browser.ts`, which loads that layer for `layerTest`.
 */
import * as Context from "effect/Context"
import type * as BrowserModule from "../Browser.ts"

export const Browser: Context.Service<BrowserModule.Browser, BrowserModule.Browser> = Context.Service<
  BrowserModule.Browser
>(
  "@usestrider/browser/Browser"
)
