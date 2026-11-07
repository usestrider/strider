# @usestrider/vitest

Run [Strider](https://usestrider.dev) tests under Vitest: each test is an Effect program, with one browser per file and
a fresh context for each page.

**Status:** pre-release.

```sh
pnpm add -D vitest @effect/vitest @effect/platform-node effect @usestrider/browser @usestrider/vitest
```

`VitestBrowser.layer` provides the backend you give it, unchanged, plus `TestRun`, the test that's running:

```ts
import { NodeServices } from "@effect/platform-node"
import { layer } from "@effect/vitest"
import { Browser, Expect } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { VitestBrowser } from "@usestrider/vitest"
import { Config, Effect, Layer } from "effect"

const ChromiumLive = Chromium.layerConfig({
  executablePath: Config.String("CHROMIUM_PATH")
}).pipe(Layer.provide(NodeServices.layer))

layer(VitestBrowser.layer(ChromiumLive), { excludeTestServices: true })("checkout", (it) => {
  it.effect("adds a product to the cart", (context) =>
    Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* page.goto("https://shop.example.com")
      yield* page.getByRole("button", { name: "Add to cart" }).click()
      yield* page.getByText("1 item").pipe(Expect.toBeVisible)
    }).pipe(VitestBrowser.withTest(context)))
})
```

Call `VitestBrowser.withTest(context)` inside each callback and retry to capture its identity, attempt and attachment
owner. It works over the shared browser layer and with a per-effect browser layer in either composition order.
Complete bound attachments before the callback ends: Vitest does not guarantee that later artifacts reach reporters. Without binding, the layer uses Vitest's global current-test lookup,
which supports sequential tests only; concurrent callbacks can read another test's identity or attach to it.

[Tests with Vitest](https://usestrider.dev/docs/tools/testing) covers concurrent pages, attaching files to a test, and a
fake browser for events. The source is at https://github.com/usestrider/strider.

MIT licensed.

To retain traces only for failed callbacks, configure the layer once:

```ts
const BrowserLive = VitestBrowser.layer(ChromiumLive, {
  trace: { directory: ".data/test-traces" }
})
```

Keep each complete test effect inside `VitestBrowser.withTest(context)`. Each context created through the layer's
`Browser.newContext` or `Browser.newPage` gets a recording, including its pages and popups. Screenshots default
to `"perAction"`, DOM snapshots and network to `true`, and screencast to `"off"`. Disable snapshots explicitly
when disabling network. Direct `Trace.record` calls keep their defaults.

Failures export one ZIP per context under `directory/context-N/traceFileName(info)` and attach it before the
binding returns. Successful callbacks retain no archives. A failing scope stages its trace before cleanup;
a callback that recovers deletes the staged archive. Keep the binding inside the scope owning the targets for
export before cleanup; targets whose scopes already succeeded and closed are exported from retained recordings
if the callback later fails. Tracing failures warn and preserve the test result. Existing/default/reclaimed
contexts, failures outside the bound effect and hard process termination are outside automatic capture.
