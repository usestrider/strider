/**
 * The browsers the integration tests are pinned to (`browsers.json`), which `flake.nix` reads too. Standard tests
 * read them as well: the drift test's fixtures are named after them, and the WebKit pin must be the build its
 * adapter is generated from.
 */
import * as fs from "node:fs"

interface Pins {
  readonly chromium: { readonly version: string; readonly fixture: string }
  readonly firefox: { readonly version: string; readonly fixture: string }
  readonly webkit: { readonly revision: string; readonly fixture: string }
}

export const pins = JSON.parse(fs.readFileSync(`${import.meta.dirname}/browsers.json`, "utf8")) as Pins
