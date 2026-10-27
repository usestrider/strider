/**
 * Stock WebKit launched in automation mode, through the public layer: `WebKit.layer`
 * with WebKitGTK's MiniBrowser (`browsers.ts`), a browser process per context, on an X server this process's
 * environment names (`stockWebKit.ts`), with Node's sockets (`sockets.ts`).
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Dialog, Expect, FileInput, Route } from "@usestrider/browser"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { site } from "./adapter/harness.ts"
import { webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

const timeout = 90_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** The reason a failed effect gave. */
const reasonOf = <A, E>(exit: Exit.Exit<A, E>) => {
  assert.isTrue(Exit.isFailure(exit), "expected a failure")
  return (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined) as
    | { readonly _tag: string; readonly reason?: { readonly _tag: string; readonly capability?: string } }
    | undefined
}

/** The MiniBrowser launched for an effect, on an X server of the effect's own. */
const launched = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  yield* useXvfb()
  return yield* effect.pipe(
    Effect.provide(
      WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
        Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector))
      )
    )
  )
}, Effect.scoped)

describe("Stock WebKit, launched in automation mode", () => {
  layer(NodeServices.layer, { excludeTestServices: true, timeout })((it) => {
    it.effect(
      "names itself, has its first tab, and drives a page with input the page trusts",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          const browser = yield* Browser.Browser
          assert.strictEqual(browser.info.product, "MiniBrowser (stock WebKit)")
          assert.strictEqual(browser.info.version, webkitgtk.version)
          // The browser's own first window, observed, as on every backend (Q141)
          assert.strictEqual((yield* browser.defaultContext.pages).length, 1)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<title>Form</title><h1>Hello</h1><button onclick="document.querySelector('h1').textContent = 'clicked ' + event.isTrusted">Go</button><input id=name>`
            ))
            yield* page.getByRole("button", { name: "Go" }).click()
            yield* page.locator("h1").pipe(Expect.toHaveText("clicked true"))
            yield* page.locator("#name").fill("hé@")
            yield* page.locator("#name").press("A")
            assert.strictEqual(yield* page.locator("#name").readValue, "hé@A")
            const png = yield* page.screenshot()
            assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47])
            assert.strictEqual(yield* page.title, "Form")
          }))
        })),
      timeout
    )

    it.effect(
      "reports a dialog with its message and an unknown kind, and answers it",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(fixtureUrl(
              origin,
              `<title>Ask</title><button onclick="document.title = String(confirm('sure?'))">Ask</button><button onclick="document.title = String(prompt('name?', 'Ada'))">Name</button>`
            ))
            const seen: Array<Dialog.Dialog> = []
            yield* Dialog.handle(page, (dialog) =>
              Effect.sync(() => {
                seen.push(dialog)
                return dialog._tag === "Unknown" && dialog.message === "name?"
                  ? dialog.respond("Grace")
                  : dialog._tag === "BeforeUnload"
                  ? dialog.leave
                  : dialog.accept
              }))
            yield* page.getByRole("button", { name: "Ask" }).click()
            yield* page.pipe(Expect.toHaveTitle("true"))
            yield* page.getByRole("button", { name: "Name" }).click()
            yield* page.pipe(Expect.toHaveTitle("Grace"))
            // Stock WebKit says a dialog is open and what it says, not which kind (Q206)
            assert.deepStrictEqual(seen.map((dialog) => [dialog._tag, "message" in dialog ? dialog.message : ""]), [
              ["Unknown", "sure?"],
              ["Unknown", "name?"]
            ])
          }))
        })),
      timeout
    )

    it.effect(
      "makes each context a browser process of its own, with its own cookies and viewport",
      () =>
        launched(Effect.gen(function*() {
          const { origin } = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const first = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
            const second = yield* Browser.newPage()
            yield* first.goto(fixtureUrl(origin, "<title>first</title>"))
            yield* second.goto(fixtureUrl(origin, "<title>second</title>"))
            yield* first.evaluateInMainWorld(() => {
              document.cookie = "who=first"
            })
            assert.strictEqual(yield* first.evaluateInMainWorld(() => document.cookie), "who=first")
            assert.strictEqual(yield* second.evaluateInMainWorld(() => document.cookie), "")
            // The window is sized so the page's viewport is the one asked for
            assert.deepStrictEqual(yield* first.evaluateInMainWorld(() => [innerWidth, innerHeight]), [640, 480])
            const cookies = yield* first.context.cookies.list
            assert.isTrue(cookies.some((cookie) => cookie.name === "who"))
          }))
        })),
      timeout
    )

    it.effect("sets a file input's files, and routes a page's requests", () =>
      launched(Effect.gen(function*() {
        const { origin } = yield* site
        const fs = yield* FileSystem.FileSystem
        const dir = yield* fs.makeTempDirectoryScoped({ prefix: "strider-upload-" })
        yield* fs.writeFileString(`${dir}/note.txt`, "abc")
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.route(
            `${origin}/made-up`,
            () =>
              Effect.succeed(Route.fulfill(
                HttpServerResponse.text("<title>made</title><h1>Made</h1>", { status: 201, contentType: "text/html" })
              ))
          )
          const made = yield* page.goto(`${origin}/made-up`)
          assert(made._tag === "Committed" && Option.isSome(made.response))
          assert.strictEqual(made.response.value.status, 201)
          yield* page.goto(fixtureUrl(
            origin,
            `<title>Upload</title><input type=file id=f><p id=out></p><script>f.onchange = () => { out.textContent = [...f.files].map((file) => file.name + ':' + file.size).join(',') }</script>`
          ))
          yield* page.locator("#f").setInputFiles(FileInput.local(`${dir}/note.txt`))
          yield* page.locator("#out").pipe(Expect.toHaveText("note.txt:3"))
        }))
      })), timeout)

    it.effect("refuses what stock WebKit can't do, saying so", () =>
      launched(Effect.gen(function*() {
        const { origin } = yield* site
        const capabilities = yield* (yield* Browser.Browser).capabilities
        const status = (name: string) => capabilities.entries.find((entry) => entry.name === name)?.status
        assert.strictEqual(status("userContexts"), "supported")
        assert.strictEqual(status("input.native"), "supported")
        assert.strictEqual(status("isolatedWorlds"), "unsupported")
        assert.strictEqual(status("navigation.traverse"), "unsupported")
        yield* Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.goto(fixtureUrl(origin, "<title>one</title>"))
          yield* page.goto(fixtureUrl(origin, "<title>two</title>"))
          // A traversal its inspector misreports (Q215)
          const back = reasonOf(yield* Effect.exit(page.back()))
          assert.strictEqual(back?.reason?.capability, "navigation.traverse")
          // A caller's function never moves to the page's world
          const evaluated = reasonOf(yield* Effect.exit(page.evaluate(() => document.title)))
          assert.strictEqual(evaluated?.reason?.capability, "isolatedWorlds")
          assert.strictEqual(yield* page.evaluateInMainWorld(() => document.title), "two")
        }))
      })), timeout)
  })
})
