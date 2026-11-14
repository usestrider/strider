/**
 * Playwright's `tests/library/har.spec.ts`: a HAR of a context's or page's requests, its entries and their timings,
 * bodies, cookies, and filters, and its export.
 *
 * What the port changes:
 * - A recording is `Har.record(context, options)`, scoped to the test, and `exportHar(path)` writes the HAR; the
 *   port reads the file as JSON, as the original does. Playwright's `recordHar` on a context is the context's
 *   recording. Its `getLog` closed the context first; the export flushes the bodies of the hops that ended, and an
 *   export never waits for a hop still in flight, which is `_incomplete`.
 * - Strider requires `content` for every recording, so the original's default (`embed`, or `attach` for a `.zip`
 *   path) is written out, and `content: "attach"` writes a zip read with `effect/encoding/Zip`, as the integration
 *   suite reads one.
 * - Exports redact cookie values and `Authorization` headers unless `include` names their class. The tests that
 *   check cookie values include `"cookies"`, as Playwright's do by default.
 * - `postData` is written only when the export includes `"requestBodies"`. Binary bodies are base64 with
 *   `_encoding`, where Playwright writes `text: ""` (HA-011). Playwright's `mimeType` carries its charset; Strider
 *   writes the media type (HA-010).
 * - Strider names a page by its navigable's id and writes no page title or load timings, where Playwright writes the
 *   document's title. The original's assertions on those stay as written, so they fail until Strider records them.
 * - Strider writes no `content.compression`, `headersSize`, `serverIPAddress`, `_serverPort`, or `_securityDetails`,
 *   and drops a `Max-Age` cookie attribute. The original's assertions stay as written. A nameless cookie, `token`
 *   with no `=`, is dropped from a response's cookies.
 * - Strider writes the protocol as the browser names it (`http/1.1`, `h2`), which HAR 1.2 allows, where Playwright
 *   writes `HTTP/1.1`; a redirect's `redirectURL` as the Location header says it, as HAR 1.2 asks; and header names in
 *   lower case. The port asserts Strider's. A `content.mimeType` keeps its charset, which HAR 1.2 asks for, so the
 *   original's assertions on it stay as written.
 * - HA-004 launches a second browser with a profile directory (`userDataDir`) and records its default context, which
 *   `defaultContext.control` gives for the scope, on that browser's first tab.
 * - Request and response bodies that Playwright names by the SHA-1 of their URL (HA-022, HA-025) are named by Strider
 *   per hop, so the port checks the file each entry's `_file` names, and that its body is what the page received.
 * - `_resourceType` is read from the entry. Timings follow Strider's documented values: `send` 0, `blocked`, `dns`,
 *   `connect`, and `ssl` -1, and `wait` and `receive` on the library's clock.
 * - `page.request` and `context.request` (the APIRequestContext) have no Strider counterpart; those tests are ledgered.
 * - `route.fallback` with overrides is `Route.continueWith` with a request change (HA-020, HA-035). Replaying a HAR is
 *   `Route.fromHar`, which the tests here don't use.
 * - Playwright's `page.waitForResponse` is `NetworkResponse.next`, subscribed before the action that sends the
 *   request. `page.waitForEvent("popup")` is `Popup.next`, subscribed before the click.
 * - Popups open by a click (`<a target=_blank>`), which is a user gesture, so no `withUserGesture` is needed (HA-039).
 * - Playwright's `window.builtins.setTimeout` is `window.setTimeout` in the main world (HA-006).
 * - The fixture server has no `serveFile`: a route in the port serves the vendored asset (HA-048, HA-059).
 * - HA-047's HTTP/2 server is made in the test, with a self-signed certificate from the same OpenSSL the fixture server
 *   uses. The context accepts it with `acceptInsecureCerts`, which Chromium refuses; the ledger says so.
 * - HA-019 creates its context with `acceptInsecureCerts`, which Chromium refuses; the ledger marks it there.
 * - HA-006's busy loop and HA-048's fixed wait are the original's own, ported as written.
 * - Playwright's `context.close()` writes the HAR after the bodies of the responses it has seen are read. The
 *   recordings here ask for the same with `inFlightAtStop: "wait"`; Strider's default marks a request still in flight
 *   at the export `_incomplete`. HA-056 keeps the default, as its point is that a response that never ends doesn't
 *   hang the export.
 * - Playwright never reports a request for `/favicon.ico`, and Strider records every request the browser makes, so the
 *   Chromium Strider launches adds a favicon entry to a HAR it exports some time after a page loads. The entry
 *   counts the original asserts (HA-005, HA-008, HA-028, HA-029, HA-043) therefore hold only when the export comes
 *   before the favicon request.
 * - HA-057: Playwright's `context.close()` writes the HAR and rejects when the save fails; Strider's export is the
 *   save, so the export fails with `WriteFailed`, and the check that the context still closes is made on the
 *   scope that owns it.
 * - HA-055 asserts two entries on every browser: Playwright's exception is for its own Firefox protocol, and Strider's
 *   Firefox is BiDi, where the original's own condition (`!isBidi`) is false.
 * - HA-058 makes its requests from the page, as Strider has no APIRequestContext; a 600 MB HAR needs the heap and time
 *   that the original marks `it.slow()`.
 * - HA-048 runs on every browser. The original skips headless browsers other than Firefox, because Playwright's
 *   headless Chromium and WebKit request no favicons, and headed WebKit, which has no favicon feature; the Chromium
 *   Strider launches does request them, and stock WebKit is not Playwright's. HA-024 is Playwright's deprecated
 *   `omitContent` flag.
 */
import { assert } from "@effect/vitest"
import { Browser, Expect, Har, NetworkResponse, Page, PageNavigation, Popup, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Exit from "effect/Exit"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import type * as http from "node:http"
import * as http2 from "node:http2"
import type { AddressInfo } from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { openssl } from "../../../../browser/test/integration/browsers.ts"
import { backend } from "../../harness/browsers.ts"
import { assetPath, failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

// HAR 1.2 as Strider writes it: the fields the tests read, with Strider's extensions and the fields it omits left out.
interface NameValue {
  readonly name: string
  readonly value: string
}
interface Cookie {
  readonly name: string
  readonly value: string
  readonly path?: string
  readonly domain?: string
  readonly expires?: string
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: string
}
interface Content {
  readonly size: number
  readonly mimeType: string
  readonly text?: string
  readonly encoding?: string
  readonly compression?: number
  readonly _file?: string
}
interface PostData {
  readonly mimeType: string
  readonly text?: string
  readonly params?: ReadonlyArray<NameValue>
  readonly _encoding?: string
  readonly _file?: string
}
interface Request {
  readonly method: string
  readonly url: string
  readonly httpVersion: string
  readonly cookies: ReadonlyArray<Cookie>
  readonly headers: ReadonlyArray<NameValue>
  readonly queryString: ReadonlyArray<NameValue>
  readonly postData?: PostData
  readonly headersSize: number
  readonly bodySize: number
}
interface Response {
  readonly status: number
  readonly statusText: string
  readonly httpVersion: string
  readonly cookies: ReadonlyArray<Cookie>
  readonly headers: ReadonlyArray<NameValue>
  readonly content: Content
  readonly redirectURL: string
  readonly headersSize: number
  readonly bodySize: number
  readonly _transferSize?: number
  readonly _failureText?: string
}
interface Timings {
  readonly blocked?: number
  readonly dns?: number
  readonly connect?: number
  readonly ssl?: number
  readonly send: number
  readonly wait: number
  readonly receive: number
}
interface Entry {
  readonly pageref?: string
  readonly startedDateTime: string
  readonly time: number
  readonly request: Request
  readonly response: Response
  readonly timings: Timings
  readonly _resourceType?: string
  readonly _incomplete?: boolean
  readonly serverIPAddress?: string
  readonly _serverPort?: number
  readonly _securityDetails?: Record<string, unknown>
}
interface HarPage {
  readonly id: string
  readonly title: string
  readonly startedDateTime: string
  readonly pageTimings: { readonly onContentLoad?: number; readonly onLoad?: number }
}
interface Log {
  readonly version: string
  readonly creator: { readonly name: string; readonly version: string }
  readonly browser?: { readonly name: string; readonly version: string }
  readonly pages?: ReadonlyArray<HarPage>
  readonly entries: ReadonlyArray<Entry>
}

/** The element at `index`, which the test asserts exists: a missing element fails the test where it's read. */
const nth = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index]
  if (item === undefined) throw new Error(`no element ${index} of ${items.length}`)
  return item
}

/** The version of `@usestrider/browser`, which a HAR's creator names. */
const striderVersion: string = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../browser/package.json"), "utf8")
).version

/** A scratch directory for one test's exports, removed when the test's scope closes. */
const scratch = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "compat-har-"))),
  (directory) => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true }))
)

/** The log of a HAR file, as JSON. */
const readLog = (file: string): Log => JSON.parse(fs.readFileSync(file, "utf8")).log

/** Exports a recording to `name` in the scratch directory and reads its log. */
const exportLog = Effect.fnUntraced(function*(
  recording: Har.Recording,
  directory: string,
  name = "test.har",
  options?: Har.ExportOptions
) {
  const file = yield* recording.exportHar(path.join(directory, name), options)
  return readLog(file)
})

/**
 * Records the page's context, as Playwright's `recordHar` on the context does. Playwright's `context.close()` writes
 * the HAR after the bodies of the responses it has seen are read, so the export here waits for the requests in flight
 * (`inFlightAtStop: "wait"`); Strider's default marks them `_incomplete` instead, as it does for a request whose
 * response the page has received but the recording hasn't yet.
 */
const recordContext = (context: Page.Page["context"], options: Har.Options = { content: "embed" }) =>
  Har.record(context, { inFlightAtStop: "wait", ...options })

/** Reads a zip's entries, by path, as the integration suite does. */
const unzip = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
        const all = Array.from(chunks)
        const bytes = new Uint8Array(all.reduce((size, chunk) => size + chunk.length, 0))
        let at = 0
        for (const chunk of all) {
          bytes.set(chunk, at)
          at += chunk.length
        }
        return [entry.header.path, bytes] as const
      }))
    ),
    Stream.runCollect,
    Effect.map((entries) => new Map(entries))
  )

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

/** The header with this name, compared without case, as HTTP names are. */
const header = (headers: ReadonlyArray<NameValue>, name: string) =>
  headers.find((each) => each.name.toLowerCase() === name.toLowerCase())

/** Whether a list holds an element matching `expected` by its fields. */
const hasHeader = (headers: ReadonlyArray<NameValue>, expected: NameValue) =>
  headers.some((each) => each.name === expected.name && each.value === expected.value)

/** Serves a vendored file as a route's response. */
const serveFile = (response: http.ServerResponse, file: string, contentType: string) => {
  response.writeHead(200, { "content-type": contentType }).end(fs.readFileSync(file))
}

/** Playwright's `waitForLoadState()`: the document has finished loading, its readiness `complete`. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

upstream(import.meta.filename, {}, (test) => {
  test("HA-001", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.version, "1.2")
      // Strider's creator is Strider, not Playwright, and the version is the library's, as the original's is Playwright's.
      assert.strictEqual(log.creator.name, "Strider")
      assert.isTrue(log.creator.version.includes(striderVersion), `creator.version ${log.creator.version}`)
    }))

  test("HA-002", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const browser = yield* Browser.Browser
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      // Strider names the browser by its product and version, as Browser.info reports them.
      assert.strictEqual(log.browser!.name, browser.info.product)
      assert.strictEqual(log.browser!.version, browser.info.version)
    }))

  test("HA-003", ({ page }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto("data:text/html,<title>Hello</title>", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.pages!.length, 1)
      const pageEntry = nth(log.pages!, 0)
      assert.isTrue(pageEntry.id.length > 0)
      assert.strictEqual(pageEntry.title, "Hello")
      assert.isTrue(new Date(pageEntry.startedDateTime).valueOf() > Date.now() - 3600 * 1000)
      assert.isTrue(pageEntry.pageTimings.onContentLoad! > 0)
      assert.isTrue(pageEntry.pageTimings.onLoad! > 0)
    }))

  test("HA-004", { page: false }, ({ browserName }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // A browser launched with a profile directory: Strider's `launchPersistentContext`. Its default context is the
      // persistent one, controlled for the scope.
      yield* Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.defaultContext.control
        const har = yield* recordContext(context)
        const [page] = yield* context.pages.waitFor((pages) => pages.length >= 1)
        yield* page!.goto("data:text/html,<title>Hello</title>", { waitUntil: "load" })
        const log = yield* exportLog(har, directory)
        assert.strictEqual(log.pages!.length, 1)
        const pageEntry = nth(log.pages!, 0)
        assert.isTrue(pageEntry.id.length > 0)
        assert.strictEqual(pageEntry.title, "Hello")
      }).pipe(Effect.provide(backend(browserName, { [browserName]: { userDataDir: path.join(directory, "profile") } })))
    })))

  test("HA-005", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 1)
      const entry = nth(log.entries, 0)
      assert.strictEqual(entry.pageref, nth(log.pages!, 0).id)
      assert.strictEqual(entry.request.url, server.EMPTY_PAGE)
      assert.strictEqual(entry.request.method, "GET")
      // Strider writes the protocol as the browser names it (`NetworkResponse.httpVersion`), which HAR 1.2 allows.
      assert.strictEqual(entry.request.httpVersion, "http/1.1")
      assert.isTrue(entry.request.headers.length > 1)
      assert.isTrue(header(entry.request.headers, "user-agent") !== undefined)
      assert.strictEqual(entry.request.bodySize, 0)
    }))

  test("HA-006", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const delayed = yield* NetworkResponse.next(page, { url: "**/delayed-fetch" })
      // `window.builtins.setTimeout` is Playwright's copy of the timer; the page's own is the one a page has.
      yield* page.evaluateInMainWorld(() => {
        window.setTimeout(() => {
          void fetch("/delayed-fetch")
        }, 50)
      })
      // The original's busy loop blocks the event loop, so the protocol event for the request queues behind it.
      const blockUntil = Date.now() + 300
      yield* Effect.sync(() => {
        while (Date.now() < blockUntil) {
          // Busy loop to prevent Node from processing protocol events.
        }
      })
      const unblockedAt = Date.now()
      yield* delayed
      const log = yield* exportLog(har, directory)
      const entry = log.entries.find((each) => each.request.url.endsWith("/delayed-fetch"))!
      const startedAt = new Date(entry.startedDateTime).valueOf()
      assert.isTrue(Number.isFinite(startedAt))
      assert.isTrue(startedAt < unblockedAt - 100)
    }))

  test("HA-007", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      const entry = nth(log.entries, 0)
      assert.strictEqual(entry.response.status, 200)
      assert.strictEqual(entry.response.statusText, "OK")
      assert.strictEqual(entry.response.httpVersion, "http/1.1")
      assert.isTrue(entry.response.headers.length > 1)
      assert.isTrue(header(entry.response.headers, "content-type")!.value.includes("text/html"))
    }))

  test("HA-008", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRedirect("/foo.html", "/empty.html")
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 2)
      const entry = nth(log.entries, 0)
      assert.strictEqual(entry.response.status, 302)
      // HAR 1.2 says `redirectURL` is the Location header, which Strider writes as the server sent it, where Playwright
      // writes the resolved URL.
      assert.strictEqual(entry.response.redirectURL, "/empty.html")
      assert.strictEqual(new URL(entry.response.redirectURL, entry.request.url).href, server.EMPTY_PAGE)
    }))

  test("HA-009", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html?name=value", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.deepStrictEqual(nth(log.entries, 0).request.queryString, [{ name: "name", value: "value" }])
    }))

  test("HA-010", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: "Hello" })
      })
      // Bodies are written when the export includes `requestBodies`, which the original always has.
      const log = yield* exportLog(har, directory, "test.har", { include: ["requestBodies"] })
      // Strider's mimeType is the media type, without the charset the browser sent.
      assert.deepStrictEqual(nth(log.entries, 1).request.postData, {
        mimeType: "text/plain",
        text: "Hello"
      })
    }))

  test("HA-011", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", { method: "POST", body: new Uint8Array(Array.from(Array(16).keys())) })
      })
      const log = yield* exportLog(har, directory, "test.har", { include: ["requestBodies"] })
      // Binary bodies are base64 with `_encoding` when embedded, where Playwright leaves `text` empty.
      const postData = nth(log.entries, 1).request.postData!
      assert.strictEqual(postData.mimeType, "application/octet-stream")
      assert.strictEqual(postData._encoding, "base64")
      assert.deepStrictEqual(
        new Uint8Array(Buffer.from(postData.text!, "base64")),
        new Uint8Array(Array.from(Array(16).keys()))
      )
    }))

  test("HA-012", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(
        `<form method='POST' action='/post'><input type='text' name='foo' value='bar'><input type='number' name='baz' value='123'><input type='submit'></form>`
      )
      const navigated = yield* PageNavigation.next(page)
      yield* page.locator("input[type=submit]").click()
      yield* navigated
      const log = yield* exportLog(har, directory, "test.har", { include: ["requestBodies"] })
      assert.deepStrictEqual(nth(log.entries, 1).request.postData, {
        mimeType: "application/x-www-form-urlencoded",
        params: [
          { name: "foo", value: "bar" },
          { name: "baz", value: "123" }
        ],
        text: "foo=bar&baz=123"
      })
    }))

  test("HA-013", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const context = page.context
      const har = yield* recordContext(context)
      yield* context.cookies.set({
        name: "name1",
        value: "\"value1\"",
        scope: { domain: "localhost", path: "/" },
        httpOnly: true
      })
      yield* context.cookies.set({
        name: "name2",
        value: "val\"ue2",
        scope: { domain: "localhost", path: "/" },
        sameSite: "lax"
      })
      yield* context.cookies.set({ name: "name3", value: "val=ue3", scope: { domain: "localhost", path: "/" } })
      yield* context.cookies.set({ name: "name4", value: "val,ue4", scope: { domain: "localhost", path: "/" } })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Cookie values are redacted unless the export includes them; the original's values are included here.
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(log.entries, 0).request.cookies, [
        { name: "name1", value: "\"value1\"" },
        { name: "name2", value: "val\"ue2" },
        { name: "name3", value: "val=ue3" },
        { name: "name4", value: "val,ue4" }
      ])
    }))

  test("HA-014", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", [
          "name1=value1; HttpOnly",
          "name2=\"value2\"",
          "name3=value4; Path=/; Domain=example.com; Max-Age=1500"
        ])
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      const cookies = nth(log.entries, 0).response.cookies
      assert.deepStrictEqual(nth(cookies, 0), { name: "name1", value: "value1", httpOnly: true })
      assert.deepStrictEqual(nth(cookies, 1), { name: "name2", value: "\"value2\"" })
      // Max-Age isn't written as an expiry, so this expiry is missing until Strider records Max-Age.
      assert.isTrue(new Date(nth(cookies, 2).expires!).valueOf() > Date.now())
    }))

  test("HA-015", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", ["token; HttpOnly"])
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(log.entries, 0).response.cookies, [{ name: "", value: "token", httpOnly: true }])
    }))

  test("HA-016", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", ["name=value; path=/; httponly; secure; samesite=Lax"])
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(nth(log.entries, 0).response.cookies, 0), {
        name: "name",
        value: "value",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax"
      })
    }))

  test("HA-017", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", ["name=value;Expires=Sat Sep 14 01:02:27 CET 2024"])
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(nth(log.entries, 0).response.cookies, 0), { name: "name", value: "value" })
    }))

  test("HA-018", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", ["name1=val, ue1", "name2=val, ue2"])
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(nth(log.entries, 0).response.cookies, 0), { name: "name1", value: "val, ue1" })
      assert.deepStrictEqual(nth(nth(log.entries, 0).response.cookies, 1), { name: "name2", value: "val, ue2" })
    }))

  test("HA-019", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // The context accepts the fixture's self-signed certificate; Chromium refuses that per context.
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", ["name1=value1; Secure"])
        res.end()
      })
      const har = yield* recordContext(context)
      yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory, "test.har", { include: ["cookies"] })
      assert.deepStrictEqual(nth(nth(log.entries, 0).response.cookies, 0), {
        name: "name1",
        value: "value1",
        secure: true
      })
    })))

  test("HA-020", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      yield* page.route("**/foo", () =>
        Route.continueWith((request) =>
          HttpClientRequest.bodyText(
            HttpClientRequest.setHeaders(
              HttpClientRequest.setMethod(HttpClientRequest.setUrl(request, server.EMPTY_PAGE), "POST"),
              { ...request.headers, "content-type": "text/plain", cookie: "foo=bar", custom: "value" }
            ),
            "Hi!",
            "text/plain"
          )
        ))
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/foo", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      const request = nth(log.entries, 0).request
      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.method, "POST")
      assert.isTrue(hasHeader(request.headers, { name: "custom", value: "value" }))
      assert.deepStrictEqual(request.cookies, [])
      assert.deepStrictEqual(request.postData, { mimeType: "text/plain", text: "Hi!" })
    }))

  test("HA-021", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/pptr.png").then((r) => r.arrayBuffer())
      })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(nth(log.entries, 0).response.content.encoding, undefined)
      assert.strictEqual(nth(log.entries, 0).response.content.mimeType, "text/html; charset=utf-8")
      assert.isTrue(nth(log.entries, 0).response.content.text!.includes("HAR Page"))
      assert.isTrue(nth(log.entries, 0).response.content.size >= 96)
      assert.strictEqual(nth(log.entries, 0).response.content.compression, 0)

      assert.strictEqual(nth(log.entries, 1).response.content.encoding, undefined)
      assert.strictEqual(nth(log.entries, 1).response.content.mimeType, "text/css; charset=utf-8")
      assert.isTrue(nth(log.entries, 1).response.content.text!.includes("pink"))
      assert.isTrue(nth(log.entries, 1).response.content.size >= 37)
      assert.strictEqual(nth(log.entries, 1).response.content.compression, 0)

      assert.strictEqual(nth(log.entries, 2).response.content.encoding, "base64")
      assert.strictEqual(nth(log.entries, 2).response.content.mimeType, "image/png")
      assert.isTrue(Buffer.from(nth(log.entries, 2).response.content.text!, "base64").byteLength > 0)
      assert.isTrue(nth(log.entries, 2).response.content.size >= 6000)
      assert.strictEqual(nth(log.entries, 2).response.content.compression, 0)
    }))

  test("HA-113", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const body = Buffer.from([0x80, 0xc3, 0x28, 0xff, 0x41])
      server.setRoute("/binary.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript")
        res.end(body)
      })
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const har = yield* recordContext(context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/binary.js").then((r) => r.arrayBuffer())
      })
      const log = yield* exportLog(har, directory)
      const content = log.entries.find((entry) => entry.request.url.endsWith("/binary.js"))!.response.content
      assert.strictEqual(content.encoding, "base64")
      assert.deepStrictEqual(new Uint8Array(Buffer.from(content.text!, "base64")), new Uint8Array(body))
    })))

  test("HA-022", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/pptr.png").then((r) => r.arrayBuffer())
      })
      const file = yield* har.exportHar(path.join(directory, "test.har.zip"))
      const zip = yield* unzip(file)
      const log = JSON.parse(text(zip.get("har.har"))).log as Log
      assert.strictEqual(nth(log.entries, 0).response.content.text, undefined)
      // Strider names each body by its hop, where Playwright names it by the SHA-1 of its URL: the file the entry names
      // holds the page's HTML.
      assert.isTrue(text(zip.get(nth(log.entries, 0).response.content._file!)).includes("HAR Page"))
    }))

  test("HA-023", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "omit" })
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/pptr.png").then((r) => r.arrayBuffer())
      })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(nth(log.entries, 0).response.content.text, undefined)
      assert.strictEqual(nth(log.entries, 0).response.content._file, undefined)
    }))

  test("HA-025", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "attach" })
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/pptr.png").then((r) => r.arrayBuffer())
      })
      const file = yield* har.exportHar(path.join(directory, "test.har.zip"))
      const zip = yield* unzip(file)
      const log = JSON.parse(text(zip.get("har.har"))).log as Log
      const [html, css, png] = log.entries.map((entry) => entry.response.content)
      assert.strictEqual(html!.encoding, undefined)
      assert.strictEqual(html!.mimeType, "text/html; charset=utf-8")
      // Each body is named by its hop; the file it names holds the body and is as large as the entry says.
      assert.isTrue(text(zip.get(html!._file!)).includes("HAR Page"))
      assert.isTrue(html!.size >= 96)
      assert.strictEqual(html!.compression, 0)

      assert.strictEqual(css!.encoding, undefined)
      assert.strictEqual(css!.mimeType, "text/css; charset=utf-8")
      assert.isTrue(text(zip.get(css!._file!)).includes("pink"))
      assert.isTrue(css!.size >= 37)
      assert.strictEqual(css!.compression, 0)

      assert.strictEqual(png!.encoding, undefined)
      assert.strictEqual(png!.mimeType, "image/png")
      assert.strictEqual(zip.get(png!._file!)!.byteLength, png!.size)
      assert.isTrue(png!.size >= 6000)
      assert.strictEqual(png!.compression, 0)
    }))

  test("HA-026", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context, { content: "embed", url: server.PREFIX + "/*.css" })
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 1)
      assert.isTrue(nth(log.entries, 0).request.url.endsWith("one-style.css"))
    }))

  test("HA-028", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 2)
      assert.isTrue(nth(log.entries, 0).request.url.endsWith("har.html"))
      assert.isTrue(nth(log.entries, 0).request.headersSize >= 100)
      assert.strictEqual(nth(log.entries, 0).response.bodySize, fs.statSync(assetPath("playwright", "har.html")).size)
      assert.isTrue(nth(log.entries, 0).response.headersSize >= 100)
      assert.isTrue(nth(log.entries, 0).response._transferSize! >= 250)

      assert.isTrue(nth(log.entries, 1).request.url.endsWith("one-style.css"))
      assert.strictEqual(
        nth(log.entries, 1).response.bodySize,
        fs.statSync(assetPath("playwright", "one-style.css")).size
      )
      assert.isTrue(nth(log.entries, 1).response.headersSize >= 100)
      assert.isTrue(nth(log.entries, 1).response._transferSize! >= 150)
    }))

  test("HA-029", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.enableGzip("/simplezip.json")
      const har = yield* recordContext(page.context)
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/simplezip.json" })
      yield* page.goto(server.PREFIX + "/simplezip.json", { waitUntil: "load" })
      const received = yield* response
      assert.strictEqual(received.headers["content-encoding"], "gzip")
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 1)
      assert.isTrue(nth(log.entries, 0).response.content.compression! > 4000)
    }))

  test("HA-030", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.isTrue(nth(log.entries, 0).time > 0)
    }))

  test("HA-031", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.isTrue(nth(log.entries, 0).timings.receive > 0)
    }))

  test("HA-032", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <img src="${server.PREFIX}/pptr.png" />
  `)
      const log = yield* exportLog(har, directory)
      assert.isTrue(nth(log.entries, 1).response._transferSize! > fs.statSync(assetPath("playwright", "pptr.png")).size)
    }))

  test("HA-033", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/one-style.css", (_req, res) => {
        res.setHeader("Content-Type", "text/css")
        res.socket!.destroy()
      })
      // The original's `requestfailed` listener collects requests it never reads, so it has no port.
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.isTrue(nth(log.entries, 1).request.url.endsWith("/one-style.css"))
      assert.strictEqual(nth(log.entries, 1).response._transferSize, -1)
    }))

  test("HA-034", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/har.html", (_req, res) => {
        res.socket!.destroy()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" }).pipe(Effect.ignore)
      const log = yield* exportLog(har, directory)
      assert.isTrue((nth(log.entries, 0).response._failureText ?? "").length > 0)
      const request = nth(log.entries, 0).request
      assert.isTrue(request.url.endsWith("/har.html"))
      assert.strictEqual(request.method, "GET")
      // Strider writes header names in lower case, as its `Headers` has them.
      assert.isTrue(request.headers.some((each) => each.name === "user-agent"))
    }))

  test("HA-035", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.socket!.destroy()
      })
      yield* page.route("**/foo", () =>
        Route.continueWith((request) =>
          HttpClientRequest.bodyText(
            HttpClientRequest.setHeaders(
              HttpClientRequest.setMethod(HttpClientRequest.setUrl(request, server.EMPTY_PAGE), "POST"),
              { ...request.headers, "content-type": "text/plain", cookie: "foo=bar", custom: "value" }
            ),
            "Hi!",
            "text/plain"
          )
        ))
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/foo", { waitUntil: "load" }).pipe(Effect.ignore)
      const log = yield* exportLog(har, directory)
      assert.isTrue((nth(log.entries, 0).response._failureText ?? "").length > 0)
      const request = nth(log.entries, 0).request
      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.method, "POST")
      assert.isTrue(hasHeader(request.headers, { name: "custom", value: "value" }))
      assert.deepStrictEqual(request.cookies, [])
      assert.deepStrictEqual(request.postData, { mimeType: "text/plain", text: "Hi!" })
    }))

  test("HA-036", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/api", (_req, res) => res.end())
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/api1" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/api1", { method: "POST", body: "abc123" })
      })
      yield* response
      const log = yield* exportLog(har, directory)
      assert.strictEqual(nth(log.entries, 1).request.bodySize, 6)
    }))

  test("HA-037", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/api", (_req, res) => res.end())
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, { url: server.PREFIX + "/api2" })
      yield* page.evaluateInMainWorld(() => {
        void fetch("/api2", { method: "POST", body: "" })
      })
      yield* response
      const log = yield* exportLog(har, directory)
      assert.strictEqual(nth(log.entries, 1).request.bodySize, 0)
    }))

  test("HA-038", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      // Playwright's `response.finished()` waits for the body; the export waits for the bodies of the hops that ended.
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(nth(log.entries, 0).response.bodySize, 0)
    }))

  test("HA-039", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent("<a target=_blank rel=noopener href=\"/one-style.html\">yo</a>")
      const opened = yield* Popup.next(page)
      yield* page.locator("a").click()
      const popup = yield* opened
      yield* popup.status.waitFor(loaded)
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.pages!.length, 2)
      const entries = log.entries.filter((entry) => entry.pageref === nth(log.pages!, 1).id)
      assert.strictEqual(entries.length, 2)
      assert.strictEqual(nth(entries, 0).request.url, server.PREFIX + "/one-style.html")
      assert.strictEqual(nth(entries, 0).response.status, 200)
      assert.strictEqual(nth(entries, 1).request.url, server.PREFIX + "/one-style.css")
      assert.strictEqual(nth(entries, 1).response.status, 200)
    }))

  test("HA-040", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Set-Cookie", "name=value")
        res.end()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const cookies = yield* page.context.cookies.list
      assert.strictEqual(cookies.length, 1)
      // Exporting the storage state is the call that creates Playwright's internal page; Strider has none to create.
      yield* page.context.exportStorageState
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.pages!.length, 1)
    }))

  test("HA-041", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const har = yield* recordContext(page.context)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      const entry = nth(log.entries, 0)
      assert.match(String(entry.serverIPAddress), /^127\.0\.0\.1|\[::1\]/)
      assert.strictEqual(entry._serverPort, server.PORT)
      assert.deepStrictEqual(entry._securityDetails, {})
    }))

  test("HA-043", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRedirect("/foo.html", "/empty.html")
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/foo.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.entries.length, 2)
      const detailsFoo = nth(log.entries, 0)
      assert.match(String(detailsFoo.serverIPAddress), /^127\.0\.0\.1|\[::1\]/)
      assert.strictEqual(detailsFoo._serverPort, server.PORT)
      const detailsEmpty = nth(log.entries, 1)
      assert.match(String(detailsEmpty.serverIPAddress), /^127\.0\.0\.1|\[::1\]/)
      assert.strictEqual(detailsEmpty._serverPort, server.PORT)
    }))

  test("HA-044", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/one-style.css", (_req, res) => {
        res.setHeader("Content-Type", "text/css")
        res.socket!.destroy()
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.match(String(nth(log.entries, 0).serverIPAddress), /^127\.0\.0\.1|\[::1\]/)
      assert.strictEqual(nth(log.entries, 0)._serverPort, server.PORT)
    }))

  test("HA-047", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      // The HTTP/2 server's certificate, self-signed for localhost, made as the fixture server makes its own.
      const tls = fs.mkdtempSync(path.join(os.tmpdir(), "compat-har-tls-"))
      yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(tls, { recursive: true, force: true })))
      const key = path.join(tls, "key.pem")
      const cert = path.join(tls, "cert.pem")
      execFileSync(openssl, [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1"
      ], { stdio: "ignore" })
      const h2 = http2.createSecureServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) })
      h2.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.respond({ "content-type": "text/html; charset=utf-8", ":status": 200 })
        stream.end("<h1>Hello World</h1>")
      })
      const port = yield* Effect.acquireRelease(
        Effect.callback<number>((resume) => {
          h2.listen(0, "127.0.0.1", () => resume(Effect.succeed((h2.address() as AddressInfo).port)))
        }),
        () =>
          Effect.callback<void>((resume) => {
            h2.close(() => resume(Effect.void))
          })
      )
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      const har = yield* recordContext(context)
      yield* page.goto(`https://localhost:${port}`, { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      // As the browser names the protocol, which HAR 1.2 allows.
      assert.strictEqual(nth(log.entries, 0).request.httpVersion, "h2")
      assert.strictEqual(nth(log.entries, 0).response.httpVersion, "h2")
      assert.strictEqual(nth(log.entries, 0).response.content.text, "<h1>Hello World</h1>")
    })))

  test("HA-048", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const har = yield* recordContext(context)
      // Browsers cache favicons, so the path is busted with a prefix to keep the test isolated.
      const favicon = `/no-cache-2/favicon.ico`
      const hashedFaviconUrl = `/favicon-hashed.ico`
      server.setRedirect(favicon, hashedFaviconUrl)
      server.setRoute(hashedFaviconUrl, (_req, res) => {
        serveFile(res, assetPath("playwright", "media-query-prefers-color-scheme.svg"), "image/svg+xml")
      })
      server.setRoute("/page.html", (_req, res) => {
        res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <link rel="icon" type="image/svg+xml" href="${favicon}">
          <title>SVG Favicon Test</title>
        </head>
        <body>
          favicons
        </body>
      </html>
`)
      })
      const faviconRequest = yield* server.waitForRequest(favicon)
      const hashedRequest = yield* server.waitForRequest(hashedFaviconUrl)
      yield* page.goto(server.PREFIX + "/page.html", { waitUntil: "load" })
      yield* faviconRequest
      yield* hashedRequest
      // The original's fixed wait, ported as written.
      yield* Effect.sleep("500 millis")
      // Text still being around ensures we haven't actually lost our browser to a crash.
      yield* Expect.toBeVisible(page.getByText("favicons"))
      const log = yield* exportLog(har, directory)
      // favicon and 302 redirects to favicons should be filtered out of request logs
      assert.strictEqual(log.entries.length, 1)
      assert.strictEqual(nth(log.entries, 0).request.url, server.PREFIX + "/page.html")
    })))

  test("HA-049", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const context0 = yield* Browser.newContext()
      const page0 = yield* context0.newPage
      const har0 = yield* recordContext(context0)
      yield* page0.goto("data:text/html,<title>Zero</title>", { waitUntil: "load" })

      const context1 = yield* Browser.newContext()
      const page1 = yield* context1.newPage
      const har1 = yield* recordContext(context1)
      yield* page1.goto("data:text/html,<title>One</title>", { waitUntil: "load" })

      // Both are written at once, as the original closes both contexts at once, so they must not race for a location.
      const [log0, log1] = yield* Effect.all([
        exportLog(har0, directory, "test-0.har"),
        exportLog(har1, directory, "test-1.har")
      ], { concurrency: "unbounded" })
      assert.strictEqual(log0.pages!.length, 1)
      assert.strictEqual(nth(log0.pages!, 0).title, "Zero")
      assert.strictEqual(log1.pages!.length, 1)
      assert.notStrictEqual(nth(log1.pages!, 0).id, nth(log0.pages!, 0).id)
      assert.strictEqual(nth(log1.pages!, 0).title, "One")
    })))

  test("HA-055", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/one-style.css", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/css", "Cache-Control": "public, max-age=10031518" })
        res.end(`body { background: red }`)
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      yield* page.goto(server.PREFIX + "/har.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      const entries = log.entries.filter((each) => each.request.url.endsWith("one-style.css"))
      // The original expects one request on Firefox over its own protocol, where cached resources raise no request
      // events. Strider's Firefox is BiDi, where the original's condition is false, so every browser sees both.
      assert.strictEqual(entries.length, 2)
    }))

  test("HA-056", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      const browser = yield* Browser.Browser
      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<script>
    let receivedFirstData = new Promise(f => {
      setTimeout(() =>  {
        var x = new XMLHttpRequest();
        x.open("GET", "slow.txt");
        x.onprogress = () => f();
        x.send();
      }, 0);
    });
    </script>`)
      })
      server.setRoute("/slow.txt", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/plain",
          "Transfer-Encoding": "chunked",
          "Content-length": "2023"
        })
        res.write("begin")
      })
      // The slow response never ends, so this recording marks it incomplete, where waiting for it would hang.
      const har = yield* recordContext(page.context, { content: "embed", inFlightAtStop: "markIncomplete" })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() =>
        (window as unknown as { receivedFirstData: Promise<void> }).receivedFirstData
      )
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.browser!.name, browser.info.product)
      assert.strictEqual(log.browser!.version, browser.info.version)
    }))

  test("HA-057", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const filePath = path.join(directory, "not-a-directory")
      fs.writeFileSync(filePath, "data")
      // The context lives in a scope of its own, so the test can close it as the original does.
      const contextScope = yield* Scope.make()
      const context = yield* Browser.newContext().pipe(Scope.provide(contextScope))
      const page = yield* context.newPage.pipe(Scope.provide(contextScope))
      const har = yield* Har.record(context, { content: "embed" }).pipe(Scope.provide(contextScope))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright's failed save rejects `context.close()`; Strider's export is the save, and it fails with WriteFailed.
      const error = yield* failureOf(har.exportHar(path.join(filePath, "test.har")), "the export")
      assert.strictEqual(error.reason._tag, "WriteFailed")
      // The original's ENOTDIR|ENOENT|EEXIST, as Effect's platform error names them.
      assert.match(error.reason.hint, /AlreadyExists|NotFound|BadResource/)
      // The failed save doesn't keep the context open: closing its scope ends it.
      yield* Scope.close(contextScope, Exit.void)
      yield* context.closed
    })))

  test("HA-058", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      // 30 x 20MB textual responses push the HAR JSON past V8's ~512MB maximum string length. Each body still fits in
      // a single string; only the aggregate would overflow. The requests are the page's own: Strider has no
      // APIRequestContext, and the serializer is the same.
      const body = "a".repeat(20 * 1024 * 1024)
      server.setRoute("/large", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" })
        res.end(body)
      })
      const har = yield* recordContext(page.context).pipe(NetworkResponse.withBodyLimit("25 MiB"))
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      for (let i = 0; i < 30; i++) {
        yield* page.evaluateInMainWorld(async () => {
          await fetch("/large").then((r) => r.arrayBuffer())
        })
      }
      const file = yield* har.exportHar(path.join(directory, "test.har"))
      const stats = fs.statSync(file)
      assert.isTrue(stats.size > 512 * 1024 * 1024)
      // Reading the whole file as a string would re-hit V8's limit, so sample the head and tail to verify structural
      // sanity.
      const fd = fs.openSync(file, "r")
      const head = Buffer.alloc(64)
      fs.readSync(fd, head, 0, 64, 0)
      const tail = Buffer.alloc(64)
      fs.readSync(fd, tail, 0, 64, stats.size - 64)
      fs.closeSync(fd)
      assert.match(head.toString(), /^\{\s*"log"\s*:\s*\{/)
      assert.match(tail.toString(), /\}\s*\}\s*$/)
    }))

  test("HA-059", ({ page, server }) =>
    Effect.gen(function*() {
      const directory = yield* scratch
      server.setRoute("/resource-types.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
      <link rel="stylesheet" href="/resource-type-stylesheet.css">
      <script src="/resource-type-script.js"></script>
      <img src="/resource-type-image.png">
    `)
      })
      server.setRoute("/resource-type-stylesheet.css", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/css" })
        res.end(`
      @font-face {
        font-family: 'iconfont';
        src: url('/resource-type-font.woff2') format('woff2');
      }
      body { font-family: 'iconfont'; }
    `)
      })
      server.setRoute("/resource-type-font.woff2", (_req, res) => {
        serveFile(res, assetPath("playwright", "webfont/iconfont.woff2"), "font/woff2")
      })
      server.setRoute("/resource-type-script.js", (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/javascript" })
        res.end("window.__loaded = true;")
      })
      server.setRoute("/resource-type-image.png", (_req, res) => {
        serveFile(res, assetPath("playwright", "pptr.png"), "image/png")
      })
      const har = yield* recordContext(page.context)
      yield* page.goto(server.PREFIX + "/resource-types.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/resource-type-fetch").catch(() => {})
      })
      yield* page.evaluateInMainWorld(() =>
        new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest()
          xhr.open("GET", "/resource-type-xhr")
          xhr.onloadend = () => resolve()
          xhr.send()
        })
      )
      const log = yield* exportLog(har, directory)
      const typeForURL: Record<string, string | undefined> = {}
      for (const entry of log.entries) typeForURL[entry.request.url] = entry._resourceType
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-types.html"], "document")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-stylesheet.css"], "stylesheet")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-script.js"], "script")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-image.png"], "image")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-font.woff2"], "font")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-fetch"], "fetch")
      assert.strictEqual(typeForURL[server.PREFIX + "/resource-type-xhr"], "xhr")
    }))

  test("HA-060", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const context = yield* Browser.newContext()
      const har = yield* recordContext(context, { content: "embed", detail: "minimal", url: "**/one-style.css" })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/one-style.html", { waitUntil: "load" })
      const log = yield* exportLog(har, directory)
      assert.deepStrictEqual(log.entries.map((entry) => entry.request.url), [server.PREFIX + "/one-style.css"])
      // Minimal mode drops body sizes.
      assert.strictEqual(nth(log.entries, 0).request.bodySize, -1)
    })))

  test("HA-062", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const directory = yield* scratch
      const context = yield* Browser.newContext()
      const har = yield* recordContext(context)
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      const page2 = yield* context.newPage
      yield* page2.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      // The page closes before the export; its requests stay in the HAR.
      yield* page.close()
      const log = yield* exportLog(har, directory)
      assert.strictEqual(log.pages!.length, 2)
      assert.strictEqual(nth(log.pages!, 0).title, "Woof-Woof")
      assert.strictEqual(nth(log.pages!, 1).title, "")
    })))
})
