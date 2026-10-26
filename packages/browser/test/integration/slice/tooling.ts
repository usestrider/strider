/**
 * Review 20's first step on every backend's layer: files made in the page, the outcomes `goto` accepts, a close
 * that runs `beforeunload`, the capabilities each backend has and the `Unsupported` of the others, and a span per
 * protocol command.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  Capability,
  Deadline,
  Dialog,
  Expect,
  FileChooser,
  FileInput,
  Locator,
  PageNavigation
} from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import { site } from "../adapter/harness.ts"

const timeout = 60_000

/** A page on the local site, showing `html`. */
const fixture = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  return `${served.origin}/fixture?html=${encodeURIComponent(html)}`
})

const text = (value: string) => new TextEncoder().encode(value)

// Writes each chosen file's name, type, size and text
const files = `<input type="file" id="files" multiple aria-label="Files"><button>Choose</button><p id="out">none</p>
<script>
  document.querySelector("button").onclick = () => document.getElementById("files").click()
  document.getElementById("files").addEventListener("change", async (event) => {
    const read = await Promise.all([...event.target.files].map(async (file) =>
      file.name + ":" + file.type + ":" + file.size + ":" + await file.text()))
    document.getElementById("out").textContent = read.join("|")
  })
</script>`

const made = [
  FileInput.bytes("a.txt", "text/plain", text("hello")),
  FileInput.bytes("b.csv", "text/csv", text("x,y"))
]

const findNode = (node: Capability.AxNode, found: (node: Capability.AxNode) => boolean): boolean =>
  found(node) || node.children.some((child) => findNode(child, found))

export const tooling = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} tooling`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("sets files made in the page, with their names, types and contents", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.getByLabel("Files").setInputFiles(made)
            yield* page.getByText("a.txt:text/plain:5:hello|b.csv:text/csv:3:x,y").pipe(Expect.toBeVisible)
            // Paths and made files can't be mixed: each would replace the other's
            const mixed = yield* page.getByLabel("Files").setInputFiles([made[0]!, FileInput.local("/etc/hosts")]).pipe(
              Effect.flip
            )
            assert(Locator.isLocatorError(mixed), String(mixed))
            assert.strictEqual(mixed.reason._tag, "InvalidInput")
          }))
        }), timeout)

      it.effect("chooses files made in the page through a file chooser", () =>
        Effect.gen(function*() {
          const url = yield* fixture(files)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const handler = yield* FileChooser.handle(page, FileChooser.choose(made))
            yield* page.getByRole("button", { name: "Choose" }).click()
            yield* page.getByText("a.txt:text/plain:5:hello|b.csv:text/csv:3:x,y").pipe(Expect.toBeVisible)
            // The handler is counted as it decides, before the page sets the files (QUIRKS.md, Q152)
            assert.strictEqual(yield* handler.handled, 1)
          }))
        }), timeout)

      it.effect("returns a download or no content as a navigation when goto accepts it", () =>
        Effect.gen(function*() {
          const served = yield* site
          const url = yield* fixture(`<p>start</p>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const refused = yield* page.goto(`${served.origin}/204`).pipe(Effect.flip)
            assert(refused._tag === "PageError", String(refused))
            assert(refused.reason instanceof PageNavigation.NoContent, String(refused.reason))
            const empty = yield* page.goto(`${served.origin}/204`, { accept: ["noContent"] })
            assert(empty._tag === "NoContent", empty._tag)
            assert.strictEqual(empty.url, `${served.origin}/204`)
            assert(Option.isSome(empty.response), "the 204's response")
            assert.strictEqual(empty.response.value.status, 204)
            const download = yield* page.goto(`${served.origin}/download`, { accept: ["download", "noContent"] })
            assert(download._tag === "BecameDownload", download._tag)
            assert.strictEqual(download.url, `${served.origin}/download`)
            // The page stayed where it was
            yield* page.getByText("start").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect(
        "runs beforeunload when closing, and a handler's stay keeps the page open",
        () =>
          Effect.gen(function*() {
            const url = yield* fixture(
              `<button>Edit</button><script>window.addEventListener("beforeunload", (e) => { e.preventDefault(); e.returnValue = "" })</script>`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              // A page prompts before unloading only after the user has interacted with it
              yield* page.getByRole("button", { name: "Edit" }).click()
              const staying = yield* Dialog.handle(page, Dialog.dismissAll)
              const canceled = yield* page.close({ runBeforeUnload: true }).pipe(Effect.flip)
              assert(canceled._tag === "PageError", String(canceled))
              assert.strictEqual(canceled.reason._tag, "CloseCanceled")
              yield* staying.handled.waitFor((count) => count === 1)
              assert.strictEqual((yield* page.status)._tag, "Open")
              yield* page.getByRole("button", { name: "Edit" }).pipe(Expect.toBeVisible)
              yield* staying.remove
              const leaving = yield* Dialog.handle(page, Dialog.acceptAll)
              yield* page.close({ runBeforeUnload: true })
              assert.strictEqual((yield* page.closed)._tag, "PageClosed")
              yield* leaving.handled.waitFor((count) => count === 1)
            }))
          }),
        timeout
      )

      it.effect("reads the browser's own accessibility tree where there is one", () =>
        Effect.gen(function*() {
          const { info } = yield* Browser.Browser
          const url = yield* fixture(`<main><button>Save</button></main>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const acquired = yield* page.capability(Capability.AxTree).pipe(
              Effect.flatMap((tree) => tree.read),
              Effect.exit
            )
            if (info.protocol !== "cdp") {
              assert(acquired._tag === "Failure", "unsupported")
              const error = yield* Effect.flip(acquired)
              assert(Capability.isCapabilityError(error), String(error))
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.axTree" })
              return
            }
            assert(acquired._tag === "Success", String(acquired))
            const tree = acquired.value
            assert.strictEqual(tree.role, "RootWebArea")
            assert.isTrue(findNode(tree, (node) => node.role === "button" && node.name === "Save"))
            // Ignored nodes are left out: no generic container with no name is kept for the main element's parent
            assert.isFalse(findNode(tree, (node) => node.properties.ignored === true))
          }))
        }), timeout)

      it.effect("streams the page's frames where the backend has a screencast", () =>
        Effect.gen(function*() {
          const { info } = yield* Browser.Browser
          const url = yield* fixture(`<p id="t"></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const acquired = yield* page.capability(Capability.Screencast).pipe(Effect.exit)
            if (info.protocol === "bidi") {
              const error = yield* Effect.flip(acquired)
              assert(Capability.isCapabilityError(error), String(error))
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.screencast" })
              return
            }
            assert(acquired._tag === "Success", String(acquired))
            const frames = yield* acquired.value.frames.pipe(
              Stream.take(2),
              Stream.runCollect,
              Deadline.within("20 seconds")
            )
            assert.strictEqual(frames.length, 2)
            for (const frame of frames) {
              assert.deepStrictEqual([frame.jpeg[0], frame.jpeg[1]], [0xff, 0xd8])
              assert.isAbove(frame.width, 0)
              assert.isAbove(frame.height, 0)
            }
          }))
        }), timeout)

      it.effect("opens a span per protocol command, under its operation's, when asked", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<p>traced</p>`)
          const spans: Array<Tracer.NativeSpan> = []
          const tracer = Tracer.make({
            span(options) {
              const span = new Tracer.NativeSpan(options)
              spans.push(span)
              return span
            }
          })
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url).pipe(Effect.provideService(Browser.TraceProtocolCommands, true))
            yield* page.reload()
          })).pipe(Effect.withTracer(tracer))
          const goto = spans.find((span) => span.name === "Page.goto")!
          assert.isDefined(goto)
          const commands = spans.filter((span) =>
            Option.isSome(span.parent) && span.parent.value.spanId === goto.spanId &&
            span.attributes.has("browser.protocol.method")
          )
          assert.isAbove(commands.length, 0, spans.map((span) => span.name).join(", "))
          // Only where asked: the reload's commands have none
          const reload = spans.find((span) => span.name === "Page.reload")!
          assert.isFalse(spans.some((span) => Option.isSome(span.parent) && span.parent.value.spanId === reload.spanId))
        }), timeout)
    })
  })
