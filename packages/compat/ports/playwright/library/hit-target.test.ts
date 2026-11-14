/**
 * Playwright's `tests/library/hit-target.spec.ts`: which element a click lands on, with overlays, `pointer-events`,
 * shadow roots, transforms, iframes, and elements that move or are replaced between the check and the click.
 *
 * What the port changes:
 * - `page.click(selector, { timeout })` is `page.locator(selector).click()` under `Deadline.within`. A timed-out click's
 *   error is a `Deadline.Timeout`: Playwright's `page.click: Timeout <n>ms exceeded.` is asserted as its operation
 *   (`Locator.click`), its budget, and the reason it last observed, which is `Covered` where the original's message
 *   names an element covering the click.
 * - Playwright's message names the covering element and its ancestors in its own words. Strider's `Timeout.message`
 *   doesn't carry the reason, so the port also asserts the reason in Strider's words on `message`, as the original does
 *   on its message. Those checks fail until the message says it. `covered by` names the element at the action point as
 *   Strider describes it (its tag, id, and flat-tree text), where Playwright prints its outer HTML.
 * - `page.evaluate("name")` reads a page global, so it runs in the main world, as Playwright's `page.evaluate` does,
 *   through `evaluateInMainWorld`. So do the setups that install listeners or change the page, which the original runs
 *   with `page.evaluate` and `page.$eval`: they must run where the page's own events are dispatched.
 * - `page.frameLocator("iframe")` is `page.frame(page.locator("iframe"))`, and a frame in a frame is
 *   `frame.frame(frame.locator("iframe"))`. A frame locator re-resolves its iframe on each attempt.
 * - HT-001 and HT-004 wait with `page.waitForTimeout(1000)` where the original says "Give it some time, just in case."
 *   That fixed wait is the original's own, so it's ported as a sleep, with the original's comment.
 * - HT-010's `expect(page).toHaveURL` is `Expect.toHaveURL(page, …)`.
 * - HT-007 loads React and Material UI from the vendored fixture, so it runs the page's own scripts.
 * - HT-021 carries Playwright's annotation for playwright#43118. The annotation is metadata, so the port keeps it as a
 *   comment only.
 * - HT-014, HT-015, and HT-022 need a closed shadow root, which Strider's engine doesn't search (CONCEPTS.md §8), and
 *   a frame from `page.frames()` or a handle from `evaluateHandle` to act through, which Strider doesn't have, so they
 *   aren't ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, type Page } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import { upstream } from "../../harness/upstream.ts"

/** The reason a timed-out action last observed, as Strider records it. */
type Reason = { readonly _tag: string; readonly by?: string }

const reasonOf = (timeout: Deadline.Timeout): Reason | undefined =>
  Option.getOrUndefined(Option.map(timeout.last, (observed) => observed.value as Reason))

/** The error of a click that Playwright's test expects to time out (its `.catch(e => e)`); a click that succeeds fails. */
const clickFailure = Effect.fnUntraced(function*(click: Effect.Effect<void, unknown>) {
  const result = yield* Effect.result(click)
  assert(Result.isFailure(result), "the click succeeded, where Playwright's click times out")
  return result.failure
})

/** Playwright's `page.click: Timeout <budget>ms exceeded.`, as a `Timeout` of the click with that budget. */
const clickTimeout = (error: unknown, budget: number): Deadline.Timeout => {
  assert(Deadline.isTimeout(error), String(error))
  // Strider names the operation `Locator.click`
  assert.strictEqual(error.operation, "Locator.click")
  // Strider's budget counts from when the click starts: the timeout less the moments before then
  assert.isAtMost(Duration.toMillis(error.budget), budget)
  assert.isAbove(Duration.toMillis(error.budget), budget - 500)
  return error
}

/** A page global, read in the main world as Playwright's `page.evaluate("name")` reads it. */
const global = (page: Page.Page, name: string) =>
  page.evaluateInMainWorld((name) => (window as unknown as Record<string, unknown>)[name], name)

upstream(import.meta.filename, {}, (test) => {
  test("HT-001", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const blocker = document.createElement("div")
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "400px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)

        const allEvents: Array<string> = []
        ;(window as unknown as { allEvents: Array<string> }).allEvents = allEvents
        for (
          const name of [
            "mousedown",
            "mouseup",
            "click",
            "dblclick",
            "auxclick",
            "contextmenu",
            "pointerdown",
            "pointerup"
          ]
        ) {
          window.addEventListener(name, (e) => allEvents.push(e.type))
          blocker.addEventListener(name, (e) => allEvents.push(e.type))
        }
      })

      const error = yield* clickFailure(page.locator("button").click().pipe(Deadline.within("3 seconds")))
      const timeout = clickTimeout(error, 3000)
      // Playwright's test checks the message; the covering blocker is the reason Strider records
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, "div")

      // Give it some time, just in case.
      yield* Effect.sleep("1 second")
      assert.deepStrictEqual(yield* global(page, "allEvents"), [])
    }))

  test("HT-002", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.addEventListener("mousemove", () => {
          button.style.marginLeft = "100px"
        })

        const allEvents: Array<string> = []
        ;(window as unknown as { allEvents: Array<string> }).allEvents = allEvents
        for (
          const name of [
            "mousemove",
            "mousedown",
            "mouseup",
            "click",
            "dblclick",
            "auxclick",
            "contextmenu",
            "pointerdown",
            "pointerup"
          ]
        ) {
          button.addEventListener(name, (e) => allEvents.push(e.type))
        }
      })

      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
      assert.deepStrictEqual(yield* global(page, "allEvents"), [
        // First attempt failed.
        "mousemove",
        // Second attempt succeeded.
        "mousemove",
        "pointerdown",
        "mousedown",
        "pointerup",
        "mouseup",
        "click"
      ])
    }))

  test("HT-003", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.addEventListener("mousedown", () => {
          ;(window as unknown as { result?: string }).result = "Mousedown"
          button.remove()
        })
      })

      yield* page.locator("button").click().pipe(Deadline.within("15 seconds"))
      assert.strictEqual(yield* global(page, "result"), "Mousedown")
    }))

  test("HT-004", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const blocker = document.createElement("div")
        blocker.style.position = "absolute"
        blocker.style.width = "400px"
        blocker.style.height = "400px"
        blocker.style.left = "0"
        blocker.style.top = "0"
        document.body.appendChild(blocker)

        window.addEventListener("mousemove", () => document.querySelector("button")!.remove())

        const allEvents: Array<string> = []
        ;(window as unknown as { allEvents: Array<string> }).allEvents = allEvents
        for (
          const name of [
            "mousedown",
            "mouseup",
            "click",
            "dblclick",
            "auxclick",
            "contextmenu",
            "pointerdown",
            "pointerup"
          ]
        ) {
          window.addEventListener(name, (e) => allEvents.push(e.type))
          blocker.addEventListener(name, (e) => allEvents.push(e.type))
        }
      })

      const error = yield* clickFailure(page.locator("button").click().pipe(Deadline.within("3 seconds")))
      clickTimeout(error, 3000)

      // Give it some time, just in case.
      yield* Effect.sleep("1 second")
      assert.deepStrictEqual(yield* global(page, "allEvents"), [])
    }))

  test("HT-005", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")!
        button.addEventListener("mousemove", () => {
          button.style.marginLeft = "100px"
          button.dispatchEvent(new MouseEvent("click"))
        })

        const allEvents: Array<string> = []
        ;(window as unknown as { allEvents: Array<string> }).allEvents = allEvents
        button.addEventListener("click", (e) => {
          if (!e.isTrusted) allEvents.push(e.type)
        })
      })

      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")
      // We should get one programmatic click on each attempt.
      assert.deepStrictEqual(yield* global(page, "allEvents"), ["click", "click"])
    }))

  test("HT-006", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result"), "Clicked")

      yield* page.evaluateInMainWorld(() => {
        document.open()
        document.write("<button onclick=\"window.result2 = true\"></button>")
        document.close()
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* global(page, "result2"), true)
    }))

  test("HT-007", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/mui.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const mui = window as unknown as {
          e: (type: unknown, props: Record<string, unknown>, children: Array<unknown>) => unknown
          MaterialUI: Record<string, unknown>
          renderComponent: (component: unknown) => void
        }
        mui.renderComponent(mui.e(mui.MaterialUI.FormControl, { fullWidth: true }, [
          mui.e(mui.MaterialUI.InputLabel, { id: "demo-simple-select-label" }, ["Age"]),
          mui.e(mui.MaterialUI.Select, {
            labelId: "demo-simple-select-label",
            id: "demo-simple-select",
            value: 10,
            label: "Age"
          }, [
            mui.e(mui.MaterialUI.MenuItem, { value: 10 }, ["Ten"]),
            mui.e(mui.MaterialUI.MenuItem, { value: 20 }, ["Twenty"]),
            mui.e(mui.MaterialUI.MenuItem, { value: 30 }, ["Thirty"])
          ])
        ]))
      })
      // `div.MuiFormControl-root:has-text("Age")`: the substring match is case-insensitive, as `filter` matches
      yield* page.locator("div.MuiFormControl-root").filter({ hasText: "Age" }).click()
      yield* page.getByText("Thirty").pipe(Expect.toBeVisible)
    }))

  test("HT-008", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/input/drag-n-drop-manual.html", { waitUntil: "load" })
      yield* page.locator("#from").dragTo(page.locator("#to"))
      yield* Expect.toHaveText(page.locator("#to"), "Dropped")
    }))

  test("HT-009", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <div>
      <span>
        <div id="target" onclick="window._clicked=true">
          Romimine
        </div>
      </span>
    </div>
  `)
      yield* page.locator("#target").click()
      assert.strictEqual(yield* global(page, "_clicked"), true)
    }))

  test("HT-010", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <div>
      <a href="#ney">
        <div>
          <span>
            <a href="#yay">
              <div>
                <h3 id="target">
                  Romimine
                </h3>
              </div>
            </a>
          </span>
        </div>
      </a>
    </div>
  `)
      yield* page.locator("#target").click()
      yield* Expect.toHaveURL(page, server.EMPTY_PAGE + "#yay")
    }))

  test("HT-011", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <div>
    </div>
    <script>
      const root = document.querySelector('div');
      const shadowRoot = root.attachShadow({ mode: 'open' });
      const span = document.createElement('span');
      shadowRoot.appendChild(span);
      const div = document.createElement('div');
      span.appendChild(div);
      div.id = 'target';
      div.addEventListener('click', () => window._clicked = true);
      div.textContent = 'Hello';
    </script>
  `)
      yield* page.locator("#target").click()
      assert.strictEqual(yield* global(page, "_clicked"), true)
    }))

  test("HT-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <button style="position: absolute; left: 250px;bottom: 0;height: 40px;width: 200px;" onclick="window._clicked=1">
      click-me
    </button>
    <div style="background: transparent; bottom: 0px; left: 0px; margin: 0px; padding: 0px; position: fixed; z-index: 2147483647;">
      <iframe srcdoc="<body onclick='window.top._clicked=2' style='background-color:red;height:40px;'></body>" style="display: block; border: 0px; width: 100vw; height: 48px;"></iframe>
    </div>
  `)
      const error = yield* clickFailure(page.getByText("click-me").click().pipe(Deadline.within("3 seconds")))
      assert.strictEqual(yield* global(page, "_clicked"), undefined)
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, "iframe")
      assert.include(timeout.message, "Another element covers the element's action point: iframe")
    }))

  test("HT-013", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <div onclick='window.top._clicked=1'>padding</div>
    <iframe width=600 height=600 srcdoc="<iframe srcdoc='<div onclick=&quot;window.top._clicked=2&quot;>padding</div><div onclick=&quot;window.top._clicked=3&quot;>inner</div>'></iframe><div onclick='window.top._clicked=4'>outer</div>"></iframe>
    <div onclick='window.top._clicked=5' style="position: absolute; left: 0; right: 0; top: 0; bottom: 0; background: rgba(255, 0, 0, 0.1); padding: 200px;">PINK OVERLAY</div>
  `)

      const outer = page.frame(page.locator("iframe"))
      const target = outer.frame(outer.locator("iframe")).getByText("inner")
      const error = yield* clickFailure(target.click().pipe(Deadline.within("3 seconds")))
      assert.strictEqual(yield* global(page, "_clicked"), undefined)
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, `div "PINK OVERLAY"`)
      assert.include(timeout.message, `Another element covers the element's action point: div "PINK OVERLAY"`)

      // `text=overlay` is the overlay, the smallest element with that text; the change is made in the main world
      yield* page.evaluateInMainWorld(() => {
        const overlay = Array.from(document.querySelectorAll("div")).find((div) =>
          div.textContent?.trim() === "PINK OVERLAY"
        )!
        overlay.style.display = "none"
      })

      yield* target.click()
      assert.strictEqual(yield* global(page, "_clicked"), 3)
    }))

  test("HT-016", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
    <style>
      div > div {
        position: absolute;
        top: 0;
        left: 0;
        width: 10px;
        height: 10px;
      }
      span {
        display: block;
        position: absolute;
        left: 0;
        top: 0;
        width: 300px;
        height: 300px;
      }
    </style>
    <div style="position:relative; width:300px; height:300px">
      <div id=container1></div>
      <div id=container2></div>
    </div>
    <script>
      for (const id of ['container1', 'container2']) {
        const span = document.createElement('span');
        span.id = id + '-span';
        span.textContent = 'click me';
        span.style.display = 'block';
        span.style.position = 'absolute';
        span.style.left = '20px';
        span.style.top = '20px';
        span.style.width = '300px';
        span.style.height = '300px';
        span.addEventListener('click', () => window.__clicked = id);
        const div = document.getElementById(id);
        const host = div.attachShadow({ mode: 'open' });
        host.appendChild(span);
      }
    </script>
  `)
      // `#container1 >> text=click me`: the text inside container1's open shadow root
      const error = yield* clickFailure(
        page.locator("#container1").getByText("click me").click().pipe(Deadline.within("3 seconds"))
      )
      const timeout = clickTimeout(error, 3000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      // Playwright names container2's host. Strider names what is at the point, the span inside container2's shadow
      // root (a hit target is followed into open shadow roots)
      assert.strictEqual(reasonOf(timeout)?.by, `span#container2-span "click me"`)
      assert.include(
        timeout.message,
        `Another element covers the element's action point: span#container2-span "click me"`
      )
    }))

  test("HT-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; }
      iframe {
        border: 4px solid black;
        background: gray;
        margin-left: 33px;
        margin-top: 24px;
        width: 400px;
        height: 400px;
        transform: scale(1.2);
      }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { margin-left: 10px; margin-top: 20px; width: 2px; height: 2px; }
        section { position: absolute; top: 0; left: 0; bottom: 0; right: 0; }
      </style>
      <div>Target</div>
      <section>Overlay</section>
      <script>
        document.querySelector('div').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      const locator = page.frame(page.locator("iframe")).locator("div")
      const error = yield* clickFailure(locator.click().pipe(Deadline.within("5 seconds")))
      const timeout = clickTimeout(error, 5000)
      assert.strictEqual(reasonOf(timeout)?._tag, "Covered")
      assert.strictEqual(reasonOf(timeout)?.by, `section "Overlay"`)
      assert.include(timeout.message, `Another element covers the element's action point: section "Overlay"`)
    }))

  test("HT-018", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; box-sizing: border-box; }
      iframe { background: gray; width: 200px; height: 200px; padding-top: 100px; }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { height: 100px; }
      </style>
      <div>Non-target</div>
      <div id=target>Target</div>
      <div>Non-target</div>
      <script>
        document.querySelector('#target').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      yield* page.frame(page.locator("iframe")).locator("#target").click()
      assert.strictEqual(yield* global(page, "_clicked"), true)
    }))

  test("HT-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      body, html, iframe { margin: 0; padding: 0; border: none; box-sizing: content-box; }
      iframe { background: gray; width: 200px; height: 200px; padding-top: 100px; }
    </style>
    <iframe srcdoc="
      <style>
        body, html { margin: 0; padding: 0; }
        div { height: 100px; }
      </style>
      <div>Non-target</div>
      <div id=target>Target</div>
      <div>Non-target</div>
      <script>
        document.querySelector('#target').addEventListener('click', () => window.top._clicked = true);
      </script>
    "></iframe>
  `)
      yield* page.frame(page.locator("iframe")).locator("#target").click()
      assert.strictEqual(yield* global(page, "_clicked"), true)
    }))

  test("HT-020", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <html>
      <body>
        <my-input></my-input>
        <script>
          class MyInput extends HTMLElement {
            connectedCallback() {
              this.attachShadow({mode:'open'});
              this.shadowRoot.innerHTML = '<div><span><input type="text" /></span></div>';
              this.shadowRoot.querySelector('input').addEventListener('click', () => window.__clicked = true);
            }
          }
          customElements.define('my-input', MyInput);
        </script>
      </body>
    </html>
  `)
      yield* page.locator("input").click()
      assert.strictEqual(yield* global(page, "__clicked"), true)
    }))

  test("HT-021", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's annotation: playwright#43118
      yield* page.setContent(`
    <outer-host></outer-host>
    <script>
      customElements.define('inner-host', class extends HTMLElement {
        connectedCallback() {
          this.attachShadow({ mode: 'open' }).innerHTML = '<inner-most></inner-most>';
        }
      });
      customElements.define('inner-most', class extends HTMLElement {
        connectedCallback() {
          this.attachShadow({ mode: 'open' }).innerHTML = '<input>';
          this.shadowRoot.querySelector('input').addEventListener('click', () => window.__clicked = true);
        }
      });
      customElements.define('outer-host', class extends HTMLElement {
        connectedCallback() {
          this.attachShadow({ mode: 'open' }).innerHTML = '<inner-host></inner-host>';
        }
      });
    </script>
  `)
      yield* page.locator("input").click()
      assert.strictEqual(yield* global(page, "__clicked"), true)
    }))
})
