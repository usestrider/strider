/**
 * API.md's acceptance scenarios, checked by the compiler. If one needs protocol knowledge or repeated
 * ceremony, the model underneath is wrong. Their requirement channels are asserted in
 * typetest/acceptance.tst.ts: an ordinary call site sees only Browser and Scope.
 */
import {
  AriaPattern,
  Browser,
  Deadline,
  Dialog,
  Download,
  Expect,
  NetworkRequest,
  NetworkResponse,
  Operation,
  Page,
  PageNavigation,
  Popup,
  Route,
  StorageState,
  UncaughtException
} from "@usestrider/browser"
import { Config, Console, Effect, Schema, Stream } from "effect"
import { HttpClientRequest, HttpIncomingMessage, HttpServerResponse } from "effect/http"

// 1. Log in once, reuse the session
export const loginOnce = Effect.gen(function*() {
  const json = yield* Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    yield* page.goto("https://app.example.com/login")
    yield* page.getByLabel("Email").fill("me@example.com")
    yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
    yield* page.getByRole("button", { name: "Sign in" }).click()
    yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
    const state = yield* page.context.exportStorageState
    return yield* Schema.encodeEffect(StorageState.Json)(state) // the persistence boundary: secrets written out
  }))
  const storageState = yield* Schema.decodeEffect(StorageState.Json)(json)
  return yield* Browser.newPage({ storageState })
})

// 2. Click, then wait for a named outcome
export const namedOutcome = Effect.fn("namedOutcome")(function*(page: Page.Page) {
  const orders = yield* PageNavigation.next(page, { url: "https://app.example.com/orders" }) // subscribed before the click
  yield* page.getByRole("link", { name: "Orders" }).click()
  return yield* orders
})

// 3. Popup with a dialog inside it
export const popupWithDialog = Effect.fn("popupWithDialog")(function*(page: Page.Page) {
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click()
  const popup = yield* popups // a Page: the opener is controlled
  yield* Dialog.handle(popup, Dialog.acceptAll) // a dialog blocks its page, so the decision is registered first
  yield* popup.getByRole("button", { name: "Allow" }).click()
})

// 4 + 9. Response body, decoded and filtered
const Cart = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
export const decodedResponse = Effect.fn("decodedResponse")(function*(page: Page.Page) {
  const added = yield* NetworkResponse.next(
    page,
    { url: "https://app.example.com/api/cart", method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
    (response) => Effect.succeed(response.body.items.length > 0) // where: runs off the ingestion path
  )
  yield* page.getByRole("button", { name: "Add to cart" }).click()
  const response = yield* added
  return response.body.items // typed by the schema
})

// 5. Download
export const download = Effect.fn("download")(function*(page: Page.Page) {
  const next = yield* Download.next(page)
  yield* page.getByText("Export CSV").click()
  const file = yield* next
  yield* file.saveAs("./export.csv")
})

// 6. Concurrent pages, settings isolated by context; Scope is closed inside, so it doesn't leak out
export const concurrentPages = Effect.fn("concurrentPages")(function*(urls: ReadonlyArray<string>) {
  return yield* Effect.forEach(urls, (url) =>
    Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage({ emulation: { locale: "de-DE" } })
      yield* page.goto(url)
      return yield* page.title
    })), { concurrency: 4 })
})

// 7. Attach, inspect one tab, control another, leave both open
export const attach = Effect.gen(function*() {
  const browser = yield* Browser.Browser // provided by Chromium.layerConnect(endpoint)
  const [first, second] = yield* browser.pages
  if (first === undefined || second === undefined) return
  yield* Effect.scoped(Effect.gen(function*() {
    const reader = yield* first.inspect
    yield* reader.getByRole("heading").readText
    const tab = yield* second.control
    const blocked = yield* tab.route("https://*.example.com/analytics/**", () => Route.abort())
    yield* tab.getByRole("button", { name: "Refresh" }).click()
    yield* Console.log(`blocked ${yield* blocked.hits} analytics calls`)
  })) // route and access released; both tabs stay open
})

// 8. Log requests until the page closes
export const logRequests = Effect.fn("logRequests")(function*(page: Page.ObservedPage) {
  const requests = yield* NetworkRequest.stream(page, { resourceType: "fetch" }) // subscribed now, so nothing is missed
  yield* requests.pipe(
    Stream.runForEach((request) => Console.log(request.method, request.url)),
    Effect.forkScoped // ends normally on close, fails on crash
  )
})

// Routes: Effect's HTTP types for responses and request changes
export const routes = Effect.fn("routes")(function*(page: Page.Page) {
  yield* page.route(
    "https://app.example.com/api/user",
    () => Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))
  )
  yield* page.route(
    "https://app.example.com/api/**",
    () => Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))
  )
  // What the server sent, patched: a route at the response phase (the body is CDP's alone)
  yield* page.route("https://app.example.com/api/slow", (intercepted) =>
    Effect.gen(function*() {
      const body = yield* intercepted.responseBody
      return yield* Route.fulfill(
        HttpServerResponse.uint8Array(body, {
          status: intercepted.response.status,
          headers: intercepted.response.headers
        }).pipe(HttpServerResponse.setHeader("x-patched", "1"))
      )
    }), { phase: "response" })
})

// 10. Paused application time
export const pausedTime = Effect.fn("pausedTime")(function*(page: Page.Page) {
  yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
  yield* page.goto("https://app.example.com/session")
  yield* page.getByRole("button", { name: "Start" }).click() // no page time passes
  yield* page.clock.adjust("5 minutes")
  yield* page.getByText("Session expired").pipe(Expect.toBeVisible)
})

// 11. Ordered setup scripts
declare const installTestHooks: () => void
declare const useTestHooks: () => void
export const orderedScripts = Effect.fn("orderedScripts")(function*(page: Page.Page) {
  const helper = yield* page.addInitScript(installTestHooks)
  yield* page.addInitScript(useTestHooks, { after: [helper] })
})

// 12. Operational failures stay typed and evidenced; deadlines are cross-cutting
declare const recheckState: Effect.Effect<void>
export const failures = Effect.fn("failures")(function*(page: Page.Page) {
  yield* page.locator("button[").click().pipe( // an invalid selector fails at once, with no waiting
    Effect.catchReason("LocatorError", "InvalidInput", (reason) => Console.log(reason.hint))
  )
  yield* page.getByRole("button", { name: "Pay" }).click().pipe(
    Deadline.within("5 seconds"),
    Effect.catchTag(
      "Timeout",
      (timeout) => timeout.phase === "dispatchedUnconfirmed" ? recheckState : Effect.fail(timeout)
    )
  )
})

// 13. One action, several outcomes, collected later
export const severalOutcomes = Effect.fn("severalOutcomes")(function*(page: Page.Page) {
  const checkout = yield* Popup.next(page)
  const order = yield* NetworkResponse.next(page, { url: "https://app.example.com/api/order" })
  yield* page.getByRole("button", { name: "Pay" }).click()
  return yield* Effect.all([checkout, order]) // each latched, even if it arrived during the click
})

// 14. Watch state while doing other work
declare const renderProgress: (status: Download.Status) => Effect.Effect<void>
export const watchState = Effect.fn("watchState")(function*(page: Page.Page) {
  const pdf = yield* Download.next(page).pipe(Deadline.within("2 minutes")) // the wait's budget, set where it starts
  yield* page.getByText("Export PDF").click()
  const report = yield* pdf
  yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped) // fork first: watching shows the present
  yield* page.status.waitFor((status) => status._tag === "Open" && status.document.readiness === "complete")
  yield* report.finished
})

// 15. What already happened: reads, not subscriptions
export const history = Effect.fn("history")(function*(page: Page.ObservedPage) {
  const errors = yield* UncaughtException.history(page)
  const carts = yield* NetworkResponse.history(page, { url: "https://app.example.com/api/cart" })
  return { errors: errors.entries.length, dropped: errors.dropped, carts: carts.entries }
})

// 16. Structure, matched explicitly
export const structure = (page: Page.ReadonlyPage) =>
  page.getByRole("navigation").pipe(Expect.toMatchAria(
    AriaPattern.node(
      "navigation",
      "Main",
      AriaPattern.including(AriaPattern.node("link", "Orders", AriaPattern.unchecked))
    )
  ))

// 17. An operation of your own: one deadline, and a Timeout named for it that says how far it got
declare const confirmation: (page: Page.Page) => Effect.Effect<string>
export const ownOperation = Operation.fn("checkout")(function*(page: Page.Page, card: string) {
  yield* page.getByLabel("Card number").fill(card)
  yield* page.getByRole("button", { name: "Pay" }).click()
  return yield* Operation.bound(confirmation(page)) // past the deadline: Timeout{checkout, postcondition}
}, Deadline.within("20 seconds"))
