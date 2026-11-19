/** Script injection, `addScriptTag`, into a page's or a frame's document, on every backend. */
import { assert } from "@effect/vitest"
import { Locator, Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { createHash } from "node:crypto"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as nodePath from "node:path"
import { site } from "../adapter/harness.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const script = (origin: string, js: string) => `${origin}/script?js=${encodeURIComponent(js)}`

/** The reason of a page or locator error, or the tag of any other failure. */
const reasonOf = <E extends { readonly _tag: string }>(error: E) =>
  Page.isPageError(error) || Locator.isLocatorError(error) ? error.reason : undefined

/** A global of the page's main world, by value. */
const global = (page: Page.Page, key: string) =>
  page.evaluateInMainWorld((key: string) => Reflect.get(window, key) as unknown, key)

/** The script tag cases, registered in a suite whose shared context they leave as they found it. */
export const scriptTags = <R>(it: ReturnType<typeof SharedContext.guard<R>>) => {
  it.effect("returns after a script from a URL has loaded and run, with its element", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/fixture?html=x`)
      const element = yield* page.addScriptTag({ url: script(served.origin, "window.fromUrl = 'ran'") })
      assert.strictEqual(yield* global(page, "fromUrl"), "ran")
      assert.strictEqual(yield* element.evaluate((tag) => tag.src.includes("/script?")), true)
    }).pipe(Effect.scoped))

  it.effect("fails with ResourceFailed when the URL doesn't load", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/fixture?html=x`)
      const error = yield* page.addScriptTag({ url: "http://127.0.0.1:9/unreachable.js" }).pipe(Effect.flip)
      assert.strictEqual(reasonOf(error)?._tag, "ResourceFailed")
    }).pipe(Effect.scoped))

  it.effect("runs inline source before returning", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/fixture?html=x`)
      yield* page.addScriptTag({ source: "window.inline = document.currentScript.tagName" })
      assert.strictEqual(yield* global(page, "inline"), "SCRIPT")
    }).pipe(Effect.scoped))

  it.effect("runs inline and URL modules, waiting for a URL's load", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/fixture?html=x`)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "inlineModule", new Promise((resolve) => Reflect.set(window, "markInline", resolve)))
      })
      yield* page.addScriptTag({ source: "await Promise.resolve(); window.markInline(typeof import.meta)" }, {
        type: "module"
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "inlineModule") as Promise<string>),
        "object"
      )
      yield* page.addScriptTag({ url: script(served.origin, "window.urlModule = typeof import.meta") }, {
        type: "module"
      })
      assert.strictEqual(yield* global(page, "urlModule"), "object")
    }).pipe(Effect.scoped))

  it.effect("runs source authorized by a CSP hash without changing its text", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      const source = "window.hashAllowed = true"
      const hash = createHash("sha256").update(source).digest("base64")
      const html =
        `<meta http-equiv="Content-Security-Policy" content="script-src 'sha256-${hash}'"><script>${source}</script>`
      yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`, { waitUntil: "load" })
      assert.strictEqual(yield* global(page, "hashAllowed"), true)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "hashAllowed", false)
      })
      const element = yield* page.addScriptTag({ source })
      assert.strictEqual(yield* global(page, "hashAllowed"), true)
      assert.strictEqual(yield* element.evaluate((tag) => tag.text), source)
    }).pipe(Effect.scoped))

  it.effect("returns an accepted inline module without waiting for it to run", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/fixture?html=x`)
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "moduleStarted", new Promise((resolve) => Reflect.set(window, "notifyStarted", resolve)))
        Reflect.set(window, "moduleFinished", new Promise((resolve) => Reflect.set(window, "notifyFinished", resolve)))
      })
      yield* page.addScriptTag({
        source:
          "window.notifyStarted(); await new Promise(resolve => { window.releaseModule = resolve }); window.finished = true; window.notifyFinished(true)"
      }, { type: "module" })
      yield* page.evaluateInMainWorld(() => Reflect.get(window, "moduleStarted") as Promise<void>)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => typeof Reflect.get(window, "releaseModule")), "function")
      assert.strictEqual(yield* global(page, "finished"), undefined, "the call returned while the module waits")
      yield* page.evaluateInMainWorld(() => {
        Reflect.get(window, "releaseModule")()
      })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => Reflect.get(window, "moduleFinished") as Promise<boolean>),
        true
      )
    }).pipe(Effect.scoped))

  it.effect("runs inline source and a URL under a report-only policy", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(`${served.origin}/csp-report-only?html=x`)
      yield* page.addScriptTag({ source: "window.reportedInline = true" })
      yield* page.addScriptTag({ url: script(served.crossSite, "window.reportedUrl = true") })
      assert.strictEqual(yield* global(page, "reportedInline"), true)
      assert.strictEqual(yield* global(page, "reportedUrl"), true)
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
      assert.strictEqual(yield* global(page, "fromPath"), "ran")
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
      const refused = reasonOf(inline)
      assert.strictEqual(refused?._tag, "RefusedByPolicy")
      assert.strictEqual(refused?._tag === "RefusedByPolicy" && refused.directive, "script-src-elem")
      const remote = yield* page.addScriptTag({ url: script(served.crossSite, "window.refused = true") }).pipe(
        Effect.flip
      )
      assert.strictEqual(reasonOf(remote)?._tag, "RefusedByPolicy")
      assert.strictEqual(yield* global(page, "refused"), undefined)
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
      assert.strictEqual(yield* global(page, "inFrame"), undefined)
    }).pipe(Effect.scoped))

  it.effect("fails with RefusedByPolicy when a cross-site iframe's CSP refuses inline source", () =>
    Effect.gen(function*() {
      const served = yield* site
      const page = yield* newPage
      yield* page.goto(
        `${served.origin}/fixture?html=${
          encodeURIComponent(`<iframe src="${served.crossSite}/csp?html=frame"></iframe>`)
        }`
      )
      const error = yield* page.frame(page.locator("iframe")).addScriptTag({ source: "window.refused = true" }).pipe(
        Effect.flip
      )
      assert.strictEqual(reasonOf(error)?._tag, "RefusedByPolicy")
    }).pipe(Effect.scoped))
}
