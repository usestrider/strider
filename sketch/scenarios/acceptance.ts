/**
 * API.md's acceptance scenarios, checked by the compiler. If one needs protocol knowledge or repeated
 * ceremony, the model underneath is wrong. Requirement channels are asserted where the design makes a claim
 * about them: an ordinary call site sees only Browser and Scope.
 */
import { Config, Console, Effect, Schema, Scope, Stream } from "effect"
import { HttpClientRequest, HttpIncomingMessage, HttpServerResponse } from "effect/http"
import {
  AriaPattern, Browser, Deadline, Deferred, Dialog, Download, Expect, NetworkRequest, NetworkResponse,
  PageNavigation, Popup, Route, StorageState, UncaughtException
} from "../src/index.ts"
import type { DownloadStatus, Page } from "../src/index.ts"
import { expectType, type Equals } from "./_check.ts"

// 1. Log in once, reuse the session
export const loginOnce = Effect.gen(function* () {
  const browser = yield* Browser
  const state = yield* Effect.scoped(Effect.gen(function* () {
    const page = yield* browser.newPage
    yield* page.goto("https://app.example.com/login")
    yield* page.getByLabel("Email").fill("me@example.com")
    yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
    yield* page.getByRole("button", { name: "Sign in" }).click
    yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
    return yield* page.context.exportStorageState
  }))
  return yield* browser.newPageWith({ storageState: yield* StorageState.import(state) })
})
expectType<Equals<Effect.Services<typeof loginOnce>, Browser | Scope.Scope>>(true)

// 2. Click, then wait for a named outcome
export const namedOutcome = (page: Page) => Effect.gen(function* () {
  const orders = yield* PageNavigation.next(page, { url: "**/orders" })   // subscribed before the click
  yield* page.getByRole("link", { name: "Orders" }).click
  return yield* Deferred.await(orders)
})
expectType<Equals<Effect.Services<ReturnType<typeof namedOutcome>>, Scope.Scope>>(true)

// 3. Popup with a dialog inside it
export const popupWithDialog = (page: Page) => Effect.gen(function* () {
  const popups = yield* Popup.next(page)
  yield* page.getByText("Connect account").click
  const popup = yield* Deferred.await(popups)          // a Page: the opener is controlled
  yield* Dialog.handle(popup, Dialog.acceptAll)         // a dialog blocks its page, so the decision is registered first
  yield* popup.getByRole("button", { name: "Allow" }).click
})

// 4 + 9. Response body, decoded and filtered
const Cart = Schema.Struct({ items: Schema.Array(Schema.Struct({ id: Schema.String })) })
export const decodedResponse = (page: Page) => Effect.gen(function* () {
  const added = yield* NetworkResponse.next(page,
    { url: "**/api/cart", method: "POST", body: HttpIncomingMessage.schemaBodyJson(Cart) },
    (response) => Effect.succeed(response.body.items.length > 0))   // where: runs off the ingestion path
  yield* page.getByRole("button", { name: "Add to cart" }).click
  const response = yield* Deferred.await(added)
  return response.body.items                           // typed by the schema
})

// 5. Download
export const download = (page: Page) => Effect.gen(function* () {
  const next = yield* Download.next(page)
  yield* page.getByText("Export CSV").click
  const file = yield* Deferred.await(next)
  yield* file.saveAs("./export.csv")
})

// 6. Concurrent pages, settings isolated by context; Scope is closed inside, so it doesn't leak out
export const concurrentPages = (urls: ReadonlyArray<string>) => Effect.gen(function* () {
  const browser = yield* Browser
  return yield* Effect.forEach(urls, (url) => Effect.scoped(Effect.gen(function* () {
    const page = yield* browser.newPageWith({ emulation: { locale: "de-DE" } })
    yield* page.goto(url)
    return yield* page.title
  })), { concurrency: 4 })
})
expectType<Equals<Effect.Services<ReturnType<typeof concurrentPages>>, Browser>>(true)

// 7. Attach, inspect one tab, control another, leave both open
export const attach = Effect.gen(function* () {
  const browser = yield* Browser                        // provided by Chromium.connect(endpoint)
  const [first, second] = yield* browser.pages
  if (first === undefined || second === undefined) return
  yield* Effect.scoped(Effect.gen(function* () {
    const reader = yield* first.inspect
    yield* reader.getByRole("heading").readText
    const tab = yield* second.control
    const blocked = yield* tab.route("**/analytics/**", () => Effect.succeed(Route.abort))
    yield* tab.getByRole("button", { name: "Refresh" }).click
    yield* Console.log(`blocked ${yield* blocked.hits} analytics calls`)
  }))                                                   // route and access released; both tabs stay open
})

// 8. Log requests until the page closes
export const logRequests = (page: Page) => Effect.gen(function* () {
  const requests = yield* NetworkRequest.stream(page)   // subscribed now, so nothing is missed
  yield* requests.pipe(
    Stream.filter((request) => request.resourceType === "fetch"),
    Stream.runForEach((request) => Console.log(request.method, request.url)),
    Effect.forkScoped)                                  // ends normally on close, fails on crash
})

// Routes: Effect's HTTP types for responses and request changes
export const routes = (page: Page) => Effect.gen(function* () {
  yield* page.route("**/api/user", () => Effect.succeed(Route.fulfill(HttpServerResponse.jsonUnsafe({ name: "Ada" }))))
  yield* page.route("**/api/**", () => Effect.succeed(Route.continueWith(HttpClientRequest.setHeader("x-test", "1"))))
  yield* page.route("**/api/slow", (intercepted) => Effect.gen(function* () {
    const original = yield* intercepted.fetch
    return Route.fulfill(HttpServerResponse.fromClientResponse(original).pipe(HttpServerResponse.setHeader("x-patched", "1")))
  }))
})

// 10. Paused application time
export const pausedTime = (page: Page) => Effect.gen(function* () {
  yield* page.clock.install({ mode: "controlled", at: "2026-01-01T09:00:00Z" })
  yield* page.goto("/session")
  yield* page.getByRole("button", { name: "Start" }).click   // no page time passes
  yield* page.clock.adjust("5 minutes")
  yield* page.getByText("Session expired").pipe(Expect.toBeVisible)
})

// 11. Ordered setup scripts
declare const installTestHooks: () => void
declare const useTestHooks: () => void
export const orderedScripts = (page: Page) => Effect.gen(function* () {
  const helper = yield* page.addInitScript(installTestHooks)
  yield* page.addInitScript(useTestHooks, { after: [helper] })
})

// 12. Operational failures stay typed and evidenced; deadlines are cross-cutting
declare const recheckState: Effect.Effect<void>
export const failures = (page: Page) => Effect.gen(function* () {
  yield* page.locator("button[").click.pipe(           // an invalid selector fails at once, with no waiting
    Effect.catchReason("ActionError", "InvalidInput", (reason) => Console.log(reason.hint)))
  yield* page.getByRole("button", { name: "Pay" }).click.pipe(
    Deadline.within("5 seconds"),
    Effect.catchTag("Timeout", (timeout) =>
      timeout.phase === "dispatchedUnconfirmed" ? recheckState : Effect.fail(timeout)))
})

// 13. One action, several outcomes, collected later
export const severalOutcomes = (page: Page) => Effect.gen(function* () {
  const checkout = yield* Popup.next(page)
  const order = yield* NetworkResponse.next(page, { url: "**/api/order" })
  yield* page.getByRole("button", { name: "Pay" }).click
  return yield* Effect.all([Deferred.await(checkout), Deferred.await(order)])   // each latched, even if it arrived during the click
})

// 14. Watch state while doing other work
declare const renderProgress: (status: DownloadStatus) => Effect.Effect<void>
export const watchState = (page: Page) => Effect.gen(function* () {
  const pdf = yield* Download.next(page).pipe(Deadline.within("2 minutes"))   // the wait's budget, set where it starts
  yield* page.getByText("Export PDF").click
  const report = yield* Deferred.await(pdf)
  yield* report.status.changes.pipe(Stream.runForEach(renderProgress), Effect.forkScoped)   // fork first: watching shows the present
  yield* page.status.waitFor((status) => status._tag === "Open" && status.document.readiness === "complete")
  yield* report.finished
})

// 15. What already happened: reads, not subscriptions
export const history = (page: Page) => Effect.gen(function* () {
  const errors = yield* UncaughtException.history(page)
  const carts = yield* NetworkResponse.history(page, { url: "**/api/cart" })
  return { errors: errors.entries.length, dropped: errors.dropped, carts: carts.entries }
})
expectType<Equals<Effect.Services<ReturnType<typeof history>>, never>>(true)   // never waits, never subscribes

// 16. Structure, matched explicitly
export const structure = (page: Page) =>
  page.getByRole("navigation").pipe(Expect.toMatchAria(
    AriaPattern.node("navigation", "Main", AriaPattern.including(
      AriaPattern.node("link", "Orders", AriaPattern.unchecked)))))
