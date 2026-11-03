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

- **Lifetimes are scopes.** A page, route or dialog handler ends with the `Scope` that acquired it, even on failure or
  interruption.
- **Subscribe, then act.** To catch a popup, download or response an action causes, subscribe first.
- **Errors say what happened.** Each module has one error, whose `reason` says why, with a hint of what to do next.
- **One deadline per operation,** covering everything it does.
- **Access is typed.** Calling a control method on a tab you may only inspect is a compile error.
- **Built for agents too.** A `strider` command line with named sessions, and an agent toolkit.

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
