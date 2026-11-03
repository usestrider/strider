# Strider

Browser automation for [Effect](https://effect.website): scripts, tests and agents that drive Chromium, Firefox or
WebKit. Strider speaks each browser's protocol directly (the Chrome DevTools Protocol, WebDriver BiDi and WebKit's
inspector protocol), so it drives browsers as they're installed, with no driver or patched build beside them.

**Documentation: [usestrider.dev](https://usestrider.dev)**

```ts
import { NodeServices } from "@effect/platform-node"
import { Browser, Expect } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Effect, Layer } from "effect"

const BrowserLive = Chromium.layer({ executablePath: "/usr/bin/chromium" }).pipe(
  Layer.provide(NodeServices.layer)
)

const program = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto("https://shop.example.com")
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("1 item").pipe(Expect.toBeVisible)
})).pipe(Effect.provide(BrowserLive))
```

## Why Strider

### Scoped lifetimes

A page, route or dialog handler ends with the `Scope` that acquired it, even on failure or
interruption.

```ts
import { Browser } from "@usestrider/browser"
import { Effect } from "effect"

const visit = Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto("https://shop.example.com")
}).pipe(Effect.scoped) // The page closes when this scope ends, even if navigation fails.
```

### Subscribing before acting

To catch a popup, download or response an action causes, subscribe first.

```ts
import { Page, Popup } from "@usestrider/browser"
import { Effect } from "effect"

const openHelp = Effect.fn("openHelp")(function*(page: Page.Page) {
  const nextPopup = yield* Popup.next(page) // Subscribe before clicking.
  yield* page.getByRole("link", { name: "Help" }).click()
  const help = yield* nextPopup // Page.Page: title, getByRole(), goto(), etc.
  return yield* help.title
})
```

### Error reasons and hints

Each module has one error, whose `reason` says why, with a hint of what to do next.

```ts
import { Page } from "@usestrider/browser"
import { Effect } from "effect"

const save = Effect.fn("save")(function*(page: Page.Page) {
  yield* page.getByRole("button", { name: "Save" }).click().pipe(
    Effect.tapErrorTag("LocatorError", (error) =>
      // Example log messages:
      // "StrictViolation"
      // "2 elements match and 1 of them is visible; add .filter({ visible: true })"
      Effect.logError(error.reason._tag, error.reason.hint))
  )
})
```

### One deadline per operation

Each operation has one deadline covering everything it does.

```ts
import { Deadline, Expect, Page } from "@usestrider/browser"
import { Effect } from "effect"

const pay = Effect.fn("pay")(function*(page: Page.Page) {
  yield* page.getByRole("button", { name: "Pay" }).click()
  yield* page.getByText("Payment received").pipe(Expect.toBeVisible)
}, Deadline.within("5 seconds")) // One shared budget for both steps.
```

### Typed access

Calling a control method on a tab you may only inspect is a compile error.

```ts
import { Page } from "@usestrider/browser"
import { Effect } from "effect"

const readTitle = Effect.fn("readTitle")(function*(tab: Page.ObservedPage) {
  const page = yield* tab.inspect
  // yield* page.goto("https://shop.example.com") // Type error: no goto on ReadonlyPage.
  return yield* page.title
})
```

### Agents and the command line

Strider includes a `strider` command line with named sessions, and an agent toolkit.

```sh
strider start --name shop --chromium /usr/bin/chromium
strider -s shop page new --name main https://shop.example.com
strider -s shop -p main snapshot
strider -s shop -p main click 'role=button[name="Add to cart"]'
strider -s shop stop
```

[Introduction](https://usestrider.dev/docs) · [Coming from Playwright](https://usestrider.dev/docs/playwright) ·
[Choosing a browser](https://usestrider.dev/docs/browsers/choosing)

## Status

Pre-release, and the API can still change before 1.0. It runs on Chromium, Firefox and WebKit, and what a browser can't
do fails with `Unsupported`, naming the capability. The packages are on npm:

| Package                                   | What it's for                              |
| ----------------------------------------- | ------------------------------------------ |
| [`@usestrider/browser`](packages/browser) | The library and its backends               |
| [`@usestrider/vitest`](packages/vitest)   | The Vitest adapter                         |
| [`@usestrider/cli`](packages/cli)         | The `strider` command, to install globally |

## Contributing

Report bugs and ask for features in [GitHub Issues](https://github.com/usestrider/strider/issues).
[CONTRIBUTING.md](CONTRIBUTING.md) says how to build and test Strider.

## License

[MIT](LICENSE). The generated protocol modules and keyboard layouts also carry their sources' notices
([THIRD_PARTY_NOTICES.md](packages/browser/THIRD_PARTY_NOTICES.md)).
