/**
 * Playwright's `tests/library/chromium/connect-over-cdp.spec.ts`: attaching to a Chromium that's already running,
 * through its remote debugging port. Strider's `Chromium.layerConnect` makes the connection, as `connectOverCDP` does.
 *
 * What the port changes:
 * - The original launches a browser with `--remote-debugging-port`. The port launches the harness's Chromium with that
 *   argument (`onHost`), and connects to its endpoint with `Chromium.layerConnect` (`connectTo`).
 * - An attached browser has one observed default context and no list of contexts (method-browser-contexts). The
 *   original's `contexts().length` has nothing to count, so where it asserts one context the port reads what the
 *   connection provides instead (CD-001's version), and `contexts()[0]` is `browser.defaultContext`, whose `control`
 *   gives a context that can open pages.
 * - A launched Chromium keeps the first tab it opened, which Playwright's `launch` doesn't have. Where the original counts
 *   or lists the default context's pages (CD-002, CD-009, CD-017, CD-033), the port closes that tab first or counts it.
 * - A page a connection creates closes with that connection's scope, where Playwright's survive their disconnect.
 *   Where the original makes a page through its first connection and reads it through a second one, the first
 *   connection stays open while the second reads (CD-011, CD-017), or the host browser makes the page (CD-002, CD-033).
 * - Strider reports a renderer crash as the page's close, with `PageCrashed`, where Playwright keeps the target without a
 *   renderer. CD-002 asserts the crash, and that the second connection reports only the healthy page.
 * - CD-004 writes the profile that enables `chrome://discards`, as the original does, and starts the host headed on the
 *   integration environment's X server, as `headless: false` does. `viewport: null` is Strider's default: it emulates
 *   no viewport unless asked. Playwright's pages share one window, so the page opened second puts the first in the
 *   background, where Chrome can discard it; Strider opens each page in a window of its own unless the context's focus
 *   is emulated, so the port makes its pages in such a context.
 * - CD-012 connects over the WebSocket endpoint that `/json/version` names. Its second half uses Playwright's
 *   deprecated `wsEndpoint` option, which is Playwright's alias, so it isn't ported.
 * - The harness has no WebSocket endpoint, so CD-013 and CD-031 use a small server of the port's own that answers
 *   the upgrade and records the handshake's headers (`handshakeServer`). CD-024 and CD-025 use a small HTTP proxy of
 *   the port's own (`proxyServer`) that answers 404 itself, where the original's forwards to the harness server, which
 *   has no `/json/version` either.
 * - Strider asks for `/json/version` where Playwright asks for `/json/version/`; Chrome answers both, so the paths the
 *   port reads and routes are Strider's. CD-014 and CD-015 assert that the endpoint's path and query are kept.
 * - CD-020 and CD-021 assert Strider's `ConnectionFailed` reason and the endpoint it names, not Playwright's wording.
 * - CD-018 sets `NODE_TLS_REJECT_UNAUTHORIZED=0` for the connection, as the original does: Strider's discovery request is
 *   Node's `fetch`, and has no option for trusting a certificate.
 * - CD-023 sets the proxy with Strider's `newContext({ proxy })`, as the original sets it.
 * - CD-027's `noDefaults` is Playwright's option for skipping its own overrides on connect. Strider's connection makes
 *   none, so the port connects as it does everywhere and asserts what the test is about: a second connection leaves the
 *   first connection's media emulation alone.
 * - CD-028 traces a context of its own with `Trace.record` and writes the archive with `exportTrace`, where the original
 *   starts and stops Playwright's tracing on the default context. The original's `page.evaluate` is `evaluateInMainWorld`.
 * - Attached local files are read with the caller's FileSystem and Path, so the connection provides the Node services.
 * - CD-029 transfers the files as Strider's attached `setInputFiles` does, which keeps their timestamps. The page's
 *   input is read through `evaluateInMainWorld`.
 * - CD-032 reads Playwright's utility world through its internal frame. Strider's `evaluate` is the isolated world it
 *   makes for each connection, so the port evaluates there. It navigates the page first, so the second connection can tell
 *   it from the host's first tab.
 * - CD-022 is CD-001's connection: Strider takes the endpoint only as its first argument, so the object form isn't there.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, BrowserWorker, Dialog, Expect, FileInput, type Page, Trace } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import type * as stream from "node:stream"
import { useXvfb } from "../../../../../browser/test/integration/stockWebKit.ts"
import { backend } from "../../../harness/browsers.ts"
import { assetPath, failureOf } from "../../../harness/playwright.ts"
import { upstream } from "../../../harness/upstream.ts"

/** The debugging port the host browser listens on. Each host stops before the next one starts. */
const debuggingPort = 9339

/** The host's endpoint, as the original's `endpointURL`. */
const localEndpoint = `http://127.0.0.1:${debuggingPort}/`

/** Runs `body` on a host browser the original launches with `--remote-debugging-port`, stopped when `body` ends. */
const onHost =
  (args: ReadonlyArray<string> = [], launch: Partial<Browser.LaunchOptions> = {}) =>
  <A, E, R>(body: Effect.Effect<A, E, R>) =>
    Effect.scoped(body).pipe(
      Effect.provide(backend("chromium", {
        chromium: { args: [`--remote-debugging-port=${debuggingPort}`, ...args], ...launch }
      }))
    )

/**
 * Runs `body` on a connection to `endpoint`, the original's `connectOverCDP`. The scope that owns the pages and
 * contexts the body creates ends before the connection does.
 */
const connectTo = (endpoint: string, options?: Browser.ConnectOptions) => <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.scoped(body).pipe(
    Effect.provide(
      Chromium.layerConnect(endpoint, options).pipe(
        Layer.provide(Layer.mergeAll(NodeSocket.layerWebSocketConstructor, NodeServices.layer))
      )
    )
  )

/** A directory the test removes when it ends. */
const tempDir = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), prefix))),
    (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true }))
  )

/** The page of `browser` that shows `url`: the original's `pages()[0]` where it knows which page that is. */
const pageAt = Effect.fnUntraced(function*(browser: Browser.Browser, url: string) {
  for (const page of yield* browser.pages) {
    if ((yield* page.url) === url) return page
  }
  return assert.fail(`no page shows ${url}`)
})

/** Closes a launched browser's first tab, which Playwright's `launch` doesn't have. */
const closeFirstTab = Effect.fnUntraced(function*(browser: Browser.Browser) {
  const [tab] = yield* browser.pages
  yield* (yield* tab!.control).close()
})

/** Sets `name` to `value` in `process.env` for the scope, and restores it after. */
const withEnv = (name: string, value: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const before = process.env[name]
      process.env[name] = value
      return before
    }),
    (before) =>
      Effect.sync(() => {
        if (before === undefined) delete process.env[name]
        else process.env[name] = before
      })
  )

/** Closes a Node server and its connections. */
const closeServer = (server: http.Server) =>
  Effect.callback<void>((resume) => {
    server.closeAllConnections()
    server.close(() => resume(Effect.void))
  })

/**
 * A WebSocket endpoint for the scope: it answers each upgrade with the handshake and hands the socket to `onSocket`,
 * and keeps the upgrade requests it received.
 */
const handshakeServer = (onSocket: (socket: stream.Duplex) => void) =>
  Effect.acquireRelease(
    Effect.callback<
      { readonly port: number; readonly requests: Array<http.IncomingMessage>; readonly server: http.Server }
    >(
      (resume) => {
        const requests: Array<http.IncomingMessage> = []
        const server = http.createServer()
        server.on("upgrade", (request, socket) => {
          requests.push(request)
          const key = request.headers["sec-websocket-key"] as string
          const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
          socket.write(
            [
              "HTTP/1.1 101 Switching Protocols",
              "Upgrade: websocket",
              "Connection: Upgrade",
              `Sec-WebSocket-Accept: ${accept}`,
              "",
              ""
            ].join("\r\n")
          )
          // Answers the client's close frame, as a WebSocket endpoint does, or the client waits for it to the end
          socket.on("data", (chunk: Buffer) => {
            for (let at = 0; at < chunk.length;) {
              const length = chunk[at + 1]! & 0x7f
              if ((chunk[at]! & 0x0f) === 8) {
                if (!socket.writableEnded) socket.end(Buffer.from([0x88, 0]))
                return
              }
              at += 2 + 4 + length
            }
          })
          onSocket(socket)
        })
        server.listen(
          0,
          () => resume(Effect.succeed({ port: (server.address() as { port: number }).port, requests, server }))
        )
      }
    ),
    ({ server }) => closeServer(server)
  )

/** An HTTP proxy for the scope that records each request's URL and Host header and answers 404. */
const proxyServer = Effect.acquireRelease(
  Effect.callback<{
    readonly URL: string
    readonly requestUrls: Array<string>
    readonly requestHosts: Array<string>
    readonly server: http.Server
  }>((resume) => {
    const requestUrls: Array<string> = []
    const requestHosts: Array<string> = []
    const server = http.createServer((request, response) => {
      requestUrls.push(request.url ?? "")
      requestHosts.push(request.headers.host ?? "")
      response.statusCode = 404
      response.end()
    })
    server.listen(
      0,
      () =>
        resume(Effect.succeed({
          URL: `http://localhost:${(server.address() as { port: number }).port}`,
          requestUrls,
          requestHosts,
          server
        }))
    )
  }),
  ({ server }) => closeServer(server)
)

upstream(import.meta.filename, { browsers: ["chromium"] }, (test) => {
  test("CD-001", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      const version = (yield* Browser.Browser).info.version
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual(browser.info.version, version)
      }))
    })))

  test("CD-002", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      // The original's first connection makes both pages in the default context and disconnects. The host makes them
      // here, since the pages of a connection close with it.
      const host = yield* Browser.Browser
      const context = yield* host.defaultContext.control
      const healthy = yield* context.newPage
      yield* healthy.goto(server.PREFIX + "/title.html")
      const crashed = yield* context.newPage
      yield* crashed.goto(server.EMPTY_PAGE)
      // Playwright's `goto('chrome://crash').catch(() => {})` isn't awaited, then the test waits for `crash`. The crash
      // closes the page, so the port waits for its close and asserts that the close is a renderer crash.
      yield* Effect.forkChild(crashed.goto("chrome://crash").pipe(Effect.ignore), { startImmediately: true })
      const reason = yield* crashed.closed
      assert(reason._tag === "PageCrashed", `closed for another reason: ${reason._tag}`)
      yield* closeFirstTab(host)

      // Connecting again should not hang on the page without a renderer, and should not report it at all.
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const pages = yield* browser.pages
        const urls = yield* Effect.forEach(pages, (page) => page.url)
        assert.deepStrictEqual(urls, [server.PREFIX + "/title.html"])
        const page = yield* pages[0]!.inspect
        assert.strictEqual(yield* page.title, "Woof-Woof")
      }))
    })))

  test("CD-004", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const userDataDir = yield* tempDir("connect-over-cdp-discard-")
      // chrome://discards is an internal debug page that is only available with this pref.
      fs.writeFileSync(path.join(userDataDir, "Local State"), JSON.stringify({ internal_only_uis_enabled: true }))
      // The original is headed, which the integration environment runs on its X server
      yield* useXvfb().pipe(Effect.provide(NodeServices.layer))
      yield* onHost(
        // Chrome refuses to discard tabs with DevTools attached, and we attach to all of them.
        ["--enable-features=AllowDevtoolsConnectedDiscard"],
        { headless: false, userDataDir }
      )(Effect.gen(function*() {
        const host = yield* Browser.Browser
        // Playwright's pages share one window, so a page opened after another puts it in the background, where Chrome can
        // discard it. Strider gives each page a window of its own, except where a context's focus is emulated.
        const context = yield* host.newContext({ focus: "emulated" })
        const victimUrl = server.PREFIX + "/title.html"
        const victim = yield* context.newPage
        yield* victim.goto(victimUrl)
        const discards = yield* context.newPage
        yield* discards.goto("chrome://discards/")
        // Discarding replaces the tab's WebContents, but the url in the table survives.
        const row = discards.getByRole("row", { name: victimUrl })
        yield* row.getByText("Urgent Discard").click()
        yield* Expect.toContainText(row, "discarded")
        // The renderer process is shut down asynchronously after the discard, so the original waits a fixed three
        // seconds, which the port keeps.
        yield* Effect.sleep("3 seconds")

        // Connecting should not hang on the discarded page, and the page should not be reported.
        yield* connectTo(localEndpoint)(Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const urls = yield* Effect.forEach(yield* browser.pages, (page) => page.url)
          assert.deepStrictEqual([...urls].sort(), ["about:blank", yield* discards.url].sort())
        }))
      }))
    })))

  test("CD-009", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser1 = yield* Browser.Browser
        yield* connectTo(localEndpoint)(Effect.gen(function*() {
          const browser2 = yield* Browser.Browser
          const context1 = yield* browser1.defaultContext.control
          const page1 = yield* context1.newPage
          yield* page1.goto(server.EMPTY_PAGE)

          const context2 = yield* browser2.defaultContext.control
          const page2 = yield* context2.newPage
          yield* page2.goto(server.EMPTY_PAGE)

          // The host's first tab is a third page, which Playwright's launched browser doesn't have
          assert.strictEqual((yield* context1.pages).length, 3)
          assert.strictEqual((yield* context2.pages).length, 3)

          // Playwright dismisses a dialog nothing handles
          yield* Dialog.handle(page1, Dialog.dismissAll)
          yield* page1.evaluateInMainWorld(() => alert("dialog race"))
          const first = yield* pageAt(browser2, server.EMPTY_PAGE)
          assert.strictEqual(yield* (yield* first.inspect).title, "")
        }))
      }))
    })))

  test("CD-010", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      const host = yield* Browser.Browser
      // The original makes the page in a context of the host's own
      const oneFrame = yield* host.newPage()
      const oneFrameUrl = server.PREFIX + "/frames/one-frame.html"
      yield* oneFrame.goto(oneFrameUrl)
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const page = yield* (yield* pageAt(browser, oneFrameUrl)).control
        yield* page.goto(server.EMPTY_PAGE)
      }))
    })))

  test("CD-011", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser1 = yield* Browser.Browser
        const context = yield* browser1.defaultContext.control
        const page = yield* context.newPage
        const started = yield* BrowserWorker.next(context, { kind: "service" })
        yield* page.goto(server.PREFIX + "/serviceworkers/empty/sw.html")
        const worker = yield* started
        assert.strictEqual(yield* worker.evaluate(() => self.toString()), "[object ServiceWorkerGlobalScope]")

        // The original's first connection has closed by now; its page stays open, as the first connection does here
        yield* connectTo(localEndpoint)(Effect.gen(function*() {
          const browser2 = yield* Browser.Browser
          assert.strictEqual((yield* browser2.defaultContext.workers).length, 1)
        }))
      }))
    })))

  test("CD-012", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      const version = (yield* Browser.Browser).info.version
      // The original's second half connects with the deprecated `wsEndpoint` option: Playwright's alias, not ported.
      const json = yield* Effect.promise(() =>
        fetch(`${localEndpoint}json/version/`).then((response) => response.text())
      )
      const wsEndpoint: string = JSON.parse(json).webSocketDebuggerUrl
      yield* connectTo(wsEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual(browser.info.version, version)
      }))
    })))

  test("CD-013", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const headers = { "User-Agent": "Playwright", foo: "bar" }
      // The WebSocket handshake. The original's `timeout: 100` ends the connection that nothing answers.
      const ws = yield* handshakeServer(() => {})
      yield* connectTo(`ws://localhost:${ws.port}/ws`, { headers })(Effect.void).pipe(
        Effect.timeoutOption("100 millis"),
        Effect.ignore
      )
      assert.lengthOf(ws.requests, 1)
      assert.strictEqual(ws.requests[0]!.headers["user-agent"], "Playwright")
      assert.strictEqual(ws.requests[0]!.headers["foo"], "bar")

      // The discovery request
      yield* connectTo(`http://localhost:${server.PORT}`, { headers })(Effect.void).pipe(Effect.ignore)
      const request = server.requests.find((received) => received.path === "/json/version")
      assert.isDefined(request)
      assert.strictEqual(request.headers["user-agent"], "Playwright")
      assert.strictEqual(request.headers["foo"], "bar")
    })))

  // The original waits for a request that Strider's discovery never sends, so it waits for the test's deadline. Strider's
  // connection settles once the request is answered, so the port reads the requests the harness server received.
  test("CD-014", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* connectTo(`http://localhost:${server.PORT}/browser/?foo=bar`)(Effect.void).pipe(Effect.ignore)
      assert.include(server.requests.map((received) => received.path), "/browser/json/version?foo=bar")
    }))

  test("CD-015", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      yield* connectTo(`http://localhost:${server.PORT}/browser?foo=bar`)(Effect.void).pipe(Effect.ignore)
      assert.include(server.requests.map((received) => received.path), "/browser/json/version?foo=bar")
    }))

  test("CD-017", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser1 = yield* Browser.Browser
        const context = yield* browser1.defaultContext.control
        for (let i = 0; i < 3; i++) yield* context.newPage
        // The original's first connection has closed by now; its pages stay open, as the first connection does here
        yield* connectTo(localEndpoint)(Effect.gen(function*() {
          const browser2 = yield* Browser.Browser
          // The host's first tab is a fourth page, which Playwright's launched browser doesn't have
          assert.strictEqual((yield* browser2.defaultContext.pages).length, 4)
        }))
      }))
    })))

  test("CD-018", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      const json = yield* Effect.promise(() =>
        fetch(`${localEndpoint}json/version/`).then((response) => response.text())
      )
      server.setRoute("/json/version", (_request, response) => {
        response.writeHead(200)
        response.end(json)
      })
      yield* withEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0")
      yield* connectTo(`https://localhost:${server.https.PORT}/`)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.defaultContext.control
        for (let i = 0; i < 3; i++) yield* context.newPage
        assert.strictEqual((yield* context.pages).length, 4)
      }))
    })))

  test("CD-020", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      server.setRoute("/json/version", (_request, response) => {
        response.statusCode = 404
        response.end(JSON.stringify({ webSocketDebuggerUrl: "dont-use-me" }))
      })
      const error = yield* failureOf(connectTo(server.PREFIX)(Effect.void))
      assert(error.reason._tag === "ConnectionFailed", `failed for another reason: ${error.reason._tag}`)
      assert.strictEqual(error.reason.stage, "refused")
      assert.include(error.reason.hint, "/json/version")
      assert.include(error.reason.hint, "404")
    }))

  test("CD-021", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      server.setRoute("/json/version", (_request, response) => {
        response.end(JSON.stringify({ webSocketDebuggerUrl: undefined }))
      })
      const error = yield* failureOf(connectTo(server.PREFIX)(Effect.void))
      assert(error.reason._tag === "ConnectionFailed", `failed for another reason: ${error.reason._tag}`)
      assert.strictEqual(error.reason.stage, "refused")
      assert.include(error.reason.hint, "/json/version")
    }))

  test("CD-022", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      // The same connection as CD-001: Strider's endpoint is its first argument, and the object form isn't there.
      const version = (yield* Browser.Browser).info.version
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual(browser.info.version, version)
      }))
    })))

  test("CD-023", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      server.setRoute("/target.html", (_request, response) => {
        response.end("<html><title>Served by the proxy</title></html>")
      })
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const context = yield* browser.newContext({ proxy: { server: `localhost:${server.PORT}` } })
        const page = yield* context.newPage
        yield* page.goto("http://non-existent.test/target.html")
        assert.strictEqual(yield* page.title, "Served by the proxy")
      }))
    })))

  test("CD-024", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const proxy = yield* proxyServer
      yield* withEnv("HTTP_PROXY", proxy.URL)
      const error = yield* failureOf(connectTo(server.PREFIX)(Effect.void))
      assert(error.reason._tag === "ConnectionFailed", `failed for another reason: ${error.reason._tag}`)
      assert.include(error.reason.hint, "404")
      assert.deepStrictEqual(proxy.requestUrls, [`${server.PREFIX}/json/version`])
    })))

  test("CD-025", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const proxy = yield* proxyServer
      yield* withEnv("HTTP_PROXY", proxy.URL)
      const error = yield* failureOf(connectTo(server.PREFIX)(Effect.void))
      assert(error.reason._tag === "ConnectionFailed", `failed for another reason: ${error.reason._tag}`)
      assert.include(error.reason.hint, "404")
      assert.deepStrictEqual(proxy.requestHosts, [new URL(server.PREFIX).host])
    })))

  test("CD-026", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      const version = (yield* Browser.Browser).info.version
      yield* connectTo(`http://localhost:${debuggingPort}`)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assert.strictEqual(browser.info.version, version)
      }))
    })))

  test("CD-027", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      const isPrint = (page: Page.Page) => page.evaluateInMainWorld(() => matchMedia("print").matches)
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser1 = yield* Browser.Browser
        const context1 = yield* browser1.newContext()
        const page1 = yield* context1.newPage
        yield* page1.emulate({ media: { type: "print" } })
        assert.isTrue(yield* isPrint(page1))
        yield* connectTo(localEndpoint)(Effect.void)
        assert.isTrue(yield* isPrint(page1))
      }))
    })))

  test("CD-028", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const dir = yield* tempDir("connect-over-cdp-trace-")
      yield* onHost()(
        connectTo(localEndpoint)(Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const context = yield* browser.newContext()
          const recording = yield* Trace.record(context, {
            screenshots: "perAction",
            domSnapshots: true,
            network: true
          })
          const page = yield* context.newPage
          yield* page.evaluateInMainWorld(() => 2 + 2)
          const traceZip = yield* recording.exportTrace(path.join(dir, "trace.zip"))
          assert.isTrue(fs.existsSync(traceZip))
        }))
      )
    })))

  test("CD-029", { page: false }, () =>
    onHost()(Effect.gen(function*() {
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const page = yield* browser.newPage()
        yield* page.setContent(`<input type=file multiple=true/>`)
        const input = page.locator("input")
        const files = ["file-to-upload.txt", "file-to-upload-2.txt"]
        yield* input.setInputFiles(files.map((file) => FileInput.local(assetPath("playwright", file))))
        const names = yield* page.evaluateInMainWorld(() =>
          [...(document.querySelector("input") as HTMLInputElement).files!].map((file) => file.name)
        )
        assert.deepStrictEqual(names, files)
        const timestamps = yield* page.evaluateInMainWorld(() =>
          [...(document.querySelector("input") as HTMLInputElement).files!].map((file) => file.lastModified)
        )
        const expected = files.map((file) => Math.round(fs.statSync(assetPath("playwright", file)).mtimeMs))
        // On Linux browser sometimes reduces the timestamp by 1ms, and WebKit rounds it to seconds.
        for (let i = 0; i < timestamps.length; i++) {
          assert.isTrue(
            Math.abs(timestamps[i]! - expected[i]!) <= 1000,
            `expected: ${expected}; actual: ${timestamps}`
          )
        }
      }))
    })))

  test("CD-031", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // The original's server closes the socket with code 4123 and the reason "Oh my!" when the client sends its first message
      const ws = yield* handshakeServer((socket) => {
        socket.once("data", () => {
          socket.write(Buffer.concat([Buffer.from([0x88, 8, 0x10, 0x1b]), Buffer.from("Oh my!")]))
          socket.end()
        })
      })
      const error = yield* failureOf(connectTo(`ws://localhost:${ws.port}/ws`)(Effect.void))
      assert(error.reason._tag === "ConnectionFailed", `failed for another reason: ${error.reason._tag}`)
      assert.include(error.reason.hint, "Oh my!")
    })))

  test("CD-032", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser1 = yield* Browser.Browser
        const context1 = yield* browser1.defaultContext.control
        const page1 = yield* context1.newPage
        yield* page1.goto(server.EMPTY_PAGE)
        yield* page1.evaluate(() => {
          Reflect.set(window, "foo", 42)
        })

        const result = yield* connectTo(localEndpoint)(Effect.gen(function*() {
          const browser2 = yield* Browser.Browser
          const page2 = yield* (yield* pageAt(browser2, server.EMPTY_PAGE)).inspect
          return yield* page2.evaluate(() => Reflect.get(window, "foo"))
        }))
        assert.isUndefined(result)
      }))
    })))

  test("CD-033", { page: false }, ({ server }) =>
    onHost()(Effect.gen(function*() {
      // The original's first connection creates the page, sets its title and disconnects. The host does both here,
      // as the default context's page that the second connection reads.
      const host = yield* Browser.Browser
      const context = yield* host.defaultContext.control
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.evaluateInMainWorld(() => {
        document.title = "my title"
      })
      yield* closeFirstTab(host)
      yield* connectTo(localEndpoint)(Effect.gen(function*() {
        const browser = yield* Browser.Browser
        const [first] = yield* browser.defaultContext.pages
        const observed = yield* first!.inspect
        assert.strictEqual(yield* observed.url, server.EMPTY_PAGE)
        assert.strictEqual(yield* observed.title, "my title")
      }))
    })))
})
