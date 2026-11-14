/**
 * Playwright's `tests/library/chromium/oopif.spec.ts`: cross-site frames that Chromium runs in processes of their
 * own, under `--site-per-process` as the original launches.
 *
 * What the port changes:
 * - Playwright's `assertOOPIFCount(browser, n)` counts Chromium's iframe targets, which Strider doesn't expose. The
 *   frame tree's size and the frame's origin stand in for it; that the frame is out of process follows from the
 *   fixture server's two sites under `--site-per-process`.
 * - A frame is entered by its element (`page.frame(iframe)`) and read through a locator in it, in Strider's
 *   isolated world. Where the original reads a main-world global in a frame, which Strider can't (the
 *   `method-frame-evaluate` row), the test's own script copies it into the DOM; that's said where it happens.
 * - Where the original reloads a frame with `frame.goto(frame.url())`, the port sets the iframe's `src` again.
 * - OO-014, OO-028 and OO-029 (in their own paragraph below) read frames' requests and frame trees the way the original
 *   does, through the frame tree and the request and response logs: `NetworkRequest.history` gives each request's frame
 *   (its document initiator), and `NetworkResponse.history` the responses that arrived for those requests, joined to
 *   them by hop. Playwright's `requestfinished` has no Strider event, so the finished frames are read from the
 *   responses that arrived; for these documents, which read no subresources, that is the same point. OO-028 and
 *   OO-029 connect to a second Chromium over CDP with `Chromium.layerConnect`: the host is launched through the harness's
 *   own backend with its debugging port, and it stays up while the connection reads it.
 * - The out-of-process count of OO-014, OO-028 and OO-029 counts the frames whose origin differs from their parent's,
 *   the same stand-in for the OOPIF count as above. OO-028's and OO-029's host browsers keep their original arguments,
 *   so their frames are out of process by Chromium's default site isolation, as the original's are.
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert } from "@effect/vitest"
import {
  Browser,
  Condition,
  ConsoleMessage,
  Expect,
  FileChooser,
  NetworkRequest,
  NetworkResponse,
  Page,
  PageNavigation,
  Route
} from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { backend } from "../../../harness/browsers.ts"
import { attachFrame, frameCount } from "../../../harness/playwright.ts"
import { type Fixtures, upstream } from "../../../harness/upstream.ts"

const href = () => "" + location.href

/** The frames of a tree, out of process: those whose origin differs from their parent's. */
const outOfProcess = (node: Page.FrameTree): number =>
  node.children.reduce(
    (sum, child) => sum + (new URL(child.url).origin === new URL(node.url).origin ? 0 : 1) + outOfProcess(child),
    0
  )

/** The frame a request's document belongs to. */
const frameOf = (request: NetworkRequest.NetworkRequest) =>
  request.initiator._tag === "Document" ? request.initiator.navigable : undefined

/** A frame tree as Playwright's `dumpFrames` lists it: each frame's URL, its children indented under it. */
const dumpFrames = (node: Page.FrameTree, indent = ""): ReadonlyArray<string> => [
  indent + node.url,
  ...node.children.flatMap((child) => dumpFrames(child, indent + "    "))
]

upstream(import.meta.filename, {
  browsers: ["chromium"],
  launch: { chromium: { args: ["--site-per-process"] } }
}, (test) => {
  test("OO-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const oopif = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* oopif.locator(":root").evaluate(href), server.CROSS_PROCESS_PREFIX + "/grid.html")
    }))

  test("OO-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const oopif = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* oopif.locator(":root").evaluate(href), server.CROSS_PROCESS_PREFIX + "/grid.html")
      yield* page.evaluate(() => document.querySelector("iframe")!.remove())
      // Playwright waits for `framedetached`; Strider's frame tree is the state that event changes
      yield* page.frames.waitFor((tree) => tree.children.length === 0)
    }))

  test("OO-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/worker/worker.html")
      yield* page.workers.waitFor((workers) => workers.length === 1)
      assert.strictEqual(yield* frameCount(page), 2)
      yield* page.goto(server.PREFIX + "/title.html", { waitUntil: "load" })
      yield* page.workers.waitFor((workers) => workers.length === 0)
    }))

  test("OO-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* Effect.scoped(Effect.gen(function*() {
        yield* page.context.route("**/*", () => Route.continue)
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/worker/worker.html")
        yield* page.workers.waitFor((workers) => workers.length === 1)
        assert.strictEqual(yield* frameCount(page), 2)
        yield* page.goto(server.CROSS_PROCESS_PREFIX + "/title.html", { waitUntil: "load" })
        // Closing the scope removes the route: Playwright's `context.unrouteAll()`
      }))
    }))

  test("OO-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const oopif = page.frame(page.locator("iframe"))
      assert.strictEqual(yield* oopif.locator(":root").evaluate(href), server.CROSS_PROCESS_PREFIX + "/grid.html")
      const local = yield* PageNavigation.next(page, {
        frames: "all",
        url: server.PREFIX + "/grid.html",
        waitUntil: "load"
      })
      yield* page.evaluateInMainWorld(() => (window as unknown as { goLocal: () => void }).goLocal())
      yield* local
      assert.strictEqual(yield* oopif.locator(":root").evaluate(href), server.PREFIX + "/grid.html")
      const remote = yield* PageNavigation.next(page, {
        frames: "all",
        url: server.CROSS_PROCESS_PREFIX + "/grid.html",
        waitUntil: "load"
      })
      yield* page.evaluateInMainWorld(() => (window as unknown as { goRemote: () => void }).goRemote())
      yield* remote
      assert.strictEqual(yield* oopif.locator(":root").evaluate(href), server.CROSS_PROCESS_PREFIX + "/grid.html")
    }))

  // A `fixme` upstream: Playwright fails it too
  test("OO-006", ({ page, server }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* page.viewportSize, Option.some({ width: 1280, height: 720 }))
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const root = page.frame(page.locator("iframe")).locator(":root")
      const screen = () => ({
        width: window.screen.width,
        height: window.screen.height,
        deviceWidth: matchMedia("(device-width: 1280px)").matches,
        deviceHeight: matchMedia("(device-height: 720px)").matches,
        touch: "ontouchstart" in window
      })
      assert.deepStrictEqual(yield* root.evaluate(screen), {
        width: 1280,
        height: 720,
        deviceWidth: true,
        deviceHeight: true,
        touch: false
      })
      yield* page.emulate({ viewport: { width: 123, height: 456 } })
      assert.deepStrictEqual(
        yield* root.evaluate(() => ({
          width: window.screen.width,
          height: window.screen.height,
          deviceWidth: matchMedia("(device-width: 123px)").matches,
          deviceHeight: matchMedia("(device-height: 456px)").matches,
          touch: "ontouchstart" in window
        })),
        { width: 123, height: 456, deviceWidth: true, deviceHeight: true, touch: false }
      )
    }))

  test("OO-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const root = page.frame(page.locator("iframe")).locator(":root")
      const dark = () => matchMedia("(prefers-color-scheme: dark)").matches
      assert.strictEqual(yield* root.evaluate(dark), false)
      yield* page.emulate({ media: { colorScheme: "dark" } })
      assert.strictEqual(yield* root.evaluate(dark), true)
    }))

  test("OO-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const root = page.frame(page.locator("iframe")).locator(":root")
      assert.strictEqual(yield* root.evaluate(() => navigator.onLine), true)
      yield* page.context.emulate({ network: "offline" })
      assert.strictEqual(yield* root.evaluate(() => navigator.onLine), false)
    }))

  test("OO-010", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      // Playwright's `devices['iPhone 6']`, with its user agent replaced as the original replaces it
      const context = yield* Browser.newContext({
        emulation: {
          viewport: { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
          touch: true,
          timezone: "America/Jamaica",
          locale: "fr-CH",
          userAgent: "UA"
        }
      })
      const page = yield* context.newPage
      const requested = yield* server.waitForRequest("/grid.html")
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      const request = yield* requested
      assert.strictEqual(yield* frameCount(page), 2)
      const root = page.frame(page.locator("iframe")).locator(":root")
      assert.strictEqual(yield* root.evaluate(() => "ontouchstart" in window), true)
      assert.strictEqual(
        yield* root.evaluate(() => new Date(1479579154987).toString()),
        "Sat Nov 19 2016 13:12:34 GMT-0500 (heure normale de l’Est nord-américain)"
      )
      assert.strictEqual(yield* root.evaluate(() => navigator.language), "fr-CH")
      assert.strictEqual(yield* root.evaluate(() => navigator.userAgent), "UA")
      assert.strictEqual(request.headers["user-agent"], "UA")
    }))

  test("OO-011", ({ page, server }) =>
    Effect.gen(function*() {
      let intercepted = false
      yield* page.route("**/digits/0.png", () =>
        Effect.suspend(() => {
          intercepted = true
          return Route.continue
        }))
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual(intercepted, true)
    }))

  test("OO-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () => Route.continue)
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
    }))

  test("OO-014", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      // main.evaluate: the main frame adds the cross-process iframe, and waits for its load
      yield* page.evaluateInMainWorld(async (url) => {
        const iframe = document.createElement("iframe")
        iframe.src = url
        document.body.appendChild(iframe)
        await new Promise((resolve) => iframe.onload = resolve)
      }, server.CROSS_PROCESS_PREFIX + "/empty.html")
      assert.strictEqual(yield* frameCount(page), 2)
      // main.childFrames()[0]: the iframe's load above already waited for its domcontentloaded, so the original's
      // waitForLoadState has nothing left to wait for
      const child = page.frame(page.locator("iframe"))
      // child.evaluate: the child adds the grandchild inside its own document, in its isolated world, which shares
      // the DOM the iframe's load is on
      yield* child.locator("body").evaluate(async (_body, url) => {
        const iframe = document.createElement("iframe")
        iframe.src = url
        document.body.appendChild(iframe)
        await new Promise((resolve) => iframe.onload = resolve)
      }, server.PREFIX + "/empty.html")
      assert.strictEqual(yield* frameCount(page), 3)
      // child.childFrames()[0]: the same wait as above, already satisfied by the grandchild's load
      const tree = yield* page.frames
      const [childNode] = tree.children
      const [grandChildNode] = childNode!.children
      assert.strictEqual(outOfProcess(tree), 2)

      // requestFrames: each request's frame, in the order the requests were sent: main, child, grandchild
      const requests = (yield* NetworkRequest.history(page)).entries
      assert.deepStrictEqual(requests.map(frameOf), [tree.id, childNode!.id, grandChildNode!.id])
      // finishedFrames: the same frames, read from the responses that arrived, joined to their requests by hop
      const responses = (yield* NetworkResponse.history(page)).entries
      const finishedFrames = responses.map((response) => {
        const request = requests.find((each) => each.hop === response.hop)
        return request === undefined ? undefined : frameOf(request)
      })
      assert.deepStrictEqual(finishedFrames, [tree.id, childNode!.id, grandChildNode!.id])
    }))

  test("OO-016", ({ page, server }) =>
    Effect.gen(function*() {
      // The original reads `window.foo` and `window.bar` in each frame's main world. Strider reads frames in its
      // isolated world, so each script also copies its global into the document once it's parsed.
      yield* page.context.addInitScript(() => {
        ;(window as unknown as { bar: number }).bar = 17
        addEventListener("DOMContentLoaded", () => {
          document.documentElement.dataset["bar"] = String((window as unknown as { bar: number }).bar)
        })
      })
      yield* page.addInitScript(() => {
        ;(window as unknown as { foo: number }).foo = 42
        addEventListener("DOMContentLoaded", () => {
          document.documentElement.dataset["foo"] = String((window as unknown as { foo: number }).foo)
        })
      })
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const globals = () => ({
        foo: document.documentElement.dataset["foo"],
        bar: document.documentElement.dataset["bar"]
      })
      assert.deepStrictEqual(yield* page.locator(":root").evaluate(globals), { foo: "42", bar: "17" })
      assert.deepStrictEqual(yield* page.frame(page.locator("iframe")).locator(":root").evaluate(globals), {
        foo: "42",
        bar: "17"
      })
    }))

  test("OO-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/button-overlay-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      yield* page.locator("button").click()
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as unknown as { BUTTON_CLICKED?: boolean }).BUTTON_CLICKED),
        true
      )
    }))

  /** The original's frame styling, then the frame reloaded so it lays out at its new size. */
  const restyle = Effect.fnUntraced(function*(
    page: Fixtures["page"],
    server: Fixtures["server"],
    style: { readonly width: string; readonly height: string; readonly marginLeft: string; readonly marginTop: string }
  ) {
    yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
    yield* page.locator("iframe").evaluate((iframe, style) => {
      Object.assign((iframe as HTMLIFrameElement).style, style)
    }, style)
    const reloaded = yield* PageNavigation.next(page, {
      frames: "all",
      url: server.CROSS_PROCESS_PREFIX + "/grid.html",
      waitUntil: "load"
    })
    yield* page.locator("iframe").evaluate((iframe) => {
      const element = iframe as HTMLIFrameElement
      element.setAttribute("src", element.src)
    })
    yield* reloaded
    assert.strictEqual(yield* frameCount(page), 2)
  })

  test("OO-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* restyle(page, server, { width: "520px", height: "520px", marginLeft: "42px", marginTop: "17px" })
      const box = page.frame(page.locator("iframe")).locator(".box:nth-of-type(13)")
      const expected = Condition.make(
        "the box at (142, 67), 50×50",
        (found: Option.Option<{ x: number; y: number; width: number; height: number }>) =>
          Option.isSome(found) && found.value.x === 142 && found.value.y === 67 && found.value.width === 50 &&
          found.value.height === 50
      )
      yield* Expect.that(box.boundingBox, expected)
      const local = yield* PageNavigation.next(page, {
        frames: "all",
        url: server.PREFIX + "/grid.html",
        waitUntil: "load"
      })
      yield* page.evaluateInMainWorld(() => (window as unknown as { goLocal: () => void }).goLocal())
      yield* local
      yield* Expect.that(box.boundingBox, expected)
    }))

  test("OO-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* restyle(page, server, { width: "500px", height: "500px", marginLeft: "102px", marginTop: "117px" })
      const box = page.frame(page.locator("iframe")).locator(".box:nth-of-type(13)")
      yield* box.evaluate((div) =>
        div.addEventListener("click", () => (window as unknown as { _clicked: boolean })._clicked = true, false)
      )
      yield* box.click()
      assert.strictEqual(yield* box.evaluate(() => (window as unknown as { _clicked?: boolean })._clicked), true)
    }))

  test("OO-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      // Playwright reaches the frame twice, by locator and by element handle; Strider has the one way
      assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("div").count, 200)
    }))

  test("OO-023", ({ page, server }) =>
    Effect.gen(function*() {
      // Subscribed before the out-of-process frame exists, as the original listens
      const choosers = yield* FileChooser.next(page)
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const frame = page.frame(page.locator("iframe"))
      // `frame.setContent` has no Strider equivalent; the frame's body is replaced instead
      yield* frame.locator("body").evaluate((body) => body.innerHTML = "<input type=file>")
      yield* frame.locator("input").click()
      yield* choosers
    }))

  test("OO-024", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.strictEqual(yield* frameCount(page), 2)
      const frame = page.frame(page.locator("iframe"))
      yield* frame.locator("body").evaluate((body) =>
        body.innerHTML = `<button onclick="console.log('clicked')">OK</button>`
      )
      const message = yield* ConsoleMessage.next(page)
      yield* frame.locator("button").click()
      assert.strictEqual((yield* message).text, "clicked")
    }))

  test("OO-026", ({ page, server }) =>
    Effect.gen(function*() {
      const grid = yield* NetworkResponse.next(page, {
        url: "**/grid.html",
        body: (message) => message.text
      })
      yield* page.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
      assert.isTrue((yield* grid).body.length > 0)
    }))

  // The original's debugging port is 10123 + parallelIndex * 4; one test runs at a time here, so each test has a port
  // of its own only to keep the two hosts apart if a run is interrupted.
  const connected = (port: number) =>
    Chromium.layerConnect(`http://localhost:${port}`).pipe(Layer.provide(NodeSocket.layerWebSocketConstructor))

  test("OO-028", { page: false }, ({ server }) =>
    Effect.scoped(
      Effect.gen(function*() {
        // hostPage: the host browser's tab, which the original opens and navigates before connecting
        yield* Effect.gen(function*() {
          const host = yield* Browser.Browser
          const [tab] = yield* host.pages.waitFor((pages) => pages.length > 0)
          const hostPage = yield* tab!.control
          yield* hostPage.goto(server.PREFIX + "/dynamic-oopif.html", { waitUntil: "load" })
        })
        // browser.contexts()[0].pages()[0]: the connected browser's first page is the host's tab
        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const [first] = yield* browser.pages.waitFor((pages) => pages.length > 0)
          const page = yield* first!.inspect
          assert.strictEqual(yield* frameCount(page), 2)
          const tree = yield* page.frames
          assert.strictEqual(outOfProcess(tree), 1)
          // the frame's location is the grid, read in the frame
          const frame = page.frame(page.locator("iframe"))
          assert.strictEqual(yield* frame.locator(":root").evaluate(href), server.CROSS_PROCESS_PREFIX + "/grid.html")
        }).pipe(Effect.provide(connected(10123)))
      }).pipe(Effect.provide(backend("chromium", { chromium: { args: ["--remote-debugging-port=10123"] } })))
    ))

  test("OO-029", { page: false }, ({ server }) =>
    Effect.scoped(
      Effect.gen(function*() {
        // top > cross-site iframe (oopif) > same-process child iframe > sandboxed srcdoc iframe (oopif).
        server.setRoute("/nested-top.html", (_request, response) => {
          response.setHeader("Content-Type", "text/html")
          response.end(`<h1 id=top>TOP</h1><iframe src="${server.CROSS_PROCESS_PREFIX}/nested-b.html"></iframe>`)
        })
        server.setRoute("/nested-b.html", (_request, response) => {
          response.setHeader("Content-Type", "text/html")
          response.end(`<iframe src="/nested-c.html"></iframe>`)
        })
        server.setRoute("/nested-c.html", (_request, response) => {
          response.setHeader("Content-Type", "text/html")
          response.end(`<iframe sandbox="allow-scripts" srcdoc="<p>D</p>"></iframe>`)
        })

        // hostPage: the host browser's tab, navigated as the original's hostPage.goto is
        yield* Effect.gen(function*() {
          const host = yield* Browser.Browser
          const [tab] = yield* host.pages.waitFor((pages) => pages.length > 0)
          const hostPage = yield* tab!.control
          yield* hostPage.goto(server.PREFIX + "/nested-top.html", { waitUntil: "load" })
        })

        yield* Effect.gen(function*() {
          const browser = yield* Browser.Browser
          const [first] = yield* browser.pages.waitFor((pages) => pages.length > 0)
          const page = yield* first!.inspect
          // assertOOPIFCount(browser, 2): the two cross-site frames, the sandboxed one among them
          assert.strictEqual(outOfProcess(yield* page.frames), 2)

          // dumpFrames: the whole tree, each frame's URL, and each frame's own location read through its locator
          const expectedTree = [
            server.PREFIX + "/nested-top.html",
            "    " + server.CROSS_PROCESS_PREFIX + "/nested-b.html",
            "        " + server.CROSS_PROCESS_PREFIX + "/nested-c.html",
            "            about:srcdoc"
          ]
          const tree = yield* page.frames
          assert.deepStrictEqual(dumpFrames(tree), expectedTree)
          assert.strictEqual(yield* frameCount(page), 4)
          const [b] = tree.children
          const [c] = b!.children
          const [d] = c!.children
          assert.strictEqual(yield* page.evaluate(href), tree.url)
          const frameB = page.frame(page.locator("iframe"))
          assert.strictEqual(yield* frameB.locator(":root").evaluate(href), b!.url)
          const frameC = frameB.frame(frameB.locator("iframe"))
          assert.strictEqual(yield* frameC.locator(":root").evaluate(href), c!.url)
          const frameD = frameC.frame(frameC.locator("iframe"))
          assert.strictEqual(yield* frameD.locator(":root").evaluate(href), d!.url)

          assert.strictEqual(yield* page.url, server.PREFIX + "/nested-top.html")
          assert.isTrue(yield* page.evaluate(() => window.top === window))
          yield* Expect.toHaveText(page.locator("#top"), "TOP")
          // the sandboxed frame's paragraph, three frames deep
          yield* Expect.toHaveText(frameD.locator("p"), "D")
        }).pipe(Effect.provide(connected(10127)))
      }).pipe(
        Effect.provide(backend("chromium", {
          chromium: {
            args: ["--remote-debugging-port=10127", "--site-per-process", "--enable-features=IsolateSandboxedIframes"]
          }
        }))
      )
    ))
})
