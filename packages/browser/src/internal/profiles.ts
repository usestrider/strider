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
 *   traffic, and the component extensions that would otherwise attach as targets. Chromium also enables
 *   CDPScreenshotNewSurface to request repaint on a new surface for captures. Capture can drive rendering;
 *   the profile does not promise that captures are unobservable to the page. Chromium also hides infobars: Chrome
 *   for Testing adds an "automated testing only" one to each new window shortly after it opens, which takes about
 *   56 px from the page area and so changes the size a page had when it was created.
 * - `concurrent` includes all automation settings and adds the throttling switches for many pages at once.
 *   Pages can observe those (timer cadence, background rendering), so they are opt-in.
 */
const chromiumAutomation: ReadonlyArray<string> = [
  "--no-first-run",
  "--no-default-browser-check",
  "--no-service-autorun",
  "--disable-infobars",
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
  "--enable-features=CDPScreenshotNewSurface",
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
  // A visible window preloads about:newtab into a browser of the default user context, which BiDi announces as a
  // top-level context in the window of the page; off, the window has only the page's contexts
  "browser.newtab.preload": false,
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
 * as windows, so a page behind a popup keeps rendering, and preloads no new-tab page, which a window would
 * announce as a context of the default user context; `concurrent` adds background-timer throttling off, which
 * pages can observe, so it is opt-in.
 */
export const firefoxPrefs: Readonly<Record<Profile, Prefs>> = {
  stock: {},
  automation: firefoxAutomation,
  concurrent: { ...firefoxAutomation, "dom.timeout.enable_budget_timer_throttling": false }
}
