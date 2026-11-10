/**
 * The scenarios, each written twice: with Strider and with Playwright, as each library's own documentation would
 * write it, against the same stock Chromium. One that only shows Strider, such as the video, has no twin. API.md's call sites that both libraries can do, on the local site
 * (`site.ts`), and a public demo site replayed from a recording, so a run sends nothing to anyone. A Strider program
 * visits the site live, as a reader would copy it, and the runner replays the recording under it (`replay.ts`).
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
  PageNavigation,
  Popup,
  Route
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Playwright from "playwright-core"

/** What a Strider scenario needs: the browser, a scope for its pages, a file system for HARs, and processes. */
export type StriderNeeds =
  | Browser.Browser
  | Scope.Scope
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner

export type Scenario =
  & {
    readonly name: string
    readonly title: string
    /** What the Strider program shows, above its code in the report. */
    readonly description: string
    /** The value both implementations must return. */
    readonly expected: string
    /** What writing it found, shown under its code. */
    readonly note?: string
    /** The browser the Strider program runs on: Chromium unless it says Firefox */
    readonly browser?: "firefox"
    /** The Strider program: given the local site's address, and needing nothing of the runner's */
    readonly strider: (origin: string) => Effect.Effect<string, unknown, StriderNeeds>
    /** Its twin, for the comparison; none for a scenario that only shows Strider */
    readonly playwright?: (browser: Playwright.Browser, origin: string, files: Files) => Promise<string>
  }
  & (
    | { readonly recording?: undefined; readonly requiredPages?: undefined }
    | {
      /** A public demo site, replayed from `.data/scenarios/<recording>.har`. */
      readonly recording: keyof typeof recordings
      /** Exact GET page URLs needed by this scenario, including navigation destinations. */
      readonly requiredPages: ReadonlyArray<string>
    }
  )

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
const theInternet = "https://the-internet.herokuapp.com"

const theInternetStrider = Effect.fn("the-internet")(function*() {
  const page = yield* Browser.newPage()
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
const controls = "https://the-internet.herokuapp.com/dynamic_controls"

const controlsStrider = Effect.fn("controls")(function*() {
  const page = yield* Browser.newPage()
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
// The page, and where its video goes
const dynamicControls = "https://the-internet.herokuapp.com/dynamic_controls"
const videoFile = "dynamic-controls.webm"

const videoStrider = Effect.fn("video")(function*() {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
  yield* page.goto(dynamicControls, { waitUntil: "load" })
  let value = ""
  const recording = yield* Effect.scoped(Effect.gen(function*() {
    const recording = yield* page.capability(Capability.Video)
    yield* page.getByRole("button", { name: "Enable" }).click()
    const input = page.getByRole("textbox")
    yield* input.fill("Strider")
    yield* page.getByText("It's enabled!").pipe(Expect.toBeVisible)
    value = yield* input.readValue
    return recording
  }))
  yield* fs.copyFile(yield* recording.file, videoFile)
  const { size } = yield* fs.stat(videoFile)
  return size > 0 ? `${value}, recorded` : `${value}, but the video is empty`
})
// #endregion

// #region video-firefox/strider
// The page, and where its video goes
const firefoxControls = "https://the-internet.herokuapp.com/dynamic_controls"
const firefoxVideoFile = "dynamic-controls-firefox.webm"

const videoFirefoxStrider = Effect.fn("video-firefox")(function*() {
  const fs = yield* FileSystem.FileSystem
  const page = yield* Browser.newPage({
    emulation: { viewport: { width: 1280, height: 720 } }
  })
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

// The twenty pages again, in a context that emulates focus, where Chromium opens pages as tabs
const manyPagesEmulatedStrider = Effect.fn("many pages emulated")(function*(origin: string) {
  const context = yield* Browser.newContext({ focus: "emulated" })
  const pages = []
  for (let i = 0; i < 20; i++) {
    const page = yield* context.newPage
    yield* page.goto(`${origin}/benchmark`)
    yield* page.getByRole("button", { name: "Increment" }).click()
    pages.push(page)
  }
  const values = []
  for (const page of pages) values.push(yield* page.locator("#count").readText)
  return values.join(",")
})

// #region many-pages/strider
const manyPagesStrider = Effect.fn("many pages")(function*(origin: string) {
  const context = yield* Browser.newContext()
  const pages = []
  for (let i = 0; i < 20; i++) {
    const page = yield* context.newPage
    yield* page.goto(`${origin}/benchmark`)
    yield* page.getByRole("button", { name: "Increment" }).click()
    pages.push(page)
  }
  const values = []
  for (const page of pages) values.push(yield* page.locator("#count").readText)
  return values.join(",")
})
// #endregion

// #region many-pages/playwright
const manyPagesPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const context = await browser.newContext()
  try {
    const pages = []
    for (let i = 0; i < 20; i++) {
      const page = await context.newPage()
      await page.goto(`${origin}/benchmark`)
      await page.getByRole("button", { name: "Increment" }).click()
      pages.push(page)
    }
    const values = []
    for (const page of pages) values.push(await page.locator("#count").textContent())
    return values.join(",")
  } finally {
    await context.close()
  }
}
// #endregion

// #region long-session/strider
const longSessionStrider = Effect.fn("long session")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/benchmark`)
  for (let i = 0; i < 150; i++) {
    yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
    yield* page.getByRole("button", { name: "Increment" }).click()
  }
  return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" }).readValue}`
})
// #endregion

// #region long-session/playwright
const longSessionPlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/benchmark`)
    for (let i = 0; i < 150; i++) {
      await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
      await page.getByRole("button", { name: "Increment" }).click()
    }
    return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
      .inputValue()}`
  } finally {
    await page.close()
  }
}
// #endregion

// #region parallel-tests/strider
const parallelTestsStrider = (origin: string) =>
  Effect.forEach(
    Array.from({ length: 4 }),
    () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/benchmark`)
        for (let i = 0; i < 25; i++) {
          yield* page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
          yield* page.getByRole("button", { name: "Increment" }).click()
        }
        return `${yield* page.locator("#count").readText}:${yield* page.getByRole("textbox", { name: "Name" })
          .readValue}`
      })),
    { concurrency: 4 }
  ).pipe(Effect.map((values) => values.join(",")))
// #endregion

// #region parallel-tests/playwright
const parallelTestsPlaywright = async (browser: Playwright.Browser, origin: string) =>
  (await Promise.all(Array.from({ length: 4 }, async () => {
    const page = await browser.newPage()
    try {
      await page.goto(`${origin}/benchmark`)
      for (let i = 0; i < 25; i++) {
        await page.getByRole("textbox", { name: "Name" }).fill(`value-${i}`)
        await page.getByRole("button", { name: "Increment" }).click()
      }
      return `${await page.locator("#count").textContent()}:${await page.getByRole("textbox", { name: "Name" })
        .inputValue()}`
    } finally {
      await page.close()
    }
  }))).join(",")
// #endregion

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "many-pages",
    title: "20 pages in one context",
    description:
      "Keeps 20 pages open, navigating and clicking once on each, then checks every counter before closing the context.",
    expected: "1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
    strider: manyPagesStrider,
    playwright: manyPagesPlaywright
  },
  {
    name: "many-pages-emulated",
    title: "20 pages in one context, emulating focus",
    description:
      "As 20 pages in one context, with Strider's context emulating focus, where Chromium opens its pages as tabs; Playwright is unchanged, as it always emulates focus.",
    expected: "1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
    strider: manyPagesEmulatedStrider,
    playwright: manyPagesPlaywright
  },
  {
    name: "long-session",
    title: "300 actions in one session",
    description: "Runs 150 fill/click pairs in one page and context, then verifies the counter and final input value.",
    expected: "150:value-149",
    strider: longSessionStrider,
    playwright: longSessionPlaywright
  },
  {
    name: "parallel-tests",
    title: "4 parallel tests sharing one browser",
    description:
      "Runs four isolated contexts concurrently, with 25 fill/click pairs in each, then verifies all four counters and input values.",
    expected: "25:value-24,25:value-24,25:value-24,25:value-24",
    strider: parallelTestsStrider,
    playwright: parallelTestsPlaywright
  },
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
    title: "The Internet's login",
    description: "Logs in on The Internet's demo login page.",
    expected: "Secure Area",
    recording: "the-internet",
    requiredPages: [`${theInternet}/login`, `${theInternet}/secure`],
    strider: theInternetStrider,
    playwright: theInternetPlaywright
  },
  {
    name: "controls",
    title: "The Internet's dynamic controls",
    description: "Enables a text box that a script enables three seconds later, and fills it as soon as it can.",
    expected: "Strider",
    recording: "the-internet",
    requiredPages: [controls],
    strider: controlsStrider,
    playwright: controlsPlaywright
  },
  {
    name: "video",
    title: "A video of a run",
    description:
      "Records a page to a WebM while it fills The Internet's dynamic controls: on Chromium from its screencast, with ffmpeg, and on Firefox with its own video.",
    expected: "Strider, recorded",
    recording: "the-internet",
    requiredPages: [controls],
    strider: videoStrider
  },
  {
    name: "video-firefox",
    title: "A video of a run, on Firefox",
    description:
      "Firefox records the video itself: no recorder and no ffmpeg, only the capability, for as long as its scope lives.",
    expected: "Strider, recorded",
    recording: "the-internet",
    requiredPages: [controls],
    browser: "firefox",
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
