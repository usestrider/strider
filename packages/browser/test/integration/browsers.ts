/**
 * The browsers the integration tests run against, and the versions they're pinned to.
 *
 * The pins are in `browsers.json`, which `flake.nix` reads too: `nix develop` provides exactly these builds, from
 * the nixpkgs revision in `flake.lock`, and names each in its environment variable. Nothing else is looked up,
 * so a test never runs against a browser nobody chose:
 *
 * - a browser whose variable isn't set has its tests skipped, which Vitest reports;
 * - one that is set to another version fails its tests, saying which version it found.
 *
 * WebKit's pin is a Playwright build, which its launcher checks by the `protocol.json` the build ships.
 */
import * as fs from "node:fs"

interface Pins {
  readonly chromium: { readonly version: string; readonly fixture: string }
  readonly firefox: { readonly version: string; readonly fixture: string }
  readonly webkit: { readonly revision: string; readonly fixture: string }
}

const pins = JSON.parse(fs.readFileSync(`${import.meta.dirname}/browsers.json`, "utf8")) as Pins

const named = (variable: string): string | undefined => {
  const value = process.env[variable]
  return value === undefined || value === "" ? undefined : value
}

/** Chromium: its executable, from `STRIDER_CHROMIUM`, and the version it must be. */
export const chromium = { executable: named("STRIDER_CHROMIUM"), ...pins.chromium }

/** Firefox: its executable, from `STRIDER_FIREFOX`, and the version it must be. */
export const firefox = { executable: named("STRIDER_FIREFOX"), ...pins.firefox }

/** Playwright's WebKit: its `pw_run.sh`, from `STRIDER_WEBKIT`, and the build it must be. */
export const webkit = { executable: named("STRIDER_WEBKIT"), ...pins.webkit }

/** Fails unless a browser is the version the tests are pinned to. */
export const assertPinned = (browser: string, found: string, pinned: string): void => {
  if (found !== pinned) {
    throw new Error(
      `${browser} ${found} isn't the pinned ${pinned} (test/integration/browsers.json). Run the tests in \`nix develop\`, which provides it`
    )
  }
}
