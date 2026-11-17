/** Style injection, `addStyleTag`, into a page's or a frame's document, on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { type Browser, Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { site } from "../adapter/harness.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const stylesheet = (origin: string, css: string) => `${origin}/style?css=${encodeURIComponent(css)}`

const bodyColor = () => getComputedStyle(document.body).color

export const styleTags = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} style tags`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout: 60_000 })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect("applies inline source before returning", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addStyleTag({ source: "body { color: rgb(1, 2, 3) }" })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(1, 2, 3)")
        }).pipe(Effect.scoped))

      it.effect("applies a stylesheet from a URL once it has loaded", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addStyleTag({ url: stylesheet(served.origin, "body { color: rgb(4, 5, 6) }") })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(4, 5, 6)")
        }).pipe(Effect.scoped))

      it.effect("reads a path and names it with sourceURL", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const directory = yield* Effect.acquireRelease(
            Effect.promise(() => fs.mkdtemp(nodePath.join(os.tmpdir(), "strider-style-tag-"))),
            (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true }))
          )
          const file = nodePath.join(directory, "injected.css")
          yield* Effect.promise(() => fs.writeFile(file, "body { color: rgb(7, 8, 9) }"))
          yield* page.goto(`${served.origin}/fixture?html=x`)
          yield* page.addStyleTag({ path: file })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(7, 8, 9)")
          assert.isTrue(
            (yield* page.evaluateInMainWorld(() => document.querySelector("style")?.textContent ?? "")).endsWith(
              `\n/*# sourceURL=${file} */`
            )
          )
        }).pipe(Effect.scoped))

      it.effect("fails with ResourceFailed when the URL doesn't load", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
          const url = `${served.origin}/missing`
          const error = yield* page.addStyleTag({ url }).pipe(Effect.flip)
          assert(error._tag === "PageError")
          assert.strictEqual(error.reason._tag, "ResourceFailed")
          assert.strictEqual(error.reason._tag === "ResourceFailed" && error.reason.url, url)
        }).pipe(Effect.scoped))

      it.effect("fails with RefusedByPolicy when the page's CSP refuses inline source or a URL", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/style-csp?html=x`)
          const before = yield* page.evaluateInMainWorld(bodyColor)
          const inline = yield* page.addStyleTag({ source: "body { color: rgb(1, 2, 3) }" }).pipe(Effect.flip)
          assert(inline._tag === "PageError")
          assert.strictEqual(inline.reason._tag, "RefusedByPolicy")
          assert.strictEqual(inline.reason._tag === "RefusedByPolicy" && inline.reason.directive, "style-src-elem")
          const remote = yield* page.addStyleTag({ url: stylesheet(served.crossSite, "body { color: rgb(4, 5, 6) }") })
            .pipe(Effect.flip)
          assert(remote._tag === "PageError")
          assert.strictEqual(remote.reason._tag, "RefusedByPolicy")
          assert.strictEqual(remote.reason._tag === "RefusedByPolicy" && remote.reason.directive, "style-src-elem")
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), before)
        }).pipe(Effect.scoped))

      it.effect("injects into a cross-site iframe's document through its frame locator", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(`<iframe src="${served.crossSite}/fixture?html=frame"></iframe>`)
            }`
          )
          const before = yield* page.evaluateInMainWorld(bodyColor)
          const frame = page.frame(page.locator("iframe"))
          yield* frame.addStyleTag({ source: "body { color: rgb(1, 2, 3) }" })
          yield* frame.locator("body").pipe(Expect.toHaveCSS("color", "rgb(1, 2, 3)"))
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), before)
        }).pipe(Effect.scoped))
    })
  })
