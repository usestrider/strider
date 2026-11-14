/**
 * Playwright's `tests/library/browsercontext-har.spec.ts`: replaying a HAR file with `routeFromHAR`, with its
 * `notFound`, `url` filter, and unrouting, and the round trips through a HAR that Strider records.
 *
 * What the port changes:
 * - `context.routeFromHAR(file, options)` and `page.routeFromHAR(file, options)` are `Route.fromHar(file, …)` given to
 *   `context.route` or `page.route` with the URL pattern. Strider's pattern is a glob or a URLPattern, not a regular
 *   expression; the filters that are a regular expression in the original and only select URLs (HA-080 to HA-083) are
 *   the glob `**theverge**`, which selects the same URLs.
 * - `notFound: "fallback"` is `notFound: "fallthrough"`, and the default `"abort"` is the default.
 * - `Route.fromHar` reads its file as it's made, so it needs a file system, which the port provides with
 *   `NodeServices`. A bad file fails there, as Strider's handler isn't made (HA-072).
 * - Playwright's `route.request().url()` assertions inside a handler are recorded and asserted by the test body.
 * - `page.goto` and `page.reload` resolve at commit, so the port asks for `load` where the original's default is it.
 *   `page.url.waitFor` replaces `waitForURL`, and `PageNavigation.next` subscribed before the click replaces
 *   `waitForNavigation`. A navigation's response is its `url` as the hop has it.
 * - `page.content()` is the document's `outerHTML`, read in the main world, for a document without a doctype.
 * - `contextFactory()` is a context from `Browser.newContext()` in the test's scope, and `page.close()` the original's
 *   `page.close()`.
 * - Playwright's `page.evaluate(fn, arg)` is `page.evaluateInMainWorld(fn, ...args)`. `fetch` POSTs run in the main
 *   world, and `/echo` echoes the request body the fixture server received, as Playwright's `req.postBody` does.
 * - The recordings are `Har.record(context, options)` scoped to the test, and `exportHar(path, options)` writes them.
 *   Playwright's `recordHar` with a `.zip` path is `content: "attach"`, which Strider writes as a zip (HA-086, HA-088,
 *   HA-089), so the port reads the HAR inside it with `effect/encoding/Zip`, and replays the zip.
 * - HA-089's `route.fallback` with a URL and a body change is `Route.continueWith` over the request's changes, with the
 *   body read through `requestBody`. A fallback passes to the next route, but no route is below this one, so the
 *   request goes to the network either way.
 * - HA-072 keeps the original's expectation: Playwright ignores a HAR it can't read and continues, while Strider fails
 *   reading it, as the handler is made. The test fails on Chromium; the report names the first line.
 * - HA-089 fails on Strider's behavior: `Har.record` records the request the page made (`/echo_redir`, bodies `1` and
 *   `2`), not the request after the route's changes (`/echo`, bodies `11` and `12`) that Playwright records.
 * - HA-092 and HA-100 fail on Strider's behavior. Replay matches a body by its bytes, so a multipart form's new boundary
 *   matches nothing and the request is aborted, where Playwright ignores the boundary. An entry that failed without a
 *   response is replayed as a failure (`cancelled`), where Playwright stalls the request.
 * - HA-091 to HA-097 and HA-100 are `routeFromHAR` with `update: true`, which records while it routes. Strider records
 *   with `Har.record` and replays with `Route.fromHar`, so they are ported as that recording and replay.
 *   Cookie values are included in the export (`include: ["cookies"]`), which an export redacts otherwise.
 * - HA-114's malformed zip is written with `Zip.file("../x.har")`, and the port checks that Strider rejects the archive
 *   with a `Har.HarError`. Strider's message doesn't name the traversal (the zip has no `har.har`, which is what it
 *   reads), so the original's message check isn't ported.
 * - HA-081 and HA-082 (`goBack` and `goForward`) read the navigation's `url` rather than assuming a response: Strider
 *   keeps the back/forward cache, so a history entry is restored without a request, where Playwright's Chromium has it
 *   off and always loads through the HAR. A loaded entry's response is checked too. A restore passes without exercising
 *   the HAR; `Restored` shows when it happened.
 * - HA-085 reads the archive's HAR with `effect/encoding/Zip` and writes the uppercase archive with it, and
 *   `unrouteAll({ behavior: "wait" })` is the registration's `remove`.
 * - HA-098 and HA-099 remove the route by its registration, which is `unrouteAll({ behavior: "wait" })` here.
 * - Each test's fixture page and context are fresh; a test that makes its own contexts uses `page: false`.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert } from "@effect/vitest"
import { Browser, Expect, Har, Page, PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Fiber from "effect/Fiber"
import { HttpServerResponse } from "effect/http"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import type * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import { assetPath, failureOf } from "../../harness/playwright.ts"
import type * as Server from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

type Committed = Extract<PageNavigation.PageNavigation, { readonly _tag: "Committed" }>

/** The navigation a `goto` committed, which the original's `goto` resolves to. */
const committedOf = (navigation: PageNavigation.PageNavigation): Committed => {
  assert(navigation._tag === "Committed", `the navigation is ${navigation._tag}, not Committed`)
  return navigation
}

/** The status of the response a committed navigation carries, which is the original's `response.ok()` for it. */
const statusOf = (navigation: PageNavigation.PageNavigation): number => {
  const committed = committedOf(navigation)
  assert(Option.isSome(committed.response), "the navigation carried no response")
  return committed.response.value.status
}

/** The URL of the response a committed navigation carries, which is the original's `response.request().url()`. */
const hopUrlOf = (navigation: PageNavigation.PageNavigation): string => {
  const committed = committedOf(navigation)
  assert(Option.isSome(committed.response), "the navigation carried no response")
  return committed.response.value.url
}

/**
 * Where a back or forward navigation went. Playwright launches Chromium with its back/forward cache off, so its
 * `goBack` always loads the page again, through the HAR, and resolves to that response. Strider keeps the cache on, so
 * the entry is either restored from it (`Restored`, which no request serves) or loaded again (`Committed`, with the
 * response the HAR served). Either way the navigation's `url` is where the history entry went, and a loaded one's
 * response must be the redirect's destination too.
 */
const historyUrlOf = (navigation: PageNavigation.PageNavigation): string => {
  assert(
    navigation._tag === "Committed" || navigation._tag === "Restored",
    `the navigation is ${navigation._tag}, not Committed or Restored`
  )
  if (navigation._tag === "Committed") {
    assert.strictEqual(hopUrlOf(navigation), navigation.url)
  }
  return navigation.url
}

/** A scratch directory for one test's files, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-har-replay-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/**
 * Strider's `Route.fromHar` for a file, given the file system it reads with. The handler is made here, as the
 * original's `routeFromHAR` reads its file.
 */
const replay = (file: string, options?: Route.FromHarOptions | undefined) =>
  Route.fromHar(file, options).pipe(Effect.provide(NodeServices.layer))

/** Records a context or a page, as Playwright's `recordHar` does, waiting for the requests in flight. */
const recordContext = (context: Parameters<typeof Har.record>[0], options: Har.Options = { content: "embed" }) =>
  Har.record(context, { inFlightAtStop: "wait", ...options })

/** Echoes the request body, as the original's `/echo` route does with its `postBody`. */
const echo = (_server: Server.ServerShape) => (request: Server.RouteRequest, response: http.ServerResponse) => {
  void request.postBody.then((body) => response.end(body))
}

/** The page's `fetch` of `path` with `body`, as the response's text, in the main world. */
const send = (page: Page.Page, requested: string, body: string) =>
  page.evaluateInMainWorld(
    async (requested, body) => {
      const response = await fetch(requested, { method: "POST", body })
      return await response.text()
    },
    requested,
    body
  )

/** The entries of a zip, by their path, with their bytes. */
const entriesOf = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.mkUint8Array(entry.body).pipe(Effect.map((bytes) => [entry.header.path, bytes] as const))
    ),
    Stream.runCollect,
    Effect.map((entries) => new Map(entries))
  )

/** The `har.har` a zip holds, as text. */
const harOf = (file: string) =>
  entriesOf(file).pipe(Effect.map((entries) => new TextDecoder().decode(entries.get("har.har"))))

/** The original's regular expression filter for theverge URLs, as the glob that selects the same URLs. */
const theverge = "**theverge**"

/** The HAR of the redirects the theverge tests replay. */
const redirectHar = () => assetPath("playwright", "har-redirect.har")

/** The HAR of the fulfilled and redirected requests the first tests replay. */
const fulfillHar = () => assetPath("playwright", "har-fulfill.har")

/** The background of the fixture's `one-style.css`, which the tests check on the page. */
const pinkBody = "rgb(255, 192, 203)"

/**
 * Replays `file` in a context of its own, aborting what it holds no entry for, and checks that the stylesheet page the
 * recording holds comes back from it: its content and its pink background.
 */
const expectOneStyleReplayed = Effect.fnUntraced(
  function*(file: string, server: Server.ServerShape, on: "context" | "page") {
    const context = yield* Browser.newContext()
    const page = yield* context.newPage
    const handler = yield* replay(file, { notFound: "abort" })
    if (on === "context") yield* context.route("**", handler)
    else yield* page.route("**", handler)
    yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
    assert.isTrue((yield* page.evaluateInMainWorld(() => document.documentElement.outerHTML)).includes("hello, world!"))
    yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))
  }
)

/** The `document.cookie` of a page, in the main world. */
const cookieOf = (page: Page.Page) => page.evaluateInMainWorld(() => document.cookie)

upstream(import.meta.filename, {}, (test) => {
  test("HA-068", ({ page }) =>
    Effect.gen(function*() {
      yield* page.context.route("**", yield* replay(fulfillHar()))
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      // The HAR's redirect for the script is followed automatically.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      // The HAR's POST for the stylesheet isn't used: its GET is.
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgb(255, 0, 0)"))
    }))

  test("HA-069", ({ page }) =>
    Effect.gen(function*() {
      yield* page.route("**", yield* replay(fulfillHar()))
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgb(255, 0, 0)"))
    }))

  test("HA-070", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**", yield* replay(fulfillHar(), { notFound: "fallthrough" }))
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))
    }))

  test("HA-071", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route("**", yield* replay(fulfillHar()))
      const error = yield* failureOf(page.goto(server.EMPTY_PAGE), "the navigation")
      // Strider's typed PageError, which is more specific than the original's Error.
      assert.isTrue(Page.isPageError(error))
    }))

  test("HA-072", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const file = path.join(directory, "test.har")
      fs.writeFileSync(file, JSON.stringify({ log: {} }), "utf-8")
      yield* page.context.route("**", yield* replay(file, { notFound: "fallthrough" }))
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))
    }))

  test("HA-073", ({ page }) =>
    Effect.gen(function*() {
      const seen: Array<string> = []
      yield* page.context.route("**/*.js", yield* replay(fulfillHar(), { notFound: "fallthrough" }))
      yield* page.context.route("http://no.playwright/", ({ request }) => {
        seen.push(request.url)
        return Route.fulfill(HttpServerResponse.html("<script src=\"./script.js\"></script><div>hello</div>"))
      })
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      assert.deepStrictEqual(seen, ["http://no.playwright/"])
      // The HAR's redirect for the script is followed automatically.
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgba(0, 0, 0, 0)"))
    }))

  test("HA-074", ({ page }) =>
    Effect.gen(function*() {
      const seen: Array<string> = []
      yield* page.context.route("**/*.js", yield* replay(fulfillHar()))
      yield* page.context.route("http://no.playwright/", ({ request }) => {
        seen.push(request.url)
        return Route.fulfill(HttpServerResponse.html("<script src=\"./script.js\"></script><div>hello</div>"))
      })
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      assert.deepStrictEqual(seen, ["http://no.playwright/"])
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgba(0, 0, 0, 0)"))
    }))

  test("HA-075", ({ page }) =>
    Effect.gen(function*() {
      const seen: Array<string> = []
      yield* page.route("**/*.js", yield* replay(fulfillHar()))
      yield* page.context.route("http://no.playwright/", ({ request }) => {
        seen.push(request.url)
        return Route.fulfill(HttpServerResponse.html("<script src=\"./script.js\"></script><div>hello</div>"))
      })
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      assert.deepStrictEqual(seen, ["http://no.playwright/"])
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgba(0, 0, 0, 0)"))
    }))

  test("HA-078", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      yield* page.route("**", yield* replay(fulfillHar()))
      yield* page.goto("http://no.playwright/", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as { value?: unknown }).value), "foo")
      yield* page.locator("body").pipe(Expect.toHaveCSS("background-color", "rgb(255, 0, 0)"))
      yield* page.close()
    })))

  test("HA-079", ({ page }) =>
    Effect.gen(function*() {
      yield* page.context.route("**", yield* replay(redirectHar()))
      const navigation = yield* page.goto("https://theverge.com/", { waitUntil: "load" })
      yield* page.url.waitFor((url) => url === "https://www.theverge.com/")
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      assert.strictEqual(hopUrlOf(navigation), "https://www.theverge.com/")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), "https://www.theverge.com/")
    }))

  test("HA-080", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route(theverge, yield* replay(redirectHar()))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<a href="https://theverge.com/">click me</a>`)
      const navigated = yield* PageNavigation.next(page, { waitUntil: "load" })
      yield* page.getByText("click me").click()
      const navigation = yield* navigated
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      assert.strictEqual(hopUrlOf(navigation), "https://www.theverge.com/")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), "https://www.theverge.com/")
    }))

  test("HA-081", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route(theverge, yield* replay(redirectHar()))
      yield* page.goto("https://theverge.com/", { waitUntil: "load" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.pipe(Expect.toHaveURL(server.EMPTY_PAGE))
      const back = yield* page.back()
      assert(Option.isSome(back), "there is no entry to go back to")
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      assert.strictEqual(historyUrlOf(back.value), "https://www.theverge.com/")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), "https://www.theverge.com/")
    }))

  test("HA-082", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.context.route(theverge, yield* replay(redirectHar()))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.pipe(Expect.toHaveURL(server.EMPTY_PAGE))
      yield* page.goto("https://theverge.com/", { waitUntil: "load" })
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      const back = yield* page.back()
      assert(Option.isSome(back), "there is no entry to go back to")
      yield* page.pipe(Expect.toHaveURL(server.EMPTY_PAGE))
      const forward = yield* page.forward()
      assert(Option.isSome(forward), "there is no entry to go forward to")
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      assert.strictEqual(historyUrlOf(forward.value), "https://www.theverge.com/")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), "https://www.theverge.com/")
    }))

  test("HA-083", ({ page }) =>
    Effect.gen(function*() {
      yield* page.context.route(theverge, yield* replay(redirectHar()))
      yield* page.goto("https://theverge.com/", { waitUntil: "load" })
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      const reloaded = yield* page.reload()
      yield* page.pipe(Expect.toHaveURL("https://www.theverge.com/"))
      assert.strictEqual(hopUrlOf(reloaded), "https://www.theverge.com/")
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), "https://www.theverge.com/")
    }))

  test("HA-085", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const harPath = yield* har.exportHar(path.join(directory, "har.ZIP"))
      const entries = yield* entriesOf(harPath)
      const { log } = JSON.parse(new TextDecoder().decode(entries.get("har.har")))
      assert.isString(log.entries[0].response.content._file)

      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      const registration = yield* context2.route("**", yield* replay(harPath, { notFound: "abort" }))
      yield* page2.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.isTrue(
        (yield* page2.evaluateInMainWorld(() => document.documentElement.outerHTML)).includes("hello, world!")
      )
      yield* page2.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))

      // The same files in an archive whose HAR is named `Recording.HAR`.
      const uppercaseHarPath = path.join(directory, "uppercase.har.zip")
      const archive = yield* Stream.fromIterable(
        Array.from(entries, ([name, bytes]) => Zip.file(name === "har.har" ? "Recording.HAR" : name, bytes))
      ).pipe(
        Stream.pipeThroughChannel(Zip.encode()),
        Stream.runCollect,
        Effect.map((chunks) => Buffer.concat(Array.from(chunks).flat()))
      )
      fs.writeFileSync(uppercaseHarPath, archive)

      yield* registration.remove
      yield* context2.route("**", yield* replay(uppercaseHarPath, { notFound: "abort" }))
      yield* page2.reload({ waitUntil: "load" })
      assert.isTrue(
        (yield* page2.evaluateInMainWorld(() => document.documentElement.outerHTML)).includes("hello, world!")
      )
      yield* page2.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))
    })))

  test("HA-086", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // Playwright's `recordHar` with a `.har` path and `content: "attach"`; Strider writes its attached zip there.
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const file = yield* har.exportHar(path.join(directory, "har.har"))
      // The bodies are beside the HAR in the zip, not in it.
      assert.isFalse((yield* harOf(file)).includes("background-color"))

      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file, { notFound: "abort" }))
      yield* page2.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      assert.isTrue(
        (yield* page2.evaluateInMainWorld(() => document.documentElement.outerHTML)).includes("hello, world!")
      )
      yield* page2.locator("body").pipe(Expect.toHaveCSS("background-color", pinkBody))
    })))

  test("HA-114", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // A zip whose entry climbs out of its directory.
      const archive = yield* Stream.make(Zip.file("../x.har", "{}")).pipe(
        Stream.pipeThroughChannel(Zip.encode()),
        Stream.runCollect,
        Effect.map((chunks) => Buffer.concat(Array.from(chunks).flat()))
      )
      const file = path.join(directory, "malformed.har.zip")
      fs.writeFileSync(file, archive)
      const failure = yield* failureOf(replay(file), "reading the malformed archive")
      assert.isTrue(Har.isHarError(failure))
    })))

  test("HA-089", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/echo", echo(server))
      const directory = yield* scratch
      const harPath = path.join(directory, "har.zip")
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright's `route.fallback` with a new URL and body: no route is below this one, so the request goes to the
      // network with those changes, as Strider's continue does.
      yield* page.route("**/echo_redir", (intercepted) =>
        intercepted.requestBody.pipe(Effect.flatMap((sent) => {
          const body = Option.match(sent, { onNone: () => "", onSome: (bytes) => new TextDecoder().decode(bytes) })
          return Route.continueWith((request) =>
            HttpClientRequest.bodyText(
              HttpClientRequest.setUrl(request, server.PREFIX + "/echo"),
              String(Number(body) + 10)
            )
          )
        })))
      assert.strictEqual(yield* send(page, "/echo_redir", "1"), "11")
      assert.strictEqual(yield* send(page, "/echo_redir", "2"), "12")
      const file = yield* har.exportHar(harPath, { include: ["requestBodies"] })

      yield* server.reset
      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file))
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* send(page2, "/echo", "11"), "11")
      assert.strictEqual(yield* send(page2, "/echo", "12"), "12")
    })))

  test("HA-088", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/echo", echo(server))
      const directory = yield* scratch
      const harPath = path.join(directory, "har.zip")
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* send(page, "/echo", "1"), "1")
      assert.strictEqual(yield* send(page, "/echo", "2"), "2")
      assert.strictEqual(yield* send(page, "/echo", "3"), "3")
      // The bodies are recorded only where the export includes them.
      const file = yield* har.exportHar(harPath, { include: ["requestBodies"] })

      yield* server.reset
      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file, { notFound: "abort" }))
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* send(page2, "/echo", "1"), "1")
      assert.strictEqual(yield* send(page2, "/echo", "2"), "2")
      assert.strictEqual(yield* send(page2, "/echo", "3"), "3")
      // A body the recording doesn't hold is aborted, so the request fails.
      yield* failureOf(send(page2, "/echo", "4"), "the request with a body that isn't recorded")
    })))

  // HA-091, HA-095, HA-096 and HA-097 are `routeFromHAR` with `update: true`, which records the requests it routes into
  // the HAR. Strider records with `Har.record` and replays with `Route.fromHar`, so each is a recording of the page or
  // context and a replay of it, which is the behavior they check: the recorded stylesheet page replays.
  test("HA-091", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const file = yield* har.exportHar(path.join(directory, "har.zip"))
      yield* expectOneStyleReplayed(file, server, "context")
    })))

  test("HA-095", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page, { content: "attach" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const file = yield* har.exportHar(path.join(directory, "har.zip"))
      yield* expectOneStyleReplayed(file, server, "page")
    })))

  test("HA-096", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // `updateContent: "embed"` and `updateMode: "full"`: Strider's `content: "embed"`, and `detail: "full"`, its default.
      const har = yield* recordContext(page, { content: "embed", detail: "full" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const file = yield* har.exportHar(path.join(directory, "har.zip"))
      yield* expectOneStyleReplayed(file, server, "page")
    })))

  test("HA-097", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page, { content: "attach" })
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const file = yield* har.exportHar(path.join(directory, "har.har"))
      yield* expectOneStyleReplayed(file, server, "page")
    })))

  test("HA-092", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end(`
      <form id="form" action="form.html" enctype="multipart/form-data" method="POST">
      <input id="file" type="file" multiple />
      <button type="submit">Upload</button>
      </form>`)
      })
      server.setRoute("/form.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.end("<div>done</div>")
      })
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      const received = yield* server.waitForRequest("/form.html")
      yield* page.locator("button").click()
      yield* page.locator("div").pipe(Expect.toHaveText("done"))
      assert.include((yield* received).body.toString(), "---")
      const file = yield* har.exportHar(path.join(directory, "har.zip"), { include: ["requestBodies"] })

      // The form's multipart boundary differs between the two submissions, and the replay matches them anyway.
      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file, { notFound: "abort" }))
      yield* page2.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      yield* page2.locator("button").click()
      // An aborted submission leaves the form, so the replayed response is what makes this `done`. (The original also
      // reads the request's response and failure; Strider's `Expect` reads the page they decide.)
      yield* page2.locator("div").pipe(Expect.toHaveText("done"))
    })))

  test("HA-093", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.setHeader("set-cookie", ["first=foo"])
        response.end()
      })
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* cookieOf(page), "first=foo")
      // An export redacts a cookie's value unless it includes cookies.
      const file = yield* har.exportHar(path.join(directory, "har.zip"), { include: ["cookies"] })

      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file, { notFound: "abort" }))
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* cookieOf(page2), "first=foo")
    })))

  test("HA-094", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/empty.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.setHeader("set-cookie", ["first=foo", "second=bar"])
        response.end()
      })
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const sorted = (cookie: string) => cookie.split("; ").sort().join("; ")
      assert.strictEqual(sorted(yield* cookieOf(page)), "first=foo; second=bar")
      const file = yield* har.exportHar(path.join(directory, "har.zip"), { include: ["cookies"] })

      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file, { notFound: "abort" }))
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(sorted(yield* cookieOf(page2)), "first=foo; second=bar")
    })))

  test("HA-100", ({ page, server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/x", (request) => {
        request.destroy()
      })
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requested = yield* server.waitForRequest("/x")
      const evaluated = yield* Effect.forkChild(
        page.evaluateInMainWorld((url) => fetch(url).catch(() => "cancelled"), server.PREFIX + "/x")
      )
      yield* requested
      assert.strictEqual(yield* Fiber.join(evaluated), "cancelled")
      const file = yield* har.exportHar(path.join(directory, "test.har"))

      yield* server.reset
      server.setRoute("/x", (_request, response) => {
        response.writeHead(200, { "Content-Type": "text/plain" })
        response.end("test")
      })
      const context2 = yield* Browser.newContext()
      const page2 = yield* context2.newPage
      yield* context2.route("**", yield* replay(file))
      yield* page2.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright stalls a request the HAR holds as aborted, so the page's fetch doesn't settle within the second the
      // original gives it. A fixed wait the original makes itself is kept.
      const result = yield* Effect.raceFirst(
        page2.evaluateInMainWorld((url) => fetch(url).catch(() => "cancelled"), server.PREFIX + "/x"),
        Effect.sleep("1 second").pipe(Effect.as("timeout"))
      )
      assert.strictEqual(result, "timeout")
    })))

  test("HA-098", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const registration = yield* page.route("**", yield* replay(fulfillHar(), { notFound: "abort" }))
      // The HAR holds requests for another domain, so every request is aborted.
      yield* failureOf(page.goto(server.EMPTY_PAGE), "the navigation")
      yield* registration.remove
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), server.EMPTY_PAGE)
    })))

  test("HA-099", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const registration = yield* context.route("**", yield* replay(fulfillHar(), { notFound: "abort" }))
      // The HAR holds requests for another domain, so every request is aborted.
      yield* failureOf(page.goto(server.EMPTY_PAGE), "the navigation")
      yield* registration.remove
      const navigation = yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(statusOf(navigation), 200)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => location.href), server.EMPTY_PAGE)
    })))
})
