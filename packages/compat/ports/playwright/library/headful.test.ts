/**
 * Playwright's `tests/library/headful.spec.ts`: a browser with a window on screen, its pages, its popups, its focus, and
 * its clicks, and whether headless and headed Chromium render alike.
 *
 * What the port changes:
 * - The whole file runs headed: every browser is launched with `headless: false`, which the original skips its tests
 *   without. The harness gives each headed launch an X display of its own.
 * - Playwright emulates focus for every page it creates, and a headed Chromium's new tab otherwise leaves the opener
 *   in the background, where it renders no frame. The tests that use a page make it with `focus: "emulated"`
 *   (`emulatedPage`, 1280×720 as the harness's pages are), so they ask for `page: false`; HE-010 and HE-011, which
 *   make their own page and context and never use the fixture's, ask for it too.
 * - Playwright's `launchPersistent()` is the harness's browser, whose first tab is `browser.pages`. Where the original
 *   makes a context of its own, the port makes one with `Browser.newContext`, which closes with its scope, as the
 *   original's `context.close()` does.
 * - Playwright's `browserType.launch()` is a second browser of the test's own: `backend(browserName, …)` provided to
 *   the effect, as the beforeunload port does. A second browser's `page` is a page of that browser.
 * - Each `page.evaluate` runs in the page's main world (`page.evaluateInMainWorld`), and `page.frames()[1]` is the frame
 *   the page's element names (`page.frame(page.locator("iframe"))`).
 * - `page.setViewportSize` is `page.emulate({ viewport })`, which Strider's page emulation keeps until the test's scope
 *   ends.
 * - `page.click(selector)` and `frame.click('text=Submit')` are a locator's click, and `text=` selectors are
 *   `getByText`, which Strider has no `text=` engine for.
 * - `page.mouse.down()` and `page.mouse.up()` are a held button, held in a scope that ends with the press, since Strider's
 *   mouse holds a button only inside a scope (`Mouse.hold`).
 * - Each `Expect` over a read waits on a condition, where the original's `waitForFunction` polls.
 * - HE-015 and HE-016 launch a second, headless browser through the harness's backend. HE-015 compares screenshots
 *   pixel by pixel, which Playwright's `compare` does with a PNG decoder that the compat package doesn't declare, so
 *   the harness's `decodePng` reads the eight-bit, non-interlaced PNGs Strider's screenshots are.
 * - HE-002's `it.slow()` isn't ported: the test keeps Playwright's 30 seconds, as the beforeunload port's do.
 * - HE-015 compares the pixels exactly, where Playwright's `compare` tolerates a small color distance, so the port is the
 *   stricter of the two.
 * - HE-001, HE-003, HE-004, HE-012 and HE-002 make their contexts and pages of their own (`page: false`).
 * - HE-014 reads the click from the console, where the original reads `window._clicked` from inside the out-of-process
 *   frame, a global Strider's frame evaluation (an isolated world) can't see. The page's handler logs as well as setting it.
 * - HE-010 and HE-011 are the original's skips on WebKit (its "no third party cookies" and "window features"); the
 *   port runs them on the other browsers only.
 */
import { assert } from "@effect/vitest"
import { Browser, Condition, ConsoleMessage, Dialog, Expect, Page, Popup } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { backend, type Launch } from "../../harness/browsers.ts"
import { attachFrame } from "../../harness/playwright.ts"
import { decodePng } from "../../harness/png.ts"
import { upstream } from "../../harness/upstream.ts"

/** The file's launch: headed, as the original's `headless` is false in every test it runs. */
const headed: Launch = {
  chromium: { headless: false },
  firefox: { headless: false },
  webkit: { headless: false }
}

/** A second browser for the tests that compare two: headless, where the browser has a headless mode. */
const headless: Launch = {
  chromium: { headless: true },
  firefox: { headless: true },
  webkit: { headless: true }
}

/** A page in a context whose focus is emulated, as Playwright makes each page, 1280×720 as the harness's pages are. */
const emulatedPage = Browser.newPage({ focus: "emulated", emulation: { viewport: { width: 1280, height: 720 } } })

const holds = Condition.make("to be true", (value: unknown) => value === true)

/** A page's load, the readiness `goto` and `setContent` wait for by default in Playwright. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

/** The pixels that differ between two screenshots, as Playwright's `compare` counts them. */
const differentPixels = (a: Uint8Array, b: Uint8Array) => {
  const first = decodePng(a)
  const second = decodePng(b)
  assert.strictEqual(first.width, second.width)
  assert.strictEqual(first.height, second.height)
  let count = 0
  for (let i = 0; i < first.width * first.height; i++) {
    for (let channel = 0; channel < 3; channel++) {
      if (first.data[i * 4 + channel] !== second.data[i * 4 + channel]) {
        count++
        break
      }
    }
  }
  return count
}

upstream(import.meta.filename, { launch: headed }, (test) => {
  test("HE-001", { page: false }, () =>
    Effect.gen(function*() {
      // `launchPersistent()`'s browser: its first tab is the one the browser opened
      const browser = yield* Browser.Browser
      const urls: Array<string> = []
      for (const page of yield* browser.pages) urls.push(yield* page.url)
      assert.deepStrictEqual(urls, ["about:blank"])
    }))

  test("HE-002", { page: false }, ({ server }) =>
    Effect.scoped(
      Effect.gen(function*() {
        // `launchPersistent()` and the context it returns, which the test ends with its scope
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
        // We have to interact with a page so that 'beforeunload' handlers fire.
        yield* page.locator("body").click()
      })
    ))

  test("HE-003", { page: false }, ({ server }) =>
    Effect.scoped(
      Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        yield* page.goto(server.PREFIX + "/beforeunload.html", { waitUntil: "load" })
        // We have to interact with a page so that 'beforeunload' handlers fire.
        yield* page.locator("body").click()
        // The original's `waitForEvent('dialog')` with `page.close({ runBeforeUnload: true })`: Playwright's close resolves
        // once the prompt shows. Here the prompt is held by a handler that never decides, the close waits for its decision
        // in a fiber of its own, and the context's scope ends with the prompt still open.
        const shown = yield* Dialog.next(page)
        yield* Dialog.handle(page, () => Effect.never)
        yield* Effect.forkChild(page.close({ runBeforeUnload: true }))
        yield* shown
      })
    ))

  test("HE-004", { page: false }, () =>
    Effect.gen(function*() {
      yield* Effect.scoped(
        Effect.gen(function*() {
          const context = yield* Browser.newContext()
          yield* context.newPage
        })
      )
      yield* Effect.scoped(
        Effect.gen(function*() {
          const context = yield* Browser.newContext()
          yield* context.newPage
        })
      )
    }))

  test("HE-005", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      // @see https://github.com/microsoft/playwright/issues/22082
      yield* page.emulate({ viewport: { width: 3000, height: 3000 } })
      yield* page.setContent(`
    <style>
      html, body { position: absolute; left: 0; top: 0; right: 0; bottom: 0; }
    </style>
    <button style="position: absolute; right: 0; bottom: 0;">Button in the bottom-right corner</button>
  `)
      yield* page.locator("button").click()
    }))

  test("HE-006", { page: false }, () =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      // @see https://github.com/microsoft/playwright/issues/22082
      // Some prime numbers for width/height.
      const width = 2971
      const height = 3067
      yield* page.emulate({ viewport: { width, height } })
      yield* page.evaluateInMainWorld(() => {
        Reflect.set(window, "events", [])
        window.addEventListener("click", (event) => {
          Reflect.get(window, "events").push({ x: event.clientX, y: event.clientY })
        }, false)
      })
      const expectedEvents: Array<{ x: number; y: number }> = []
      // Allow a little padding from the edges of viewport.
      for (let i = 3; i < 23; ++i) {
        const x = width - i
        const y = height - i
        expectedEvents.push({ x, y })
        yield* page.mouse.move({ x, y })
        // The original's `mouse.down()` and `mouse.up()`: a left button held for this press, released when its scope ends
        yield* Effect.scoped(page.mouse.hold("left"))
      }
      const actualEvents = yield* page.evaluateInMainWorld(() => Reflect.get(window, "events"))
      assert.deepStrictEqual(expectedEvents, actualEvents)
    }))

  test("HE-007", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      yield* page.setContent(`<button>Hello</button><a target=_blank href="${server.EMPTY_PAGE}">empty.html</a>`)
      yield* page.locator("a").click()
      yield* page.locator("button").click()
    }))

  test("HE-008", { page: false }, ({ server, browserName }) =>
    Effect.scoped(
      Effect.gen(function*() {
        // `browserType.launch()`: a browser of the test's own, closed when its scope ends with the menu open
        const page = yield* Browser.newPage()
        yield* page.goto(server.PREFIX + "/grid.html", { waitUntil: "load" })
        yield* page.locator("body").click({ button: "right" })
      }).pipe(Effect.provide(backend(browserName, headed)))
    ))

  test("HE-009", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      // The original's `allowsThirdParty` is true on Firefox and false elsewhere
      const allowsThirdParty = browserName === "firefox"
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const frame = yield* attachFrame(page, "frame", server.CROSS_PROCESS_PREFIX + "/grid.html")
      const documentCookie = yield* frame.locator(":root").evaluate(() => {
        document.cookie = "username=John Doe"
        return document.cookie
      })
      // The original's `page.waitForTimeout(2000)`, ported as written
      yield* Effect.sleep("2 seconds")
      assert.strictEqual(documentCookie, allowsThirdParty ? "username=John Doe" : "")
      const cookies = yield* page.context.cookies.listFor(server.CROSS_PROCESS_PREFIX + "/grid.html")
      if (allowsThirdParty) {
        assert.strictEqual(cookies.length, 1)
        const [cookie] = cookies
        assert.isDefined(cookie)
        assert.strictEqual(cookie.name, "username")
        assert.strictEqual(Redacted.value(cookie.value), "John Doe")
        assert.strictEqual(cookie.domain, "127.0.0.1")
        assert.strictEqual(cookie.path, "/")
        assert.isFalse(cookie.httpOnly)
        assert.isFalse(cookie.secure)
        assert.isTrue(Option.isNone(cookie.expires), "a session cookie, where the original's expires is -1")
      } else {
        assert.deepStrictEqual(cookies, [])
      }
    }))

  test("HE-010", { browsers: ["chromium", "firefox"], page: false }, ({ server }) =>
    Effect.gen(function*() {
      // The original's `ignoreHTTPSErrors` is Strider's `acceptInsecureCerts`, which Chromium refuses (the ledger)
      const page = yield* Browser.newPage({ acceptInsecureCerts: true, focus: "emulated" })

      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, {
          "Content-Type": "text/html"
        })
        res.end(`<iframe src="${server.https.CROSS_PROCESS_PREFIX}/grid.html"></iframe>`)
      })

      server.setRoute("/grid.html", (_req, res) => {
        res.writeHead(200, {
          "Set-Cookie": ["a=b; Path=/; Max-Age=3600; SameSite=None; Secure"],
          "Content-Type": "text/html"
        })
        res.end(`Hello world
    <script>
    setTimeout(() => fetch('/json'), 1000);
    </script>`)
      })

      // The request for `/json` is awaited from the moment it's listened for, as the original's promise is
      const json = yield* server.waitForRequest("/json")
      server.setRoute("/json", (_req, res) => {
        res.end()
      })

      yield* page.goto(server.https.EMPTY_PAGE, { waitUntil: "load" })
      const received = yield* json
      assert.strictEqual(received.headers.cookie, "a=b")
    }))

  test("HE-011", { browsers: ["chromium", "firefox"], page: false }, ({ server }) =>
    Effect.gen(function*() {
      // `viewport: null` is Strider's default, which emulates no viewport, so the context has no emulation at all
      const context = yield* Browser.newContext({ focus: "emulated" })
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const popups = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        const win = window.open(
          window.location.href,
          "Title",
          "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=600,height=300,top=0,left=0"
        )
        if (win === null) throw new Error("the popup was blocked")
        win.resizeTo(500, 450)
      }).pipe(Page.withUserGesture)
      const popup = yield* popups
      // The popup is reported before it loads, so it's waited for: its URL, then its load
      yield* popup.url.waitFor((url) => url === server.EMPTY_PAGE)
      yield* popup.status.waitFor(loaded)
      yield* Expect.that(
        popup.evaluateInMainWorld(() => window.outerWidth === 500 && window.outerHeight === 450),
        holds
      )
    }))

  test("HE-012", { page: false }, () =>
    Effect.gen(function*() {
      const page1 = yield* Browser.newPage()
      yield* page1.setContent("Page1")
      const page2 = yield* Browser.newPage()
      yield* page2.setContent("Page2")

      yield* page1.activate
      assert.strictEqual(yield* page1.evaluateInMainWorld(() => document.visibilityState), "visible")
      assert.strictEqual(yield* page2.evaluateInMainWorld(() => document.visibilityState), "visible")

      yield* page2.activate
      assert.strictEqual(yield* page1.evaluateInMainWorld(() => document.visibilityState), "visible")
      assert.strictEqual(yield* page2.evaluateInMainWorld(() => document.visibilityState), "visible")
    }))

  test("HE-013", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<iframe src="${server.CROSS_PROCESS_PREFIX}/iframe.html"></iframe>`)
      })
      server.setRoute("/iframe.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<button id="button" onclick="console.log('ok')">Submit</button>
    <script>console.log('frame loaded')</script>`)
      })

      // `page.on('console', …)`: every message from the page, its frames included, from before the navigation
      const messages = yield* ConsoleMessage.stream(page)
      const consoleLog: Array<string> = []
      yield* Effect.forkScoped(
        Stream.runForEach(messages, (message) => Effect.sync(() => consoleLog.push(message.text)))
      )

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.frame(page.locator("iframe")).getByText("Submit").click()
      assert.include(consoleLog, "ok")
    }))

  test("HE-014", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
        iframe { position: absolute; bottom: 0; }
      </style>
      <iframe src="${server.CROSS_PROCESS_PREFIX}/iframe.html"></iframe>
    `)
      })

      // The original's handler sets `window._clicked`, read back with the frame's own `evaluate`. Strider's frame evaluates
      // in an isolated world that can't see the page's globals, so the handler also logs, as HE-013's does, and the
      // click is read from the console.
      server.setRoute("/iframe.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
        button { position: absolute; bottom: 0; }
      </style>
      <button id="button" onclick="window._clicked=true; console.log('clicked')">Submit</button>`)
      })

      const page = yield* emulatedPage
      const messages = yield* ConsoleMessage.stream(page)
      const consoleLog: Array<string> = []
      yield* Effect.forkScoped(
        Stream.runForEach(messages, (message) => Effect.sync(() => consoleLog.push(message.text)))
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      if (browserName === "chromium") {
        // CHROME BUG (the original's comment): the automation infobar can resize the view after the navigation, and
        // hit testing in an out-of-process frame then misses; the workaround re-applies the viewport.
        yield* page.emulate({ viewport: { width: 800, height: 600 } })
      }
      yield* page.frame(page.locator("iframe")).getByText("Submit").click()
      assert.include(consoleLog, "clicked")
    }))

  test("HE-015", { page: false }, ({ browserName }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      // @see https://github.com/microsoft/playwright/issues/11177
      const genericFontFamilies = [
        "standard",
        "serif",
        "sans-serif",
        "monospace",
        "cursive",
        "fantasy",
        "emoji"
      ]
      // `browserType.launch({ headless: true })`: a second browser, headless, whose page is the same size as the headed one
      yield* Effect.scoped(
        Effect.gen(function*() {
          const headlessPage = yield* Browser.newPage({ emulation: { viewport: { width: 1280, height: 720 } } })
          for (const family of genericFontFamilies) {
            const content = `<div style="font: 15px bold ${
              family === "standard" ? "" : family
            }; max-width: 300px; max-height: 300px; overflow: hidden">
      Lorem ipsum dolor sit amet consectetur adipiscing elit proin, integer curabitur imperdiet rhoncus cursus tincidunt bibendum, consequat sed magnis laoreet luctus mollis tellus. Nisl parturient mus accumsan feugiat sem laoreet magnis nisi, aptent per sollicitudin gravida orci ac blandit, viverra eros praesent auctor vivamus semper bibendum. Consequat sed habitasse luctus dictumst gravida platea semper phasellus, nascetur ridiculus purus est varius quisque et scelerisque, id vehicula eleifend montes sollicitudin dis velit. Pellentesque ridiculus per natoque et eleifend taciti nunc, laoreet auctor at condimentum imperdiet ante, conubia mi cubilia scelerisque sociosqu sem.</p> <p>Curabitur magna per felis primis mauris non dapibus luctus ultricies eros, quis et egestas condimentum lobortis eget semper montes litora purus, ridiculus elementum sollicitudin imperdiet dictum lacinia parturient cras eu. Risus cum varius rhoncus eros torquent pretium taciti id erat dis egestas, nibh tristique montes convallis metus lacus phasellus blandit ut auctor bibendum semper, facilisis mi integer eget ultrices lobortis odio viverra duis dui. Risus ullamcorper lacinia in venenatis sodales fusce tortor potenti volutpat quis, dictum vulputate suspendisse velit mollis torquent sociis aptent morbi, senectus nascetur justo maecenas conubia magnis viverra gravida fames. Phasellus sed nec gravida nibh class augue lectus, blandit quis turpis orci diam nam pellentesque, ultricies metus imperdiet hendrerit lacinia lacus.</p> <p>Inceptos facilisi montes cum hendrerit, pulvinar ut tellus eget velit, arcu nulla aenean. Phasellus augue urna nostra molestie interdum vehicula, posuere fames cum euismod massa curabitur donec, inceptos cubilia tellus facilisis fermentum. Lacus laoreet facilisis ultrices cursus quisque at ad porta vestibulum massa inceptos, curae class aliquet maecenas cum ullamcorper pulvinar erat mus vitae. Cum in aenean convallis dis quam tincidunt justo sed quisque, imperdiet faucibus hendrerit felis commodo scelerisque magnis vehicula etiam leo, eros varius platea lobortis maecenas condimentum nisi phasellus. Turpis vulputate mus himenaeos sociosqu facilisis dignissim leo quam, ultricies habitasse commodo molestie est tortor vitae et, porttitor risus erat cursus phasellus facilisi litora.</p> <p>Nostra habitasse egestas magnis velit pellentesque parturient cum lectus viverra, vestibulum sociosqu nunc vel urna consequat lacinia phasellus at sapien, aenean pretium dictum sed montes interdum imperdiet iaculis. Leo hac eros arcu senectus maecenas, tortor pulvinar venenatis lacinia volutpat, mattis platea ut facilisi. Aenean condimentum at et donec sociosqu fermentum luctus potenti semper vulputate, sapien justo non est auctor gravida ultricies fames per commodo, sed habitasse facilisi nulla quisque hendrerit aliquet viverra bibendum.</p> <p>Interdum nisl quam etiam montes porttitor laoreet nullam senectus velit, mauris proin tellus imperdiet litora venenatis fames massa quis, sollicitudin justo vivamus curae in sociis suscipit facilisi. Platea inceptos lacus elementum pellentesque quam euismod dictumst sociis tincidunt vulputate porttitor eros, turpis netus ut ad tempor sapien aliquet sodales molestie consequat nostra. Cum augue in quisque primis ut nunc sodales, sem orci tempus posuere cubilia suspendisse lacinia ligula, magna sed ridiculus at maecenas habitant.</p> <p>Natoque magna ac feugiat tellus bibendum diam, metus lobortis nisl ornare varius praesent, dictumst gravida lacus parturient semper. Pellentesque faucibus congue fusce posuere placerat dictum vitae, dui vestibulum eu sociis tempus aliquam ultricies malesuada, potenti laoreet lacus sem gravida nisi. Nostra platea sagittis hendrerit congue conubia senectus bibendum quis sapien pharetra, scelerisque nam imperdiet fermentum feugiat suspendisse viverra luctus at, semper ac consequat vitae mi gravida parturient mollis nascetur. Vel taciti justo consequat primis et blandit convallis sed, felis purus fusce a venenatis etiam aenean scelerisque, fringilla volutpat sagittis egestas rutrum id dis.</p> <p>Feugiat fermentum tortor ante ac iaculis sollicitudin ut interdum, cras orci ullamcorper potenti tristique vehicula. Molestie tortor ullamcorper rutrum turpis malesuada phasellus sem ultricies praesent mattis lobortis porta, senectus venenatis diam nostra laoreet volutpat per aptent justo elementum cum. Urna cursus vel felis cras eleifend arcu enim magnis, duis rutrum nibh nascetur cubilia interdum ultrices curae, id lacus aliquam dictumst diam fringilla lacinia.</p> <p>Luctus diam morbi eget tellus libero taciti faucibus inceptos, natoque facilisis lectus maecenas risus dapibus suscipit nibh, vel curae conubia orci imperdiet metus fusce. Condimentum massa donec luctus pharetra cum, in viverra placerat nisl litora facilisis, neque nascetur sociis dictumst. Suscipit accumsan eget rhoncus pharetra justo malesuada aliquet, suspendisse metus eleifend tincidunt varius ridiculus, convallis primis vitae curabitur quis mus.</p> <p>Gravida donec lacus molestie tortor aenean ultricies blandit per tempor, nostra penatibus orci vestibulum semper lectus vel a, montes potenti cum dapibus natoque eu volutpat nulla. Himenaeos purus nam malesuada habitasse nisl pharetra laoreet feugiat mi non, ultrices ultricies a cras ante eu venenatis ligula. Suscipit ut mus habitasse at aliquet sodales commodo justo, feugiat platea sagittis phasellus eleifend pellentesque interdum iaculis, integer cubilia montes metus hendrerit tincidunt purus.</p> <p>Vel posuere tellus dapibus eget duis cubilia, nec class vehicula libero gravida ligula, tempus urna taciti donec congue. Facilisis ridiculus congue cum dui per augue natoque, molestie hac etiam pellentesque dignissim urna class, feugiat aenean massa himenaeos penatibus ut eu, convallis purus et fusce tempus mattis. At mattis suscipit porta nostra nec facilisis sodales turpis, integer et lectus conubia justo nam congue taciti odio, fermentum semper cubilia fusce nunc purus velit.
      <div/>
    `
            // Playwright's `Promise.all([page.setContent(content), headlessPage.setContent(content)])`
            yield* Effect.all([page.setContent(content), headlessPage.setContent(content)], { concurrency: 2 })
            // The original's `page.screenshot()` and `headlessPage.screenshot()`, read together
            const [image1, image2] = yield* Effect.all([page.screenshot(), headlessPage.screenshot()], {
              concurrency: 2
            })
            assert.strictEqual(differentPixels(image1, image2), 0)
          }
        })
      ).pipe(Effect.provide(backend(browserName, headless)))
    }))

  test("HE-016", { page: false }, ({ server, browserName }) =>
    Effect.gen(function*() {
      const page = yield* emulatedPage
      // @see https://github.com/microsoft/playwright/issues/33590
      const content = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        .hyphenated {
          width: 100px;
          hyphens: auto;
          text-align: justify;
          border: 1px solid black;
        }
      </style>
    </head>
    <body>
      <div class="hyphenated">
        supercalifragilisticexpialidocious
      </div>
    </body>
    </html>
  `
      server.setRoute("/hyphenated.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(content)
      })
      const hyphenHeight = (target: typeof page) =>
        target.evaluateInMainWorld(() => document.querySelector(".hyphenated")!.getBoundingClientRect().height)

      // `browserType.launch({ headless: !headless })`: the opposite browser, headless
      const oppositeHeight = yield* Effect.scoped(
        Effect.gen(function*() {
          const oppositePage = yield* Browser.newPage()
          yield* oppositePage.goto(server.PREFIX + "/hyphenated.html", { waitUntil: "load" })
          return yield* hyphenHeight(oppositePage)
        })
      ).pipe(Effect.provide(backend(browserName, headless)))

      yield* page.goto(server.PREFIX + "/hyphenated.html", { waitUntil: "load" })
      assert.strictEqual(yield* hyphenHeight(page), oppositeHeight)
    }))
})
