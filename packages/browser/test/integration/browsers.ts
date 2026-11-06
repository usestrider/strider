/** Browser paths and strict versions for the selected integration entry point. */
import * as fs from "node:fs"
import { pins as linuxPins } from "./pins.ts"
import { assertVersion } from "./platform.ts"

interface BrowserPins {
  readonly chromium: { readonly version: string }
  readonly firefox: { readonly version: string }
}

const pins: BrowserPins = process.env["STRIDER_ENVIRONMENT"] === "macos-integration"
  ? JSON.parse(fs.readFileSync(`${import.meta.dirname}/browsers.macos.json`, "utf8")) as BrowserPins
  : linuxPins

const named = (variable: string): string => {
  const value = process.env[variable]
  if (value === undefined || value === "") {
    throw new Error(
      `${variable} isn't set: use pnpm test:integration or pnpm test:integration:macos`
    )
  }
  return value
}

/** Chromium: its executable and the version it must be. */
export const chromium = { executable: named("STRIDER_CHROMIUM"), ...pins.chromium }

/** Firefox: its executable and the version it must be. */
export const firefox = { executable: named("STRIDER_FIREFOX"), ...pins.firefox }

/** OpenSSL, which makes the TLS fixture's certificate (`adapter/harness.ts`). */
export const openssl = named("STRIDER_OPENSSL")

/** Stock WebKit: WebKitGTK's MiniBrowser, the version it must be, and the X server it runs on. */
export const webkitgtk = {
  get executable() {
    return named("STRIDER_WEBKITGTK")
  },
  get xvfb() {
    return named("STRIDER_XVFB")
  },
  ...linuxPins.webkitgtk
}

/** Fails unless a browser is the version the tests are pinned to. */
export const assertPinned = (browser: string, found: string, pinned: string): void =>
  assertVersion(browser, found, pinned, process.env["STRIDER_ENVIRONMENT"] === "macos-integration" ? "macos" : "linux")
