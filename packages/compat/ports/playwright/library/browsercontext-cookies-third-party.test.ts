/**
 * Playwright's `tests/library/browsercontext-cookies-third-party.spec.ts`: third-party and partitioned cookies, read in
 * frames of two sites, from pages, and after the cookies are exported to another context by `addCookies` and by
 * `storageState`.
 *
 * What the port changes:
 * - Every test here is HTTPS: the original's `ignoreHTTPSErrors` is the test file's `test.use`, so each context accepts
 *   the fixture server's self-signed certificate with `acceptInsecureCerts`. Chromium refuses that per context, so
 *   Chromium isn't ported (the ledger marks it `needsFeature`, as browsercontext-add-cookies' CO-041 does). CO-060 is
 *   `needsFeature` on every browser: its launch is persistent, and a launched default context takes no
 *   `acceptInsecureCerts`.
 * - The tests run on Firefox and stock WebKit only, with the flags of those browsers here: Firefox is Strider's BiDi
 *   Firefox (`isBidi`), and WebKit is stock WebKit on Linux (not macOS, so `isMac` is false, and WebKit doesn't
 *   partition third-party cookies: `webkitPartitions` is false). The branches for other platforms and browsers are not
 *   written, since no run reaches them. They were not run on Firefox or WebKit here; the CI run does.
 * - `page.context().cookies()` is `context.cookies.list`, `cookies(url)` is `cookies.listFor(url)`, and `addCookies` is one
 *   `cookies.set` per cookie. `readd` sets a cookie read from the jar again with the attributes it was read with, as the
 *   original's export does.
 * - Strider's cookie carries `partitionKey` as a tagged value: `Unpartitioned`, or `Partitioned` with its `topLevelSite`
 *   and `crossSiteAncestor` as an `Option`. `partitionOf` reads it as the original's string (its site, or undefined), and
 *   CO-056's `_crHasCrossSiteAncestor` is that `crossSiteAncestor` option.
 * - A frame is `page.frame(page.locator("iframe"))`, and a nested frame enters the outer frame's iframe. A body's text is
 *   `toHaveText` through `Expect`; an `{ timeout: 1000 }` is `Deadline.within("1 second")`.
 * - `expect.soft` is an ordinary assertion here: a failed one ends the test, where the original's soft checks let the rest
 *   run.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. The main page's `document.cookie`
 *   writes are in the main world too. CO-061 writes the cookie from inside a cross-site frame, which is only reachable
 *   through the frame's isolated world (`locator.evaluate`), so CO-061 is ported for Firefox alone: stock WebKit has no
 *   isolated worlds (`method-frame-evaluate`, the ledger).
 * - `page.waitForTimeout(2000)` in CO-061 is the original's own wait, ported as written.
 * - CO-058's `storageState({ path })` also wrote a file at `/tmp`; the port exports the state without writing it.
 * - `httpsServer.waitForRequest` is `server.waitForRequest`, listened to before the action that sends the request, and
 *   each wait is bounded by `awaiting` (the harness's 30 seconds ends the test otherwise). CO-062's `/json` promise is that
 *   request, and the cookie it carried is read from the request's headers.
 * - `browser.newContext()` in the export steps is `Browser.newContext({ acceptInsecureCerts: true })`, as the original's
 *   contexts take the same test-file option.
 * - CO-059's `context.addCookies` with a `127.0.0.1` domain is `cookies.set` with that domain, as Strider names the scope.
 * - CO-061's `allowsThirdParty` is Firefox's `true`, and the expected SameSite of a cookie that names none is Strider's
 *   `undefined`, as CO-002 of browsercontext-cookies reads it, where the original expects `Lax`.
 * - CO-062 and CO-059 run on the browsers the original runs them on, from its `test.skip`s: CO-062 skips WebKit, and CO-059
 *   skips Firefox over BiDi (its Total Cookie Protection blocks the cookie) and runs on WebKit only.
 */
import { assert } from "@effect/vitest"
import { Browser, type CookieJar, Deadline, Expect, type Page, Url, type UserContext } from "@usestrider/browser"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type { BrowserName } from "../../harness/browsers.ts"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

type Urls = ReturnType<typeof urlsOf>

/** The fixture server's TLS origins and the pages the original names, as its `urls` fixture builds them. */
const urlsOf = (server: ServerShape) => {
  const origin1 = server.https.PREFIX
  const origin2 = server.https.CROSS_PROCESS_PREFIX
  return {
    origin1,
    origin2,
    read_origin1: origin1 + "/read-cookie.html",
    read_origin2_origin1: origin2 + "/frame-read-cookie.html",
    read_origin1_origin1: origin1 + "/frame-read-cookie.html",
    read_origin1_origin2_origin1: origin1 + "/nested-frame-read-cookie.html",
    set_origin1: origin1 + "/set-cookie.html",
    set_origin2_origin1: origin2 + "/frame-set-cookie.html",
    set_origin1_origin2_origin1: origin1 + "/nested-frame-set-cookie.html"
  }
}

/** A cookie in the original's shape: `expires` is -1 for a session cookie, and `sameSite` is Strider's word for it. */
interface PlaywrightCookie {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly expires: number
  readonly httpOnly: boolean
  readonly secure: boolean
  readonly sameSite: "lax" | "strict" | "none" | undefined
}

const asPlaywright = (cookie: CookieJar.Cookie): PlaywrightCookie => ({
  name: cookie.name,
  value: Redacted.value(cookie.value),
  domain: cookie.domain,
  path: cookie.path,
  expires: Option.match(cookie.expires, {
    onNone: () => -1,
    onSome: (when) => DateTime.toEpochMillis(when) / 1000
  }),
  httpOnly: cookie.httpOnly,
  secure: cookie.secure,
  sameSite: Option.getOrUndefined(cookie.sameSite)
})

/** The site of a cookie's storage partition, as the original's `partitionKey` string; undefined when unpartitioned. */
const partitionOf = (cookie: CookieJar.Cookie): string | undefined =>
  cookie.partitionKey._tag === "Partitioned" ? cookie.partitionKey.topLevelSite : undefined

/** Playwright's `expectPartitionKey`: the named cookie is there, and its partition is the one given. */
const expectPartitionKey = (
  cookies: ReadonlyArray<CookieJar.Cookie>,
  name: string,
  partitionKey: string | undefined
) => {
  const cookie = cookies.find((each) => each.name === name)
  assert.isDefined(cookie, `Cookie ${name} not found in ${JSON.stringify(cookies.map((each) => each.name))}`)
  assert.strictEqual(partitionOf(cookie!), partitionKey, `Cookie ${name}'s partition`)
}

const site = (value: string) => Schema.decodeUnknownSync(Url.Site)(value)

/** Playwright's `addCookies(cookies)` for cookies read from a jar: each is set again with the attributes it was read with. */
const readd = (context: UserContext.UserContext, cookies: ReadonlyArray<CookieJar.Cookie>) =>
  Effect.forEach(cookies, (cookie) =>
    context.cookies.set({
      name: cookie.name,
      value: Redacted.value(cookie.value),
      scope: { domain: cookie.domain, path: cookie.path },
      expires: Option.getOrUndefined(cookie.expires),
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: Option.getOrUndefined(cookie.sameSite),
      partitionKey: cookie.partitionKey
    }), { discard: true })

/** A context that accepts the fixture server's self-signed certificate, with one page in it. */
const tlsPage = Effect.gen(function*() {
  const context = yield* Browser.newContext({ acceptInsecureCerts: true })
  return { context, page: yield* context.newPage }
})

/** A wait on the fixture server, bounded, so a failure says what it waited for. */
const awaiting = <A, E, R>(what: string, wait: Effect.Effect<A, E, R>) =>
  wait.pipe(Effect.timeoutOrElse({
    duration: "20 seconds",
    orElse: () => Effect.die(new Error(`${what} never arrived`))
  }))

/** The body of the top-level iframe, and of the iframe nested in it (`page.locator('iframe').contentFrame()`). */
const frameBody = (page: Page.Page) => page.frame(page.locator("iframe")).locator("body")
const nestedFrameBody = (page: Page.Page) => {
  const outer = page.frame(page.locator("iframe"))
  return outer.frame(outer.locator("iframe")).locator("body")
}

const load = { waitUntil: "load" } as const

/** Playwright's `addCommonCookieHandlers`: the pages the original's frames and reads are served from. */
const addCommonCookieHandlers = (server: ServerShape, urls: Urls) => {
  // '/set-cookie.html' handlers are added in the tests.
  server.setRoute("/read-cookie.html", (req, res) => {
    res.setHeader("Content-Type", "text/html")
    const cookies = req.headers.cookie?.split(";").map((c) => c.trim()).sort().join("; ")
    res.end(`Received cookie: ${cookies}`)
  })
  server.setRoute("/frame-set-cookie.html", (_req, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(`<iframe src='${urls.origin1}/set-cookie.html'></iframe>`)
  })
  server.setRoute("/frame-read-cookie.html", (_req, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(`<iframe src='${urls.origin1}/read-cookie.html'></iframe>`)
  })
  // Nested cross-origin iframe:
  //   main frame: (origin1 or origin2) -> iframe1: origin2 -> iframe2: origin1
  server.setRoute("/nested-frame-set-cookie.html", (_req, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(`<iframe src='${urls.origin2}/frame-set-cookie.html'></iframe>`)
  })
  server.setRoute("/nested-frame-read-cookie.html", (_req, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(`<iframe src='${urls.origin2}/frame-read-cookie.html'></iframe>`)
  })
}

/** The single-cookie `Set-Cookie` of the non-partitioned tests: `frame=value` from a frame, `top-level=value` otherwise. */
const setNonPartitionedCookie = (server: ServerShape) =>
  server.setRoute("/set-cookie.html", (req, res) => {
    res.setHeader("Set-Cookie", `${req.headers.referer ? "frame" : "top-level"}=value; SameSite=None; Path=/; Secure;`)
    res.setHeader("Content-Type", "text/html")
    res.end()
  })

/** The two cookies of the partitioned tests: a `Partitioned;` one and a plain one, from a frame or from the top level. */
const setPartitionedCookies = (server: ServerShape) =>
  server.setRoute("/set-cookie.html", (req, res) => {
    res.setHeader("Set-Cookie", [
      `${req.headers.referer ? "frame" : "top-level"}-partitioned=value; SameSite=None; Path=/; Secure; Partitioned;`,
      `${req.headers.referer ? "frame" : "top-level"}-non-partitioned=value; SameSite=None; Path=/; Secure;`
    ])
    res.end()
  })

/**
 * Playwright's `runNonPartitionedTest`: the cookies the pages set without partitioning, read back from the top level and
 * from frames. The branches are Firefox over BiDi (whose frame reads no third-party cookie) and stock WebKit on Linux.
 */
const runNonPartitionedTest = Effect.fnUntraced(function*(
  page: Page.Page,
  server: ServerShape,
  browserName: BrowserName
) {
  const urls = urlsOf(server)
  addCommonCookieHandlers(server, urls)
  setNonPartitionedCookie(server)

  yield* page.goto(urls.set_origin1, load)
  yield* page.goto(urls.read_origin1, load)
  assert.strictEqual(yield* page.locator("body").readText, "Received cookie: top-level=value")

  yield* page.goto(urls.read_origin2_origin1, load)
  // WebKit does not support third-party cookies without a 'Partition' attribute.
  yield* frameBody(page).pipe(
    Expect.toHaveText(
      browserName === "firefox" ? "Received cookie: undefined" : "Received cookie: top-level=value"
    )
  )

  // Set cookie and do second navigation.
  yield* page.goto(urls.set_origin2_origin1, load)
  yield* page.goto(urls.read_origin2_origin1, load)
  const expectedThirdParty = browserName === "webkit"
    ? "Received cookie: top-level=value"
    : "Received cookie: frame=value"
  yield* frameBody(page).pipe(Expect.toHaveText(expectedThirdParty), Deadline.within("1 second"))

  // Check again the top-level cookie.
  yield* page.goto(urls.read_origin1, load)
  const expectedTopLevel = "Received cookie: top-level=value"
  assert.strictEqual(yield* page.locator("body").readText, expectedTopLevel)

  return { expectedTopLevel, expectedThirdParty }
})

/** Playwright's `runPartitionedTest`: the `Partitioned;` cookie, sent to a frame only where the browser partitions it. */
const runPartitionedTest = Effect.fnUntraced(function*(
  page: Page.Page,
  server: ServerShape,
  browserName: BrowserName
) {
  const urls = urlsOf(server)
  addCommonCookieHandlers(server, urls)
  setPartitionedCookies(server)

  yield* page.goto(urls.set_origin1, load)
  yield* page.goto(urls.read_origin1, load)
  assert.strictEqual(
    yield* page.locator("body").readText,
    "Received cookie: top-level-non-partitioned=value; top-level-partitioned=value"
  )

  yield* page.goto(urls.read_origin2_origin1, load)
  // Linux WebKit doesn't partition third-party cookies at all.
  if (browserName === "webkit") {
    yield* frameBody(page).pipe(
      Expect.toHaveText("Received cookie: top-level-non-partitioned=value; top-level-partitioned=value")
    )
    return
  }
  // Firefox over BiDi sends a third-party cookie only when its partition matches.
  yield* frameBody(page).pipe(Expect.toHaveText("Received cookie: undefined"))

  // First navigation: no cookie sent, the cookie was set only on the top-level site, and sets the third-party cookie for
  // the top-level context. Second navigation: sends the cookie for the (top-level site, iframe url) partition.
  yield* page.goto(urls.set_origin2_origin1, load)
  yield* page.goto(urls.read_origin2_origin1, load)
  yield* frameBody(page).pipe(
    Expect.toHaveText("Received cookie: frame-non-partitioned=value; frame-partitioned=value")
  )
})

/** Playwright's `testThirdPartyCookiesAreBlocked`, for a frame of the other site, in a page of this one. */
const testThirdPartyCookiesAreBlocked = Effect.fnUntraced(function*(
  page: Page.Page,
  context: UserContext.UserContext,
  server: ServerShape,
  allowsThirdParty: boolean
) {
  const grid = server.https.CROSS_PROCESS_PREFIX + "/grid.html"
  yield* page.goto(server.https.EMPTY_PAGE, load)
  yield* page.evaluateInMainWorld((src) =>
    new Promise<void>((resolve) => {
      const iframe = document.createElement("iframe")
      document.body.appendChild(iframe)
      iframe.onload = () => resolve()
      iframe.src = src
    }), grid)
  // The frame is cross-site, so its document is written from its own (isolated) world, as the original's `frames()[1]`.
  const frame = page.frame(page.locator("iframe"))
  const documentCookie = yield* frame.locator(":root").evaluate(() => {
    document.cookie = "username=John Doe"
    return document.cookie
  })
  // The original's fixed wait, ported as written: it lets a cookie the frame set reach the browser's jar.
  yield* Effect.sleep("2 seconds")
  assert.strictEqual(documentCookie, allowsThirdParty ? "username=John Doe" : "")
  const cookies = (yield* context.cookies.listFor(grid)).map(asPlaywright)
  if (allowsThirdParty) {
    assert.deepStrictEqual(cookies, [
      {
        domain: "127.0.0.1",
        expires: -1,
        httpOnly: false,
        name: "username",
        path: "/",
        // A cookie the frame set names no SameSite, which Strider reads as none; the original expects Firefox's `Lax`
        sameSite: undefined,
        secure: false,
        value: "John Doe"
      }
    ])
  } else {
    assert.deepStrictEqual(cookies, [])
  }
})

upstream(import.meta.filename, {}, (test) => {
  test(
    "CO-052",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { page } = yield* tlsPage
        yield* runNonPartitionedTest(page, server, browserName)
      }))
  )

  test(
    "CO-053",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { context, page } = yield* tlsPage
        const urls = urlsOf(server)
        const { expectedTopLevel, expectedThirdParty } = yield* runNonPartitionedTest(page, server, browserName)

        const checkCookies = Effect.fnUntraced(function*(page: Page.Page) {
          // Check top-level cookie first.
          yield* page.goto(urls.read_origin1, load)
          assert.strictEqual(yield* page.locator("body").readText, expectedTopLevel)
          // Check third-party cookie.
          yield* page.goto(urls.read_origin2_origin1, load)
          yield* frameBody(page).pipe(Expect.toHaveText(expectedThirdParty))
        })

        yield* checkCookies(page)

        // export via cookies/addCookies
        const cookies = yield* context.cookies.list
        const context2 = yield* Browser.newContext({ acceptInsecureCerts: true })
        yield* readd(context2, cookies)
        yield* checkCookies(yield* context2.newPage)

        // export via storageState
        const storageState = yield* context.exportStorageState
        const context3 = yield* Browser.newContext({ acceptInsecureCerts: true, storageState })
        yield* checkCookies(yield* context3.newPage)
      }))
  )

  test(
    "CO-054",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { page } = yield* tlsPage
        yield* runPartitionedTest(page, server, browserName)
      }))
  )

  test(
    "CO-055",
    { page: false, browsers: ["firefox"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { context, page } = yield* tlsPage
        const urls = urlsOf(server)
        yield* runPartitionedTest(page, server, browserName)

        const checkCookies = Effect.fnUntraced(function*(page: Page.Page) {
          {
            // Check top-level cookie first.
            yield* page.goto(urls.read_origin1, load)
            assert.strictEqual(
              yield* page.locator("body").readText,
              "Received cookie: frame-non-partitioned=value; top-level-non-partitioned=value; top-level-partitioned=value"
            )
          }
          {
            // Check third-party cookie.
            yield* page.goto(urls.read_origin2_origin1, load)
            // Stock WebKit sends no partitioned third-party cookie; Firefox sends the frame's cookies
            yield* frameBody(page).pipe(
              Expect.toHaveText(
                browserName === "webkit"
                  ? "Received cookie: undefined"
                  : "Received cookie: frame-non-partitioned=value; frame-partitioned=value; top-level-non-partitioned=value"
              ),
              Deadline.within("1 second")
            )
          }
          {
            yield* page.goto(urls.read_origin1_origin2_origin1, load)
            yield* nestedFrameBody(page).pipe(
              Expect.toHaveText(
                browserName === "webkit"
                  ? "Received cookie: top-level-non-partitioned=value; top-level-partitioned=value"
                  : "Received cookie: frame-non-partitioned=value; top-level-non-partitioned=value"
              ),
              Deadline.within("1 second")
            )
          }
        })

        yield* checkCookies(page)

        const checkStorageCookies = (cookies: ReadonlyArray<CookieJar.Cookie>) => {
          // Stock WebKit doesn't partition, so its cookies carry no partition at all
          const webkitNoPartition = browserName === "webkit"
          expectPartitionKey(cookies, "top-level-partitioned", webkitNoPartition ? undefined : "https://localhost")
          expectPartitionKey(cookies, "top-level-non-partitioned", undefined)
          if (webkitNoPartition) {
            assert.isUndefined(cookies.find((cookie) => cookie.name === "frame-partitioned"))
            assert.isUndefined(cookies.find((cookie) => cookie.name === "frame-non-partitioned"))
          } else {
            expectPartitionKey(cookies, "frame-partitioned", "https://127.0.0.1")
            expectPartitionKey(cookies, "frame-non-partitioned", undefined)
          }
        }
        checkStorageCookies(yield* context.cookies.list)
        checkStorageCookies((yield* context.exportStorageState).cookies)

        // export via cookies/addCookies
        const cookies = yield* context.cookies.list
        const context2 = yield* Browser.newContext({ acceptInsecureCerts: true })
        yield* readd(context2, cookies)
        yield* checkCookies(yield* context2.newPage)

        // export via storageState
        const storageState = yield* context.exportStorageState
        const context3 = yield* Browser.newContext({ acceptInsecureCerts: true, storageState })
        yield* checkCookies(yield* context3.newPage)
      }))
  )

  test(
    "CO-056",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { context, page } = yield* tlsPage
        const urls = urlsOf(server)
        addCommonCookieHandlers(server, urls)
        const hostname = "localhost"

        yield* context.cookies.set({
          name: "top-level-partitioned",
          value: "value",
          scope: { domain: hostname, path: "/" },
          secure: true,
          sameSite: "none",
          partitionKey: {
            _tag: "Partitioned",
            topLevelSite: site("https://localhost"),
            crossSiteAncestor: Option.some(false)
          }
        })
        yield* context.cookies.set({
          name: "top-level-non-partitioned",
          value: "value",
          scope: { domain: hostname, path: "/" },
          secure: true,
          sameSite: "none"
        })
        yield* context.cookies.set({
          name: "frame-partitioned",
          value: "value",
          scope: { domain: hostname, path: "/" },
          secure: true,
          sameSite: "none",
          partitionKey: {
            _tag: "Partitioned",
            topLevelSite: site("https://127.0.0.1"),
            crossSiteAncestor: Option.some(true)
          }
        })
        yield* context.cookies.set({
          name: "frame-non-partitioned",
          value: "value",
          scope: { domain: hostname, path: "/" },
          secure: true,
          sameSite: "none"
        })

        const checkCookies = Effect.fnUntraced(function*(page: Page.Page) {
          {
            // Check top-level cookie first.
            yield* page.goto(urls.read_origin1, load)
            // Firefox over BiDi reads the cookies that aren't partitioned, where stock WebKit reads them all
            const expectedTopLevel = browserName === "webkit"
              ? "Received cookie: frame-non-partitioned=value; frame-partitioned=value; top-level-non-partitioned=value; top-level-partitioned=value"
              : "Received cookie: frame-non-partitioned=value; top-level-non-partitioned=value; top-level-partitioned=value"
            assert.strictEqual(yield* page.locator("body").readText, expectedTopLevel)
          }
          {
            // Check third-party cookie.
            yield* page.goto(urls.read_origin2_origin1, load)
            yield* frameBody(page).pipe(
              Expect.toHaveText(
                browserName === "webkit"
                  ? "Received cookie: frame-non-partitioned=value; frame-partitioned=value; top-level-non-partitioned=value; top-level-partitioned=value"
                  : "Received cookie: frame-partitioned=value"
              ),
              Deadline.within("1 second")
            )
          }
          {
            yield* page.goto(urls.read_origin1_origin2_origin1, load)
            yield* nestedFrameBody(page).pipe(
              Expect.toHaveText(
                browserName === "webkit"
                  ? "Received cookie: frame-non-partitioned=value; frame-partitioned=value; top-level-non-partitioned=value; top-level-partitioned=value"
                  : "Received cookie: undefined"
              ),
              Deadline.within("1 second")
            )
          }
        })

        yield* checkCookies(page)
      }))
  )

  test(
    "CO-057",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server }) =>
      Effect.scoped(Effect.gen(function*() {
        const { context, page } = yield* tlsPage
        const urls = urlsOf(server)
        addCommonCookieHandlers(server, urls)
        setPartitionedCookies(server)
        // main frame: origin1 -> iframe1: origin2 -> iframe2: origin1. The cookie in iframe2 is a third-party partitioned
        // cookie, even though it's the same origin as the main frame.
        yield* page.goto(urls.set_origin1_origin2_origin1, load)

        const checkCookies = Effect.fnUntraced(function*(page: Page.Page) {
          yield* page.goto(urls.read_origin1_origin2_origin1, load)
          yield* nestedFrameBody(page).pipe(
            Expect.toHaveText("Received cookie: frame-non-partitioned=value; frame-partitioned=value")
          )
        })

        yield* checkCookies(page)

        // export via cookies/addCookies
        const cookies = yield* context.cookies.list
        const context2 = yield* Browser.newContext({ acceptInsecureCerts: true })
        yield* readd(context2, cookies)
        yield* checkCookies(yield* context2.newPage)

        // export via storageState
        const storageState = yield* context.exportStorageState
        const context3 = yield* Browser.newContext({ acceptInsecureCerts: true, storageState })
        yield* checkCookies(yield* context3.newPage)
      }))
  )

  test(
    "CO-058",
    { page: false, browsers: ["firefox", "webkit"] },
    ({ server, browserName }) =>
      Effect.scoped(Effect.gen(function*() {
        const { context, page } = yield* tlsPage
        const urls = urlsOf(server)
        addCommonCookieHandlers(server, urls)
        server.setRoute("/set-cookie.html", (req, res) => {
          res.setHeader("Set-Cookie", [
            `${req.headers.referer ? "frame" : "top-level"}=value; SameSite=None; Path=/; Secure; Partitioned;`,
            `${req.headers.referer ? "frame" : "top-level"}-non-partitioned=value; SameSite=None; Path=/; Secure;`
          ])
          res.end()
        })

        // Same origin iframe cookies are partitioned the same way as top-level cookies.
        yield* page.goto(urls.set_origin1, load)
        // The original also saves this state to a file; the port exports it without a file.
        yield* context.exportStorageState

        const checkCookies = Effect.fnUntraced(function*(page: Page.Page) {
          {
            // Check top-level cookie first.
            yield* page.goto(urls.read_origin1, load)
            assert.strictEqual(
              yield* page.locator("body").readText,
              "Received cookie: top-level-non-partitioned=value; top-level=value"
            )
          }
          {
            // Same origin iframe.
            yield* page.goto(urls.read_origin1_origin1, load)
            yield* frameBody(page).pipe(
              Expect.toHaveText("Received cookie: top-level-non-partitioned=value; top-level=value"),
              Deadline.within("1 second")
            )
          }
          {
            // Check third-party cookie. main frame: origin1 -> iframe1: origin2 -> iframe2: origin1
            yield* page.goto(urls.read_origin1_origin2_origin1, load)
            yield* nestedFrameBody(page).pipe(
              Expect.toHaveText(
                browserName === "firefox"
                  ? "Received cookie: undefined"
                  : "Received cookie: top-level-non-partitioned=value; top-level=value"
              ),
              Deadline.within("1 second")
            )
          }
        })

        yield* checkCookies(page)

        // export via cookies/addCookies
        const cookies = yield* context.cookies.list
        const context2 = yield* Browser.newContext({ acceptInsecureCerts: true })
        yield* readd(context2, cookies)
        yield* checkCookies(yield* context2.newPage)

        // export via storageState
        const storageState = yield* context.exportStorageState
        const context3 = yield* Browser.newContext({ acceptInsecureCerts: true, storageState })
        yield* checkCookies(yield* context3.newPage)
      }))
  )

  test("CO-059", { page: false, browsers: ["webkit"] }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const { context, page } = yield* tlsPage
      yield* page.goto(server.https.EMPTY_PAGE, load)
      yield* context.cookies.set({
        scope: { domain: new URL(server.https.CROSS_PROCESS_PREFIX).hostname, path: "/" },
        name: "cookie1",
        value: "yes",
        httpOnly: true,
        secure: true,
        sameSite: "none"
      })
      // Listened to before the navigation, as the original's `Promise.all` starts it
      const grid = yield* server.waitForRequest("/grid.html")
      yield* page.setContent(`<iframe src="${server.https.CROSS_PROCESS_PREFIX}/grid.html"></iframe>`)
      const response = yield* awaiting("the frame's /grid.html request", grid)
      assert.strictEqual(response.headers["cookie"], "cookie1=yes")
    })))

  test("CO-061", { page: false, browsers: ["firefox"] }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const { context, page } = yield* tlsPage
      yield* testThirdPartyCookiesAreBlocked(page, context, server, true)
    })))

  test("CO-062", { page: false, browsers: ["firefox"] }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ acceptInsecureCerts: true })
      const page = yield* context.newPage
      server.setRoute("/empty.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
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
      server.setRoute("/json", (_req, res) => {
        res.end()
      })
      // The request's cookie is what the original's promise carries
      const json = yield* server.waitForRequest("/json")
      yield* page.goto(server.https.EMPTY_PAGE, load)
      const received = yield* awaiting("the /json request", json)
      assert.strictEqual(received.headers.cookie, "a=b")
    })))
})
