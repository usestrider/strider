/** Script injection, `addScriptTag`, into a page's or a frame's document, on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { site } from "../adapter/harness.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const script = (origin: string, js: string) => `${origin}/script?js=${encodeURIComponent(js)}`

const global = (name: string) => () => Reflect.get(window, name) as unknown

export const scriptTags = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} script tags`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout: 60_000 })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect("returns after a script from a URL has loaded and run, with its element", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          const element = yield* page.addScriptTag({ url: script(served.origin, "window.fromUrl = 'ran'") })
          assert.strictEqual(yield* page.evaluateInMainWorld(global("fromUrl")), "ran")
          assert.strictEqual(yield* element.evaluate((tag) => tag.src.includes("/script?")), true)
        }).pipe(Effect.scoped))

      it.effect("fails with ResourceFailed when the URL doesn't load", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          const error = yield* page.addScriptTag({ url: "http://127.0.0.1:9/unreachable.js" }).pipe(Effect.flip)
          assert.strictEqual(error._tag, "PageError")
          assert.strictEqual(error.reason._tag, "ResourceFailed")
        }).pipe(Effect.scoped))

      it.effect("runs inline source before returning", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addScriptTag({ source: "window.inline = document.currentScript.tagName" })
          assert.strictEqual(yield* page.evaluateInMainWorld(global("inline")), "SCRIPT")
        }).pipe(Effect.scoped))

      it.effect("waits for inline and URL modules to run", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addScriptTag({ source: "await Promise.resolve(); window.inlineModule = typeof import.meta" }, {
            type: "module"
          })
          assert.strictEqual(yield* page.evaluateInMainWorld(global("inlineModule")), "object")
          yield* page.addScriptTag({ url: script(served.origin, "window.urlModule = typeof import.meta") }, {
            type: "module"
          })
          assert.strictEqual(yield* page.evaluateInMainWorld(global("urlModule")), "object")
        }).pipe(Effect.scoped))

      it.effect("reads a path and names it with sourceURL", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() => fs.mkdtemp(nodePath.join(os.tmpdir(), "strider-script-tag-"))),
            (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true }))
          )
          const file = nodePath.join(directory, "injected.js")
          yield* Effect.promise(() => fs.writeFile(file, "window.fromPath = 'ran'"))
          yield* page.goto(`${served.origin}/fixture?html=x`)
          const element = yield* page.addScriptTag({ path: file })
          assert.strictEqual(yield* page.evaluateInMainWorld(global("fromPath")), "ran")
          assert.isTrue((yield* element.evaluate((tag) => tag.text)).endsWith(`\n//# sourceURL=${file}`))
        }).pipe(Effect.scoped))

      it.effect("sets the id on the element", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addScriptTag({ source: "" }, { id: "injected" })
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() => document.querySelector("script#injected")?.tagName),
            "SCRIPT"
          )
        }).pipe(Effect.scoped))

      it.effect("fails with RefusedByPolicy when the page's CSP refuses inline source or a URL", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/csp?html=x`)
          const inline = yield* page.addScriptTag({ source: "window.refused = true" }).pipe(Effect.flip)
          assert.strictEqual(inline.reason._tag, "RefusedByPolicy")
          assert.strictEqual(inline.reason._tag === "RefusedByPolicy" && inline.reason.directive, "script-src-elem")
          const remote = yield* page.addScriptTag({ url: script(served.crossSite, "window.refused = true") }).pipe(
            Effect.flip
          )
          assert.strictEqual(remote.reason._tag, "RefusedByPolicy")
          assert.strictEqual(yield* page.evaluateInMainWorld(global("refused")), undefined)
        }).pipe(Effect.scoped))

      it.effect("injects into a cross-site iframe's main world through its frame locator", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(`<iframe src="${served.crossSite}/fixture?html=frame"></iframe>`)
            }`
          )
          const frame = page.frame(page.locator("iframe"))
          const element = yield* frame.addScriptTag({ source: "window.inFrame = location.host" })
          assert.strictEqual(
            yield* element.evaluate((tag) => tag.ownerDocument.defaultView === window && Reflect.get(window, "inFrame")),
            new URL(served.crossSite).host
          )
          assert.strictEqual(yield* page.evaluateInMainWorld(global("inFrame")), undefined)
        }).pipe(Effect.scoped))
    })
  })
