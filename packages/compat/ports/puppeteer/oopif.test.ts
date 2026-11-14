/**
 * Puppeteer's `test/src/oopif.test.ts`: cross-site frames that Chromium runs in processes of their own, under
 * `--site-per-process` as the original launches.
 *
 * What the port changes:
 * - Puppeteer's runner (`test/src/mocha-utils.ts`) adds three arguments to every Chromium it launches:
 *   `--host-resolver-rules` (so `domain1.test`, `domain2.test`, and `domain3.test` resolve to 127.0.0.1, which the
 *   tests need), `--force-device-scale-factor=1`, and `--disable-features=OrganizerPanel`. The port passes them with
 *   `--site-per-process`. The page is the harness's 1280x720, not Puppeteer's 800x600 default.
 * - Puppeteer's `page.waitForFrame(predicate)` is a wait on `page.frames`, which is level-triggered, so the port waits
 *   after the action rather than subscribing before it. `frame.url()`, `childFrames()`, and `page.frames()` are reads of
 *   the frame tree, read once as the original reads them. A frame is identified by its tree id, as Puppeteer's Frame
 *   objects are.
 * - Puppeteer's `frame.evaluate` runs in the frame's main world. Strider's runs in the frame's isolated world, the
 *   only one a frame has. Where a test reads a global of its own, the port reads a DOM attribute the init script sets
 *   (as soon as the document has its root element, before any of the page's own scripts). Frame-level `evaluate` that
 *   writes and reads a global (OOPIF "should support evaluating in oop iframes") keeps the write and read in the
 *   frame's isolated world, and checks the frame's URL in the tree.
 * - Local equivalents of Puppeteer's test helpers, written here for this file: `navigateFrame` and `detachFrame`
 *   (`test/src/utils.ts`, run in the page's main world), `dumpFrames` (the frame tree's URLs and names; Puppeteer's falls
 *   back to the frame element's id, which the tree doesn't have), and `pagesAt` (a browser's pages at a URL). The
 *   harness's `attachFrame` and `frameCount` stand in for `utils.ts`'s `attachFrame` and `page.frames().length`.
 * - "should recover cross-origin frames on reconnect" and "should detect existing OOPIFs when Puppeteer connects to an
 *   existing page" connect a second client to the browser. Each launches its own browser with
 *   `--remote-debugging-port` and connects with `Chromium.layerConnect`, as OO-028 does.
 * - "should expose events within OOPIFs" is CDP-level behavior: it uses a raw CDP session on the page
 *   (`CdpConnection`, as `session.test.ts` does), with `Target.setAutoAttach` and `waitForDebuggerOnStart`. The page
 *   is navigated before the session's auto-attach is set, where Puppeteer sets it before its first navigation; the
 *   out-of-process frame is created after that, so the events it checks are the same.
 * - "should evaluate on a page with a PDF viewer" waits for `networkidle2`, which Strider has no state for. The port
 *   waits for the frame tree the test then checks (the viewer's last frame starts at about:blank and navigates to the
 *   PDF), evaluates in the two frames that have an element to enter them by, and reads the other two from the tree.
 * - "should support lazy OOP frames" reads Puppeteer's private `frame._hasStartedLoading`. The port answers the lazy
 *   frame's https://www.example.com from a route, so nothing leaves the machine, and checks that the lazy frame is in
 *   the tree and that no request for it was made. `page.setViewport` is `page.emulate`.
 * - "should continue intercepted requests from workers in OOPIFs" reads the worker's realm from the request's
 *   initiator, where Puppeteer compares `request.worker()` with the worker object.
 * - "clickablePoint, boundingBox, boxModel should work for elements inside OOPIFs" keeps the `boundingBox` assertions;
 *   Strider has no `clickablePoint` or `boxModel`, so those two are dropped.
 * - The tests that need features Strider lacks are not ported; the ledger says why each is.
 * - Strider's `page.route` and `page.addInitScript` are scoped to the test, as Puppeteer's request interception and
 *   `evaluateOnNewDocument` are to its page.
 * - The file runs on Chromium only: its `--site-per-process` launch and out-of-process frames are Chromium's, and the
 *   original's Firefox run is the CDP-and-BiDi one the ledger covers.
 * - "should provide access to elements" returns early in Puppeteer when `HEADLESS` is `true`, its default, and
 *   Strider's Chromium is headless. The port runs the body, since the click reaching the frame is what it checks.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import { Browser, Expect, NetworkRequest, NetworkResponse, Page, PageNavigation, Route } from "@usestrider/browser"
import { Network, Runtime, Target as CdpTarget } from "@usestrider/browser/cdp"
import { Chromium } from "@usestrider/browser/chromium"
import { CdpConnection, Protocol, Transport } from "@usestrider/browser/protocol"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import { backend } from "../harness/browsers.ts"
import { attachFrame, frameCount, rafraf } from "../harness/playwright.ts"
import {
  detachFrame,
  dumpFrames,
  flatten,
  frameById,
  iframeCount,
  navigateFrame,
  runnerChromiumArgs
} from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

type FrameId = Page.FrameTree["id"]

/** Puppeteer's runner arguments, with the file's `--site-per-process`. */
const chromiumArgs = ["--site-per-process", ...runnerChromiumArgs]

/** The debugging port a host browser listens on. Each test's browsers stop before the next one starts. */
const debuggingPort = 9461

/** Puppeteer's `frame.url()`: the URL the frame tree has for the frame with `id` now, read once. */
const urlOfFrame = Effect.fnUntraced(function*(page: Page.Page, id: FrameId) {
  const frame = frameById(yield* page.frames, id)
  assert.isDefined(frame, `the tree has no frame ${id}`)
  return String(frame!.url)
})

/** A page in a context of its own, at `url`, once it has loaded. */
const pageAt = Effect.fnUntraced(function*(url: string) {
  const context = yield* Browser.newContext()
  const page = yield* context.newPage
  yield* page.goto(url, { waitUntil: "load" })
  return page
})

/** The browser's pages that show `url`, as Puppeteer's `browser.pages()` filtered by `page.url()`. */
const pagesAt = Effect.fnUntraced(function*(predicate: (url: string) => boolean) {
  const tabs = yield* (yield* Browser.Browser).pages
  const matches: Array<Page.ObservedPage> = []
  for (const tab of tabs) {
    if (predicate(String(yield* tab.url))) matches.push(tab)
  }
  return matches
})

/** Runs `body` on a Chromium this test launches with a debugging port, which stops when the body ends. */
const withHostBrowser = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.scoped(body).pipe(
    Effect.provide(
      backend("chromium", { chromium: { args: [...chromiumArgs, `--remote-debugging-port=${debuggingPort}`] } })
    )
  )

/** A Chromium connected to the host browser's debugging port, as Puppeteer's `puppeteer.connect` is to the same one. */
const connected = Chromium.layerConnect(`http://127.0.0.1:${debuggingPort}`).pipe(
  Layer.provide(NodeSocket.layerWebSocketConstructor)
)

/** The raw CDP connection to a host browser's debugging port. */
const withBrowserConnection = <A, E, R>(
  body: (cdp: CdpConnection.CdpConnection) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(Effect.gen(function*() {
    const json = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${debuggingPort}/json/version`).then((response) => response.json() as Promise<unknown>)
    )
    const { webSocketDebuggerUrl } = Schema.decodeUnknownSync(Schema.Struct({ webSocketDebuggerUrl: Schema.String }))(
      json
    )
    const transport = yield* Transport.webSocket(webSocketDebuggerUrl)
    const cdp = yield* CdpConnection.make(transport)
    return yield* body(cdp)
  })).pipe(
    Effect.provide(Layer.mergeAll(
      NodeSocket.layerWebSocketConstructor,
      backend("chromium", { chromium: { args: [...chromiumArgs, `--remote-debugging-port=${debuggingPort}`] } })
    ))
  )

/** The original's `page.createCDPSession()`: a session on the target of the page that shows `url`. */
const sessionFor = Effect.fnUntraced(function*(cdp: CdpConnection.CdpConnection, url: string) {
  const { targetInfos } = yield* CdpTarget.getTargets().pipe(Protocol.on(cdp.browser))
  const target = targetInfos.find((info) => info.type === "page" && info.url === url)
  assert.isDefined(target, `no page target shows ${url}`)
  const { sessionId } = yield* CdpTarget.attachToTarget({ targetId: target!.targetId, flatten: true }).pipe(
    Protocol.on(cdp.browser)
  )
  return yield* cdp.session(sessionId)
})

/**
 * The init script the evaluateOnNewDocument tests add: it marks each document, OOPIFs included, with an attribute as
 * soon as the document has its root element, which is before any of the page's own scripts run.
 */
const markEvaluated = () => {
  const mark = () => {
    if (document.documentElement === null) return false
    document.documentElement.dataset["evaluateOnNewDocument"] = "true"
    return true
  }
  if (!mark()) {
    const observer = new MutationObserver(() => {
      if (mark()) observer.disconnect()
    })
    observer.observe(document, { childList: true })
  }
}

upstream(import.meta.filename, {
  browsers: ["chromium"],
  launch: { chromium: { args: chromiumArgs } }
}, (test) => {
  test("OOPIF should treat OOP iframes and normal iframes the same", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* attachFrame(page, "frame2", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* page.frames.waitFor((tree) => tree.children.some((child) => child.url.endsWith("/empty.html")))
      assert.strictEqual((yield* page.frames).children.length, 2)
    }))

  test("OOPIF should track navigations within OOP iframes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      const tree = yield* page.frames.waitFor((tree) => tree.children.length === 1)
      const id = tree.children[0]!.id
      assert.include(String(frameById(tree, id)!.url), "/empty.html")
      yield* navigateFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/assets/frame.html")
      assert.include(yield* urlOfFrame(page, id), "/assets/frame.html")
    }))

  test("OOPIF should support OOP iframes becoming normal iframes again", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* page.frames.waitFor((tree) => tree.children.length === 1)
      yield* navigateFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* navigateFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
    }))

  test("OOPIF should support frames within OOP frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame1 = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/frames/one-frame.html")
      yield* page.frames.waitFor((tree) => tree.children[0]?.children.length === 1)
      const frame2 = frame1.frame(frame1.locator("iframe"))
      // frame.evaluate(() => document.location.href), in each of the two frames
      assert.match(yield* frame1.locator(":root").evaluate(() => document.location.href), /one-frame\.html$/)
      assert.match(yield* frame2.locator(":root").evaluate(() => document.location.href), /frames\/frame\.html$/)
    }))

  test("OOPIF should recover cross-origin frames on reconnect", { page: false }, ({ server }) =>
    withHostBrowser(
      Effect.gen(function*() {
        const page = yield* pageAt(server.EMPTY_PAGE)
        yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/frames/one-frame.html")
        const tree = yield* page.frames.waitFor((tree) => tree.children[0]?.children.length === 1)
        const dump1 = dumpFrames(tree)
        // puppeteer.connect to the same browser: a second client of the one browser
        yield* Effect.gen(function*() {
          const emptyPages = yield* pagesAt((url) => url === server.EMPTY_PAGE)
          assert.strictEqual(emptyPages.length, 1)
          const dump2 = dumpFrames(yield* (yield* emptyPages[0]!.inspect).frames)
          assert.deepStrictEqual(dump1, dump2)
        }).pipe(Effect.provide(connected))
      })
    ))

  test("OOPIF should support OOP iframes getting detached", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* page.frames.waitFor((tree) => tree.children.length === 1)
      yield* navigateFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* detachFrame(page, "frame1")
      assert.strictEqual(yield* frameCount(page), 1)
    }))

  test("OOPIF should support wait for navigation for transitions from local to OOPIF", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* page.frames.waitFor((tree) => tree.children.length === 1)
      // frame.waitForNavigation(): subscribed before the navigation, over the page's frames
      const navigated = yield* PageNavigation.next(page, { frames: "all", waitUntil: "load" })
      yield* navigateFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* navigated
      yield* detachFrame(page, "frame1")
      assert.strictEqual(yield* frameCount(page), 1)
    }))

  test("OOPIF should keep track of a frames OOP state", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      const tree = yield* page.frames.waitFor((tree) => tree.children.length === 1)
      const id = tree.children[0]!.id
      assert.include(String(frameById(tree, id)!.url), "/empty.html")
      yield* navigateFrame(page, "frame1", server.EMPTY_PAGE)
      assert.strictEqual(yield* urlOfFrame(page, id), server.EMPTY_PAGE)
    }))

  test("OOPIF should support evaluating in oop iframes", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      const tree = yield* page.frames.waitFor((tree) => tree.children.length === 1)
      // The frame is the cross-site one: its URL in the tree, which the write and the read below both run in
      assert.include(String(tree.children[0]!.url), server.CROSS_PROCESS_PREFIX)
      yield* frame.locator(":root").evaluate(() => {
        ;(window as unknown as { _test?: string })._test = "Test 123!"
      })
      const result = yield* frame.locator(":root").evaluate(() => (window as unknown as { _test?: string })._test)
      assert.strictEqual(result, "Test 123!")
    }))

  test("OOPIF should provide access to elements", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* frame.locator("body").evaluate(() => {
        const button = document.createElement("button")
        button.id = "test-button"
        button.innerText = "click"
        button.onclick = () => {
          button.id = "clicked"
        }
        document.body.appendChild(button)
      })
      yield* page.evaluateInMainWorld(() => {
        document.body.style.border = "150px solid black"
        document.body.style.margin = "250px"
        document.body.style.padding = "50px"
      })
      yield* Expect.toBeVisible(frame.locator("#test-button"))
      // The page layout change moves the OOP iframe. Two animation frames in the main frame give the browser hit-test
      // data for the new position, so the click doesn't land on the <iframe> element.
      yield* rafraf(page)
      yield* frame.locator("#test-button").click()
      yield* Expect.toBeAttached(frame.locator("#clicked"))
    }))

  test("OOPIF should report oopif frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      const tree = yield* page.frames.waitFor((tree) =>
        flatten(tree).some((frame) => frame.url.endsWith("/oopif.html"))
      )
      assert.strictEqual(iframeCount(tree), 1)
      assert.strictEqual(flatten(tree).length, 2)
    }))

  test("OOPIF should wait for inner OOPIFs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(`http://domain1.test:${server.PORT}/main-frame.html`, { waitUntil: "load" })
      const tree = yield* page.frames.waitFor((tree) =>
        flatten(tree).some((frame) => frame.url.endsWith("inner-frame2.html"))
      )
      assert.strictEqual(iframeCount(tree), 2)
      assert.strictEqual(flatten(tree).length, 3)
      const inner = page.frame(page.locator("iframe"))
      const frame2 = inner.frame(inner.locator("iframe"))
      assert.strictEqual(yield* frame2.locator("button").count, 1)
    }))

  test("OOPIF should load oopif iframes with subresources and request interception", ({ page, server }) =>
    Effect.gen(function*() {
      // page.on('request', continue) with setRequestInterception(true): every request is continued
      yield* page.route("**", () => Route.continue)
      const requested = yield* NetworkRequest.next(page, { url: "**requestFromOOPIF" })
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      const request = yield* requested
      const tree = yield* page.frames.waitFor((tree) =>
        tree.children.some((child) => child.url.endsWith("/oopif.html"))
      )
      assert.strictEqual(iframeCount(tree), 1)
      const frame = tree.children.find((child) => child.url.endsWith("/oopif.html"))!
      // request.frame() is the frame whose document started the request
      assert.isTrue(request.initiator._tag === "Document" && request.initiator.navigable === frame.id)
    }))

  test("OOPIF should retrieve body for OOPIF document requests", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const response = yield* NetworkResponse.next(page, {
        url: server.PREFIX.replace("localhost", "domain1.test") + "/oopif-response.html",
        body: (message) => message.text
      })
      yield* page.evaluateInMainWorld((frameUrl) =>
        new Promise<void>((resolve, reject) => {
          const frame = document.createElement("iframe")
          frame.setAttribute("src", frameUrl)
          document.body.appendChild(frame)
          frame.onload = () => resolve()
          frame.onerror = () => reject(new Error("the frame failed to load"))
        }), server.PREFIX.replace("localhost", "domain1.test") + "/oopif-response.html")
      yield* Expect.toBeAttached(page.locator("iframe"))
      assert.include((yield* response).body, "I'm an OOPIF")
    }))

  test("OOPIF should support evaluateOnNewDocument", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.addInitScript(markEvaluated)
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      yield* page.frames.waitFor((tree) => flatten(tree).some((frame) => frame.url.endsWith("/oopif.html")))
      assert.strictEqual(yield* frameCount(page), 2)
      // Each frame's document, the page's and the OOPIF's, was marked as it started
      yield* Expect.toHaveAttribute(page.locator(":root"), "data-evaluate-on-new-document", "true")
      yield* Expect.toHaveAttribute(
        page.frame(page.locator("iframe")).locator(":root"),
        "data-evaluate-on-new-document",
        "true"
      )
    }))

  test("OOPIF should support removing evaluateOnNewDocument scripts", ({ page, server }) =>
    Effect.gen(function*() {
      const script = yield* page.addInitScript(markEvaluated)
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      yield* page.frames.waitFor((tree) => flatten(tree).some((frame) => frame.url.endsWith("/oopif.html")))
      assert.strictEqual(yield* frameCount(page), 2)
      yield* Expect.toHaveAttribute(page.locator(":root"), "data-evaluate-on-new-document", "true")
      yield* Expect.toHaveAttribute(
        page.frame(page.locator("iframe")).locator(":root"),
        "data-evaluate-on-new-document",
        "true"
      )
      yield* script.remove
      yield* page.reload({ waitUntil: "load" })
      yield* page.frames.waitFor((tree) => flatten(tree).some((frame) => frame.url.endsWith("/oopif.html")))
    }))

  test("OOPIF waitForFrame should resolve immediately if the frame already exists", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame2", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* page.frames.waitFor((tree) => tree.children.some((child) => child.url.endsWith("/empty.html")))
    }))

  test("OOPIF should report google.com frame", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Every request is answered by the test, so the frame's document never leaves the machine
      yield* page.route("**", () => Route.fulfill(HttpServerResponse.text("YO, GOOGLE.COM")))
      yield* page.evaluateInMainWorld(() =>
        new Promise<void>((resolve) => {
          const frame = document.createElement("iframe")
          frame.setAttribute("src", "https://google.com/")
          document.body.appendChild(frame)
          frame.onload = () => resolve()
        })
      )
      yield* Expect.toBeAttached(page.locator("iframe[src=\"https://google.com/\"]"))
      const urls = flatten(yield* page.frames).map((frame) => String(frame.url)).sort()
      assert.deepStrictEqual(urls, [server.EMPTY_PAGE, "https://google.com/"])
    }))

  test(
    "OOPIF should expose events within OOPIFs",
    { page: false },
    ({ server }) =>
      withBrowserConnection((cdp) =>
        Effect.gen(function*() {
          const page = yield* pageAt(server.EMPTY_PAGE)
          const session = yield* sessionFor(cdp, server.EMPTY_PAGE)
          const networkEvents: Array<string> = []
          const otherSessions: Array<Protocol.ProtocolSession> = []
          // session.on(SessionAttached): each attached target's session gets its network events, then runs
          const attached = yield* session.subscribe(CdpTarget.attachedToTarget)
          yield* attached.pipe(
            Stream.runForEach((event) =>
              Effect.gen(function*() {
                const child = yield* cdp.session(event.sessionId)
                otherSessions.push(child)
                const requests = yield* child.subscribe(Network.requestWillBeSent)
                yield* requests.pipe(
                  Stream.runForEach((request) => Effect.sync(() => networkEvents.push(request.request.url))),
                  Effect.forkScoped
                )
                yield* Network.enable().pipe(Protocol.on(child))
                yield* Runtime.runIfWaitingForDebugger().pipe(Protocol.on(child))
              })
            ),
            Effect.forkScoped
          )
          yield* CdpTarget.setAutoAttach({ autoAttach: true, flatten: true, waitForDebuggerOnStart: true }).pipe(
            Protocol.on(session)
          )
          yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
          yield* page.evaluateInMainWorld((frameUrl) =>
            new Promise<void>((resolve, reject) => {
              const frame = document.createElement("iframe")
              frame.setAttribute("src", frameUrl)
              document.body.appendChild(frame)
              frame.onload = () => resolve()
              frame.onerror = () => reject(new Error("the frame failed to load"))
            }), server.PREFIX.replace("localhost", "domain1.test") + "/one-style.html")
          yield* Expect.toBeAttached(page.locator("iframe"))
          yield* session.drainObserved
          yield* Effect.yieldNow
          assert.strictEqual(otherSessions.length, 1)
          const iframeSession = otherSessions[0]!
          yield* Runtime.evaluate({ expression: "fetch('/fetch')", awaitPromise: true }).pipe(
            Protocol.on(iframeSession)
          )
          yield* iframeSession.drainObserved
          yield* Effect.yieldNow
          assert.include(networkEvents, `http://domain1.test:${server.PORT}/fetch`)
        })
      )
  )

  test("OOPIF clickablePoint, boundingBox, boxModel should work for elements inside OOPIFs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      yield* page.evaluateInMainWorld(() => {
        document.body.style.border = "50px solid black"
        document.body.style.margin = "50px"
        document.body.style.padding = "50px"
      })
      yield* frame.locator("body").evaluate(() => {
        const button = document.createElement("button")
        button.id = "test-button"
        button.innerText = "click"
        document.body.appendChild(button)
      })
      yield* Expect.toBeVisible(frame.locator("#test-button"))
      const box = yield* frame.locator("#test-button").boundingBox
      assert.isTrue(Option.isSome(box), "the button inside the OOPIF has no bounding box")
      // padding + margin + border, left and top
      assert.isAbove(Option.getOrThrow(box).x, 150)
      assert.isAbove(Option.getOrThrow(box).y, 150)
    }))

  test(
    "OOPIF should detect existing OOPIFs when Puppeteer connects to an existing page",
    { page: false },
    ({ server }) =>
      withHostBrowser(
        Effect.gen(function*() {
          const page = yield* pageAt(server.PREFIX + "/dynamic-oopif.html")
          yield* page.frames.waitFor((tree) => flatten(tree).some((frame) => frame.url.endsWith("/oopif.html")))
          const tree = yield* page.frames
          assert.strictEqual(iframeCount(tree), 1)
          assert.strictEqual(flatten(tree).length, 2)
          // puppeteer.connect to the same browser, then the target that shows the page: target.page()
          yield* Effect.gen(function*() {
            const [target] = yield* pagesAt((url) => url.endsWith("dynamic-oopif.html"))
            assert.isDefined(target, "the connected browser has no target for dynamic-oopif.html")
            yield* target!.inspect
          }).pipe(Effect.provide(connected))
        })
      )
  )

  test("OOPIF should support lazy OOP frames", ({ page, server }) =>
    Effect.gen(function*() {
      // The lazy frame's https://www.example.com is answered by the test, so nothing leaves the machine, and a request
      // for it would show the frame had started loading
      yield* page.route("https://www.example.com/**", () => Route.fulfill(HttpServerResponse.text("lazy")))
      yield* page.goto(server.PREFIX + "/lazy-oopif-frame.html", { waitUntil: "load" })
      yield* page.emulate({ viewport: { width: 1000, height: 1000 } })
      // frame._hasStartedLoading is [true, true, false]: the page and the about:blank frame started, the lazy one didn't
      const tree = yield* page.frames
      assert.strictEqual(flatten(tree).length, 3)
      assert.deepStrictEqual((yield* NetworkRequest.history(page, { url: "https://www.example.com/**" })).entries, [])
      assert.notInclude(String(tree.children[1]!.url), "example.com")
    }))

  test("OOPIF should evaluate on a page with a PDF viewer", ({ page, server }) =>
    Effect.gen(function*() {
      // networkidle2 has no Strider state: the port waits for the tree the test checks, as the original's idle network
      // does, so the PDF viewer's last frame has navigated off about:blank
      yield* page.goto(server.PREFIX + "/pdf-viewer.html", { waitUntil: "load" })
      const expected = ["/pdf-viewer.html", "/sample.pdf", "/index.html", "/sample.pdf"]
      const pathnamesOf = (tree: Page.FrameTree) => flatten(tree).map((frame) => new URL(frame.url).pathname)
      const tree = yield* page.frames.waitFor((tree) => pathnamesOf(tree).join(" ") === expected.join(" "))
      // frame.evaluate(() => window.location.pathname) where the frame has an element to enter it by: the page, and the
      // PDF's document. The viewer's own frames and the one inside them are the tree's alone
      const second = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* page.locator(":root").evaluate(() => window.location.pathname), expected[0])
      assert.strictEqual(yield* second.locator(":root").evaluate(() => window.location.pathname), expected[1])
      assert.deepStrictEqual(pathnamesOf(tree), expected)
    }))

  test("OOPIF should continue intercepted requests from workers in OOPIFs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/worker/worker.html")
      const [worker] = yield* page.workers.waitFor((workers) => workers.length === 1)
      // page.setRequestInterception(true) with every request continued
      yield* page.route("**", () => Route.continue)
      const url = server.CROSS_PROCESS_PREFIX + "/empty.html"
      const requested = yield* NetworkRequest.next(page, { url })
      // Requests from a worker in an OOPIF are paused on the OOPIF session, so continuing them on any other session
      // leaves the fetch hanging.
      const result = yield* worker!.evaluate(async (url: string) => {
        try {
          await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) })
          return "ok"
        } catch {
          return "error"
        }
      }, url)
      assert.strictEqual(result, "ok")
      // request.worker() is the worker: the request's initiator names the worker's realm
      const request = yield* requested
      assert.isTrue(request.initiator._tag === "Worker" && request.initiator.realm === worker!.realm)
    }))
})
