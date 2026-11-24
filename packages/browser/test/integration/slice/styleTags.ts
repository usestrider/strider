/** Style injection, `addStyleTag`, into a page's or a frame's document, on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { type Browser, Deadline, Expect } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
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

/** Whether the document's load event has fired, waiting for it. */
const loaded = () =>
  document.readyState === "complete" || new Promise<boolean>((resolve) => addEventListener("load", () => resolve(true)))

export const styleTags = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} style tags`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout: 60_000 })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect("applies inline source before returning", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
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

      // Firefox commits a navigation only once its document's body has ended, so `goto` never returns into a document
      // without a root element there
      if (name !== "Firefox") {
        it.effect("abandons inline style insertion when waiting for the root times out", () =>
          Effect.gen(function*() {
            const served = yield* site
            const page = yield* newPage
            yield* page.goto(
              `${served.origin}/held-page?key=style-timeout&html=${encodeURIComponent("<body>x</body>")}`
            )
            assert.isTrue(yield* page.evaluateInMainWorld(() => document.documentElement === null))
            const exit = yield* page.addStyleTag({ source: "body { color: rgb(61, 62, 63) }" }).pipe(
              Deadline.within("1 second"),
              Effect.exit
            )
            assert.isTrue(Exit.isFailure(exit) && Deadline.isTimeout(Cause.squash(exit.cause)))
            // The HTML arrives only after the operation has failed, so no insertion has happened yet
            yield* served.release("style-timeout")
            yield* page.evaluateInMainWorld(loaded)
            assert.strictEqual(yield* page.evaluateInMainWorld(() => document.querySelectorAll("style").length), 0)
            assert.notStrictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(61, 62, 63)")
          }).pipe(Effect.scoped))

        it.effect("adds inline source to a document committed before its parser made a root element", () =>
          Effect.gen(function*() {
            const served = yield* site
            const page = yield* newPage
            yield* page.goto(`${served.origin}/held-page?key=style&html=${encodeURIComponent("<body>x</body>")}`)
            // The navigation has committed, and the HTML after the doctype is still held back
            assert.isTrue(yield* page.evaluateInMainWorld(() => document.documentElement === null))
            const added = yield* page.addStyleTag({ source: "body { color: rgb(61, 62, 63) }" }).pipe(Effect.forkChild)
            // A later call in the same world, so the addition has reached the page before the HTML does
            yield* page.evaluateInMainWorld(() => null)
            yield* served.release("style")
            yield* Fiber.join(added)
            yield* page.evaluateInMainWorld(loaded)
            assert.strictEqual(yield* page.evaluateInMainWorld(() => document.documentElement?.tagName), "HTML")
            assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(61, 62, 63)")
          }).pipe(Effect.scoped))
      }

      it.effect("applies a stylesheet from a URL once it has loaded", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(`${served.origin}/fixture?html=x`)
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
          yield* page.goto(`${served.origin}/fixture?html=x`)
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
          yield* page.goto(`${served.origin}/fixture?html=x`)
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
          yield* page.goto(`${served.origin}/style-csp?html=x`)
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
          yield* page.goto(`${served.origin}/fixture?html=${
            encodeURIComponent(
              `<meta http-equiv="Content-Security-Policy" content="style-src ${served.origin}/style"><body>x</body>`
            )
          }`)
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
          yield* page.goto(`${served.origin}/style-report-only`)
          yield* page.addStyleTag({ source: "body { color: rgb(41, 42, 43) }" })
          assert.strictEqual(yield* page.evaluateInMainWorld(bodyColor), "rgb(41, 42, 43)")
        }).pipe(Effect.scoped))

      it.effect("keeps an allowed inline style independent of other inline refusals", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const source = "body { color: rgb(51, 52, 53) }"
          const hash = createHash("sha256").update(source).digest("base64")
          yield* page.goto(`${served.origin}/fixture?html=${
            encodeURIComponent(
              `<meta http-equiv="Content-Security-Policy" content="style-src 'sha256-${hash}'; script-src 'none'"><body>x</body>`
            )
          }`)
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
            }`
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
