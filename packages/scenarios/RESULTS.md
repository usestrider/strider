# Strider and Playwright, side by side

_Written by `pnpm scenarios` on 2026-10-27: Chrome/155.0.8059.79, the integration environment's, driven headless by Strider at `8e9210f` and by Playwright 1.64.1 through `playwright-core`, whose own browsers are never installed; Node v24.21.0; AMD Ryzen 9 9900X 12-Core Processor, 24 threads, 60 GiB, Linux 7.2.10, load 2.9 2.6 2.4 at the end. Timings are each scenario's wall time over 10 runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Don't edit: run `pnpm scenarios` again._

## Scenarios

Each scenario is written with each library as its own documentation would write it, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed.

| Scenario                                  | Strider             | Playwright          | Strider read                               | Playwright read                            | Lines, Strider / Playwright |
| ----------------------------------------- | ------------------- | ------------------- | ------------------------------------------ | ------------------------------------------ | --------------------------- |
| The README's program                      | 173 ms (p90 189 ms) | 98 ms (p90 101 ms)  | ✓ `Added to cart`                          | ✓ `Added to cart`                          | 7 / 11                      |
| A login reused through storage state      | 395 ms (p90 410 ms) | 263 ms (p90 270 ms) | ✓ `Signed in`                              | ✓ `Signed in`                              | 15 / 24                     |
| A popup with a dialog inside it           | 311 ms (p90 316 ms) | 145 ms (p90 152 ms) | ✓ `Allowed`                                | ✓ `Allowed`                                | 11 / 15                     |
| A route that blocks analytics             | 66 ms (p90 72 ms)   | 69 ms (p90 73 ms)   | ✓ `analytics blocked`                      | ✓ `analytics blocked`                      | 7 / 11                      |
| A file upload, from bytes                 | 99 ms (p90 106 ms)  | 69 ms (p90 75 ms)   | ✓ `receipt.txt:4`                          | ✓ `receipt.txt:4`                          | 9 / 15                      |
| A response's body, from a click           | 191 ms (p90 199 ms) | 109 ms (p90 118 ms) | ✓ `{"items":[{"sku":"tea","quantity":1}]}` | ✓ `{"items":[{"sku":"tea","quantity":1}]}` | 12 / 14                     |
| Waiting for the navigation a click causes | 236 ms (p90 260 ms) | 167 ms (p90 178 ms) | ✓ `Orders`                                 | ✓ `Orders`                                 | 8 / 11                      |
| A HAR recorded, then replayed             | 139 ms (p90 154 ms) | 152 ms (p90 175 ms) | ✓ `42 sold`                                | ✓ `42 sold`                                | 16 / 21                     |
| TodoMVC's demo, replayed                  | 424 ms (p90 438 ms) | 176 ms (p90 183 ms) | ✓ `2 items left`                           | ✓ `2 items left`                           | 14 / 18                     |
| The Internet's login, replayed            | 326 ms (p90 359 ms) | 233 ms (p90 260 ms) | ✓ `Secure Area`                            | ✓ `Secure Area`                            | 10 / 15                     |

**Launch:** a browser launched and a first page loaded, 5 times: Strider 201 ms (p90 425 ms), Playwright 130 ms (p90 134 ms).

## What a waiting expectation costs the page (Q82)

Strider evaluates a waiting expectation at every animation frame (QUIRKS.md, Q82). A page animating 200 of its 3000 elements each frame shows `#ready` after 3000 ms; the renderers' CPU time per second is read from `/proc` while each library waits for it, and while each leaves the page alone for as long.

|                                         | Renderer CPU per second |
| --------------------------------------- | ----------------------- |
| Strider, idle                           | 256 ms (p90 289 ms)     |
| Strider, `Expect.toBeVisible` waiting   | 287 ms (p90 300 ms)     |
| Playwright, idle                        | 253 ms (p90 280 ms)     |
| Playwright, `locator.waitFor()` waiting | 246 ms (p90 259 ms)     |

## What an interceptor installed costs a load (Q103)

Strider keeps Chromium's `Fetch` interceptor enabled on every page, with a pattern nothing matches, so a route is in force as soon as it is declared (QUIRKS.md, Q103). A page with 300 images, each a request, loaded to its `load` event:

|                                                               | Load                |
| ------------------------------------------------------------- | ------------------- |
| Strider, no route (its interceptor is always installed, Q103) | 106 ms (p90 116 ms) |
| Strider, a route matching nothing on the page                 | 110 ms (p90 113 ms) |
| Playwright, no route                                          | 73 ms (p90 83 ms)   |
| Playwright, a route matching nothing on the page              | 111 ms (p90 120 ms) |

## What each leaves for a page to see

What a page's own script reads about the browser driving it, the signals bot protection looks for (`/tells` in `src/site.ts`), headless, as each launches by default:

|                                 | Strider                                                                                      | Playwright                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| navigator.webdriver             | true                                                                                         | true                                                                                         |
| userAgent says HeadlessChrome   | true                                                                                         | true                                                                                         |
| Runtime.enable observed         | false                                                                                        | false                                                                                        |
| window.chrome                   | object                                                                                       | object                                                                                       |
| window.chrome.runtime           | undefined                                                                                    | undefined                                                                                    |
| navigator.plugins.length        | 5                                                                                            | 5                                                                                            |
| navigator.languages             | en-US,en                                                                                     | en-US,en                                                                                     |
| outer size                      | 780×580                                                                                      | 1280×720                                                                                     |
| inner size                      | 780×493                                                                                      | 1280×720                                                                                     |
| screen size                     | 800×600                                                                                      | 1280×720                                                                                     |
| Notification.permission / query | default / prompt                                                                             | default / prompt                                                                             |
| WebGL renderer                  | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) |
| globals added                   | 0                                                                                            | 0                                                                                            |

The arguments each launched Chromium with:

```
Strider:    --no-first-run --no-default-browser-check --no-service-autorun --disable-sync --disable-component-update --disable-background-networking --disable-default-apps --disable-client-side-phishing-detection --disable-domain-reliability --disable-breakpad --disable-hang-monitor --disable-prompt-on-repost --disable-component-extensions-with-background-pages --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication --metrics-recording-only --password-store=basic --use-mock-keychain --headless --remote-debugging-pipe --user-data-dir=/tmp/nix-shell.i2WVC3/strider-chromium-Tiz1Qb about:blank
Playwright: --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/nix-shell.i2WVC3/playwright_chromiumdev_profile-J7twG6 --remote-debugging-pipe --no-startup-window
```

## The code

### The README's program

```ts
const readmeStrider = Effect.fn("readme")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/`)
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("Added to cart").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
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
```

### A login reused through storage state

```ts
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
```

```ts
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
```

### A popup with a dialog inside it

```ts
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
```

```ts
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
```

### A route that blocks analytics

```ts
const blockStrider = Effect.fn("block")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.route(`${origin}/analytics/**`, () => Effect.succeed(Route.abort()))
  yield* page.goto(`${origin}/tracked`)
  yield* page.getByText("analytics blocked").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
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
```

### A file upload, from bytes

```ts
const uploadStrider = Effect.fn("upload")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/upload`)
  yield* page.getByLabel("Receipt").setInputFiles([
    FileInput.bytes("receipt.txt", "text/plain", new TextEncoder().encode("paid"))
  ])
  yield* page.getByText("receipt.txt:4").pipe(Expect.toBeVisible)
  return yield* page.locator("#out").readText
})
```

```ts
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
```

### A response's body, from a click

```ts
const responseStrider = Effect.fn("response")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/cart`)
  const added = yield* NetworkResponse.next(page, {
    url: `${origin}/api/cart`,
    method: "POST",
    body: (message) => message.json
  })
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  const response = yield* added
  return JSON.stringify(response.body)
})
```

```ts
const responsePlaywright = async (browser: Playwright.Browser, origin: string) => {
  const page = await browser.newPage()
  try {
    await page.goto(`${origin}/cart`)
    const added = page.waitForResponse((response) =>
      response.url() === `${origin}/api/cart` && response.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Add to cart" }).click()
    const response = await added
    return JSON.stringify(await response.json())
  } finally {
    await page.close()
  }
}
```

### Waiting for the navigation a click causes

```ts
const navigationStrider = Effect.fn("navigation")(function*(origin: string) {
  const page = yield* Browser.newPage()
  yield* page.goto(`${origin}/home`)
  const orders = yield* PageNavigation.next(page, { url: `${origin}/orders` })
  yield* page.getByRole("link", { name: "Orders" }).click()
  yield* orders
  return yield* page.getByRole("heading").readText
})
```

```ts
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
```

### A HAR recorded, then replayed

```ts
const harStrider = Effect.fn("har")(function*(origin: string, files: Files) {
  const path = files.temporary("report-strider.har")
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
```

```ts
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
```

### TodoMVC's demo, replayed

```ts
const todomvcStrider = Effect.fn("todomvc")(function*(_: string, files: Files) {
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(files.recording("todomvc")))
  yield* page.goto(todomvc)
  const input = page.getByPlaceholder("What needs to be done?")
  for (const todo of ["Buy tea", "Write docs", "Ship it"]) {
    yield* input.fill(todo)
    yield* input.press("Enter")
  }
  // TodoMVC's checkbox is `opacity: 0` under its styled label, which Strider's actions count as hidden (Q241)
  yield* page.getByTestId("todo-item").first.getByRole("checkbox").check({ checks: { visible: false } })
  yield* page.getByText("2 items left").pipe(Expect.toBeVisible)
  return yield* page.getByTestId("todo-count").readText
})
```

```ts
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
```

Strider's `check` waited out its deadline on TodoMVC's checkbox, which is `opacity: 0` under a styled label: its actions count an element of no opacity as hidden (CONCEPTS.md §8), where Playwright's count it visible. Turning the check off, `checks: { visible: false }`, says so at the call site (QUIRKS.md, Q241).

### The Internet's login, replayed

```ts
const theInternetStrider = Effect.fn("the-internet")(function*(_: string, files: Files) {
  const page = yield* Browser.newPage()
  yield* page.route("**/*", yield* Route.fromHar(files.recording("the-internet")))
  yield* page.goto(`${theInternet}/login`)
  yield* page.getByLabel("Username").fill("tomsmith")
  yield* page.getByLabel("Password").fill("SuperSecretPassword!")
  yield* page.getByRole("button", { name: "Login" }).click()
  yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
  return yield* page.locator("h2").readText
})
```

```ts
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
```
