# @usestrider/browser

Strider: Effect-native browser automation that speaks the Chrome DevTools Protocol, WebDriver BiDi and the WebKit
inspector protocol directly. Scoped lifetimes, typed errors that say what happened, events you subscribe to before
you act, and an agent toolkit, all built on [Effect](https://effect.website).

**Status:** pre-release. The API is designed, type-checked and documented; the implementation is in progress.

```ts
import { Browser, Expect } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Effect } from "effect"

const program = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto("https://shop.example.com")
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("1 item").pipe(Expect.toBeVisible)
})).pipe(Effect.provide(Chromium.layer()))
```

The design, its principles and the full API are in the repository: https://github.com/usestrider/strider.
