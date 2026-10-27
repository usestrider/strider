# Strider and Playwright, side by side

*Written by `pnpm scenarios` on 2026-10-27: Chrome/155.0.8059.79, the integration environment's, driven headless by Strider at `dd98cc7` and by Playwright 1.64.1 through `playwright-core`, whose own browsers are never installed; Node v24.21.0; AMD Ryzen 9 9900X 12-Core Processor, 24 threads, 60 GiB, Linux 7.2.10, load 6.6 5.9 5.4 at the end. Timings are each scenario's wall time over 10 runs after one that warms it up, which libraries take turns going first in; the machine is a desktop, so they move with whatever else it runs. Don't edit: run `pnpm scenarios` again.*

## Scenarios

Each scenario is written with each library as its own documentation would write it, against the local site (`src/site.ts`), or a public demo site replayed from a recording, so a run sends nothing to anyone. A run is the whole scenario: its contexts and pages made and closed.

| Scenario | Strider | Playwright | Strider read | Playwright read | Lines, Strider / Playwright |
|---|---|---|---|---|---|
| The README's program | 184 ms (p90 205 ms) | 110 ms (p90 117 ms) | ✓ `Added to cart` | ✓ `Added to cart` | 7 / 11 |
| A login reused through storage state | 436 ms (p90 453 ms) | 297 ms (p90 318 ms) | ✓ `Signed in` | ✓ `Signed in` | 15 / 24 |
| A popup with a dialog inside it | 329 ms (p90 334 ms) | 154 ms (p90 199 ms) | ✓ `Allowed` | ✓ `Allowed` | 11 / 15 |
| A route that blocks analytics | 74 ms (p90 80 ms) | 77 ms (p90 93 ms) | ✓ `analytics blocked` | ✓ `analytics blocked` | 7 / 11 |
| A file upload, from bytes | 101 ms (p90 116 ms) | 81 ms (p90 91 ms) | ✓ `receipt.txt:4` | ✓ `receipt.txt:4` | 9 / 15 |
| A response's body, from a click | 194 ms (p90 200 ms) | 115 ms (p90 118 ms) | ✓ `tea × 1` | ✓ `tea × 1` | 15 / 15 |
| Waiting for the navigation a click causes | 243 ms (p90 252 ms) | 168 ms (p90 192 ms) | ✓ `Orders` | ✓ `Orders` | 8 / 11 |
| A HAR recorded, then replayed | 153 ms (p90 169 ms) | 155 ms (p90 176 ms) | ✓ `42 sold` | ✓ `42 sold` | 17 / 21 |
| The Internet's login, replayed | 347 ms (p90 360 ms) | 244 ms (p90 246 ms) | ✓ `Secure Area` | ✓ `Secure Area` | 13 / 15 |
| The Internet's dynamic controls, replayed | 3260 ms (p90 3296 ms) | 3416 ms (p90 3424 ms) | ✓ `Strider` | ✓ `Strider` | 14 / 15 |

**Launch:** a browser launched and a first page loaded, 5 times: Strider 257 ms (p90 481 ms), Playwright 144 ms (p90 163 ms).

## What a waiting expectation costs the page (Q82)

Strider evaluates a waiting expectation at every animation frame (QUIRKS.md, Q82). A page animating 200 of its 3000 elements each frame shows `#ready` after 3000 ms; the renderers' CPU time per second is read from `/proc` while each library waits for it, and while each leaves the page alone for as long.

| | Renderer CPU per second |
|---|---|
| Strider, idle | 286 ms (p90 319 ms) |
| Strider, `Expect.toBeVisible` waiting | 327 ms (p90 341 ms) |
| Playwright, idle | 270 ms (p90 277 ms) |
| Playwright, `locator.waitFor()` waiting | 297 ms (p90 314 ms) |

## What an interceptor installed costs a load (Q103)

Strider keeps Chromium's `Fetch` interceptor enabled on every page, with a pattern nothing matches, so a route is in force as soon as it is declared (QUIRKS.md, Q103). A page with 300 images, each a request, loaded to its `load` event:

| | Load |
|---|---|
| Strider, no route (its interceptor is always installed, Q103) | 123 ms (p90 131 ms) |
| Strider, a route matching nothing on the page | 140 ms (p90 184 ms) |
| Playwright, no route | 84 ms (p90 105 ms) |
| Playwright, a route matching nothing on the page | 127 ms (p90 150 ms) |

## What each leaves for a page to see

What a page's own script reads about the browser driving it, the signals bot protection looks for (`/tells` in `src/site.ts`), headless, as each launches by default:

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
Strider:    --no-first-run --no-default-browser-check --no-service-autorun --disable-sync --disable-component-update --disable-background-networking --disable-default-apps --disable-client-side-phishing-detection --disable-domain-reliability --disable-breakpad --disable-hang-monitor --disable-prompt-on-repost --disable-component-extensions-with-background-pages --disable-features=Translate,MediaRouter,DialMediaRouteProvider,OptimizationHints,AutofillServerCommunication --metrics-recording-only --password-store=basic --use-mock-keychain --headless --remote-debugging-pipe --user-data-dir=/tmp/nix-shell.SOHYbR/strider-chromium-lbRw4J about:blank
Playwright: --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/nix-shell.SOHYbR/playwright_chromiumdev_profile-yDUhlO --remote-debugging-pipe --no-startup-window
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
