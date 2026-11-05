# Strider and Playwright, side by side

*Written by `pnpm scenarios` on 2026-11-05: Chrome/155.0.8059.79, the integration environment's, driven headless by Strider at `c732173` and by Playwright 1.64.1 through `playwright-core`, whose own browsers are never installed; Node v24.21.0; AMD Ryzen 9 9900X 12-Core Processor, 24 threads, 60 GiB, Linux 7.2.10, load 8.2 4.7 5.0 at the end. Timings are each scenario's wall time over 10 scheduled runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Don't edit: run `pnpm scenarios` again.*

## Scenarios

Each scenario is written with each library as its own documentation would write it, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed.

| Scenario | Strider | Playwright | Strider read | Playwright read | Lines, Strider / Playwright |
|---|---|---|---|---|---|
| The README's program | 97 ms (p90 112 ms); 10/10 successful | 99 ms (p90 101 ms); 10/10 successful | ✓ `Added to cart` | ✓ `Added to cart` | 7 / 11 |
| A login reused through storage state | 323 ms (p90 332 ms); 10/10 successful | 263 ms (p90 272 ms); 10/10 successful | ✓ `Signed in` | ✓ `Signed in` | 15 / 24 |
| A popup with a dialog inside it | 149 ms (p90 162 ms); 10/10 successful | 150 ms (p90 154 ms); 10/10 successful | ✓ `Allowed` | ✓ `Allowed` | 11 / 15 |
| A route that blocks analytics | 71 ms (p90 74 ms); 10/10 successful | 73 ms (p90 77 ms); 10/10 successful | ✓ `analytics blocked` | ✓ `analytics blocked` | 7 / 11 |
| A file upload, from bytes | 100 ms (p90 105 ms); 10/10 successful | 74 ms (p90 77 ms); 10/10 successful | ✓ `receipt.txt:4` | ✓ `receipt.txt:4` | 9 / 15 |
| A response's body, from a click | 109 ms (p90 111 ms); 10/10 successful | 115 ms (p90 117 ms); 10/10 successful | ✓ `tea × 1` | ✓ `tea × 1` | 15 / 15 |
| Waiting for the navigation a click causes | 156 ms (p90 170 ms); 10/10 successful | 166 ms (p90 177 ms); 10/10 successful | ✓ `Orders` | ✓ `Orders` | 8 / 11 |
| A HAR recorded, then replayed | 140 ms (p90 147 ms); 10/10 successful | 135 ms (p90 146 ms); 10/10 successful | ✓ `42 sold` | ✓ `42 sold` | 17 / 21 |
| The Internet's login, replayed | 253 ms (p90 263 ms); 10/10 successful | 237 ms (p90 248 ms); 10/10 successful | ✓ `Secure Area` | ✓ `Secure Area` | 13 / 15 |
| The Internet's dynamic controls, replayed | –; 0/10 successful | –; 0/10 successful | failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page) | failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load" | 14 / 15 |

Timing counts are successful/attempted repetitions; failed attempts are excluded from statistics. Initial outcomes above are retained separately.

- The Internet's dynamic controls, replayed, strider, timed repetition 1: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, playwright, timed repetition 1: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, playwright, timed repetition 2: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, strider, timed repetition 2: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, strider, timed repetition 3: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, playwright, timed repetition 3: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, playwright, timed repetition 4: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, strider, timed repetition 4: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, strider, timed repetition 5: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, playwright, timed repetition 5: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, playwright, timed repetition 6: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, strider, timed repetition 6: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, strider, timed repetition 7: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, playwright, timed repetition 7: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, playwright, timed repetition 8: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, strider, timed repetition 8: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, strider, timed repetition 9: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)
- The Internet's dynamic controls, replayed, playwright, timed repetition 9: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, playwright, timed repetition 10: failed: page.goto: net::ERR_FAILED at https://the-internet.herokuapp.com/dynamic_controls Call log: - navigating to "https://the-internet.herokuapp.com/dynamic_controls", waiting until "load"
- The Internet's dynamic controls, replayed, strider, timed repetition 10: failed: Page.goto: Navigation to https://the-internet.herokuapp.com/dynamic_controls failed: net::ERR_FAILED (The browser couldn't load the page)

**Launch:** a browser launched and a first page loaded, 5 times: Strider 213 ms (p90 454 ms), Playwright 127 ms (p90 138 ms).

## What a waiting expectation costs the page (Q82)

Strider evaluates a waiting expectation at every animation frame (QUIRKS.md, Q82). A page animating 200 of its 3000 elements each frame shows `#ready` after 3000 ms; the renderers' CPU time per second is read from `/proc` while each library waits for it, and while each leaves the page alone for as long.

| | Renderer CPU per second |
|---|---|
| Strider, idle | 266 ms (p90 269 ms) |
| Strider, `Expect.toBeVisible` waiting | 284 ms (p90 294 ms) |
| Playwright, idle | 280 ms (p90 393 ms) |
| Playwright, `locator.waitFor()` waiting | 296 ms (p90 335 ms) |

## What an interceptor installed costs a load (Q103)

Strider keeps Chromium's `Fetch` interceptor enabled on every page, with a pattern nothing matches, so a route is in force as soon as it is declared (QUIRKS.md, Q103). A page with 300 images, each a request, loaded to its `load` event:

| | Load |
|---|---|
| Strider, no route (its interceptor is always installed, Q103) | 122 ms (p90 130 ms) |
| Strider, a route matching nothing on the page | 121 ms (p90 131 ms) |
| Playwright, no route | 82 ms (p90 86 ms) |
| Playwright, a route matching nothing on the page | 120 ms (p90 129 ms) |

## What each leaves for a page to see

What a page's own script reads about the browser driving it (`/tells` in `src/site.ts`), headless, as each launches by default:

| | Strider | Playwright |
|---|---|---|
| navigator.webdriver | true | true |
| userAgent says HeadlessChrome | true | true |
| Runtime.enable observed | false | false |
| window.chrome | object | object |
| window.chrome.runtime | undefined | undefined |
| navigator.plugins.length | 5 | 5 |
| navigator.languages | en-US,en | en-US,en |
| outer size | 780×580 | 1280×720 |
| inner size | 780×493 | 1280×720 |
| screen size | 800×600 | 1280×720 |
| Notification.permission / query | default / prompt | default / prompt |
| WebGL renderer | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver) |
| globals added | 0 | 0 |

The arguments each launched Chromium with:

```
Strider:    --no-first-run --no-default-browser-check --no-service-autorun --disable-sync --disable-component-update --disable-background-networking --disable-default-apps --disable-client-side-phishing-detection --disable-domain-reliability --disable-breakpad --disable-hang-monitor --disable-prompt-on-repost --disable-component-extensions-with-background-pages --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication --enable-features=CDPScreenshotNewSurface --metrics-recording-only --password-store=basic --use-mock-keychain --headless --remote-debugging-pipe --user-data-dir=/tmp/nix-shell.pl2ayS/strider-chromium-yZrC5x about:blank
Playwright: --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/nix-shell.pl2ayS/playwright_chromiumdev_profile-AOxEhp --remote-debugging-pipe --no-startup-window
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
  yield* page.route(`${origin}/analytics/**`, () => Route.abort())
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
    const cart = (await response.json()) as { items: ReadonlyArray<{ sku: string; quantity: number }> }
    return cart.items.map((item) => `${item.sku} × ${item.quantity}`).join(", ")
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

### The Internet's login, replayed

```ts
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

### The Internet's dynamic controls, replayed

```ts
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
```

```ts
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
```
