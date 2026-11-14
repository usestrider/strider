/**
 * Stock WebKit, through the public layer: WebKitGTK's MiniBrowser (`browsers.ts`), on an X
 * server of its own (`stockWebKit.ts`), attached through its remote inspector by `WebKit.layerAttach`. Its
 * inspector is for looking, not driving: what it can't do is refused, saying so, and the rest is checked here.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, ConsoleMessage, Dialog, Expect, type Page, Route, Target } from "@usestrider/browser"
import { WebKit } from "@usestrider/browser/webkit"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as net from "node:net"
import { site } from "./adapter/harness.ts"
import { startMiniBrowser } from "./stockWebKit.ts"

const timeout = 60_000

/** A page whose Content-Security-Policy forbids eval and its inline script. */
const cspPage = "<title>Policy</title><h1>Policy</h1><script>document.title = 'Ran'</script>"

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A tab with a heading and a button that reports whether its analytics call went through. */
const tabUrl = (origin: string, heading: string) =>
  fixtureUrl(
    origin,
    `<title>${heading}</title><h1>${heading}</h1><button onclick="fetch('/analytics/hit').then(() => { document.getElementById('out').textContent = 'sent' }, () => { document.getElementById('out').textContent = 'blocked' })">Refresh</button><p id="out">waiting</p>`
  )

/**
 * A function whose declaration is over 128 KiB once JSON-encoded twice, as the attached inspector sends it: a string
 * of quotes, backslashes, newlines and non-ASCII text, whose length it returns.
 */
const large = (() => {
  const text = "\"\\\né漢😀".repeat(20_000)
  return { fn: new Function(`return ${JSON.stringify(text)}.length`) as () => number, length: text.length }
})()

/** The reason a failed effect gave, and the operation's dispatch. */
const reasonOf = <A, E>(exit: Exit.Exit<A, E>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  return (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined) as
    | {
      readonly _tag: string
      readonly reason?: {
        readonly _tag: string
        readonly capability?: string
        readonly netError?: string
        readonly hint?: string
      }
      readonly diagnostics?: { readonly dispatch: { readonly _tag: string } }
    }
    | undefined
}

/** A port nothing listens on, for a navigation the connection refuses. */
const closedPort = Effect.callback<number>((resume) => {
  const server = net.createServer()
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as net.AddressInfo).port
    server.close(() => resume(Effect.succeed(port)))
  })
})

/** The layer attached to an inspector server. */
const attach = (endpoint: string) =>
  WebKit.layerAttach(endpoint).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))

/** A page's handle by its title, once the browser shows it. */
const byTitle = Effect.fnUntraced(function*(browser: Browser.Browser, title: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const page of yield* browser.pages) {
      const url = yield* page.url
      if (url.includes(encodeURIComponent(`<title>${title}</title>`))) return page
    }
    yield* Effect.sleep("100 millis")
  }
  return yield* Effect.die(new Error(`No page shows ${title}`))
})

describe("Stock WebKit, attached through its remote inspector", () => {
  layer(NodeServices.layer, { excludeTestServices: true, timeout })((it) => {
    class TwoTabFixture extends Context.Service<TwoTabFixture, {
      readonly origin: string
      readonly endpoint: string
    }>()("StockWebKit/TwoTabFixture") {}

    const twoTabFixture = Layer.effect(
      TwoTabFixture,
      Effect.gen(function*() {
        const { origin } = yield* site
        const { endpoint } = yield* startMiniBrowser(tabUrl(origin, "First"), tabUrl(origin, "Second"))
        return { origin, endpoint }
      }).pipe(Effect.timeout("50 seconds"))
    )

    // Only the two attachment cycles and assertions share the five-second body budget.
    it.layer(twoTabFixture, { timeout })("two tabs", (it) => {
      it.effect("inspects one tab, controls another, and leaves both open (call site 7)", () =>
        Effect.gen(function*() {
          const { origin, endpoint } = yield* TwoTabFixture
          yield* Effect.gen(function*() {
            const browser = yield* Browser.Browser
            assert.strictEqual(browser.info.product, "WebKit (stock)")
            // Two pages, each in a web process of its own, whose frames and requests are numbered alike (Q195)
            const first = yield* byTitle(browser, "First")
            const second = yield* byTitle(browser, "Second")
            yield* Effect.scoped(Effect.gen(function*() {
              const reader = yield* first.inspect
              assert.deepStrictEqual(yield* reader.viewportSize, Option.none())
              assert.strictEqual(yield* reader.getByRole("heading").readText, "First")
              const snapshot = yield* reader.locator("body").snapshot()
              assert.include(snapshot.text, `heading "First"`)
              const png = yield* reader.screenshot()
              assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47])
              const tab = yield* second.control
              const blocked = yield* tab.route(`${origin}/analytics/**`, () => Route.abort())
              // No input: the button is clicked by the page's own script
              yield* tab.evaluateInMainWorld(() => document.querySelector("button")!.click())
              yield* tab.locator("#out").pipe(Expect.toHaveText("blocked"))
              assert.strictEqual(yield* blocked.hits, 1)
            }))
          }).pipe(Effect.provide(attach(endpoint)))
          // Both tabs are there for the next client, and the route went with its grant
          yield* Effect.gen(function*() {
            const browser = yield* Browser.Browser
            yield* byTitle(browser, "First")
            const second = yield* byTitle(browser, "Second")
            yield* Effect.scoped(Effect.gen(function*() {
              const tab = yield* second.control
              yield* tab.evaluateInMainWorld(() => document.querySelector("button")!.click())
              yield* tab.locator("#out").pipe(Expect.toHaveText("sent"))
            }))
          }).pipe(Effect.provide(attach(endpoint)))
        }), 5_000)
    })

    class NavigationFixture extends Context.Service<NavigationFixture, {
      readonly origin: string
      readonly crossSite: string
      readonly tab: Page.Page
    }>()("StockWebKit/NavigationFixture") {}

    const navigationFixture = Layer.effect(
      NavigationFixture,
      Effect.gen(function*() {
        const { origin, crossSite } = yield* site
        const { endpoint } = yield* startMiniBrowser(tabUrl(origin, "Start"))
        const context = yield* Layer.build(attach(endpoint))
        const browser = Context.get(context, Browser.Browser)
        const tab = yield* (yield* byTitle(browser, "Start")).control
        return { origin, crossSite, tab }
      }).pipe(Effect.timeout("50 seconds"))
    )

    // Acquisition and release have hook budgets; only the navigation sequence has the five-second body budget.
    it.layer(navigationFixture, { timeout })("script navigation", (it) => {
      it.effect("navigates by script, and reports how each navigation ended", () =>
        Effect.gen(function*() {
          const { origin, crossSite, tab } = yield* NavigationFixture
          // Another site's page is another web process: a provisional target the page swaps to
          const committed = yield* tab.goto(`${crossSite}/child`)
          assert.strictEqual(committed._tag, "Committed")
          assert.include(yield* tab.locator("p").readText, "child of localhost")
          const missing = yield* tab.goto(`${origin}/missing`)
          assert(missing._tag === "Committed" && Option.isSome(missing.response))
          assert.strictEqual(missing.response.value.status, 404)
          const landed = yield* tab.goto(`${origin}/redirect`)
          assert.strictEqual(landed.url, `${origin}/landed`)
          // The ends stock WebKit reports only through the document's request (Q198)
          const refused = reasonOf(yield* Effect.exit(tab.goto(`http://127.0.0.1:${yield* closedPort}/`)))
          assert.strictEqual(refused?.reason?._tag, "NavigationFailed")
          assert.include(refused?.reason?.netError, "Connection refused")
          // The browser shows its error page, a navigation of its own (Q199), before it's asked to go on
          yield* tab.status.waitFor((status) => status._tag === "Open" && status.url === "about:blank")
          // A port it blocks is refused before any request: the error page is all there is
          const blocked = reasonOf(yield* Effect.exit(tab.goto("http://127.0.0.1:1/")))
          assert.strictEqual(blocked?.reason?._tag, "NavigationFailed")
          assert.include(blocked?.reason?.netError, "error page")
          yield* tab.goto(`${origin}/landed`)
          const noContent = reasonOf(yield* Effect.exit(tab.goto(`${origin}/204`)))
          assert.strictEqual(noContent?.reason?._tag, "NoContent")
          const download = reasonOf(yield* Effect.exit(tab.goto(`${origin}/download`)))
          assert.strictEqual(download?.reason?._tag, "BecameDownload")
          assert.strictEqual(yield* tab.url, `${origin}/landed`)
          // A fragment of the same document would be a navigation it never reports
          const fragment = reasonOf(yield* Effect.exit(tab.goto(`${origin}/landed#later`)))
          assert.strictEqual(fragment?.reason?._tag, "Unsupported")
          assert.strictEqual(fragment?.reason?.capability, "navigation.sameDocument")
          const reloaded = yield* tab.reload()
          assert.strictEqual(reloaded.url, `${origin}/landed`)
        }), 5_000)
    })

    it.effect("reads the console, the network and storage, and runs init scripts in the page's world", () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const { endpoint } = yield* startMiniBrowser(tabUrl(origin, "Reads"))
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          yield* Effect.scoped(Effect.gen(function*() {
            const tab = yield* (yield* byTitle(browser, "Reads")).control
            const messages = yield* ConsoleMessage.stream(tab)
            const collected = yield* messages.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
            yield* tab.goto(`${origin}/console`)
            const [hello, bad] = yield* Fiber.join(collected)
            assert.deepInclude(hello, { level: "log", text: "hello 42" })
            assert.deepInclude(bad, { level: "error", text: "bad" })
            // A route answers in the inspector's place
            yield* tab.route(
              `${origin}/made-up`,
              () =>
                Route.fulfill(
                  HttpServerResponse.text("<title>made</title><h1>Made</h1>", { status: 201, contentType: "text/html" })
                )
            )
            const made = yield* tab.goto(`${origin}/made-up`)
            assert(made._tag === "Committed" && Option.isSome(made.response))
            assert.strictEqual(made.response.value.status, 201)
            assert.strictEqual(made.response.value.servedBy, "route")
            assert.strictEqual(yield* tab.getByRole("heading").readText, "Made")
            // The only world there is: the page's own
            yield* tab.addInitScript(() => {
              ;(window as { fromInit?: number }).fromInit = 1
            })
            yield* tab.goto(`${origin}/init`)
            assert.strictEqual(
              yield* tab.evaluateInMainWorld(() => (window as { seenByAuthor?: string }).seenByAuthor),
              "number"
            )
            const context = yield* browser.defaultContext.control
            yield* context.cookies.set({ name: "who", value: "me", scope: { url: origin } })
            const cookies = yield* context.cookies.list
            assert.isTrue(cookies.some((cookie) => cookie.name === "who"))
            yield* tab.evaluateInMainWorld(() => localStorage.setItem("kept", "yes"))
            assert.deepStrictEqual(yield* tab.localStorage.entries, [["kept", "yes"]])
            const full = yield* tab.screenshot({ area: "fullPage" })
            assert.deepStrictEqual([...full.subarray(1, 4)], [0x50, 0x4e, 0x47])
          }))
        }).pipe(Effect.provide(attach(endpoint)))
      }))

    it.effect("refuses what its inspector can't do, saying so", () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const { endpoint } = yield* startMiniBrowser(tabUrl(origin, "Refusals"))
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const capabilities = yield* browser.capabilities
          const status = (name: string) => capabilities.entries.find((entry) => entry.name === name)?.status
          assert.strictEqual(status("userContexts"), "unsupported")
          assert.strictEqual(status("isolatedWorlds"), "unsupported")
          assert.strictEqual(status("input.native"), "unsupported")
          assert.strictEqual(status("prompts"), "unsupported")
          const opened = reasonOf(yield* Effect.exit(Effect.scoped(Browser.newPage())))
          assert.strictEqual(opened?.reason?._tag, "Unsupported")
          yield* Effect.scoped(Effect.gen(function*() {
            const tab = yield* (yield* byTitle(browser, "Refusals")).control
            assert.deepStrictEqual(yield* tab.viewportSize, Option.none())
            const viewport = reasonOf(yield* Effect.exit(tab.emulate({ viewport: { width: 640, height: 480 } })))
            assert.strictEqual(viewport?.reason?.capability, "emulation.viewport")
            assert.deepStrictEqual(yield* tab.viewportSize, Option.none())
            const headers = reasonOf(yield* Effect.exit(tab.emulate({ extraHTTPHeaders: { "x-test": "value" } })))
            assert.strictEqual(headers?.reason?._tag, "Unsupported")
            assert.strictEqual(headers?.reason?.capability, "emulation.extraHTTPHeaders")
            assert.deepStrictEqual(yield* tab.viewportSize, Option.none())
            // Refused before anything was sent
            const clicked = reasonOf(yield* Effect.exit(tab.getByRole("button", { name: "Refresh" }).click()))
            assert.strictEqual(clicked?.reason?.capability, "input.native")
            assert.strictEqual(clicked?.diagnostics?.dispatch._tag, "NotSent")
            // A caller's function never moves to the page's world
            const evaluated = reasonOf(yield* Effect.exit(tab.evaluate(() => document.title)))
            assert.strictEqual(evaluated?.reason?.capability, "isolatedWorlds")
            assert.strictEqual(yield* tab.evaluateInMainWorld(() => document.title), "Refusals")
            const jpeg = reasonOf(yield* Effect.exit(tab.screenshot({ format: "jpeg", quality: 80 })))
            assert.strictEqual(jpeg?.reason?.capability, "screenshot.format")
            // Bringing a page forward is refused as an error, not a defect
            const activated = reasonOf(yield* Effect.exit(tab.activate))
            assert.strictEqual(activated?._tag, "PageError")
            assert.strictEqual(activated?.reason?.capability, "emulation.focus")
            // Its inspector reports no dialogs, so nothing waits for one
            const dialogs = reasonOf(yield* Effect.exit(Dialog.next(tab)))
            assert.strictEqual(dialogs?._tag, "SubscriptionError")
            assert.strictEqual(dialogs?.reason?.capability, "prompts")
            const handler = reasonOf(yield* Effect.exit(Dialog.handle(tab, Dialog.acceptAll)))
            assert.strictEqual(handler?._tag, "DeclarationError")
            assert.strictEqual(handler?.reason?.capability, "prompts")
          }))
        }).pipe(Effect.provide(attach(endpoint)))
      }))

    it.effect("queries a page whose policy forbids eval, and evaluates a function over the message limit", () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const { endpoint } = yield* startMiniBrowser(`${origin}/csp?html=${encodeURIComponent(cspPage)}`)
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          yield* Effect.scoped(Effect.gen(function*() {
            const tab = yield* (yield* byTitle(browser, "Policy")).control
            // The policy holds: the page's inline script never ran
            assert.strictEqual(yield* tab.evaluateInMainWorld(() => document.title), "Policy")
            // The engine's install is larger than one message, so it's compiled in the page in parts
            assert.strictEqual(yield* tab.getByRole("heading").readText, "Policy")
            assert.strictEqual(yield* tab.evaluateInMainWorld(large.fn), large.length)
          }))
        }).pipe(Effect.provide(attach(endpoint)))
      }))

    it.effect("evaluates a large declaration when the page replaced eval before attachment", () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const html = "<title>Custom eval</title><script>globalThis.eval = () => () => -1</script>"
        const { endpoint } = yield* startMiniBrowser(fixtureUrl(origin, html))
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          yield* Effect.scoped(Effect.gen(function*() {
            const tab = yield* (yield* byTitle(browser, "Custom eval")).control
            assert.strictEqual(yield* tab.evaluateInMainWorld(() => 42), 42)
            // This declaration fits the old single-packet path, but now crosses the staging threshold.
            const fn = new Function(`/*${"x".repeat(70_000)}*/ return 42`) as () => number
            assert.strictEqual(yield* tab.evaluateInMainWorld(fn), 42)
          }))
        }).pipe(Effect.provide(attach(endpoint)))
      }))

    it.effect("finds a page the browser opens, and ends with the browser", () =>
      Effect.gen(function*() {
        const { origin } = yield* site
        const { endpoint, process } = yield* startMiniBrowser(tabUrl(origin, "Opener"))
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const opener = yield* byTitle(browser, "Opener")
          yield* Effect.scoped(Effect.gen(function*() {
            const tab = yield* opener.control
            yield* tab.evaluateInMainWorld((url: string) => {
              window.open(url)
            }, tabUrl(origin, "Opened"))
          }))
          // The list is read again for pages that arrive
          const opened = yield* byTitle(browser, "Opened")
          yield* Effect.scoped(Effect.gen(function*() {
            const reader = yield* opened.inspect
            assert.strictEqual(yield* reader.getByRole("heading").readText, "Opened")
          }))
          // A browser that exits takes the inspector server with it: the connection is lost, not each page closed
          yield* process.kill()
          const ended = yield* opener.closed
          assert.deepStrictEqual(ended, new Target.ConnectionLost({}) satisfies Target.CloseReason)
        }).pipe(Effect.provide(attach(endpoint)))
      }))
  })
})
