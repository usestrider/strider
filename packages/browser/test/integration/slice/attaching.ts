/**
 * The seventh slice: attaching and access, through the public API. Access on every backend, through a
 * launched browser's own first tab and its default context; call site 7 on Chromium and Firefox, against a browser
 * the test starts with two tabs and a layer attaches to; and Firefox's one session.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Dialog, Expect, Locator, Page, Popup, Route, Target, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import type * as Scope from "effect/Scope"
import type * as Socket from "effect/socket/Socket"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import * as DevToolsActivePort from "../../../src/internal/devToolsActivePort.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import * as Launch from "../../../src/internal/launch.ts"
import { site } from "../adapter/harness.ts"
import { chromium, firefox } from "../browsers.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A tab with a heading and a button that reports whether its analytics call went through. */
const tabUrl = (origin: string, heading: string) =>
  fixtureUrl(
    origin,
    `<h1>${heading}</h1><button onclick="fetch('/analytics/hit').then(() => { document.getElementById('out').textContent = 'sent' }, () => { document.getElementById('out').textContent = 'blocked' })">Refresh</button><p id="out">waiting</p>`
  )

/** The reason a failed effect gave. */
const reasonOf = <A, E>(exit: Exit.Exit<A, E>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  return (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined) as
    | { readonly _tag: string; readonly reason?: { readonly _tag: string; readonly hint?: string } }
    | undefined
}

/** How a backend is started for attaching: its endpoint, and the layer that attaches to it. */
export interface Attachable {
  readonly start: (
    first: string,
    second: string
  ) => Effect.Effect<
    { readonly endpoint: string; readonly layer: Layer.Layer<Browser.Browser, unknown> },
    unknown,
    Scope.Scope | FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
  >
}

/** Chromium with a debugging port, two tabs, attached through its HTTP endpoint. */
export const chromiumAttachable = (
  layerConnect: (endpoint: string) => Layer.Layer<Browser.Browser, unknown, Socket.WebSocketConstructor>
): Attachable => ({
  start: Effect.fnUntraced(function*(first: string, second: string) {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-attach-" })
    // Headless Chromium takes one URL on its command line (QUIRKS.md): the second tab is opened through its endpoint
    yield* Launch.spawn(
      chromium.executable,
      ChromiumLauncher.argsFor({ args: [first] }, dir, "port").filter((arg) => arg !== "about:blank"),
      dir,
      {}
    )
    const { port } = yield* DevToolsActivePort.read(dir, { timeout: "10 seconds" })
    const endpoint = `http://127.0.0.1:${port}`
    yield* Effect.promise(() => fetch(`${endpoint}/json/new?${encodeURIComponent(second)}`, { method: "PUT" }))
    return { endpoint, layer: layerConnect(endpoint).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor)) }
  })
})

/** Firefox with its remote agent, two tabs from its command line. */
export const firefoxAttachable = (
  layerConnect: (endpoint: string) => Layer.Layer<Browser.Browser, unknown, Socket.WebSocketConstructor>
): Attachable => ({
  start: Effect.fnUntraced(function*(first: string, second: string) {
    const fs = yield* FileSystem.FileSystem
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-attach-" })
    yield* fs.writeFileString(`${dir}/user.js`, FirefoxLauncher.userJs(FirefoxLauncher.profilePrefs.automation))
    const launched = yield* Launch.spawn(
      firefox.executable,
      ["--headless", "--remote-debugging-port=0", "--no-remote", "--profile", dir, first, second],
      dir,
      {}
    )
    const listening = yield* launched.stderrLine(/WebDriver BiDi listening on (ws:\/\/\S+)/)
    const endpoint = Option.getOrThrow(listening)[1]!
    return { endpoint, layer: layerConnect(endpoint).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor)) }
  })
})

/** A page's handle by the heading in its URL, once the browser has a page there: adopted tabs may still be loading. */
const byHeading = Effect.fnUntraced(function*(browser: Browser.Browser, heading: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const page of yield* browser.pages) {
      const url = yield* page.url.pipe(Effect.timeoutOption("100 millis"))
      if (Option.isSome(url) && url.value.includes(encodeURIComponent(`<h1>${heading}</h1>`))) return page
    }
    yield* Effect.sleep("100 millis")
  }
  return yield* Effect.die(new Error(`No page shows ${heading}`))
})

export const attaching = (
  name: "Chromium" | "Firefox" | "WebKit",
  backend: Layer.Layer<Browser.Browser, unknown>,
  attachable: Option.Option<Attachable>
) =>
  describe(`${name} attaching`, () => {
    layer(Layer.mergeAll(backend, NodeServices.layer, NodeSocket.layerWebSocketConstructor), {
      excludeTestServices: true,
      timeout
    })((it) => {
      // ── Access, on every backend ──

      it.effect("lists the browser's pages, and controls one it didn't open for a scope", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const browser = yield* Browser.Browser
          yield* Effect.scoped(Effect.gen(function*() {
            const ours = yield* Browser.newPage()
            const pages = yield* browser.pages
            assert.isTrue(pages.some((page) => Equal.equals(page, ours)))
            // The launched browser's own first tab: observed, so it has no locators
            const first = (yield* browser.defaultContext.pages)[0]!
            assert.isFalse("getByRole" in first)
            assert.isTrue(pages.some((page) => Equal.equals(page, first)))
            let kept: Page.Page | undefined
            yield* Effect.scoped(Effect.gen(function*() {
              const tab = yield* first.control
              assert.isTrue(Equal.equals(tab, first))
              // A tab in the background renders about a frame a second on Firefox, too seldom to act on (Q71)
              yield* tab.activate
              yield* tab.goto(tabUrl(origin, "Initial"))
              const blocked = yield* tab.route(`${origin}/analytics/**`, () => Route.abort())
              yield* tab.getByRole("button", { name: "Refresh" }).click()
              yield* tab.locator("#out").pipe(Expect.toHaveText("blocked"))
              assert.strictEqual(yield* blocked.hits, 1)
              assert.isFalse(yield* tab.getByRole("heading").isEditable)
              kept = tab
            }))
            // Released: what the grant gave fails, and the page stays open
            const read = reasonOf(yield* Effect.exit(kept!.getByRole("heading").readText))
            assert.deepInclude(read, { _tag: "TargetGone" })
            assert.deepStrictEqual((read as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            const selected = reasonOf(yield* Effect.exit(kept!.getByRole("heading").selectText()))
            assert.deepStrictEqual((selected as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            const editable = reasonOf(yield* Effect.exit(kept!.getByRole("heading").isEditable))
            assert.deepStrictEqual((editable as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            const navigated = reasonOf(yield* Effect.exit(kept!.reload()))
            assert.deepStrictEqual((navigated as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            const replaced = reasonOf(yield* Effect.exit(kept!.setContent("<title>Forbidden</title>")))
            assert.deepStrictEqual((replaced as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            const routed = reasonOf(
              yield* Effect.exit(Effect.scoped(kept!.route("**", () => Route.abort())))
            )
            // A declaration too: every member declares TargetGone (QUIRKS.md, Q143)
            assert.deepStrictEqual((routed as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
            assert.strictEqual((yield* first.status)._tag, "Open")
            // A grant's declarations go with it: the analytics call goes through now
            yield* Effect.scoped(Effect.gen(function*() {
              const reader = yield* first.inspect
              assert.strictEqual(yield* reader.getByRole("heading").readText, "Initial")
              assert.isFalse(yield* reader.getByRole("heading").isEditable)
              const tab = yield* first.control
              yield* tab.activate
              yield* tab.getByRole("button", { name: "Refresh" }).click()
              yield* tab.locator("#out").pipe(Expect.toHaveText("sent"))
            }))
          }))
        }), timeout)

      it.effect("controls the default context for a scope, and leaves its dialogs to whoever decides them", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const browser = yield* Browser.Browser
          let context: UserContext.UserContext | undefined
          let page: Page.Page | undefined
          yield* Effect.scoped(Effect.gen(function*() {
            context = yield* browser.defaultContext.control
            yield* context.cookies.set({ name: "who", value: "me", scope: { _tag: "Url", url: origin } })
            page = yield* context.newPage
            yield* page.goto(
              fixtureUrl(
                origin,
                `<p id="cookie"></p><script>document.getElementById('cookie').textContent = document.cookie</script>`
              )
            )
            yield* page.locator("#cookie").pipe(Expect.toHaveText("who=me"))
            // The default context has no dialog policy: a dialog waits for a handler or the user
            const dialogs = yield* Dialog.next(page)
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() =>
                alert("hello"), 50)
            })
            const dialog = yield* dialogs
            // A backend that can't say a dialog's kind says it's unknown (QUIRKS.md, Q206)
            assert.strictEqual(dialog._tag, (yield* supports("prompts.kind")) ? "Alert" : "Unknown")
            yield* Effect.sleep("300 millis")
            const status = yield* page.status
            assert.isTrue(status._tag === "Open" && Option.isSome(status.prompt))
            const blocked = reasonOf(yield* Effect.exit(page.getByRole("heading").readText))
            assert.strictEqual((blocked as unknown as Locator.LocatorError).reason._tag, "PromptBlocking")
          }))
          // Released: the page the grant made closed with its scope, and the context's members fail with
          // TargetGone; the scope waited for the page's close (QUIRKS.md, Q135 and Q143)
          yield* page!.closed.pipe(Effect.timeout("10 seconds"))
          const listed = reasonOf(yield* Effect.exit(context!.cookies.list))
          assert.deepStrictEqual((listed as unknown as Target.TargetGone).reason, new Target.AccessReleased({}))
          yield* Effect.scoped(Effect.flatMap(browser.defaultContext.control, (again) => again.cookies.clear))
        }), timeout)

      // ── Attaching, where the backend can ──

      if (Option.isSome(attachable)) {
        const start = attachable.value.start

        it.effect("honors required init-script timing or refuses it for an attached context popup", () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const { layer: attached } = yield* start(tabUrl(origin, "First"), tabUrl(origin, "Second"))
            yield* Effect.scoped(Effect.gen(function*() {
              const browser = yield* Browser.Browser
              const page = yield* (yield* byHeading(browser, "First")).control
              const context = yield* browser.defaultContext.control
              const registration = yield* Effect.exit(
                context.addInitScript({ source: "window.__initProbe = 'before'" }, { timing: "beforeAuthorScript" })
              )
              if (Exit.isFailure(registration)) {
                const error = reasonOf(registration)
                assert.strictEqual(error?._tag, "DeclarationError")
                assert.strictEqual(error?.reason?._tag, "TimingUnsupported")
                return
              }
              const url = fixtureUrl(
                origin,
                "<h1><script>document.write(window.__initProbe ?? 'missing')</script></h1>"
              )
              yield* page.goto(fixtureUrl(origin, `<a target="_blank" href="${url}">Open popup</a>`))
              yield* page.activate
              const opened = yield* Popup.next(page)
              yield* page.getByRole("link", { name: "Open popup" }).click()
              const popup = yield* (yield* opened).inspect
              yield* popup.getByRole("heading").pipe(Expect.toHaveText(/^(before|missing)$/))
              assert.strictEqual(yield* popup.getByRole("heading").readText, "before")
            })).pipe(Effect.provide(attached))
          }), timeout)

        for (const timing of [undefined, "beforeAuthorScript", "bestEffort"] as const) {
          it.effect(`checks attached context init-script timing ${timing ?? "default"} without leaking refusals`, () =>
            Effect.gen(function*() {
              const { origin } = yield* site
              const { layer: attached } = yield* start(tabUrl(origin, "First"), tabUrl(origin, "Second"))
              yield* Effect.scoped(Effect.gen(function*() {
                const browser = yield* Browser.Browser
                const page = yield* (yield* byHeading(browser, "First")).control
                const context = yield* browser.defaultContext.control
                const registration = yield* Effect.exit(context.addInitScript(
                  { source: "window.__contextTiming = 'context'" },
                  { timing }
                ))
                const refused = browser.info.protocol === "cdp" && timing !== "bestEffort"
                if (refused) {
                  const error = reasonOf(registration)
                  assert.strictEqual(error?._tag, "DeclarationError")
                  assert.strictEqual(error?.reason?._tag, "TimingUnsupported")
                } else {
                  assert.isTrue(Exit.isSuccess(registration))
                }
                // Page timing still runs before the first author script of the next document.
                yield* page.addInitScript({ source: "window.__pageTiming = 'page'" })
                yield* page.goto(
                  fixtureUrl(
                    origin,
                    "<h1><script>document.write((window.__contextTiming ?? 'absent') + ':' + window.__pageTiming)</script></h1>"
                  )
                )
                yield* page.getByRole("heading").pipe(Expect.toHaveText(`${refused ? "absent" : "context"}:page`))
              })).pipe(Effect.provide(attached))
            }), timeout)
        }

        it.effect("attaches, inspects one tab, controls another, and leaves both open (call site 7)", () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const { layer: attached } = yield* start(tabUrl(origin, "First"), tabUrl(origin, "Second"))
            yield* Effect.gen(function*() {
              const browser = yield* Browser.Browser
              const first = yield* byHeading(browser, "First")
              const second = yield* byHeading(browser, "Second")
              // 7. Attach, inspect one tab, control another, leave both open
              yield* Effect.scoped(Effect.gen(function*() {
                const reader = yield* first.inspect
                yield* reader.getByRole("heading").pipe(Expect.toBeVisible)
                const text = yield* reader.getByRole("heading").readText
                assert.strictEqual(text, "First")
                const tab = yield* second.control
                // Firefox renders a tab in the background too seldom to act on (Q71)
                yield* tab.activate
                const blocked = yield* tab.route(`${origin}/analytics/**`, () =>
                  Route.abort())
                yield* tab.getByRole("button", { name: "Refresh" }).click()
                yield* tab.locator("#out").pipe(Expect.toHaveText("blocked"))
                assert.strictEqual(yield* blocked.hits, 1)
              }))
            }).pipe(Effect.provide(attached))
            // Both tabs are still there for the next client, and the route went with its grant
            yield* Effect.gen(function*() {
              const browser = yield* Browser.Browser
              const second = yield* byHeading(browser, "Second")
              yield* byHeading(browser, "First")
              yield* Effect.scoped(Effect.gen(function*() {
                const tab = yield* second.control
                yield* tab.activate
                yield* tab.getByRole("button", { name: "Refresh" }).click()
                yield* tab.locator("#out").pipe(Expect.toHaveText("sent"))
              }))
            }).pipe(Effect.provide(attached))
          }), timeout)

        it.effect("preserves the fragment in page.url when attaching to an already loaded page", () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const requested = `${fixtureUrl(origin, "<h1>Loaded</h1>")}#encoded%20fragment%23%2f`
            const { layer: attached } = yield* start(requested, tabUrl(origin, "Other"))
            // Finish loading before disconnecting, so the next client must read the frame-tree snapshot.
            yield* Effect.gen(function*() {
              const page = yield* byHeading(yield* Browser.Browser, "Loaded")
              yield* Effect.scoped(Effect.gen(function*() {
                const reader = yield* page.inspect
                yield* reader.getByRole("heading").pipe(Expect.toHaveText("Loaded"))
                assert.strictEqual(
                  yield* reader.evaluate(() =>
                    location.href
                  ),
                  requested
                )
              }))
            }).pipe(Effect.provide(attached))
            yield* Effect.gen(function*() {
              const page = yield* byHeading(yield* Browser.Browser, "Loaded")
              yield* Effect.scoped(Effect.gen(function*() {
                const reader = yield* page.inspect
                const href = yield* reader.evaluate(() =>
                  location.href
                )
                assert.strictEqual(href, requested)
                assert.strictEqual(yield* page.url, href)
              }))
            }).pipe(Effect.provide(attached))
          }), timeout)

        if (name === "Firefox") {
          it.effect("refuses a second client while one holds Firefox's one session", () =>
            Effect.gen(function*() {
              const { origin } = yield* site
              const { layer: attached } = yield* start(tabUrl(origin, "First"), tabUrl(origin, "Second"))
              yield* Effect.scoped(Effect.gen(function*() {
                yield* Layer.build(attached)
                const second = reasonOf(yield* Effect.exit(Effect.scoped(Layer.build(attached))))
                assert.strictEqual(second?.reason?._tag, "ConnectionFailed")
                assert.include(second?.reason?.hint, "one WebDriver BiDi session at a time")
              }))
              // Ended with the first layer: a new one connects
              yield* Effect.scoped(Layer.build(attached))
            }), timeout)
        }
      }
    })
  })
