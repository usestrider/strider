/**
 * The third slice: the other event modules, through the public API on every backend's layer. Call
 * sites 2, 4 + 9, 5 and 8 of API.md, and around them what the design says each module does: downloads saved,
 * read and canceled, file choosers answered or canceled, console messages and exceptions attributed and
 * encoded, navigations that end well or badly, requests and bodies, workers evaluated in, WebSocket frames, and
 * `Unsupported` wherever a backend can't report something.
 */
import { assert, describe, layer } from "@effect/vitest"
import {
  AutoResolution,
  Browser,
  BrowserWorker,
  ConsoleMessage,
  Deadline,
  Declaration,
  Download,
  Expect,
  FileChooser,
  FileInput,
  NetworkConnection,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Subscription,
  Target,
  UncaughtException,
  Watchable
} from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"
import { navigationFailure } from "./navigationFailure.ts"

const timeout = 60_000

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

/** A page on the local site, showing `html`, and the site's origin. */
const fixture = Effect.fnUntraced(function*(html: (origin: string) => string) {
  const served = yield* site
  return { url: fixtureUrl(served.origin, html(served.origin)), origin: served.origin }
})

/** A button that runs `code` when clicked. */
const button = (label: string, code: string) =>
  `<button onclick="${code.replaceAll("&", "&amp;").replaceAll(`"`, "&quot;")}">${label}</button>`

const chooser =
  `<input id="f" type="file" style="display:none" onchange="document.getElementById('out').textContent = [...this.files].map((file) => file.name).join(',')">${
    button("Upload", "document.getElementById('f').click()")
  }<p id="out">nothing yet</p>`

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "strider-saved-"))

/** Where the backend lacks `capability`, a subscription that needs it is refused, naming it: whether it was. */
const refused = Effect.fnUntraced(function*(
  capability: string,
  subscribe: (
    page: Page.Page
  ) => Effect.Effect<
    unknown,
    Subscription.SubscriptionError | Declaration.DeclarationError | Target.TargetGone,
    Scope.Scope
  >
) {
  if (yield* supports(capability)) return false
  yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const error = yield* Effect.flip(Effect.asVoid(subscribe(page)))
    assert.deepInclude(error.reason, { _tag: "Unsupported", capability })
  }))
  return true
})

export const modules = (name: "Chromium" | "Firefox" | "WebKit", backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} event modules`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      // ── Download ──

      it.effect("runs call site 5: a download, saved to a path", () =>
        Effect.gen(function*() {
          if (yield* refused("downloads", (page) => Download.next(page))) return
          const { url } = yield* fixture(() => `<a href="/download" download>Export CSV</a>`)
          const saved = path.join(temporary(), "export.csv")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const download = yield* Download.next(page)
            yield* page.getByText("Export CSV").click()
            const file = yield* download
            yield* file.saveAs(saved)
            assert.strictEqual(fs.readFileSync(saved, "utf8"), "hello, download")
            assert.strictEqual(file.suggestedFilename, "hello.txt")
            assert.strictEqual((yield* file.status)._tag, "Completed")
            // One handle per download, from the page's log and the context's
            const seen = yield* Download.history(page.context)
            assert.isTrue(seen.entries[0] === file)
          }))
        }), timeout)

      it.effect("reads a download's bytes, and its file goes with its context", () =>
        Effect.gen(function*() {
          if (yield* refused("downloads", (page) => Download.next(page))) return
          const { url } = yield* fixture(() => `<a href="/download" download>Export</a>`)
          const scope = yield* Scope.make()
          const file = yield* Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const download = yield* Download.next(page)
            yield* page.getByText("Export").click()
            return yield* download
          }).pipe(Scope.provide(scope))
          const bytes = yield* Stream.runCollect(file.stream)
          assert.strictEqual(Buffer.concat(Array.from(bytes)).toString("utf8"), "hello, download")
          yield* file.finished
          yield* Scope.close(scope, Exit.void)
          const error = yield* file.saveAs(path.join(temporary(), "late.txt")).pipe(Effect.flip)
          assert(Target.isTargetGone(error), String(error))
          assert.strictEqual(error.reason._tag, "UserContextRemoved")
        }), timeout)

      it.effect(
        "cancels a download where the backend can, and reports progress where it does",
        () =>
          Effect.gen(function*() {
            if (yield* refused("downloads", (page) => Download.next(page))) return
            const { url } = yield* fixture(() => `<a href="/slow-download" download>Slow</a>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const download = yield* Download.next(page)
              yield* page.getByText("Slow").click()
              const file = yield* download
              if (name === "Chromium") {
                const progress = yield* file.status.waitFor((status) =>
                  status._tag === "InProgress" && Option.isSome(status.total)
                )
                assert(progress._tag === "InProgress")
                assert.deepStrictEqual(progress.total, Option.some(4 * 64 * 1024))
              }
              if (name === "Firefox") {
                const refused = yield* file.cancel.pipe(Effect.flip)
                assert(Download.isDownloadError(refused), String(refused))
                assert.strictEqual(refused.reason._tag, "Unsupported")
                yield* file.finished
                return
              }
              yield* file.cancel
              const error = yield* file.finished.pipe(Effect.flip)
              assert(Download.isDownloadError(error), String(error))
              assert.strictEqual(error.reason._tag, "DownloadCanceled")
              assert.strictEqual((yield* file.status)._tag, "Canceled")
              // A wait on a status it can no longer reach says it settled, with what on (QUIRKS.md, Q62)
              const settled = yield* file.status.waitFor((status) => status._tag === "Completed").pipe(Effect.flip)
              assert(Watchable.isEnded(settled), String(settled))
              assert.deepInclude(settled.value, { _tag: "Canceled" })
            }))
          }),
        timeout
      )

      // ── FileChooser ──

      it.effect("answers a file chooser with the page's handler", () =>
        Effect.gen(function*() {
          if (yield* refused("fileChooser", (page) => FileChooser.next(page))) {
            // Nor is a handler registered that nothing would ask
            yield* refused(
              "fileChooser",
              (page) => FileChooser.handle(page, (chooser) => chooser.cancel)
            )
            return
          }
          const { url } = yield* fixture(() => chooser)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const choosers = yield* FileChooser.next(page)
            const handler = yield* FileChooser.handle(page, FileChooser.choose(FileInput.local(import.meta.filename)))
            yield* page.getByRole("button", { name: "Upload" }).click()
            assert.deepStrictEqual(yield* choosers, { _tag: "Single" })
            yield* page.getByText("modules.ts").pipe(Expect.toBeVisible)
            assert.strictEqual(yield* handler.handled, 1)
            assert.strictEqual((yield* FileChooser.history(page, { multiple: false })).entries.length, 1)
          }))
        }), timeout)

      it.effect("cancels a chooser no handler answers, and reports it", () =>
        Effect.gen(function*() {
          if (yield* refused("fileChooser", (page) => FileChooser.next(page))) return
          const { url } = yield* fixture(() => chooser)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const decisions = yield* AutoResolution.next(page, { subject: "FileChooser" })
            yield* page.getByRole("button", { name: "Upload" }).click()
            const decided = yield* decisions
            assert.deepStrictEqual(decided.subject, { _tag: "FileChooser" })
            assert.strictEqual(decided.decision, "cancel")
            assert.deepStrictEqual(decided.policy, { _tag: "Default" })
            yield* page.getByText("nothing yet").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("cancels a chooser for one file given two", () =>
        Effect.gen(function*() {
          if (yield* refused("fileChooser", (page) => FileChooser.next(page))) return
          const { url } = yield* fixture(() => chooser)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const both = [FileInput.local(import.meta.filename), FileInput.local(import.meta.filename)]
            const handler = yield* FileChooser.handle(page, FileChooser.choose(both))
            const decisions = yield* AutoResolution.next(page)
            yield* page.getByRole("button", { name: "Upload" }).click()
            assert.strictEqual((yield* decisions).decision, "cancel")
            assert.strictEqual(yield* handler.handled, 0)
          }))
        }), timeout)

      // ── ConsoleMessage, UncaughtException ──

      it.effect(
        "reports console messages to their page and context, from the page and its worker",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              `<script>function log() { console.error("bad thing") }</script>${button("Log", "log()")}${
                button("Work", "window.worker = new Worker('/worker.js')")
              }`
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const errors = yield* ConsoleMessage.next(page, { level: "error", text: /bad/ })
              const fromWorker = yield* ConsoleMessage.next(page.context, { text: "from the worker" })
              yield* page.getByText("Log").click()
              const message = yield* errors
              assert.strictEqual(message.text, "bad thing")
              assert.deepStrictEqual(message.origin, { _tag: "Page", page: page.id })
              const location = Option.getOrThrow(message.location)
              assert.strictEqual(location.line, 1, "1-based, on the page's one line")
              assert.isAbove(location.column, 1)
              yield* page.getByText("Work").click()
              const worker = yield* fromWorker
              // Firefox attributes a dedicated worker's console to its page (its `console` capability)
              assert.strictEqual(worker.origin._tag, name === "Firefox" ? "Page" : "Worker")
              const history = yield* ConsoleMessage.history(page.context)
              const encoded = Schema.encodeUnknownSync(Subscription.History(ConsoleMessage.ConsoleMessage))(history)
              assert.deepStrictEqual(
                (encoded as { entries: ReadonlyArray<{ text: string }> }).entries.map((each) => each.text),
                ["bad thing", "from the worker"]
              )
            }))
          }),
        timeout
      )

      it.effect(
        "keeps ready console subscriptions across document replacement and releases their scope",
        () =>
          Effect.gen(function*() {
            const { url, origin } = yield* fixture(() => `<p>Old document</p>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const closed = yield* Effect.scoped(Effect.gen(function*() {
                const pending = yield* ConsoleMessage.next(page, { text: "never" }).pipe(
                  Deadline.within("100 millis")
                )
                const expired = yield* pending.pipe(Effect.flip)
                assert(Deadline.isTimeout(expired), String(expired))
                const owned = yield* ConsoleMessage.next(page, { text: "never either" })
                const interrupted = yield* owned.pipe(Effect.forkChild)
                yield* Fiber.interrupt(interrupted)
                return owned
              }))
              yield* Effect.scoped(Effect.gen(function*() {
                const waits = yield* Effect.forEach(
                  Array.from({ length: 20 }),
                  () => ConsoleMessage.next(page, { text: "new document ready" })
                )
                yield* page.goto(fixtureUrl(origin, `<script>console.log("new document ready")</script>`))
                const messages = yield* Effect.all(waits)
                assert.deepStrictEqual(
                  messages.map((message) => message.text),
                  Array.from({ length: 20 }, () => "new document ready")
                )
              }))
              const fresh = yield* ConsoleMessage.next(page, { text: "after release" })
              yield* page.evaluateInMainWorld(() => console.log("after release"))
              assert.strictEqual((yield* fresh).text, "after release")
              const closedResult = yield* Effect.exit(closed).pipe(Effect.timeoutOption("1 second"))
              assert(Option.isSome(closedResult), "closing the subscription scope must complete its returned wait")
              const closedExit = closedResult.value
              assert(Exit.isFailure(closedExit) && closedExit.cause.reasons.some(Cause.isInterruptReason))
            }))
          }),
        timeout
      )

      it.effect("formats a console call's text from its arguments", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            button(
              "Log",
              `console.log("%s has %d items at %f", "cart", 3.7, 1.25); console.log("%cstyled", "color: red")`
            )
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const formatted = yield* ConsoleMessage.next(page, { text: /cart/ })
            const styled = yield* ConsoleMessage.next(page, { text: /styled/ })
            yield* page.getByText("Log").click()
            // The Console Standard's formatter: the library applies it for CDP and WebKit; Firefox applies its own,
            // which writes %f as printf does (QUIRKS.md, Q33)
            assert.strictEqual(
              (yield* formatted).text,
              `cart has 3 items at ${name === "Firefox" ? "1.250000" : "1.25"}`
            )
            assert.strictEqual((yield* styled).text, "styled")
          }))
        }), timeout)

      it.effect(
        "reports uncaught exceptions by message, with their kind where the backend knows it",
        () =>
          Effect.gen(function*() {
            const { url } = yield* fixture(() =>
              button("Throw", "setTimeout(() => { throw new TypeError('thrown here') })") +
              button("Reject", "Promise.reject(new Error('rejected here'))") +
              button("Raw", "setTimeout(() => { throw 'a string' })")
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const thrown = yield* UncaughtException.next(page, { message: "thrown here" })
              const rejected = yield* UncaughtException.next(page, { message: /rejected/ })
              const raw = yield* UncaughtException.next(page, { message: "a string" })
              yield* page.getByText("Throw").click()
              yield* page.getByText("Reject").click()
              yield* page.getByText("Raw").click()
              const error = yield* thrown
              assert.strictEqual(error.name, "TypeError")
              assert.strictEqual(error.kind, name === "Firefox" ? "unknown" : "thrown")
              const rejection = yield* rejected
              assert.strictEqual(rejection.kind, name === "Firefox" ? "unknown" : "unhandledRejection")
              const value = yield* raw
              assert.deepStrictEqual([value.name, value.message], ["Error", "a string"])
              const history = yield* UncaughtException.history(page)
              Schema.encodeUnknownSync(Subscription.History(UncaughtException.UncaughtException))(history)
              assert.strictEqual(history.entries.length, 3)
            }))
          }),
        timeout
      )

      // ── PageNavigation ──

      it.effect("preserves the fragment in page.url after cross-document navigation", () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const requested = `${origin}/json?token=url-test#details`
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(requested)
            const href = yield* page.evaluateInMainWorld(() => location.href)
            assert.strictEqual(href, requested)
            assert.strictEqual(yield* page.url, href)
          }))
        }), timeout)

      it.effect("preserves page.url through same-document fragment changes and removal", () =>
        Effect.gen(function*() {
          if (!(yield* supports("navigation.sameDocument"))) return
          const { origin } = yield* site
          const base = `${origin}/json?token=url-test`
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(`${base}#initial`)
            for (const requested of [`${base}#changed`, base]) {
              const next = yield* PageNavigation.next(page)
              if (requested === base) {
                yield* page.evaluateInMainWorld(() => history.pushState(null, "", location.pathname + location.search))
              } else {
                yield* page.evaluateInMainWorld(() => {
                  location.hash = "changed"
                })
              }
              assert.strictEqual((yield* next)._tag, "SameDocument")
              const href = yield* page.evaluateInMainWorld(() => location.href)
              assert.strictEqual(href, requested)
              assert.strictEqual(yield* page.url, href)
            }
          }))
        }), timeout)

      it.effect("runs call site 2: waits for the navigation a click causes", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => `<a href="/orders">Orders</a>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const orders = yield* PageNavigation.next(page, { url: `${origin}/orders` })
            yield* page.getByRole("link", { name: "Orders" }).click()
            const navigation = yield* orders
            assert(navigation._tag === "Committed", navigation._tag)
            assert.strictEqual(navigation.url, `${origin}/orders`)
            assert.strictEqual(Option.getOrThrow(navigation.response).status, 200)
          }))
        }), timeout)

      it.effect(
        "reports a same-document navigation with its URL, and encodes the history",
        () =>
          Effect.gen(function*() {
            // A backend that reports none says so (QUIRKS.md, Q200)
            if (!(yield* supports("navigation.sameDocument"))) return
            const { url } = yield* fixture(() => `<a href="#details">Details</a><p id="details">Details here</p>`)
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const fragment = yield* PageNavigation.next(page, { url: `${url}#details` })
              yield* page.getByRole("link", { name: "Details" }).click()
              const navigation = yield* fragment
              assert(navigation._tag === "SameDocument", navigation._tag)
              assert.strictEqual(navigation.via, "fragment")
              const history = yield* PageNavigation.history(page)
              assert.deepStrictEqual(history.entries.map((each) => each._tag), ["Committed", "SameDocument"])
              const encoded = Schema.encodeUnknownSync(Subscription.History(PageNavigation.PageNavigation))(history)
              assert.strictEqual(
                (encoded as { entries: ReadonlyArray<{ url: string }> }).entries[1]!.url,
                `${url}#details`
              )
            }))
          }),
        timeout
      )

      it.effect("fails a navigation's wait with the reason goto gives", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* navigationFailure
          const { url } = yield* fixture(() => `<a href="${origin}/nowhere">Broken</a>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const broken = yield* PageNavigation.next(page, { url: `${origin}/*` })
            yield* page.getByRole("link", { name: "Broken" }).click()
            const error = yield* broken.pipe(Effect.flip)
            assert(Page.isPageError(error), String(error))
            assert.strictEqual(error.reason._tag, "NavigationFailed")
            assert.strictEqual(error.operation, "PageNavigation.next")
          }))
        })), timeout)

      it.effect("reports a frame's own navigations when asked, each naming its frame", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => `<iframe id="inner" src="/child"></iframe>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.frame(page.locator("#inner")).getByText("child of").pipe(Expect.toBeVisible)
            const inFrame = yield* PageNavigation.next(page, { url: `${origin}/child?moved`, frames: "all" })
            yield* page.evaluateInMainWorld(() => {
              ;(document.getElementById("inner") as HTMLIFrameElement).contentWindow!.location.href = "/child?moved"
            })
            const navigation = yield* inFrame
            assert(navigation._tag === "Committed", navigation._tag)
            assert.notStrictEqual(navigation.frame, page.id)
            assert.strictEqual(Option.getOrThrow(navigation.response).status, 200)
            // The page's own are the default, and name the page
            const own = yield* PageNavigation.history(page)
            assert.deepStrictEqual(own.entries.map((each) => [each.url, each.frame === page.id]), [[url, true]])
            const all = yield* PageNavigation.history(page, { frames: "all" })
            assert.includeDeepMembers(all.entries.map((each) => each.url), [url, `${origin}/child?moved`])
            assert.isTrue(all.entries.some((each) => each.frame === navigation.frame))
          }))
        }), timeout)

      it.effect("waits for the document a navigation committed to load", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture((origin) =>
            `<a href="${fixtureUrl(origin, `<img src="/slow-image"><p>Loaded</p>`)}">Slow</a>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const loaded = yield* PageNavigation.next(page, { url: `${origin}/fixture*`, waitUntil: "load" })
            yield* page.getByRole("link", { name: "Slow" }).click()
            yield* loaded
            const status = yield* page.status
            assert(status._tag === "Open")
            assert.strictEqual(status.document.readiness, "complete")
          }))
        }), timeout)

      // ── NetworkRequest, NetworkResponse ──

      it.effect("runs call site 8: streams a page's fetches, its frames' included", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture((origin) =>
            `<iframe src="${fixtureUrl(origin, "<p>frame</p>")}"></iframe>${button("Fetch", "fetch('/json')")}${
              button("Frame", "frames[0].fetch('/json?from=frame')")
            }`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url, { waitUntil: "load" })
            const requests = yield* NetworkRequest.stream(page, { resourceType: "fetch" })
            const collected = yield* requests.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
            const one = yield* NetworkRequest.next(page, { url: `${origin}/json` })
            yield* page.getByText("Fetch").click()
            yield* page.getByText("Frame").click()
            const [first, second] = Array.from(yield* Fiber.join(collected))
            assert.strictEqual(first!.url, `${origin}/json`)
            assert.strictEqual(first!.method, "GET")
            assert.strictEqual(second!.url, `${origin}/json?from=frame`)
            assert(second!.initiator._tag === "Document")
            assert.notStrictEqual(second!.initiator.navigable, page.id, "the frame's document made it")
            assert.strictEqual((yield* one).hop, first!.hop)
            const replay = NetworkRequest.toHttpClientRequest(first!)
            assert.deepStrictEqual([replay.method, replay.url], ["GET", `${origin}/json`])
          }))
        }), timeout)

      it.effect("runs call sites 4 and 9: a response body, decoded and filtered", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => button("Add to cart", "fetch('/cart', { method: 'POST' })"))
          const Cart = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const added = yield* NetworkResponse.next(
              page,
              { url: `${origin}/cart`, method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
              (response) => Effect.succeed(response.body.items.length > 0)
            )
            yield* page.getByRole("button", { name: "Add to cart" }).click()
            const response = yield* added
            assert.deepStrictEqual(response.body.items, [{ id: "tea" }])
            assert.strictEqual(response.status, 200)
            assert.deepStrictEqual(yield* response.json, { items: [{ id: "tea" }] })
            assert.strictEqual((yield* NetworkResponse.history(page, { url: `${origin}/cart` })).entries.length, 1)
            assert.strictEqual(
              (yield* NetworkResponse.history(page, { method: "GET", url: `${origin}/cart` })).entries.length,
              0
            )
          }))
        }), timeout)

      it.effect(
        "keeps body decoding pending after reader interruption until its scope closes",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin, url } = yield* fixture(() => "<p>body cancellation</p>")
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const decoding = yield* Deferred.make<void>()
            const interrupted = yield* Deferred.make<void>()
            const collection = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
            const pending = yield* NetworkResponse.next(page, {
              url: `${origin}/cart`,
              body: (message) =>
                message.arrayBuffer.pipe(
                  Effect.tap(() => Deferred.succeed(decoding, undefined)),
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
                )
            }).pipe(Scope.provide(collection))
            const fiber = yield* pending.pipe(Effect.forkChild)
            yield* page.evaluateInMainWorld(() => {
              void fetch("/cart", { method: "POST" })
            })
            yield* Deferred.await(decoding).pipe(Deadline.within("5 seconds"))
            yield* Fiber.interrupt(fiber)
            assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)))
            assert.isFalse(yield* Deferred.isDone(interrupted))
            yield* Scope.close(collection, Exit.void)
            assert.isTrue(yield* Deferred.isDone(interrupted))
          })),
        timeout
      )

      it.effect(
        "reads scoped redirect neighbors across repeated URLs without tracking other contexts",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* fixture(() => "")
            const page = yield* Browser.newPage()
            const other = yield* Browser.newPage()
            const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
            const links = yield* NetworkRequest.redirects(page).pipe(Scope.provide(scope))
            const firstSent = yield* NetworkRequest.next(page, { url: `${origin}/redirect-repeat` })
            const completed = yield* NetworkResponse.next(page, {
              url: `${origin}/redirect-repeat`,
              status: 200,
              body: (message) => message.text
            })
            yield* page.goto(`${origin}/redirect-repeat`)
            yield* completed
            const first = yield* firstSent
            const second = Option.getOrThrow(yield* links.to(first))
            const third = Option.getOrThrow(yield* links.to(second))
            assert.strictEqual(first.url, third.url)
            assert.notStrictEqual(first.hop, third.hop)
            assert.strictEqual(Option.getOrThrow(yield* links.from(third)), second)
            assert.strictEqual(Option.getOrThrow(yield* links.from(second)), first)
            assert.isTrue(Option.isNone(yield* links.from(first)))
            assert.isTrue(Option.isNone(yield* links.to(third)))
            const foreign = yield* NetworkRequest.redirects(other)
            assert.strictEqual((yield* Effect.flip(foreign.from(first))).reason.why, "unavailable")
            yield* other.goto(`${origin}/redirect-repeat`)
            const otherRequests = (yield* NetworkRequest.history(other, { url: `${origin}/redirect-repeat` })).entries
            assert.strictEqual(otherRequests.length, 3)
            assert.strictEqual((yield* Effect.flip(links.from(otherRequests[0]!))).reason.why, "unavailable")
            const streaming = yield* NetworkRequest.next(page, { url: `${origin}/events` })
            yield* page.evaluateInMainWorld(() => {
              void fetch("/events")
            })
            assert.strictEqual((yield* Effect.flip(links.to(yield* streaming))).reason.why, "pending")
            yield* Scope.close(scope, Exit.void)
            assert.strictEqual((yield* Effect.flip(links.from(first))).reason.why, "released")
            const live = yield* NetworkRequest.redirects(page)
            yield* page.close()
            assert.strictEqual((yield* Effect.flip(live.from(first))).reason.why, "targetClosed")
          })),
        timeout
      )

      it.effect(
        "ends the redirect chain at a redirect status the browser doesn't follow",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const { origin } = yield* fixture(() => "")
            const page = yield* Browser.newPage()
            const links = yield* NetworkRequest.redirects(page)
            // Its body, which has no location to follow, arrives only once the hop has ended
            const completed = yield* NetworkResponse.next(page, {
              url: `${origin}/redirect-unfollowed`,
              status: 302,
              body: (message) => message.text
            })
            yield* page.goto(`${origin}/redirect-unfollowed`)
            assert.strictEqual((yield* completed).body, "<title>unfollowed</title>")
            const [request] = (yield* NetworkRequest.history(page, { url: `${origin}/redirect-unfollowed` })).entries
            assert.isTrue(Option.isNone(yield* links.from(request!)))
            assert.isTrue(Option.isNone(yield* links.to(request!)))
          })),
        timeout
      )

      it.effect("says a redirect hop has no body, and filters responses by status", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => button("Go", "fetch('/redirect')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const hop = yield* NetworkResponse.next(page, {
              url: `${origin}/redirect`,
              body: (message) => message.text
            })
            const landed = yield* NetworkResponse.next(page, { url: `${origin}/landed`, status: 200 })
            yield* page.getByText("Go").click()
            const error = yield* hop.pipe(Effect.flip)
            assert(NetworkResponse.isResponseError(error), String(error))
            assert(error.reason._tag === "BodyUnavailable")
            assert.strictEqual(error.reason.why, "redirect")
            assert.strictEqual((yield* landed).status, 200)
          }))
        }), timeout)

      it.effect("says at once that an event stream's body never finishes", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => button("Listen", "window.source = new EventSource('/events')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const stream = yield* NetworkResponse.next(page, {
              url: `${origin}/events`,
              body: (message) => message.text
            })
            yield* page.getByText("Listen").click()
            // Well within the deadline, which a wait for the body's end would have used up (QUIRKS.md, Q40)
            const error = yield* stream.pipe(Effect.flip, Deadline.within("5 seconds"))
            assert(NetworkResponse.isResponseError(error), String(error))
            assert(error.reason._tag === "BodyUnavailable")
            assert.strictEqual(error.reason.why, "streaming")
          }))
        }), timeout)

      it.effect("fails a read whose filter doesn't compile, as a subscription would", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => "<p>nothing</p>")
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const reads: ReadonlyArray<Effect.Effect<unknown, Subscription.SubscriptionError>> = [
              NetworkRequest.history(page, { url: "https://example.com/:id(" }),
              PageNavigation.history(page, { url: "https://example.com/:id(" })
            ]
            for (const read of reads) {
              const error = yield* Effect.flip(read)
              assert(Subscription.isSubscriptionError(error), String(error))
              assert.strictEqual(error.reason._tag, "InvalidInput")
            }
          }))
        }), timeout)

      // ── BrowserWorker ──

      it.effect(
        "hands out a page's worker, evaluates in it where the backend can, and sees it end",
        () =>
          Effect.gen(function*() {
            const { origin, url } = yield* fixture(() =>
              button("Start", "window.worker = new Worker('/worker.js')") + button("Stop", "window.worker.terminate()")
            )
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(url)
              const started = yield* BrowserWorker.next(page)
              yield* page.getByText("Start").click()
              const worker = yield* started
              assert.deepStrictEqual([worker.kind, worker.url], ["dedicated", `${origin}/worker.js`])
              assert.isTrue((yield* page.workers).includes(worker))
              assert.isTrue((yield* page.context.workers).includes(worker))
              const evaluated = worker.evaluate((n: number) => [self.location.pathname, n * 2, new Map([["a", 1]])], 21)
              if (name === "Firefox") {
                const error = yield* Effect.flip(evaluated)
                assert(BrowserWorker.isBrowserWorkerError(error), String(error))
                assert.strictEqual(error.reason._tag, "Unsupported")
              } else {
                assert.deepStrictEqual(yield* evaluated, ["/worker.js", 42, new Map([["a", 1]])])
              }
              yield* page.getByText("Stop").click()
              assert.strictEqual((yield* worker.closed)._tag, "RealmDestroyed")
              assert.deepStrictEqual(yield* page.workers, [])
            }))
          }),
        timeout
      )

      it.effect("finds a context's service worker where the backend says whose it is", () =>
        Effect.gen(function*() {
          const { origin, url } = yield* fixture(() => button("Register", "navigator.serviceWorker.register('/sw.js')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const invalid = yield* BrowserWorker.next(page, { kind: "service" }).pipe(Effect.asVoid, Effect.flip)
            assert.strictEqual(invalid.reason._tag, "InvalidInput", "a page's workers are dedicated")
            if (name !== "Chromium") {
              const error = yield* BrowserWorker.next(page.context, { kind: "service" }).pipe(
                Effect.asVoid,
                Effect.flip
              )
              assert(error.reason._tag === "Unsupported", String(error))
              assert.strictEqual(error.reason.capability, "workers.service")
              return
            }
            const registered = yield* BrowserWorker.next(page.context, { kind: "service" })
            yield* page.getByText("Register").click()
            const worker = yield* registered
            assert.deepStrictEqual([worker.kind, worker.url], ["service", `${origin}/sw.js`])
          }))
        }), timeout)

      // ── NetworkConnection ──

      it.effect("reports a WebSocket, its frames and its close, where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() =>
            button(
              "Open",
              "window.socket = new WebSocket('ws://' + location.host + '/ws'); socket.onopen = () => document.getElementById('state').textContent = 'connected'"
            ) + button("Send", "socket.send('ping')") + button("Close", "socket.close()") +
            `<p id="state">waiting</p>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            if (name === "Firefox") {
              const reads: ReadonlyArray<Effect.Effect<unknown, Subscription.SubscriptionError, Scope.Scope>> = [
                NetworkConnection.next(page).pipe(Effect.asVoid),
                NetworkConnection.history(page)
              ]
              for (const read of reads) {
                const error = yield* Effect.flip(read)
                assert(error.reason._tag === "Unsupported", String(error))
                assert.strictEqual(error.reason.capability, "networkConnections")
              }
              return
            }
            const opened = yield* NetworkConnection.next(page, { kind: "webSocket" })
            yield* page.getByText("Open").click()
            const socket = yield* opened
            assert.strictEqual(socket.kind, "webSocket")
            assert.match(socket.url, /^ws:\/\/127\.0\.0\.1:\d+\/ws$/)
            const frames = yield* socket.frames
            const collected = yield* frames.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
            yield* page.getByText("connected").pipe(Expect.toBeVisible)
            yield* page.getByText("Send").click()
            const [sent, received] = Array.from(yield* Fiber.join(collected))
            assert.deepStrictEqual([sent!.direction, sent!.payload], ["sent", { _tag: "Text", text: "ping" }])
            assert.deepStrictEqual([received!.direction, received!.payload], ["received", {
              _tag: "Text",
              text: "ping"
            }])
            yield* page.getByText("Close").click()
            assert.strictEqual((yield* socket.closed)._tag, "NetworkConnectionClosed")
          }))
        }), timeout)

      it.effect("reports an EventSource's messages where the backend can", () =>
        Effect.gen(function*() {
          const { url } = yield* fixture(() => button("Listen", "window.source = new EventSource('/events')"))
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            if (name !== "Chromium") {
              const error = yield* NetworkConnection.next(page, { kind: "eventSource" }).pipe(
                Effect.asVoid,
                Effect.flip
              )
              assert(error.reason._tag === "Unsupported", String(error))
              return
            }
            const opened = yield* NetworkConnection.next(page, { kind: "eventSource" })
            yield* page.getByText("Listen").click()
            const source = yield* opened
            const frames = yield* source.frames
            // Chromium reports the connection with its first message, so the frames from now on start at the second
            const [frame] = Array.from(yield* frames.pipe(Stream.take(1), Stream.runCollect))
            assert.deepStrictEqual(frame!.payload, { _tag: "Text", text: "two" })
          }))
        }), timeout)
    })
  })
