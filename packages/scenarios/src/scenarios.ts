/**
 * The scenarios, each written twice: with Strider and with Playwright, as each library's own documentation would
 * write it, against the same stock Chromium. One that only shows Strider, such as the video, has no twin. API.md's call sites that both libraries can do, on the local site
 * (`site.ts`), and two public demo sites replayed from recordings, so a run sends nothing to anyone.
 *
 * Each implementation sits between `#region <scenario>/<library>` markers, which the report copies into
 * RESULTS.md side by side. Each returns what it read, which the report compares.
 */
import {
  Browser,
  Capability,
  Dialog,
  Expect,
  FileInput,
  Har,
  NetworkResponse,
  Page,
  PageNavigation,
  Popup,
  Route
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import * as ChildProcess from "effect/process/ChildProcess"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as Playwright from "playwright-core"

/** What a Strider scenario needs: the browser, a scope for its pages, a file system for HARs, and processes. */
export type StriderNeeds =
  | Browser.Browser
  | Scope.Scope
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner

export interface Scenario {
  readonly name: string
  readonly title: string
  /** What the Strider program shows, for its page on the documentation site. */
  readonly description: string
  /** The value both implementations must return. */
  readonly expected: string
  /** A public demo site, replayed from `.data/scenarios/<recording>.har`; none for the local site. */
  readonly recording?: string
  /** What writing it found, shown under its code. */
  readonly note?: string
  /** A video the program recorded, kept in the site's `public/videos/`, shown on its page. */
  readonly video?: string
  /** The browser the Strider program runs on: Chromium unless it says Firefox */
  readonly browser?: "firefox"
  /** Another scenario that does the same on another browser, shown beside it on its page */
  readonly compare?: string
  /** The Strider program: given the local site's address, and needing nothing of the runner's */
  readonly strider: (origin: string) => Effect.Effect<string, unknown, StriderNeeds>
  /** Its twin, for the comparison; none for a scenario that only shows Strider */
  readonly playwright?: (browser: Playwright.Browser, origin: string, files: Files) => Promise<string>
}

/** Where a Playwright twin may write a file, and where the recordings are; a Strider program names its own. */
export interface Files {
  readonly temporary: (name: string) => string
  readonly recording: (name: string) => string
}

// #region readme/strider
const readmeStrider = Effect.fn("readme")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/`)
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("Added to cart").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
// #endregion

// #region readme/playwright
const readmePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/`)
    await page.getByRole("button", { name: "Add to cart" }).click()
    await page.getByText("Added to cart").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
// #endregion

// #region login/strider
const loginStrider = Effect.fn("login")(function*(origin: string) {
  const state = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.goto(`${origin}/login`)
    yield* page.getByLabel("Email").fill("me@example.com")
    yield* page.getByLabel("Password").fill("hunter2")
    yield* page.getByRole("button", { name: "Sign in" }).click()
    yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
    return yield* page.context.exportStorageState
  }))
  const page = yield* Browser.newPage({ storageState: state })
  yield* page.goto(`${origin}/account`)
  yield* page.getByText("theme: dark").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading").readText
})
// #endregion

// #region login/playwright
const loginPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const first = await browser.newContext()
  let state: Awaited<ReturnType<Playwright.BrowserContext["storageState"]>>
  try {
    const page = await first.newPage()
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill("me@example.com")
    await page.getByLabel("Password").fill("hunter2")
    await page.getByRole("button", { name: "Sign in" }).click()
    await page.getByText("Welcome").waitFor()
    state = await first.storageState()
  } finally {
    await first.close()
  }
  const context = await browser.newContext({ storageState: state })
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/account`)
    await page.getByText("theme: dark").waitFor()
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
// #endregion

// #region popup/strider
const popupStrider = Effect.fn("popup")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/connect`)
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click()
  const popup = yield* popups
  yield* Dialog.handle(popup, Dialog.acceptAll)
  yield* popup.getByRole("button", { name: "Allow" }).click()
  yield* popup.getByText("Allowed").pipe(Expect.toBeVisible)
  return yield* popup.locator("#out").readText
})
// #endregion

// #region popup/playwright
const popupPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/connect`)
    const popupOpened = page.waitForEvent("popup")
    await page.getByText("Connect account").click()
    const popup = await popupOpened
    popup.on("dialog", (dialog) => dialog.accept())
    await popup.getByRole("button", { name: "Allow" }).click()
    await popup.getByText("Allowed").waitFor()
    return (await popup.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
// #endregion

// #region block/strider
const blockStrider = Effect.fn("block")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.route(`${origin}/analytics/**`, () => Route.abort())
  yield* page.goto(`${origin}/tracked`)
  yield* page.getByText("analytics blocked").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
// #endregion

// #region block/playwright
const blockPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.route(`${origin}/analytics/**`, (route) => route.abort())
    await page.goto(`${origin}/tracked`)
    await page.getByText("analytics blocked").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
// #endregion

// #region upload/strider
const uploadStrider = Effect.fn("upload")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/upload`)
  yield* page.getByLabel("Receipt").setInputFiles([
    FileInput.bytes("receipt.txt", "text/plain", new TextEncoder().encode("paid"))
  ])
  yield* page.getByText("receipt.txt:4").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
// #endregion

// #region upload/playwright
const uploadPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/upload`)
    await page.getByLabel("Receipt").setInputFiles({
      name: "receipt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("paid")
    })
    await page.getByText("receipt.txt:4").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
// #endregion

// #region response/strider
const Cart = Schema.Struct({
  items: Schema.Array(Schema.Struct({ sku: Schema.String, quantity: Schema.Number }))
})

const responseStrider = Effect.fn("response")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/cart`)
  const added = yield* NetworkResponse.next(page, {
    url: `${origin}/api/cart`,
    method: "POST",
    body: HttpIncomingMessage.schemaBodyJson(Cart)
  })
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  const { body } = yield* added
  return body.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
})
// #endregion

// #region response/playwright
const responsePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/cart`)
    const added = page.waitForResponse((response) =>
      response.url() === `${origin}/api/cart` && response.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Add to cart" }).click()
    const response = await added
    const cart = (await response.json()) as { items: ReadonlyArray<{ sku: string; quantity: number }> }
    return cart.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
  } finally {
    await page.close()
  }
}
// #endregion

// #region navigation/strider
const navigationStrider = Effect.fn("navigation")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/home`)
  const orders = yield* PageNavigation.next(page, { url: `${origin}/orders` })
  yield* page.getByRole("link", { name: "Orders" }).click()
  yield* orders
  return yield* page.getByRole("heading").readText
})
// #endregion

// #region navigation/playwright
const navigationPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/home`)
    await page.getByRole("link", { name: "Orders" }).click()
    await page.waitForURL(`${origin}/orders`)
    return (await page.getByRole("heading").textContent()) ?? ""
  } finally {
    await page.close()
  }
}
// #endregion

// #region har/strider
const harStrider = Effect.fn("har")(function*(origin: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ suffix: ".har" })
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(`${origin}/report`)
    yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
    yield* har.entries.waitFor((count) => count >= 2)
    yield* har.exportHar(path)
  }))
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(path))
  yield* page.goto(`${origin}/report`)
  yield* page.getByText("42 sold").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
// #endregion

// #region har/playwright
const harPlaywright = async (browser: Playwright.Browser, origin: string, files: Files) => {
  const path = files.temporary("report-playwright.har")
  const recording = await browser.newContext({ recordHar: { path, content: "embed" } })
  try {
    const page = await recording.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
  } finally {
    await recording.close()
  }
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(path, { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${origin}/report`)
    await page.getByText("42 sold").waitFor()
    return (await page.locator("#out").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
// #endregion

// #region the-internet/strider
// The Internet's login, and a recording of it to replay instead of visiting it
const theInternet = "https://the-internet.herokuapp.com"
const theInternetRecording = ".data/scenarios/the-internet.har"

const theInternetStrider = Effect.fn("the-internet")(function*() {
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(theInternetRecording))
  yield* page.goto(`${theInternet}/login`)
  yield* page.getByLabel("Username").fill("tomsmith")
  yield* page.getByLabel("Password").fill("SuperSecretPassword!")
  yield* page.getByRole("button", { name: "Login" }).click()
  yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
  return yield* page.getByRole("heading", { level: 2 }).readText
})
// #endregion

// #region the-internet/playwright
const theInternetPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(`${theInternet}/login`)
    await page.getByLabel("Username").fill("tomsmith")
    await page.getByLabel("Password").fill("SuperSecretPassword!")
    await page.getByRole("button", { name: "Login" }).click()
    await page.getByText("You logged into a secure area!").waitFor()
    return (await page.getByRole("heading", { level: 2 }).textContent()) ?? ""
  } finally {
    await context.close()
  }
}
// #endregion

// #region controls/strider
// The page, and a recording of its site to replay instead of visiting it
const controls = "https://the-internet.herokuapp.com/dynamic_controls"
const controlsRecording = ".data/scenarios/the-internet.har"

const controlsStrider = Effect.fn("controls")(function*() {
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(controlsRecording))
  yield* page.goto(controls)
  yield* page.getByRole("button", { name: "Enable" }).click()
  // A script enables the box three seconds later: fill waits for it
  const input = page.getByRole("textbox")
  yield* input.fill("Strider")
  yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
  return yield* input.readValue
})
// #endregion

// #region controls/playwright
const controlsPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("the-internet"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(controls)
    await page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    await input.fill("Strider")
    await page.getByText("It's enabled!").waitFor()
    return await input.inputValue()
  } finally {
    await context.close()
  }
}
// #endregion

// #region video/strider
// The page's frames, encoded as a WebM by ffmpeg. Chromium sends a frame only when
// the page repaints, so the latest is taken 25 times a second, as ffmpeg reads them
const recordVideo = Effect.fn("recordVideo")(function*(page: Page.Page, file: string) {
  const screencast = yield* page.capability(Capability.Screencast)
  const latest = yield* Ref.make<Uint8Array | undefined>(undefined)
  yield* screencast.frames.pipe(
    Stream.runForEach((frame) => Ref.set(latest, frame.jpeg)),
    Effect.ignore,
    Effect.forkScoped
  )
  const stop = yield* Deferred.make<void>()
  const frames = Stream.fromSchedule(Schedule.fixed("40 millis")).pipe(
    Stream.mapEffect(() => Ref.get(latest)),
    Stream.filter((jpeg) => jpeg !== undefined),
    Stream.interruptWhen(Deferred.await(stop))
  )
  const ffmpeg = yield* ChildProcess.make({ stdin: frames, stderr: "inherit" })`
    ffmpeg -loglevel error -f mjpeg -framerate 25 -i pipe:0
      -c:v libvpx-vp9 -crf 36 -b:v 0 -deadline realtime -cpu-used 8
      -y ${file}`
  // As the page's scope ends: a second more, for the last paint, then the file finished
  yield* Effect.addFinalizer(() =>
    Effect.sleep("1 second").pipe(
      Effect.andThen(Deferred.succeed(stop, undefined)),
      Effect.andThen(ffmpeg.exitCode),
      Effect.ignore
    )
  )
})

// The page, a recording of its site to replay instead of visiting it, and the video
const dynamicControls = "https://the-internet.herokuapp.com/dynamic_controls"
const dynamicControlsRecording = ".data/scenarios/the-internet.har"
const videoFile = ".data/scenarios/dynamic-controls.webm"

const videoStrider = Effect.fn("video")(function*() {
  const value = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage({
      emulation: { viewport: { width: 1280, height: 720 } }
    })
    yield* page.route("**/*", yield* Route.fromHar(dynamicControlsRecording))
    yield* page.goto(dynamicControls, { waitUntil: "load" })
    yield* recordVideo(page, videoFile)
    yield* page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    yield* input.fill("Strider")
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    return yield* input.readValue
  }))
  const fs = yield* FileSystem.FileSystem
  const { size } = yield* fs.stat(videoFile)
  return size > 0 ? `${value}, recorded` : `${value}, but the video is empty`
})
// #endregion

// #region video-firefox/strider
// The page, a recording of its site to replay instead of visiting it, and the video
const firefoxControls = "https://the-internet.herokuapp.com/dynamic_controls"
const firefoxControlsRecording = ".data/scenarios/the-internet.har"
const firefoxVideoFile = ".data/scenarios/dynamic-controls-firefox.webm"

const videoFirefoxStrider = Effect.fn("video-firefox")(function*() {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({
    emulation: { viewport: { width: 1280, height: 720 } }
  })
  yield* page.route("**/*", yield* Route.fromHar(firefoxControlsRecording))
  yield* page.goto(firefoxControls, { waitUntil: "load" })
  const input = page.getByRole("textbox")
  // Firefox writes the video itself, for as long as the capability's scope lives
  const video = yield* Effect.scoped(Effect.gen(function*() {
    const recording = yield* page.capability(Capability.Video)
    yield* page.getByRole("button", { name: "Enable" }).click()
    yield* input.fill("Strider")
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    // A second more, so the last paint is in it
    yield* Effect.sleep("1 second")
    return recording
  }))
  // Into the context's temporary downloads, which close with the page: keep a copy
  yield* fs.copyFile(yield* video.file, firefoxVideoFile)
  return `${yield* input.readValue}, recorded`
})
// #endregion

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "readme",
    title: "The README's program",
    description: "Opens a page, clicks a button, waits for what it shows, and reads it: the README's first program.",
    expected: "Added to cart",
    strider: readmeStrider,
    playwright: readmePlaywright
  },
  {
    name: "login",
    title: "A login reused through storage state",
    description:
      "Signs in once, keeps the context's storage state, and opens a later page in a new context already signed in.",
    expected: "Signed in",
    strider: loginStrider,
    playwright: loginPlaywright
  },
  {
    name: "popup",
    title: "A popup with a dialog inside it",
    description: "Waits for the popup a click opens, accepts every dialog in it, and acts in it.",
    expected: "Allowed",
    strider: popupStrider,
    playwright: popupPlaywright
  },
  {
    name: "block",
    title: "A route that blocks analytics",
    description: "Aborts every request to the page's analytics with a route, declared before the page loads.",
    expected: "analytics blocked",
    strider: blockStrider,
    playwright: blockPlaywright
  },
  {
    name: "upload",
    title: "A file upload, from bytes",
    description: "Sets a file input from bytes the program makes, with no file on disk.",
    expected: "receipt.txt:4",
    strider: uploadStrider,
    playwright: uploadPlaywright
  },
  {
    name: "response",
    title: "A response's body, from a click",
    description:
      "Subscribes to the response a click causes, before the click, and decodes its JSON body with a schema.",
    expected: "tea × 1",
    strider: responseStrider,
    playwright: responsePlaywright
  },
  {
    name: "navigation",
    title: "Waiting for the navigation a click causes",
    description: "Subscribes to the navigation a click causes, before the click, then waits for it.",
    expected: "Orders",
    strider: navigationStrider,
    playwright: navigationPlaywright
  },
  {
    name: "har",
    title: "A HAR recorded, then replayed",
    description: "Records a page's traffic to a HAR, then serves a new page entirely from the recording.",
    expected: "42 sold",
    strider: harStrider,
    playwright: harPlaywright
  },
  {
    name: "the-internet",
    title: "The Internet's login, replayed",
    description: "Logs in on The Internet's demo login page, against a recording of the site.",
    expected: "Secure Area",
    recording: "the-internet",
    strider: theInternetStrider,
    playwright: theInternetPlaywright
  },
  {
    name: "controls",
    title: "The Internet's dynamic controls, replayed",
    description: "Enables a text box that a script enables three seconds later, and fills it as soon as it can.",
    expected: "Strider",
    recording: "the-internet",
    strider: controlsStrider,
    playwright: controlsPlaywright
  },
  {
    name: "video",
    title: "A video of a run, on Chromium",
    description: "Records the page's screencast to a WebM with ffmpeg while it fills The Internet's dynamic controls.",
    expected: "Strider, recorded",
    recording: "the-internet",
    video: "dynamic-controls.webm",
    compare: "video-firefox",
    strider: videoStrider
  },
  {
    name: "video-firefox",
    title: "A video of a run, on Firefox",
    description: "Records the page to a WebM with Firefox's own video while it fills The Internet's dynamic controls.",
    expected: "Strider, recorded",
    recording: "the-internet",
    video: "dynamic-controls-firefox.webm",
    browser: "firefox",
    compare: "video",
    strider: videoFirefoxStrider
  }
]

/** The public demo sites' recordings: each visited once, live, by `pnpm scenarios --record`. */
export const recordings = {
  "the-internet": Effect.fn("record the-internet")(function*(path: string) {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(`${theInternet}/login`)
    yield* page.getByLabel("Username").fill("tomsmith")
    yield* page.getByLabel("Password").fill("SuperSecretPassword!")
    yield* page.getByRole("button", { name: "Login" }).click()
    yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
    yield* page.goto(controls)
    yield* page.getByRole("button", { name: "Enable" }).click()
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    yield* har.exportHar(path, { include: ["cookies", "requestBodies"] })
  })
} as const
