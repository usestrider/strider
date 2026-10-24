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
(`exportStorageState`, the context option `storageState`), every event module (`Popup`, `Dialog`, `FileChooser`, `Download`, `ConsoleMessage`,
`UncaughtException`, `PageNavigation`, `NetworkRequest`, `NetworkResponse`, `BrowserWorker`, `NetworkConnection`,
`AutoResolution`), `Dialog.handle` and `FileChooser.handle`, and the declarations (`route`, `addInitScript`,
`emulate`, `grant`, `clock`, and the context options `emulation`, `permissions` and `focus`) work on every backend. What a backend can't do or report
fails with `Unsupported`, naming the capability: modifiers on WebKit's pointer, an HTML drag anywhere but
Chromium, a CSS-pixel or transparent screenshot and a PDF's header on Firefox, a PDF on WebKit, and a partitioned
cookie anywhere but Chromium. A member that isn't built yet fails as the defect `NotBuilt`, naming itself
(`Page.inspect`, `Page.control` and `Page.capability` among them).

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
- **Access is typed.** A `Page.ReadonlyPage` can read but not act; `observed.control` gains control for a scope.
- **Errors are per module, with a reason.** Recover with
  `Effect.catchReason("LocatorError", "StrictViolation", …)`. Any operation can also fail with `TargetGone` or
  `Timeout`, which says how far it got (`timeout.phase`).
- **Secrets stay `Redacted`.** Pass `Config.Redacted("PASSWORD")` to `fill`; it is never logged or traced.
- **Keys are UI Events names, modifiers an option.** `field.press("Enter")`,
  `field.press("a", { modifiers: ["Control"] })`; there is no `"Control+A"` syntax.
- **Reads are strict.** `readText`, `readValue` and the other reads need exactly one match and never wait: none is
  `NoMatch`, several `StrictViolation`. To wait for a value, expect it: `field.pipe(Expect.toHaveValue("Ada"))`.
- **Held input is scoped.** `yield* page.keyboard.hold("Shift")` inside `Effect.scoped`; the scope releases it.
- **A page in the background of a Firefox context barely renders,** so actions there time out; call
  `page.activate` on it first.
- **A route has one phase.** `page.route(pattern, handler)` sees requests before they are sent; pass
  `{ phase: "response" }` or `{ phase: "auth" }` for the others. Return a `Route` decision valid for it
  (`Route.fulfill`, `Route.continueWith`, `Route.abort()`, `Route.fallthrough`, `Route.continue`); there is no
  `fetch` on the request. A failing handler lets the request continue, logged.
- **Emulation is checked, not best-effort.** `page.emulate({...})` fails with `Unsupported` naming a field the
  backend can't apply; read `browser.capabilities` (`emulation.*`) to branch.
