/**
 * The launch profiles' contents (`LaunchProfile`): Chromium's arguments and Firefox's preferences for each named
 * profile. No imports, so the public module and the launchers share them without a load cycle.
 */

/** A launch profile's name. */
export type Profile = "stock" | "automation" | "concurrent"

/*
 * Each profile's arguments.
 *
 * - `automation` turns off first-run, sync, update and crash-report prompts, the browser's own background
 *   traffic, and the component extensions that would otherwise attach as targets. Nothing a page can observe.
 * - `concurrent` adds the throttling switches for many pages at once. Pages can observe those (timer cadence,
 *   background rendering), so they are opt-in.
 */
const chromiumAutomation: ReadonlyArray<string> = [
  "--no-first-run",
  "--no-default-browser-check",
  "--no-service-autorun",
  "--disable-sync",
  "--disable-component-update",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-client-side-phishing-detection",
  "--disable-domain-reliability",
  "--disable-breakpad",
  "--disable-hang-monitor",
  "--disable-prompt-on-repost",
  "--disable-component-extensions-with-background-pages",
  "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication",
  "--metrics-recording-only",
  "--password-store=basic",
  "--use-mock-keychain"
]

export const chromiumArgs: Readonly<Record<Profile, ReadonlyArray<string>>> = {
  stock: [],
  automation: chromiumAutomation,
  concurrent: [
    ...chromiumAutomation,
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
  ]
}

export type Prefs = Readonly<Record<string, string | number | boolean>>

const firefoxAutomation: Prefs = {
  // The JSON viewer replaces a JSON response's document with a devtools page, whose text is the viewer's
  // buttons; off, the document is the JSON as served, as in Chromium and WebKit (QUIRKS.md, Q15)
  "devtools.jsonview.enabled": false,
  // A popup, or a link that opens a new page, opens as a window rather than a tab over its opener, which would
  // leave the opener rendering about once a second (QUIRKS.md, Q71)
  "browser.link.open_newwindow": 2,
  "app.update.disabledForTesting": true,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "browser.aboutwelcome.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.reportingpolicy.firstRun": false
}

/**
 * Each profile's preferences. `automation` turns off update, first-run and data-reporting prompts, nothing a
 * page can observe, and the JSON viewer, so a JSON response is the document the server sent, and opens new pages
 * as windows, so a page behind a popup keeps rendering; `concurrent` adds background-timer throttling off, which
 * pages can observe, so it is opt-in.
 */
export const firefoxPrefs: Readonly<Record<Profile, Prefs>> = {
  stock: {},
  automation: firefoxAutomation,
  concurrent: { ...firefoxAutomation, "dom.timeout.enable_budget_timer_throttling": false }
}
