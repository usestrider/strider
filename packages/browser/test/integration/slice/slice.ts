/**
 * The first slice through all three layers: the README's program, launched, navigated,
 * clicked and checked through the public API only, written once and run against every backend's layer, with
 * the cases around it that the design says how to handle.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Expect, Locator, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import { site } from "../adapter/harness.ts"

const timeout = 60_000

/** A page on the local site, showing `html`. */
const fixture = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  return `${served.origin}/fixture?html=${encodeURIComponent(html)}`
})

// A shop whose button renders late, and whose cart updates a little after the click
const shop = `<title>Shop</title>
<p id="cart">0 items</p>
<div id="slot"></div>
<script>
  setTimeout(() => {
    const button = document.createElement("button")
    button.textContent = "Add to cart"
    button.onclick = () => setTimeout(() => { document.getElementById("cart").textContent = "1 item" }, 100)
    document.getElementById("slot").append(button)
  }, 300)
</script>`

const counter = (attributes: string, script = "") =>
  `<button id="b" ${attributes} onclick="this.dataset.clicks = (Number(this.dataset.clicks ?? 0) + 1); document.getElementById('out').textContent = 'clicked ' + this.dataset.clicks">Press</button>
<p id="out">not clicked</p><script>${script}</script>`

/**
 * The slice against one backend's layer. `pinned` checks the browser the layer launched, from what it reports:
 * a browser that isn't the pinned one fails the first test.
 */
export const slice = (
  name: string,
  backend: Layer.Layer<Browser.Browser, unknown>,
  pinned: (info: Browser.Info) => void
) =>
  describe(`${name} slice`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("launches the pinned browser", () =>
        Effect.gen(function*() {
          const browser = yield* Browser.Browser
          pinned(browser.info)
        }), timeout)

      it.effect("runs the README's program: a late button clicked, the cart checked", () =>
        Effect.gen(function*() {
          const url = yield* fixture(shop)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const navigation = yield* page.goto(url)
            assert.strictEqual(navigation._tag, "Committed")
            assert(navigation._tag === "Committed" && Option.isSome(navigation.response))
            assert.strictEqual(navigation.response.value.status, 200)
            yield* page.getByRole("button", { name: "Add to cart" }).click()
            yield* page.getByText("1 item").pipe(Expect.toBeVisible)
            assert.strictEqual(yield* page.title, "Shop")
          }))
        }), timeout)

      it.effect("waits for a disabled button to be enabled, and clicks once", () =>
        Effect.gen(function*() {
          const url = yield* fixture(
            counter("disabled", "setTimeout(() => document.getElementById('b').disabled = false, 400)")
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url, { waitUntil: "load" })
            yield* page.getByRole("button", { name: "Press" }).click()
            yield* page.getByText("clicked 1", { exact: true }).pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("scrolls a button below the fold into view; a trial runs the checks and clicks nothing", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<div style="height: 4000px"></div>${counter("")}`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            yield* page.locator("#b").click({ trial: true })
            yield* page.getByText("not clicked", { exact: true }).pipe(Expect.toBeVisible)
            yield* page.locator("#b").click()
            yield* page.getByText("clicked 1").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("times out on a covered button, naming what covers it", () =>
        Effect.gen(function*() {
          const url = yield* fixture(
            `<div style="position: relative">${
              counter("")
            }<div class="toast" style="position: absolute; inset: 0; background: white">Saved</div></div>`
          )
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const error = yield* page.locator("#b").click().pipe(Deadline.within("1500 millis"), Effect.flip)
            assert(Deadline.isTimeout(error), String(error))
            assert.strictEqual(error.phase, "waitingForCondition")
            assert.include(
              Option.getOrElse(error.hint, () =>
                ""),
              `div.toast "Saved"`
            )
            assert.deepInclude(
              error.history.map((each) =>
                each.value
              ),
              { _tag: "Covered", by: `div.toast "Saved"` }
            )
            yield* page.getByText("not clicked").pipe(Expect.toBeVisible)
          }))
        }), timeout)

      it.effect("fails at once on two matches, with the candidates", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<button>Buy</button><button style="display: none">Buy</button>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const error = yield* page.getByRole("button", { name: "Buy", includeHidden: true }).click().pipe(
              Deadline.within("20 seconds"),
              Effect.flip
            )
            assert(Locator.isLocatorError(error), String(error))
            assert(error.reason._tag === "StrictViolation")
            assert.deepStrictEqual(error.reason.candidates.map((each) => each.visible), [true, false])
            assert.include(error.reason.hint, "filter({ visible: true })")
            assert.strictEqual(error.locator, `page.getByRole("button", { name: "Buy", includeHidden: true })`)
          }))
        }), timeout)

      it.effect("reports a navigation that fails, and one that commits an error status", () =>
        Effect.gen(function*() {
          const served = yield* site
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const failed = yield* page.goto("http://127.0.0.1:1/").pipe(Effect.flip)
            assert(failed._tag === "PageError", String(failed))
            assert.strictEqual(failed.reason._tag, "NavigationFailed")
            assert(failed.reason instanceof PageNavigation.NavigationFailed)
            // A 404 is a successful commit (CONCEPTS.md §4)
            const missing = yield* page.goto(`${served.origin}/missing`)
            assert(missing._tag === "Committed" && Option.isSome(missing.response), String(missing))
            assert.strictEqual(missing.response.value.status, 404)
          }))
        }), timeout)

      it.effect("fails an expectation that never holds, with what it saw", () =>
        Effect.gen(function*() {
          const url = yield* fixture(`<p>1 item</p><p>2 items</p>`)
          yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(url)
            const error = yield* page.getByText("item").pipe(
              Expect.toBeVisible,
              Deadline.within("500 millis"),
              Effect.flip
            )
            assert(Expect.isExpectationFailed(error), String(error))
            assert.strictEqual(error.subject, `page.getByText("item")`)
            assert.deepStrictEqual(error.history.map((each) => each.value), [{ matches: 2, visible: 2 }])
            // One round waited in the page, checking again on each frame, for the whole deadline
            assert.isAtLeast(error.checks.count, 1)
            assert.include(error.checks.triggeredBy, "change")
            yield* page.getByText("3 items").pipe(Expect.toBeHidden)
          }))
        }), timeout)

      it.effect("closes the page and its context with the scope", () =>
        Effect.gen(function*() {
          const scope = yield* Scope.make()
          const page = yield* Browser.newPage().pipe(Scope.provide(scope))
          const context = page.context
          assert.strictEqual((yield* page.status)._tag, "Open")
          yield* Scope.close(scope, Exit.void)
          const reason = yield* page.closed
          assert.strictEqual(reason._tag, "PageClosed")
          assert.strictEqual((yield* context.closed)._tag, "UserContextRemoved")
          assert.strictEqual((yield* page.status)._tag, "Closed")
        }), timeout)
    })
  })
