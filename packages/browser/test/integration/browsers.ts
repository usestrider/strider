/**
 * The browsers the integration tests run against: the pinned builds (`pins.ts`), which the Nix environment
 * (`flake.nix`, `devShells.integration`) names in `STRIDER_CHROMIUM`, `STRIDER_FIREFOX` and `STRIDER_WEBKITGTK`,
 * with the X server stock WebKit's MiniBrowser needs in `STRIDER_XVFB`. Nothing else is looked up, and nothing is
 * skipped: outside that environment the integration tests don't run (`environment.ts`), and a browser that isn't
 * the pinned version fails them, saying which version it found.
 */
import { pins } from "./pins.ts"

const named = (variable: string): string => {
  const value = process.env[variable]
  if (value === undefined || value === "") {
    throw new Error(
      `${variable} isn't set: the browser integration tests run in the Nix environment, with \`pnpm test:integration\``
    )
  }
  return value
}

/** Chromium: its executable and the version it must be. */
export const chromium = { executable: named("STRIDER_CHROMIUM"), ...pins.chromium }

/** Firefox: its executable and the version it must be. */
export const firefox = { executable: named("STRIDER_FIREFOX"), ...pins.firefox }

/** Stock WebKit: WebKitGTK's MiniBrowser, the version it must be, and the X server it runs on. */
export const webkitgtk = { executable: named("STRIDER_WEBKITGTK"), xvfb: named("STRIDER_XVFB"), ...pins.webkitgtk }

/** Fails unless a browser is the version the tests are pinned to. */
export const assertPinned = (browser: string, found: string, pinned: string): void => {
  if (found !== pinned) {
    throw new Error(
      `${browser} ${found} isn't the pinned ${pinned} (test/integration/browsers.json); the Nix environment provides it`
    )
  }
}
