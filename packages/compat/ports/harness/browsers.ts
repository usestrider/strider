/**
 * The browsers a run uses: the integration environment's pinned Chromium, Firefox, and stock WebKit, launched through
 * their public layers as a user's tests would. `STRIDER_COMPAT_BROWSERS` (`chromium,firefox`) selects some.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { type Browser, VideoWriter } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Layer from "effect/Layer"
import { assertPinned, chromium, firefox, webkitgtk } from "../../../browser/test/integration/browsers.ts"
import { socketConnector } from "../../../browser/test/integration/sockets.ts"
import { useXvfb } from "../../../browser/test/integration/stockWebKit.ts"

export const browserNames = ["chromium", "firefox", "webkit"] as const
export type BrowserName = typeof browserNames[number]

const parse = (value: string | undefined): ReadonlyArray<BrowserName> => {
  if (value === undefined || value === "") return browserNames
  const names = value.split(",").map((name) => name.trim())
  for (const name of names) {
    if (!browserNames.some((known) => known === name)) {
      throw new Error(`STRIDER_COMPAT_BROWSERS names ${name}: use chromium, firefox, or webkit`)
    }
  }
  return names as ReadonlyArray<BrowserName>
}

/** The browsers this run selects. */
export const selected = parse(process.env["STRIDER_COMPAT_BROWSERS"])

/** What a port file launches its browsers with, beyond the defaults: Playwright's `it.use({ launchOptions })`. */
export interface Launch {
  readonly chromium?: Partial<Browser.LaunchOptions> | undefined
  readonly firefox?: Partial<Browser.LaunchOptions> | undefined
  readonly webkit?: Partial<Browser.LaunchOptions> | undefined
}

/** One browser, launched for a port file. */
/**
 * Chromium's video is written by a `VideoWriter`, which the integration environment's ffmpeg provides. Firefox writes
 * its own; stock WebKit's also needs launch settings, which the harness doesn't give.
 */
const videoWriter = () => {
  const ffmpeg = process.env["STRIDER_FFMPEG"]
  return ffmpeg === undefined
    ? Layer.empty
    : VideoWriter.layerFfmpeg({ path: ffmpeg }).pipe(Layer.provide(NodeServices.layer))
}

/**
 * An X server for a headed browser: the integration environment has no display, so a launch with `headless: false`
 * gets an Xvfb of its own, as the MiniBrowser always does. It comes up before the browser, and goes after it.
 */
const displayFor = (headless: boolean | undefined) =>
  headless === false ? Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer)) : Layer.empty

export const backend = (name: BrowserName, launch: Launch | undefined): Layer.Layer<Browser.Browser, unknown> => {
  switch (name) {
    case "chromium":
      return Chromium.layer({ executablePath: chromium.executable, ...launch?.chromium }).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, videoWriter(), displayFor(launch?.chromium?.headless)))
      )
    case "firefox":
      return Firefox.layer({ executablePath: firefox.executable, ...launch?.firefox }).pipe(
        Layer.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NodeSocket.layerWebSocketConstructor,
            displayFor(launch?.firefox?.headless)
          )
        )
      )
    case "webkit": {
      return WebKit.layer({ executablePath: webkitgtk.executable, ...launch?.webkit }).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, displayFor(false)))
      )
    }
  }
}

/** Fails unless the launched browser is the pinned one. */
export const checkPinned = (name: BrowserName, info: Browser.Info) => {
  switch (name) {
    case "chromium":
      return assertPinned("Chromium", info.version, chromium.version)
    case "firefox":
      return assertPinned("Firefox", info.version, firefox.version)
    case "webkit":
      return assertPinned("WebKit", info.version, webkitgtk.version)
  }
}
