# Using @usestrider/browser

Instructions for agents writing code that uses Strider. `INDEX.md` in this package lists every declaration and member.
The design and its reasons are in the repository: https://github.com/usestrider/strider.

Strider is pre-release: the API is designed and type-checked, and the implementation is in progress.

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
    return yield* Deferred.await(download)
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
