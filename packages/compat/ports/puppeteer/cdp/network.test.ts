/**
 * Puppeteer's `test/src/cdp/network.test.ts`: a request's post data, and a request whose HSTS upgrade is an internal
 * redirect that request interception doesn't pause.
 *
 * What the port changes:
 * - `request.postData()` is `NetworkRequest.next` with a `body` decoder: the body the request sent, read as text,
 *   `Option.some` when there is one and `Option.none` when there isn't. Strider reads a request's body whole, where
 *   Puppeteer keeps an inline body apart from one it fetches (`hasPostData`, `fetchPostData`). The blob test's
 *   `postData()` being undefined is that split, which Strider has no form for, so the port asserts the body is present
 *   and holds the blob's text (as `hasPostData` and `fetchPostData` do).
 * - The request is subscribed before the action that sends it, as the original's `waitEvent` is, and its filter
 *   `!isFavicon(r)` is the URL pattern `**\/post`, or the page's own URL.
 * - `page.evaluate` runs page code in the main world, so each is `page.evaluateInMainWorld`.
 * - Puppeteer's `setRequestInterception(true)` with `request.continue()` is `page.route("**\/*", …)` with
 *   `Route.continue`, which resolves each request as it arrives. Its `request` and `response` listeners are
 *   `NetworkRequest.stream` and `NetworkResponse.stream`, which skip the favicon, and its `redirectChain()` is
 *   `NetworkRequest.redirects(page).from`, hop by hop. The test's `http://` page is the same TLS port as its `https://`
 *   one.
 * - The HSTS test's TLS origin needs its certificate trusted. On Chromium the port launches its own browser, as the
 *   original does, with `--ignore-certificate-errors-spki-list` naming the SPKI hash of the certificate the fixture
 *   server made for this run (read from a TLS connection to it), and `domain1.test` mapped to the fixture server, as
 *   the original's host is. Stock WebKit takes `acceptInsecureCerts` on its context, on the fixture's own host.
 * - Puppeteer skips the HSTS test on Firefox ("Test relies on Chrome's internal 307 HSTS upgrade redirect"), so it
 *   runs on Chromium and stock WebKit, and Firefox's ledger entry is not applicable.
 */
import { assert } from "@effect/vitest"
import { Browser, NetworkRequest, NetworkResponse, type PageNavigation, Route } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as crypto from "node:crypto"
import * as tls from "node:tls"
import { backend } from "../../harness/browsers.ts"
import { runnerChromiumArgs } from "../../harness/puppeteer.ts"
import { upstream } from "../../harness/upstream.ts"

const load = { waitUntil: "load" } as const

/** Puppeteer's `isFavicon`: the browser's own request for `/favicon.ico`, which the test doesn't count. */
const isFavicon = (url: string) => new URL(url).pathname === "/favicon.ico"

/** Puppeteer's `response.ok()`: the navigation committed with a response whose status is 2xx. */
const isOk = (navigation: PageNavigation.PageNavigation) =>
  navigation._tag === "Committed" &&
  Option.match(navigation.response, {
    onNone: () => false,
    onSome: (response) => response.status >= 200 && response.status < 300
  })

/** Waits for a background read of the test's own, and names what it waited for when it runs past 10 seconds. */
const bounded = <A, E, R>(effect: Effect.Effect<A, E, R>, what: string) =>
  effect.pipe(Effect.timeoutOrElse({
    duration: "10 seconds",
    orElse: () => Effect.die(new Error(`${what} didn't happen within 10 seconds`))
  }))

/** The base64 SHA-256 of the SPKI of the certificate a TLS server presents: what `--ignore-certificate-errors-spki-list` takes. */
const spkiHash = (port: number) =>
  Effect.callback<string>((resume) => {
    const socket = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }, () => {
      const certificate = new crypto.X509Certificate(socket.getPeerCertificate().raw)
      const spki = certificate.publicKey.export({ type: "spki", format: "der" })
      socket.destroy()
      resume(Effect.succeed(crypto.createHash("sha256").update(spki).digest("base64")))
    })
    socket.on("error", (error) => resume(Effect.die(error)))
  })

upstream(import.meta.filename, {}, (test) => {
  test("network Request.postData should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      server.setRoute("/post", (_req, res) => {
        return res.end()
      })
      const sent = yield* NetworkRequest.next(page, { url: "**/post", body: (message) => message.text })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: JSON.stringify({ foo: "bar" })
        })
      })
      const request = yield* bounded(sent, "the POST request")
      assert.deepStrictEqual(request.body, Option.some("{\"foo\":\"bar\"}"))
    }))

  test(
    "network Request.postData should be |undefined| when there is no post data",
    { page: false },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const context = yield* Browser.newContext()
        const page = yield* context.newPage
        // Subscribed before the navigation that sends the request, as the original's `goto` is the request it reads
        const sent = yield* NetworkRequest.next(page, { url: "**/empty.html", body: (message) => message.text })
        yield* page.goto(server.EMPTY_PAGE, load)
        const request = yield* bounded(sent, "the navigation's request")
        assert.isTrue(Option.isNone(request.body))
      }))
  )

  test("network Request.postData should work with blobs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, load)
      server.setRoute("/post", (_req, res) => {
        return res.end()
      })
      const sent = yield* NetworkRequest.next(page, { url: "**/post", body: (message) => message.text })
      yield* page.evaluateInMainWorld(async () => {
        await fetch("./post", {
          method: "POST",
          body: new Blob([JSON.stringify({ foo: "bar" })], { type: "application/json" })
        })
      })
      const request = yield* bounded(sent, "the POST request with a blob body")
      // `hasPostData` is true, and `fetchPostData` reads the blob's text: Strider's one body read
      assert.isTrue(Option.isSome(request.body))
      assert.deepStrictEqual(request.body, Option.some("{\"foo\":\"bar\"}"))
    }))

  test(
    "network Page.setRequestInterception should work with internal redirects not paused by Fetch.requestPaused",
    { page: false, browsers: ["chromium", "webkit"] },
    ({ browserName, server }) =>
      Effect.scoped(Effect.gen(function*() {
        // Chromium ignores `Strict-Transport-Security` on a connection with a certificate error, even when certificate
        // errors are ignored, so the original launches it with the certificate's SPKI hash and `domain1.test` mapped to
        // the fixture server. Stock WebKit accepts the certificate in a context, on the fixture's own host.
        const chromiumLaunch = browserName === "chromium"
          ? backend("chromium", {
            chromium: {
              args: [
                ...runnerChromiumArgs,
                `--ignore-certificate-errors-spki-list=${yield* spkiHash(server.https.PORT)}`
              ]
            }
          })
          : undefined
        const host = browserName === "chromium" ? "domain1.test" : "localhost"
        const body = Effect.gen(function*() {
          const context = yield* Browser.newContext(browserName === "chromium" ? {} : { acceptInsecureCerts: true })
          const page = yield* context.newPage
          server.setRoute("/hsts", (_req, res) => {
            res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
            res.end("ok")
          })
          const httpsOrigin = `https://${host}:${server.https.PORT}`
          const httpEmptyPage = `http://${host}:${server.https.PORT}/empty.html`
          const httpsEmptyPage = `https://${host}:${server.https.PORT}/empty.html`
          server.setRedirect("/start", httpEmptyPage)

          yield* page.goto(httpsOrigin + "/hsts", load)

          // Puppeteer's `setRequestInterception(true)` and its listeners, which record each request and response
          const requests: Array<NetworkRequest.NetworkRequest> = []
          const responses: Array<number> = []
          const requestStream = yield* NetworkRequest.stream(page)
          const responseStream = yield* NetworkResponse.stream(page)
          const requestFiber = yield* requestStream.pipe(
            Stream.filter((request) => !isFavicon(request.url)),
            Stream.take(3),
            Stream.runForEach((request) => Effect.sync(() => requests.push(request))),
            Effect.forkScoped
          )
          const responseFiber = yield* responseStream.pipe(
            Stream.filter((response) => !isFavicon(response.url)),
            Stream.take(3),
            Stream.runForEach((response) => Effect.sync(() => responses.push(response.status))),
            Effect.forkScoped
          )
          yield* page.route("**/*", () => Route.continue)

          const navigation = yield* page.goto(httpsOrigin + "/start", load)
          yield* bounded(Fiber.join(requestFiber), "the three requests")
          yield* bounded(Fiber.join(responseFiber), "the three responses")

          assert.isTrue(isOk(navigation))
          assert.deepStrictEqual(requests.map((request) => request.url), [
            httpsOrigin + "/start",
            httpEmptyPage,
            httpsEmptyPage
          ])
          assert.deepStrictEqual(responses, [302, 307, 200])

          // `response.request().redirectChain()`: the requests before the final one, first to last
          const redirects = yield* NetworkRequest.redirects(page)
          const chain: Array<NetworkRequest.NetworkRequest> = []
          let previous = yield* redirects.from(requests[2]!)
          while (Option.isSome(previous)) {
            chain.unshift(previous.value)
            previous = yield* redirects.from(previous.value)
          }
          assert.deepStrictEqual(chain.map((request) => request.hop), [requests[0]!.hop, requests[1]!.hop])
        })
        yield* chromiumLaunch === undefined ? body : body.pipe(Effect.provide(chromiumLaunch))
      }))
  )
})
