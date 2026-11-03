# @usestrider/browser

Strider: Effect-native browser automation that speaks the Chrome DevTools Protocol, WebDriver BiDi and the WebKit
inspector protocol directly. Scoped lifetimes, typed errors that say what happened, events you subscribe to before
you act, and an agent toolkit, all built on [Effect](https://effect.website).

**Status:** pre-release. The API is designed, type-checked and documented, and every member it declares is built:
the program below runs on Chromium, Firefox and WebKit, and what a backend can't do fails with `Unsupported`,
naming the capability.

```ts
import { Browser, Expect } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Effect } from "effect"

const program = Effect.scoped(Effect.gen(function*() {
  const page = yield* Browser.newPage()
  yield* page.goto("https://shop.example.com")
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  yield* page.getByText("1 item").pipe(Expect.toBeVisible)
})).pipe(Effect.provide(Chromium.layer({ executablePath: "/usr/bin/chromium" })))
```

A launch runs the executable you name, and the library never looks for or installs a browser. To find the paths
on your machine, run `npx strider browsers` in a project that has the package; it lists each browser it finds with
its version.

The guides and the full API are at https://usestrider.dev, and the source is at https://github.com/usestrider/strider.

MIT licensed. The protocol modules and keyboard layouts are generated from others' definitions, whose notices are
in `THIRD_PARTY_NOTICES.md`.
