# Using @usestrider/browser

Instructions for agents writing code that uses Strider. `INDEX.md` in this package lists every declaration and member.
The design and its reasons are in the repository: https://github.com/usestrider/strider.

Strider is pre-release: the API is designed and type-checked, and the implementation is in progress. Launching,
`Browser.newPage`, navigation, the queries, frames (`page.frame`, `locator.frame`, `page.frames`), every locator
action (`click`, `dblclick`, `tap`, `hover`, `check`, `uncheck`, `focus`, `clear`, `fill`, `press`,
`pressSequentially`, `selectOption`, `setInputFiles`, `dragTo`, `scrollIntoView`), the one-shot reads,
`page.keyboard` and `page.mouse`, every `Expect` matcher, `Condition`, `Deadline`, evaluation (`page.evaluate`,
`evaluateInMainWorld`, `evaluateHandle`, `JSHandle`, `Locator.evaluate`), snapshots with refs and `AriaPattern`,
`screenshot`, `pdf` and `readHtml`, cookies, `localStorage` and `sessionStorage`, storage state with IndexedDB
(`exportStorageState`, the context option `storageState`), attaching (`Chromium.layerConnect`,
`Firefox.layerConnect`, `Bidi.layerConnect`, and `WebKit.layerAttach` for stock WebKit), `browser.pages`, the default
context, `inspect` and `control` for a scope,
every event module (`Popup`, `Dialog`, `FileChooser`, `Download`, `ConsoleMessage`,
`UncaughtException`, `PageNavigation`, `NetworkRequest`, `NetworkResponse`, `BrowserWorker`, `NetworkConnection`,
`AutoResolution`), `Dialog.handle` and `FileChooser.handle`, and the declarations (`route`, `addInitScript`,
`emulate`, `grant`, `clock`, and the context options `emulation`, `permissions` and `focus`), `FileInput.bytes`,
`goto({ accept })`, `close({ runBeforeUnload: true })`, `Page.capability`, the span references
(`Browser.SpanNameGenerator`, `TracerDisabledWhen`, `TraceProtocolCommands`) and `Diagnostics.withPreset`, and the
test layers (`Browser.layerTest`, and `VitestBrowser.layer` from `@usestrider/vitest`), recordings (`Har.record`, `Trace.record`), the agent toolkit
(`BrowserToolkit`, `CapturePolicy`) and the `strider` command (CLI.md) work on every backend. What a backend can't do or report
fails with `Unsupported`, naming the capability: an HTML drag anywhere but Chromium, a CSS-pixel or transparent
screenshot and a PDF's header on Firefox, a partitioned cookie anywhere but Chromium, `Capability.AxTree` anywhere but
Chromium, `Capability.Screencast` on Firefox, and on WebKit, which is stock WebKit, `evaluate`, a PDF, a screencast,
waiting for a popup, a download or a file chooser, and most emulation; attached, input, dialogs and new pages too
(`WebKit.layer`'s and `WebKit.layerAttach`'s documentation list them). Every member the API declares is built.

## Shape

- Import modules as namespaces: `import { Browser, Expect, Page } from "@usestrider/browser"`. Types are
  `Page.Page`, `Locator.Locator`, `Download.Download`.
- A backend layer provides `Browser`, from a subpath: `Chromium.layer({ executablePath: "/usr/bin/chromium" })`
  from `"@usestrider/browser/chromium"`, also `/firefox`, `/webkit` and `/bidi`. `executablePath` is required and
  absolute; nothing is looked up, downloaded or installed. `npx strider browsers` lists the browsers on the machine,
  by path. Code that runs on several machines reads the path from the environment:
  `Chromium.layerConfig({ executablePath: Config.String("CHROMIUM_PATH") })`.
- Open a page with `Browser.newPage(options?)` inside `Effect.scoped`; the page and its context close with the scope.
- Write reusable steps as `Effect.fn("name")(function*(page: Page.Page) { … })`.

## Rules that are easy to get wrong

- **Subscribe before you act.** Event waits start when `next` returns, so call it before the action that causes the
  event, then await:
  ```ts
  const exportCsv = Effect.fn("exportCsv")(function*(page: Page.Page) {
    const download = yield* Download.next(page)
    yield* page.getByText("Export CSV").click()
    return yield* download
  })
  ```
  `history` reads what already happened and never waits.
- **Actions are calls; reads are values.** `button.click()`, `field.fill(value)`; `locator.count`, `page.title`.
  `Expect.to*` retries until the deadline; reads never retry.
- **No sleeps.** Wait for something specific: `Expect.toBeVisible`, `page.status.waitFor(…)`, or an event's `next`.
- **Deadlines are cross-cutting.** `effect.pipe(Deadline.within("5 seconds"))` sets one budget for everything inside.
- **Access is typed, and held by a scope.** A `Page.ReadonlyPage` can read but not act. A page you didn't open
  (`browser.pages`, an attached browser's tabs, a launched browser's first tab) is observed: `yield* page.inspect` or
  `yield* page.control` inside `Effect.scoped` gains access for the scope, after which the handle fails with
  `TargetGone{AccessReleased}` and its routes are removed. Attach with `Chromium.layerConnect("http://127.0.0.1:9222")`
  or `Firefox.layerConnect("ws://127.0.0.1:9222")`; Firefox takes one client at a time. A WebKitGTK or WPE browser
  started with `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9333` attaches with `WebKit.layerAttach("http://127.0.0.1:9333")`
  for looking, not driving: no clicks or typing, so script the page with `evaluateInMainWorld`, which is also the
  only evaluation there, since stock WebKit has no isolated worlds.
- **Stock WebKit launched** is `WebKit.layer({ executablePath: ".../MiniBrowser" })`, which needs a display
  (`DISPLAY`; there is no headless mode) and a `SocketConnector` (`@usestrider/browser/protocol`):
  `SocketConnector.layer((endpoint) => NodeSocket.makeNet({ host: endpoint.host, port: endpoint.port }))`. Clicks
  and typing work, and frame locators; `evaluate` doesn't (use `evaluateInMainWorld`); dialogs arrive as
  `Dialog.Unknown`, so a `Dialog.handle` handler matching on `_tag` needs that case; `back` and `forward` are refused,
  and `Popup`, `Download` and `FileChooser` waits fail at once with `SubscriptionError{Unsupported}`: a page another
  opens has no opener there. A context's cookie list is what its open pages are sent.
- **Errors are per module, with a reason.** Recover with
  `Effect.catchReason("LocatorError", "StrictViolation", …)`. Any operation can also fail with `TargetGone` or
  `Timeout`, which says how far it got (`timeout.phase`); a `waitFor` on a value that settled for good, such as a
  finished download's status, fails with `Watchable.Ended` and the value.
- **Secrets stay `Redacted`.** Pass `Config.Redacted("PASSWORD")` to `fill`; it is never logged or traced.
- **Keys are UI Events names, modifiers an option.** `field.press("Enter")`,
  `field.press("a", { modifiers: ["Control"] })`; there is no `"Control+A"` syntax.
- **Reads are strict.** `readText`, `readValue` and the other reads need exactly one match and never wait: none is
  `NoMatch`, several `StrictViolation`. To wait for a value, expect it: `field.pipe(Expect.toHaveValue("Ada"))`.
- **Held input is scoped.** `yield* page.keyboard.hold("Shift")` inside `Effect.scoped`; the scope releases it.
- **A popup's opener on Chromium renders nothing while the popup is in front,** so actions on it time out: call
  `page.activate` on it first, or make the context with `newContext({ focus: "emulated" })` when many pages act
  at once. Firefox opens every page, popups too, as a window, which keeps rendering; WebKit renders them all.
- **A route has one phase.** `page.route(pattern, handler)` sees requests before they are sent; pass
  `{ phase: "response" }` or `{ phase: "auth" }` for the others. Return a `Route` decision valid for it
  (`Route.fulfill`, `Route.continueWith`, `Route.abort()`, `Route.fallthrough`, `Route.continue`); there is no
  `fetch` on the request. A failing handler lets the request continue, logged. At the response phase,
  `Route.continueWith({ status, headers })` changes a response but not its body (not on WebKit).
- **Replay a HAR with a route.** `page.route("**/api/**", yield* Route.fromHar("api.har"))` answers from the
  recording, matching method, URL and body; export it with `include: ["requestBodies"]` to match bodies.
- **HTML drag and drop on every browser:** `dragTo(target, { html: "synthetic" })` has the page dispatch the drag's
  events (untrusted); the default, `"native"`, is Chromium's alone for a `draggable` element.
- **Type on another keyboard layout** with `Browser.newContext({ keyboardLayout: "de" })` (`us`, `uk`, `de`, `fr`,
  `es`, `it`): the page sees the layout's keys, Shift, AltGr and dead keys (Firefox: keys only).
- **Workers:** `addInitScript(script, { workers: true })` and `clock.install(mode, { workers: true })` reach dedicated
  workers started later (not on Firefox); `PageNavigation.next(page, { frames: "all" })` sees frames' navigations.
- **Upload generated files as bytes.** `locator.setInputFiles(FileInput.bytes("report.csv", "text/csv", data))`
  makes the file in the page; one call takes bytes or paths, not both.
- **Record, then export.** `const har = yield* Har.record(page, { content: "embed" })`, act, then
  `har.exportHar("run.har")`; `Trace.record(page, { screenshots: "perAction" })` and `exportTrace("trace.zip")`
  write a trace trace.playwright.dev opens; `domSnapshots: true` with `network: true` adds DOM snapshots before and
  after each action, which the viewer renders. Exports are redacted unless `include` names a class of secret;
  requests' bodies are left out unless it names `"requestBodies"`. A request event's `headers` can lack `Cookie`:
  `NetworkRequest.headersSent(page, request)` gives the headers as sent.
- **Drive a browser from a shell with `strider`.** `strider start --name s --chromium <path>`, then
  `strider -s s page new --name shop <url>`, `strider -s s -p shop snapshot`, `strider -s s -p shop click e9`; every
  command names its session and page. `strider -s s stop` ends it. `strider -s s -p shop find "Sign in"` gives refs
  without the whole snapshot; `strider -s s tabs` and `strider -s s control <id> --name mail` take a tab the browser
  already has. An MCP client such as Claude Desktop runs `strider mcp -s s` to share the session.
- **Test events without a browser.** `Effect.provide(Browser.layerTest("--resp(cart)--commit--load--|"))` gives a
  fake whose first page plays the timeline under `TestClock`, with `-` as 10 ms; it has no DOM.
- **Emulation is checked, not best-effort.** `page.emulate({...})` fails with `Unsupported` naming a field the
  backend can't apply; read `browser.capabilities` (`emulation.*`) to branch.
