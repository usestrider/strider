/** Style injection, `addStyleTag`, into a page's or a frame's document, on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { type Browser, Expect } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import { createHash } from "node:crypto"
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
          yield* page.goto(`${served.origin}/fixture?html=x`, { waitUntil: "load" })
          // The handle is released with its scope, and the stylesheet stays in the document
          const element = yield* Effect.gen(function*() {
            const element = yield* page.addStyleTag({ source: "body { color: rgb(1, 2, 3) }" })
            assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(1, 2, 3)")
            assert.strictEqual(yield* element.evaluate((style) => style.tagName), "STYLE")
            return element
          }).pipe(Effect.scoped)
          const exit = yield* element.evaluate((style) => style.tagName).pipe(Effect.exit)
          assert(Exit.isFailure(exit))
          assert.include(String(Cause.squash(exit.cause)), "the handle was released")
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(1, 2, 3)")
        }).pipe(Effect.scoped))

      it.effect("applies a stylesheet from a URL once it has loaded", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`, { waitUntil: "load" })
          const element = yield* page.addStyleTag({ url: stylesheet(served.origin, "body { color: rgb(4, 5, 6) }") })
          assert.deepStrictEqual(
            yield* element.evaluate((link) => [link.tagName, link.getAttribute("rel")]),
            ["LINK", "stylesheet"]
          )
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
          yield* page.goto(`${served.origin}/fixture?html=x`, { waitUntil: "load" })
          const element = yield* page.addStyleTag({ path: file })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(7, 8, 9)")
          assert.isTrue(
            (yield* element.evaluate((style) => style.textContent ?? "")).endsWith(
              `\n/*# sourceURL=${file} */`
            )
          )
        }).pipe(Effect.scoped))

      it.effect("fails with ResourceFailed when the URL doesn't load", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`, { waitUntil: "load" })
          const url = `${served.origin}/missing`
          const error = yield* page.addStyleTag({ url }).pipe(Effect.flip)
          assert(error._tag === "PageError")
          assert.strictEqual(error.reason._tag, "ResourceFailed")
          assert.strictEqual(error.reason._tag === "ResourceFailed" && error.reason.url, url)
        }).pipe(Effect.scoped))

      it.effect("fails with RefusedByPolicy, each time, when the page's CSP refuses inline source or a URL", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/style-csp?html=x`, { waitUntil: "load" })
          const before = yield* page.evaluateInMainWorld(bodyColor)
          // The same refusal twice in one document, and a URL whose fragment the reported URL omits
          const url = `${stylesheet(served.crossSite, "body { color: rgb(4, 5, 6) }")}#theme`
          for (const tag of [{ source: "body { color: rgb(1, 2, 3) }" }, { url }]) {
            for (let attempt = 1; attempt <= 2; attempt++) {
              const error = yield* page.addStyleTag(tag).pipe(Effect.flip)
              assert(error._tag === "PageError", `${JSON.stringify(tag)}, attempt ${attempt}: ${error._tag}`)
              assert.strictEqual(error.reason._tag, "RefusedByPolicy", `${JSON.stringify(tag)}, attempt ${attempt}`)
              assert.strictEqual(error.reason._tag === "RefusedByPolicy" && error.reason.directive, "style-src-elem")
            }
          }
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), before)
        }).pipe(Effect.scoped))

      it.effect("ignores another stylesheet's policy violation whose URL prefixes its own", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                `<meta http-equiv="Content-Security-Policy" content="style-src ${served.origin}/style"><body>x</body>`
              )
            }`,
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld((url: string) => {
            const observer = new MutationObserver((records) => {
              if (
                !records.some((record) => Array.from(record.addedNodes).some((node) => node instanceof HTMLLinkElement))
              ) return
              observer.disconnect()
              const other = document.createElement("link")
              other.rel = "stylesheet"
              other.href = url
              document.head.appendChild(other)
            })
            observer.observe(document.head, { childList: true })
          }, `${served.origin}/`)
          yield* page.addStyleTag({ url: stylesheet(served.origin, "body { color: rgb(31, 32, 33) }") })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(31, 32, 33)")
        }).pipe(Effect.scoped))

      it.effect("applies inline source under a report-only policy", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/style-report-only`, { waitUntil: "load" })
          yield* page.addStyleTag({ source: "body { color: rgb(41, 42, 43) }" })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(41, 42, 43)")
        }).pipe(Effect.scoped))

      it.effect("keeps an allowed inline style independent of other inline refusals", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const source = "body { color: rgb(51, 52, 53) }"
          const hash = createHash("sha256").update(source).digest("base64")
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(
                `<meta http-equiv="Content-Security-Policy" content="style-src 'sha256-${hash}'; script-src 'none'"><body>x</body>`
              )
            }`,
            { waitUntil: "load" }
          )
          yield* page.evaluateInMainWorld(() => {
            const observer = new MutationObserver(() => {
              observer.disconnect()
              const otherStyle = document.createElement("style")
              otherStyle.textContent = "body { color: red }"
              const otherScript = document.createElement("script")
              otherScript.textContent = "window.otherRan = true"
              document.head.append(otherStyle, otherScript)
            })
            observer.observe(document.head, { childList: true })
          })
          const element = yield* page.addStyleTag({ source })
          assert.strictEqual(yield* element.evaluate((style) => style.textContent), source)
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(51, 52, 53)")
          assert.deepStrictEqual(
            yield* page.evaluateInMainWorld(() => [
              document.querySelectorAll("style").length,
              document.querySelectorAll("script").length,
              Reflect.get(window, "otherRan") === undefined
            ]),
            [2, 1, true]
          )
        }).pipe(Effect.scoped))

      it.effect("injects into a cross-site iframe's document through its frame locator", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(
            `${served.origin}/fixture?html=${
              encodeURIComponent(`<iframe src="${served.crossSite}/fixture?html=frame"></iframe>`)
            }`,
            { waitUntil: "load" }
          )
          const before = yield* page.evaluateInMainWorld(bodyColor)
          const frame = page.frame(page.locator("iframe"))
          const element = yield* frame.addStyleTag({ source: "body { color: rgb(1, 2, 3) }" })
          assert.isTrue(yield* element.evaluate((style) => style.ownerDocument === document && window.top !== window))
          yield* frame.locator("body").pipe(Expect.toHaveCSS("color", "rgb(1, 2, 3)"))
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), before)
        }).pipe(Effect.scoped))
    })
  })
