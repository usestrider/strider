/**
 * The scenarios, each written twice: with Strider and with Playwright, as each library's own documentation would
 * write it, against the same stock Chromium. API.md's call sites that both libraries can do, on the local site
 * (`site.ts`), and two public demo sites replayed from recordings, so a run sends nothing to anyone.
 *
 * Each implementation sits between `#region <scenario>/<library>` markers, which the report copies into
 * RESULTS.md side by side. Each returns what it read, which the report compares.
 */
import {
  Browser,
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
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Playwright from "playwright-core"

/** What a Strider scenario needs: the browser, a scope for its pages, and a file system for HARs. */
export type StriderNeeds = Browser.Browser | Scope.Scope | FileSystem.FileSystem

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
  /** The Strider program: given the local site's address, and needing nothing of the runner's */
  readonly strider: (origin: string) => Effect.Effect<string, unknown, StriderNeeds>
  readonly playwright: (browser: Playwright.Browser, origin: string, files: Files) => Promise<string>
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
  yield* page.route(`${origin}/analytics/**`, () => Effect.succeed(Route.abort()))
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

// #region todomvc/strider
// TodoMVC's demo, and a recording of it to replay instead of visiting it
const todomvc = "https://demo.playwright.dev/todomvc/"
const todomvcRecording = ".data/scenarios/todomvc.har"

const todomvcStrider = Effect.fn("todomvc")(function*() {
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(todomvcRecording))
  yield* page.goto(todomvc)
  const input = page.getByPlaceholder("What needs to be done?")
  for (const todo of ["Buy tea", "Write docs", "Ship it"]) {
    yield* input.fill(todo)
    yield* input.press("Enter")
  }
  // The checkbox is `opacity: 0` under a styled label, which actions count as hidden
  const first = page.getByTestId("todo-item").first
  yield* first.getByRole("checkbox").check({ checks: { visible: false } })
  yield* page.getByText("2 items left").pipe(Expect.toBeVisible)
  return yield* page.getByTestId("todo-count").readText
})
// #endregion

// #region todomvc/playwright
const todomvcPlaywright = async (browser: Playwright.Browser, _: string, files: Files) => {
  const context = await browser.newContext()
  try {
    await context.routeFromHAR(files.recording("todomvc"), { notFound: "abort" })
    const page = await context.newPage()
    await page.goto(todomvc)
    const input = page.getByPlaceholder("What needs to be done?")
    for (const todo of ["Buy tea", "Write docs", "Ship it"]) {
      await input.fill(todo)
      await input.press("Enter")
    }
    await page.getByTestId("todo-item").first().getByRole("checkbox").check()
    await page.getByText("2 items left").waitFor()
    return (await page.getByTestId("todo-count").textContent()) ?? ""
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
  return yield* page.locator("h2").readText
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
    return (await page.locator("h2").textContent()) ?? ""
  } finally {
    await context.close()
  }
}
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
    name: "todomvc",
    title: "TodoMVC's demo, replayed",
    description: "Adds three todos to TodoMVC's demo and completes one, against a recording of the site.",
    expected: "2 items left",
    recording: "todomvc",
    note:
      "Strider's `check` waited out its deadline on TodoMVC's checkbox, which is `opacity: 0` under a styled label: its actions count an element of no opacity as hidden (CONCEPTS.md §8), where Playwright's count it visible. Turning the check off, `checks: { visible: false }`, says so at the call site (QUIRKS.md, Q241).",
    strider: todomvcStrider,
    playwright: todomvcPlaywright
  },
  {
    name: "the-internet",
    title: "The Internet's login, replayed",
    description: "Logs in on The Internet's demo login page, against a recording of the site.",
    expected: "Secure Area",
    recording: "the-internet",
    strider: theInternetStrider,
    playwright: theInternetPlaywright
  }
]

/** The public demo sites' recordings: each visited once, live, by `pnpm scenarios --record`. */
export const recordings = {
  "todomvc": Effect.fn("record todomvc")(function*(path: string) {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(todomvc)
    const input = page.getByPlaceholder("What needs to be done?")
    yield* input.fill("Buy tea")
    yield* input.press("Enter")
    yield* page.getByText("1 item left").pipe(Expect.toBeVisible)
    yield* har.exportHar(path, { include: ["cookies", "requestBodies"] })
  }),
  "the-internet": Effect.fn("record the-internet")(function*(path: string) {
    const page = yield* Browser.newPage()
    const har = yield* Har.record(page, { content: "embed" })
    yield* page.goto(`${theInternet}/login`)
    yield* page.getByLabel("Username").fill("tomsmith")
    yield* page.getByLabel("Password").fill("SuperSecretPassword!")
    yield* page.getByRole("button", { name: "Login" }).click()
    yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
    yield* har.exportHar(path, { include: ["cookies", "requestBodies"] })
  })
} as const
