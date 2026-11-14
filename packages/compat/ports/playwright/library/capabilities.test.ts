/**
 * Playwright's `tests/library/capabilities.spec.ts`: web platform features the browser supports (WebAssembly, workers,
 * media, WebGL, CSS and script APIs, service workers, and the like), and whether each is there.
 *
 * What the port changes:
 * - Upstream's `it.skip`, `it.fixme`, and the platform conditions that gate them aren't ported: every test runs on every
 *   browser it runs on upstream, and a browser's failure is a result, not a skip. A test upstream runs on one browser
 *   only (CA-011 on Chromium, CA-016 on WebKit, `it.skip(browserName !== …)`) runs there alone, and the ledger marks the
 *   others. Upstream's own browser branches inside a test (CA-012's error message on WebKit, CA-019, CA-028's state on
 *   WebKit) are kept.
 * - Playwright's `evaluate` runs every call as a user gesture. Strider's `evaluateInMainWorld` doesn't unless asked
 *   (`Page.withUserGesture`), so the calls that need one, which Chromium refuses without it, run with it: `play()` on
 *   media (CA-005 to CA-007) and `requestFullscreen()` (CA-020).
 * - Playwright's `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. A returned value
 *   crosses by value, so a non-serializable one is read as a boolean where the original asserts truthiness (CA-013's
 *   `navigator.clipboard`).
 * - `page.goto` and `page.reload` wait for `load` by default in Playwright; the port asks for `load` where the original
 *   relies on it.
 * - `page.$eval(selector, fn)` is `page.evaluateInMainWorld` running a `querySelector` in the page.
 * - `expect.poll(() => boundingBox)` is `Expect.that` over a read, which runs again until its deadline.
 * - `page.waitForTimeout(ms)` is `Effect.sleep`, as the original's own fixed waits (CA-007, CA-010, CA-011).
 * - `page.frames()[1]` is `page.frame(page.locator("iframe"))`, and a frame's own script runs as the original's
 *   `iframe.evaluate` does, through `page.evaluateInMainWorld` on the same-origin frame's `contentWindow`. A frame's
 *   locator is the isolated world's, so `frameLocator("iframe").locator("div")` is `page.frame(...).locator(...)`.
 * - CA-026's `fileChooser.page()` is the page the chooser was subscribed on: Strider's `FileChooser` data carries no
 *   page, so the assertion is that the chooser arrived on `FileChooser.next(page)`.
 * - Playwright's `server.HOST` is `localhost:<port>`, the host of `server.PREFIX`.
 * - CA-029 uses `context.credentials.install()`, which Strider has no counterpart of, so it isn't ported (see the
 *   ledger).
 * - CA-001's context accepts the test server's self-signed certificate with `acceptInsecureCerts`, which Strider
 *   supports on Firefox and launched WebKit only, and refuses on Chromium.
 * - CA-004 sets the CSP header on the fixture server's route, as the original does on its own.
 * - Upstream's `annotation` and `it.info().annotations` issue links are not carried over; each test's name says what it
 *   checks.
 */
import { assert } from "@effect/vitest"
import { Browser, Condition, Expect, FileChooser, Page, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { HttpServerResponse } from "effect/http"
import * as Result from "effect/Result"
import * as url from "node:url"
import { assetPath } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("CA-001", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      // The route is shared by the server's plain and TLS listeners, as Playwright's `httpsServer.setRoute` is for its
      // own, so the same handler answers here
      server.setRoute("/sharedarraybuffer", (_req, res) => {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
        // Note: without 'onload', Firefox sometimes does not fire the load event over the protocol. The reason is unclear.
        res.end(`
      <div>Hello there!</div>
      <script>window.onload = () => console.log('onload')</script>
    `)
      })
      yield* page.goto(server.https.PREFIX + "/sharedarraybuffer", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => typeof SharedArrayBuffer), "function")
    }))

  test("CA-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/wasm/table2.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).loadTable()), "42, 83")
    }))

  test("CA-003", ({ page, server }) =>
    Effect.gen(function*() {
      server.sendOnWebSocketConnection("incoming")
      const value = yield* page.evaluateInMainWorld((host) => {
        let cb: (value: unknown) => void
        const result = new Promise((f) => cb = f)
        const ws = new WebSocket("ws://" + host + "/ws")
        ws.addEventListener("message", (data) => {
          ws.close()
          cb(data.data)
        })
        ws.addEventListener("error", () => cb("Error"))
        return result
      }, new URL(server.PREFIX).host)
      assert.strictEqual(value, "incoming")
    }))

  test("CA-004", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/empty.html", (_req, res) => {
        res.setHeader("Content-Security-Policy", `script-src 'unsafe-inline';`)
        res.end(`
      <script>
        window.testStatus = 'SUCCESS';
        window.testStatus = eval("'FAILED'");
      </script>`)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as any).testStatus), "SUCCESS")
    }))

  test("CA-005", ({ page, browserName }) =>
    Effect.gen(function*() {
      // Safari only plays mp4, so the original tests WebKit with an mp4 clip
      const fileName = browserName === "webkit" ? "video_mp4.html" : "video.html"
      yield* page.goto(url.pathToFileURL(assetPath("playwright", fileName)).href, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => (document.querySelector("video") as HTMLVideoElement).play()).pipe(
        Page.withUserGesture
      )
      yield* page.evaluateInMainWorld(() => (document.querySelector("video") as HTMLVideoElement).pause())
    }))

  test("CA-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.goto(url.pathToFileURL(assetPath("playwright", "video_webm.html")).href, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => (document.querySelector("video") as HTMLVideoElement).play()).pipe(
        Page.withUserGesture
      )
      yield* page.evaluateInMainWorld(() => (document.querySelector("video") as HTMLVideoElement).pause())
    }))

  test("CA-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<audio src="${server.PREFIX}/example.mp3"></audio>`)
      yield* page.evaluateInMainWorld(() => (document.querySelector("audio") as HTMLAudioElement).play()).pipe(
        Page.withUserGesture
      )
      // The original's own fixed wait, `page.waitForTimeout(3000)`, while the audio plays
      yield* Effect.sleep("3 seconds")
      yield* page.evaluateInMainWorld(() => (document.querySelector("audio") as HTMLAudioElement).pause())
      assert.isAbove(
        yield* page.evaluateInMainWorld(() => (document.querySelector("audio") as HTMLAudioElement).currentTime),
        0.1
      )
    }))

  test("CA-008", ({ page }) =>
    Effect.gen(function*() {
      const hasWebGL = yield* page.evaluateInMainWorld(() => {
        const canvas = document.createElement("canvas")
        return !!canvas.getContext("webgl")
      })
      assert.isTrue(hasWebGL)
    }))

  test("CA-009", ({ page }) =>
    Effect.gen(function*() {
      const hasWebGL2 = yield* page.evaluateInMainWorld(() => {
        const canvas = document.createElement("canvas")
        return !!canvas.getContext("webgl2")
      })
      assert.isTrue(hasWebGL2)
    }))

  test("CA-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<video><source src="${server.PREFIX}/movie.mp4"/></video>`)
      // The original's own fixed wait, `page.waitForTimeout(1000)`
      yield* Effect.sleep("1 second")
    }))

  test("CA-011", { browsers: ["chromium"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // "User activation is required to show a file picker." - so we click first.
      yield* page.locator("body").click()
      yield* page.evaluateInMainWorld(() => {
        ;(window as any).showDirectoryPicker().catch((e: unknown) => {
          ;(window as any).__pickerError = String(e)
        })
      })
      // The dialog will not be accepted, so we just wait for some time to give the browser a chance to crash.
      yield* Effect.sleep("3 seconds")
      // In headless it throws (aborted), in headed it stalls and waits for the picker to be accepted.
      const error = yield* page.evaluateInMainWorld(() => (window as any).__pickerError ?? "stalled")
      assert.match(error, /((DOMException|AbortError): .*The user aborted a request|stalled)/)
    }))

  test("CA-012", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const result = yield* Effect.result(page.evaluateInMainWorld(async () => {
        const dir = await navigator.storage.getDirectory()
        return dir.name
      }))
      if (browserName === "webkit") {
        assert(Result.isFailure(result), "storage.getDirectory() succeeded, where WebKit's fails")
        assert.include(
          String(result.failure),
          "UnknownError: The operation failed for an unknown transient reason"
        )
      } else {
        assert(Result.isSuccess(result), `storage.getDirectory() failed: ${String(Result.getFailure(result))}`)
        assert.isFalse(Boolean(result.success))
      }
    }))

  test("CA-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The original asserts the Clipboard object is truthy; the object doesn't cross by value, so the page says it.
      assert.isTrue(yield* page.evaluateInMainWorld(() => Boolean(navigator.clipboard)))
    }))

  test("CA-014", ({ page, server }) =>
    Effect.gen(function*() {
      server.onceWebSocketConnection((socket) => {
        socket.terminate()
      })
      const wasClean = yield* page.evaluateInMainWorld((port) =>
        new Promise<boolean>((resolve) => {
          const ws = new WebSocket("ws://localhost:" + port + "/ws")
          ws.addEventListener("close", (error) => resolve(error.wasClean))
        }), server.PORT)
      assert.strictEqual(wasClean, false)
    }))

  test("CA-015", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/sw.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript")
        res.end(`
      self.addEventListener('fetch', event => {
        event.respondWith(new Response('intercepted'));
      });
      self.addEventListener('activate', event => {
        event.waitUntil(clients.claim());
      });
    `)
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async () => {
        await navigator.serviceWorker.register("/sw.js")
        await new Promise((resolve) => navigator.serviceWorker.oncontrollerchange = resolve)
      })
      yield* page.reload({ waitUntil: "load" })
      assert.strictEqual(yield* page.locator("body").readText, "intercepted")
    }))

  test("CA-016", { browsers: ["webkit"] }, ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => !!(window as any).safari))
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => typeof (window as any).safari.pushNotification),
        "object"
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => (window as any).safari.pushNotification.toString()),
        "[object SafariRemoteNotification]"
      )
    }))

  test("CA-017", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const events = yield* page.evaluateInMainWorld(async () => {
        const events: Array<string> = []
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener("loadstart", () => events.push("loadstart"))
        xhr.upload.addEventListener("progress", () => events.push("progress"))
        xhr.upload.addEventListener("load", () => events.push("load"))
        xhr.upload.addEventListener("loadend", () => events.push("loadend"))
        xhr.open("POST", "/simple.json")
        xhr.send("hello")
        await new Promise((f) => xhr.onload = f)
        return events
      })
      assert.deepStrictEqual(events, ["loadstart", "progress", "load", "loadend"])
    }))

  test("CA-018", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.isTrue(yield* page.evaluateInMainWorld(() => "loading" in HTMLImageElement.prototype))
    }))

  test("CA-019", ({ page, server, browserName }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => "GestureEvent" in window),
        browserName === "webkit"
      )
      assert.strictEqual(
        yield* page.evaluateInMainWorld(() => typeof (window as any).GestureEvent),
        browserName === "webkit" ? "function" : "undefined"
      )
    }))

  test("CA-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Fullscreen needs a user gesture, which Playwright's `evaluate` always gives on Chromium
      yield* page.evaluateInMainWorld(() => {
        const result = new Promise((resolve) => document.addEventListener("fullscreenchange", resolve))
        void document.documentElement.requestFullscreen().then(() => console.log("success")).catch((e) =>
          console.log(e)
        )
        // The original resolves to the `fullscreenchange` Event, which doesn't cross by value: the page waits for it
        return result.then(() => undefined)
      }).pipe(Page.withUserGesture)
      assert.isTrue(
        yield* page.evaluateInMainWorld(() => document.fullscreenElement === document.documentElement)
      )
      yield* page.evaluateInMainWorld(() => {
        const result = new Promise((resolve) => document.addEventListener("fullscreenchange", resolve))
        void document.exitFullscreen().then(() => console.log("success")).catch((e) => console.log(e))
        // The original resolves to the `fullscreenchange` Event, which doesn't cross by value: the page waits for it
        return result.then(() => undefined)
      })
      assert.isFalse(yield* page.evaluateInMainWorld(() => !!document.fullscreenElement))
    }))

  test("CA-021", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Listen before the request is sent, as the original's `Promise.all` does
      const received = yield* server.waitForRequest("/empty.html")
      yield* page.evaluateInMainWorld(async () => {
        await fetch("/empty.html", {
          headers: { "Content-Type": "application/json" },
          method: "GET"
        })
      })
      const request = yield* received
      assert.isUndefined(request.headers["content-length"])
    }))

  test("CA-022", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const formatted = yield* page.evaluateInMainWorld(() => {
        const data = ["first", "second", "third"]
        const listFormat = new Intl.ListFormat("en", {
          type: "disjunction",
          style: "short"
        })
        return listFormat.format(data)
      })
      assert.strictEqual(formatted, "first, second, or third")
    }))

  test("CA-023", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/sw.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" }).end(`
      <script>
        window.registrationPromise = navigator.serviceWorker.register('sw.js');
        window.activationPromise = new Promise(resolve => navigator.serviceWorker.oncontrollerchange = resolve);
      </script>
    `)
      })

      server.setRoute("/iframe.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" }).end(`<div>from the server</div>`)
      })

      server.setRoute("/sw.js", (_req, res) => {
        res.writeHead(200, { "content-type": "application/javascript" }).end(`
      const kIframeHtml = "<div>from the service worker</div>";

      self.addEventListener('fetch', event => {
        if (event.request.url.endsWith('iframe.html')) {
          const blob = new Blob([kIframeHtml], { type: 'text/html' });
          const response = new Response(blob, { status: 200 , statusText: 'OK' });
          event.respondWith(response);
          return;
        }
        event.respondWith(fetch(event.request));
      });

      self.addEventListener('activate', event => {
        event.waitUntil(clients.claim());
      });
    `)
      })

      yield* page.goto(server.PREFIX + "/sw.html", { waitUntil: "load" })
      // The original awaits the promise and discards its value, which is the controller change's Event: an object that
      // doesn't cross by value, so the page awaits it and returns nothing
      yield* page.evaluateInMainWorld(async () => {
        await (window as any).activationPromise
      })

      yield* page.evaluateInMainWorld(() => {
        const iframe = document.createElement("iframe")
        iframe.src = "/iframe.html"
        document.body.appendChild(iframe)
      })

      yield* page.frame(page.locator("iframe")).locator("div").pipe(
        Expect.toHaveText("from the service worker")
      )
    }))

  test("CA-024", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/main.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" }).end(`
      <iframe src='/dir/iframe.html'></iframe>
    `)
      })

      server.setRoute("/dir/iframe.html", (_req, res) => {
        res.writeHead(200, { "content-type": "text/html" }).end(`
      <script>
        window.registrationPromise = navigator.serviceWorker.register('sw.js');
        window.activationPromise = new Promise(resolve => navigator.serviceWorker.oncontrollerchange = resolve);
      </script>
    `)
      })

      server.setRoute("/dir/sw.js", (_req, res) => {
        res.writeHead(200, { "content-type": "application/javascript" }).end(`
      const kIframeHtml = "<div>from the service worker</div>";

      self.addEventListener('fetch', event => {
        if (event.request.url.endsWith('html')) {
          event.respondWith(fetch(event.request));
          return;
        }
        const blob = new Blob(['responseFromServiceWorker'], { type: 'text/plain' });
        const response = new Response(blob, { status: 200 , statusText: 'OK' });
        event.respondWith(response);
      });

      self.addEventListener('activate', event => {
        event.waitUntil(clients.claim());
      });
    `)
      })

      yield* page.goto(server.PREFIX + "/main.html", { waitUntil: "load" })
      // The iframe's own script, in its main world: the original's `iframe.evaluate`, on the same-origin frame
      yield* page.evaluateInMainWorld(async () => {
        const frame = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow as any
        await frame.activationPromise
      })

      const response = yield* page.evaluateInMainWorld(async () => {
        const frame = (document.querySelector("iframe") as HTMLIFrameElement).contentWindow as any
        const fetched = await frame.fetch(new frame.URL("foo.txt", frame.location.href))
        return fetched.text()
      })
      assert.strictEqual(response, "responseFromServiceWorker")
    }))

  test("CA-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`<img src="${server.PREFIX}/rgb.avif" onerror="window.error = true">`)
      yield* Expect.that(
        page.locator("img").boundingBox,
        Condition.make("a 128×128 image", (box) =>
          box._tag === "Some" && box.value.width === 128 && box.value.height === 128)
      )
      assert.isUndefined(
        yield* page.evaluateInMainWorld(() =>
          (window as any).error
        )
      )
    }))

  test("CA-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <form>
      <label>
        A second file
        <input type="file" />
      </label>
    </form>
  `)
      // Subscribed before the click that opens the chooser. Strider's chooser data carries no page: it arrives on this
      // page's subscription, so that the chooser is delivered at all is the page check.
      const fileChooserPromise = yield* FileChooser.next(page)
      yield* page.getByText("A second file").click()
      const fileChooser = yield* fileChooserPromise
      assert.strictEqual(fileChooser._tag, "Single")
    }))

  test("CA-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent("<input type=\"color\">")
      const input = page.locator("input")

      yield* input.pipe(Expect.toBeVisible)
      yield* input.click()
      yield* input.pipe(Expect.toBeVisible)
    }))

  test("CA-028", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.route("**/*", () =>
        Route.fulfill(HttpServerResponse.html(`
      <script>
        async function onLoad() {
          const log = document.getElementById('log');
          const audioContext = new AudioContext();
          const gainNode = new GainNode(audioContext);
          gainNode.connect(audioContext.destination);
          gainNode.gain.value = 0.025;
          const sineNode = new OscillatorNode(audioContext);
          sineNode.connect(gainNode);
          sineNode.start();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          log.innerHTML = 'State: ' + audioContext.state;
        }
      </script>
      <body onload="onLoad()">
      <div id="log"></div>
      </body>`)))
      yield* page.goto("http://127.0.0.1/audio.html", { waitUntil: "load" })
      const log = page.locator("#log")
      if (browserName === "webkit") {
        yield* log.pipe(Expect.toHaveText(/State: (interrupted|suspended)/))
      } else {
        yield* log.pipe(Expect.toHaveText("State: suspended"))
      }
    }))
})
