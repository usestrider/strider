/**
 * Playwright's `tests/page/to-match-aria-snapshot.spec.ts`: the `toMatchAriaSnapshot` matcher, which compares a locator's
 * or page's accessibility tree with a YAML template.
 *
 * What the port changes:
 * - Strider's matcher is `Expect.toMatchAria`, which matches a typed `AriaPattern` against the locator's accessibility
 *   tree, not a YAML template. A pattern is a node (role, accessible name, children) whose children are `exactly` the
 *   listed ones, `including` them in order among others, or `unchecked`. Playwright's default, a template's children
 *   in contain mode, is `including`; `/children: equal` is `exactly`; `/children: deep-equal` is `exactly` at each
 *   level it applies to, and `/children: contain` inside one is `including` there.
 * - A page-level expectation (`expect(page).toMatchAriaSnapshot`) is the same matcher on `page.locator("body")`, with
 *   the body's generic node as the root pattern, `node("generic", "", …)`. That is the node `page.snapshot` leaves out
 *   as its children, the document's, which the page-snapshot port reads the same way.
 * - A failed expectation is `Expect.ExpectationFailed`. Playwright's diff in the message isn't reproduced: where a test
 *   checks the text of its message, the port checks the observed tree in the failure, which is the rendered accessibility
 *   tree Strider saw (`- heading "todos"`), and the expectation's condition, which names the pattern it waited for.
 * - The original's `{ timeout }` is `Deadline.within` around the expectation, and an expectation without one waits
 *   for Playwright's 10 seconds, the timeout its call log names.
 * - `AriaPattern` has no state, heading level, link URL, textbox value, or negated form. So the tests that match
 *   `[checked]`, `[disabled]`, `[expanded]`, `[level]`, `[pressed]`, `[selected]`, `[invalid]`, a `/url` line, or a
 *   `not.toMatchAriaSnapshot` are not ported (see the ledger), and a test with one of those in it is not ported as a
 *   whole. Its ledger file says which.
 * - Where a test's point is Playwright's template syntax (its escaping, YAML parse errors, and template indentation),
 *   the test is `notApplicable`: a pattern is data, so there is no template to parse.
 * - Strider's tree joins adjacent inline texts as Playwright's does: `<span>Alpha</span><span>7</span>` is the one text
 *   node `Alpha 7`, which AR-140 matches.
 * - `Expect.toMatchAria` compares the locator's own node and its direct children. Playwright's template, whose root is a
 *   fragment, matches at any depth: AR-126's heading and textbox are inside a `banner`, which Playwright finds and
 *   Strider's body node, whose child is the banner, doesn't. No `AriaPattern` form reaches a descendant, so AR-126
 *   fails as ported.
 * - AR-127's `timeout: 1` is `Deadline.within("1 millis")`, which ends before Strider's first check, so the failure
 *   observed nothing; the test fails on that.
 * - `Expect.toMatchAria` takes a locator, so each pattern is checked against the locator the original's `expect` named.
 *   `Expect.toMatchAria` reads only the pattern's own node and its children; nothing here reads the DOM.
 * - AR-139's annotation (a Playwright issue) and AR-140's and AR-142's are the upstream's own; a port has none.
 */
import { assert } from "@effect/vitest"
import { AriaPattern, Deadline, Expect, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { expectationFailure, observedValues } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** The page's document as a pattern: the body's generic node, whose children are the page's top-level nodes. */
const document = (children: AriaPattern.Children) => AriaPattern.node("generic", "", children)

/** Playwright's `expect(page).toMatchAriaSnapshot(template)`: the body's node, with the page's top-level children. */
const matchPage = (page: Page.ReadonlyPage, children: AriaPattern.Children) =>
  page.locator("body").pipe(Expect.toMatchAria(document(children)))

/** The rendered accessibility trees a failed expectation observed, as text. */
const observedTrees = (failure: Expect.ExpectationFailed): string => observedValues(failure).map(String).join("\n")

const heading = (name: string | RegExp) => AriaPattern.node("heading", name, AriaPattern.unchecked)
const textbox = (name: string) => AriaPattern.node("textbox", name, AriaPattern.unchecked)
const link = (name: string) => AriaPattern.node("link", name, AriaPattern.unchecked)
const item = (children: AriaPattern.Children) => AriaPattern.node("listitem", "", children)

upstream(import.meta.filename, {}, (test) => {
  test("AR-107", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<h1>title</h1>`)
      yield* matchPage(page, AriaPattern.including(heading("title")))
    }))

  test("AR-108", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Microsoft</h1>
    <div>Open source projects and samples from Microsoft</div>
    <ul>
      <li>
        <a href="about:blank">Playwright</a>
      </li>
    </ul>`)
      yield* matchPage(
        page,
        AriaPattern.including(
          heading("Microsoft"),
          AriaPattern.text("Open source projects and samples from Microsoft"),
          AriaPattern.node("list", "", AriaPattern.including(item(AriaPattern.including(link("Playwright")))))
        )
      )
    }))

  // Playwright's `not.toMatchAriaSnapshot`: Strider's matcher has no negated form, and a condition can't read a
  // pattern's match without a hand-written comparison, so the test is `needsFeature` (see the ledger).

  test("AR-110", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<h1>title</h1>`)
      const failure = yield* expectationFailure(
        matchPage(page, AriaPattern.including(heading("wrong"))).pipe(Deadline.within("2 seconds"))
      )
      // The expectation waited for the wrong heading, and the page's heading is what it observed
      assert.include(failure.condition, `node("heading", "wrong", unchecked)`)
      assert.include(observedTrees(failure), `- heading "title"`)
    }))

  test("AR-111", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<h1>title</h1>`)
      yield* matchPage(page, AriaPattern.including(heading("title")))
    }))

  test("AR-112", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>title</h1>
    <h1>title 2</h1>
  `)
      yield* matchPage(page, AriaPattern.including(heading("title")))
    }))

  test("AR-113", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul aria-label="my list">
      <li>one</li>
      <li>two</li>
    </ul>
  `)
      yield* matchPage(
        page,
        AriaPattern.including(
          AriaPattern.node(
            "list",
            "my list",
            AriaPattern.including(
              item(AriaPattern.including(AriaPattern.text("one"))),
              item(AriaPattern.including(AriaPattern.text("two")))
            )
          )
        )
      )
    }))

  test("AR-114", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <h1>title</h1>
      <h1>title 2</h1>
    </div>
  `)
      yield* matchPage(page, AriaPattern.including(heading("title")))
    }))

  test("AR-115", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>
        <a href='about:blank'>link</a>
      </li>
    </ul>
  `)
      yield* matchPage(
        page,
        AriaPattern.including(
          AriaPattern.node("list", "", AriaPattern.including(item(AriaPattern.including(link("link")))))
        )
      )
    }))

  test("AR-116", ({ page }) =>
    Effect.gen(function*() {
      // Each template's `${regex}` is a regular expression on the heading's name
      yield* page.setContent(`<h1>Issues 12</h1>`)
      yield* matchPage(page, AriaPattern.including(heading(/Issues \d+/)))
      yield* page.setContent(`<h1>Issues 1/2</h1>`)
      yield* matchPage(page, AriaPattern.including(heading(/Issues 1[/]2/)))
      yield* page.setContent(`<h1>Issues 1[</h1>`)
      yield* matchPage(page, AriaPattern.including(heading(/Issues 1\[/)))
      yield* page.setContent(`<h1>Issues 1]]2</h1>`)
      yield* matchPage(page, AriaPattern.including(heading(/Issues 1[\]]]2/)))
    }))

  test("AR-117", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Microsoft</h1>
    <div>Open source projects and samples from Microsoft</div>
  `)
      yield* matchPage(
        page,
        AriaPattern.including(
          heading("Microsoft"),
          AriaPattern.text("Open source projects and samples from Microsoft")
        )
      )
    }))

  test("AR-118", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <details>
      <summary>Summary</summary>
      <div>Details</div>
    </details>
  `)
      // The group has no name: its text is its child, as the YAML's `- group: "Summary"` lists it
      yield* matchPage(
        page,
        AriaPattern.including(AriaPattern.node("group", "", AriaPattern.including(AriaPattern.text("Summary"))))
      )
    }))

  test("AR-125", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Microsoft</h1>
    <div>Open source projects and samples from Microsoft</div>
    <ul>
      <li>
        <details>
          <summary>
            Verified
          </summary>
          <div>
            <div>
              <p>
                We've verified that the organization <strong>microsoft</strong> controls the domain:
              </p>
              <ul>
                <li class="mb-1">
                  <strong>opensource.microsoft.com</strong>
                </li>
              </ul>
              <div>
                <a href="about: blank">Learn more about verified organizations</a>
              </div>
            </div>
          </div>
        </details>
      </li>
      <li>
        <a href="about:blank">
          <summary title="Label: GitHub Sponsor">Sponsor</summary>
        </a>
      </li>
    </ul>`)
      yield* matchPage(
        page,
        AriaPattern.including(
          heading("Microsoft"),
          AriaPattern.text("Open source projects and samples from Microsoft"),
          AriaPattern.node(
            "list",
            "",
            AriaPattern.including(
              item(
                AriaPattern.including(
                  AriaPattern.node("group", "", AriaPattern.including(AriaPattern.text("Verified")))
                )
              ),
              item(AriaPattern.including(link("Sponsor")))
            )
          )
        )
      )
    }))

  test("AR-126", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <header>
        <h1>todos</h1>
        <input placeholder="What needs to be done?">
      </header>
    </div>`)
      yield* matchPage(
        page,
        AriaPattern.including(heading("todos"), textbox("What needs to be done?"))
      )
    }))

  test("AR-127", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <header>
        <h1>todos</h1>
        <input placeholder="What needs to be done?">
        <button>Time 15:30</button>
      </header>
    </div>`)
      const failure = yield* expectationFailure(
        matchPage(
          page,
          AriaPattern.including(heading("todos"), textbox("Wrong text"))
        ).pipe(Deadline.within("1 millis"))
      )
      // Playwright's message is a diff of the template and the received tree. Strider's failure carries the received tree
      // as the observation: the heading, the textbox with its placeholder as its name, and the button. The diff's
      // markers and its quoting of the template aren't reproduced.
      const observed = observedTrees(failure)
      assert.include(observed, `- heading "todos"`)
      assert.include(observed, `- textbox "What needs to be done?"`)
      assert.include(observed, `- button "Time 15:30"`)
    }))

  // Playwright's escaping of names in its template (quotes, `/…/` regular expressions, and backslashes), and YAML's
  // single-quoted scalars, are `notApplicable`: a pattern's name is a JavaScript string or RegExp (see the ledger).

  // Playwright's YAML parse errors and its messages for them are `notApplicable` (see the ledger).

  test("AR-131", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<h1>todos</h1>`)
      const failure = yield* expectationFailure(
        matchPage(page, AriaPattern.including(heading("wrong"))).pipe(Deadline.within("3 seconds"))
      )
      // Playwright's call log prints the received snapshot with its `[level=1]`; Strider's observation is the rendered
      // tree, without a heading's level, which the snapshot node doesn't carry
      assert.include(observedTrees(failure), `- heading "todos"`)
    }))

  // Playwright's template indentation (the text of the template, as its error message echoes it) is `notApplicable`:
  // a pattern has no text to indent (see the ledger).

  test("AR-134", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<p>Text</p>`)
      const failure = yield* expectationFailure(
        matchPage(
          page,
          AriaPattern.including(
            AriaPattern.node(
              "paragraph",
              "",
              AriaPattern.including(AriaPattern.node("button", "bogus", AriaPattern.unchecked))
            )
          )
        ).pipe(Deadline.within("10 seconds"))
      )
      // The paragraph is what was received, with its text as the child; the button the template wanted isn't there
      const observed = observedTrees(failure)
      assert.match(observed, /^\s*- paragraph\b/m)
      assert.include(observed, `- text: "Text"`)
    }))

  // AR-135 (`/url` matches a link's URL) is `needsFeature` on method-page-ariasnapshot: Strider's snapshot node carries no
  // link URL (see the ledger).

  test("AR-136", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>One</li>
      <li>Two</li>
      <li>Three</li>
    </ul>
  `)
      const list = (children: AriaPattern.Children) => AriaPattern.node("list", "", children)
      yield* matchPage(
        page,
        AriaPattern.including(
          list(AriaPattern.including(
            item(AriaPattern.including(AriaPattern.text("One"))),
            item(AriaPattern.including(AriaPattern.text("Three")))
          ))
        )
      )

      // `/children: equal` on the list: exactly these two items, and "Two" is one more
      const failure = yield* expectationFailure(
        matchPage(
          page,
          AriaPattern.including(
            list(AriaPattern.exactly(
              item(AriaPattern.including(AriaPattern.text("One"))),
              item(AriaPattern.including(AriaPattern.text("Three")))
            ))
          )
        ).pipe(Deadline.within("1 second"))
      )
      assert.include(observedTrees(failure), `- text: "Two"`)
    }))

  test("AR-137", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>
        <ul>
          <li>1.1</li>
          <li>1.2</li>
        </ul>
      </li>
    </ul>
  `)
      const innerList = (children: AriaPattern.Children) => AriaPattern.node("list", "", children)
      yield* matchPage(
        page,
        AriaPattern.including(
          AriaPattern.node(
            "list",
            "",
            AriaPattern.including(
              item(
                AriaPattern.including(
                  innerList(AriaPattern.including(item(AriaPattern.including(AriaPattern.text("1.1")))))
                )
              )
            )
          )
        )
      )

      // `/children: equal` on the outer list: one item, whose own list is still matched in contain mode
      yield* matchPage(
        page,
        AriaPattern.including(
          AriaPattern.node(
            "list",
            "",
            AriaPattern.exactly(
              item(
                AriaPattern.including(
                  innerList(AriaPattern.including(item(AriaPattern.including(AriaPattern.text("1.1")))))
                )
              )
            )
          )
        )
      )

      // `/children: deep-equal`: exactly at every level, so the inner list's second item is unexpected
      const failure = yield* expectationFailure(
        matchPage(
          page,
          AriaPattern.including(
            AriaPattern.node(
              "list",
              "",
              AriaPattern.exactly(
                item(
                  AriaPattern.exactly(
                    innerList(AriaPattern.exactly(item(AriaPattern.exactly(AriaPattern.text("1.1")))))
                  )
                )
              )
            )
          )
        ).pipe(Deadline.within("1 second"))
      )
      assert.include(observedTrees(failure), `- text: "1.2"`)
    }))

  test("AR-138", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>
        <ul>
          <li>1.1</li>
          <li>1.2</li>
        </ul>
      </li>
    </ul>
  `)
      const innerList = (children: AriaPattern.Children) => AriaPattern.node("list", "", children)
      // `/children: deep-equal` on the outer list: the inner list is exact too, and its second item is unexpected
      const failure = yield* expectationFailure(
        matchPage(
          page,
          AriaPattern.including(
            AriaPattern.node(
              "list",
              "",
              AriaPattern.exactly(
                item(
                  AriaPattern.exactly(
                    innerList(AriaPattern.exactly(item(AriaPattern.exactly(AriaPattern.text("1.1")))))
                  )
                )
              )
            )
          )
        ).pipe(Deadline.within("1 second"))
      )
      assert.include(observedTrees(failure), `- text: "1.2"`)

      // `/children: contain` restored on the inner list: its items may come among others
      yield* matchPage(
        page,
        AriaPattern.including(
          AriaPattern.node(
            "list",
            "",
            AriaPattern.exactly(
              item(
                AriaPattern.exactly(
                  innerList(AriaPattern.including(item(AriaPattern.including(AriaPattern.text("1.1")))))
                )
              )
            )
          )
        )
      )
    }))

  test("AR-139", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>
        <ul>
          <li>1.1</li>
          <li>1.2</li>
        </ul>
      </li>
    </ul>
  `)
      // `/children: deep-equal` at the top: the page's only child is a list, with no children of its own in the template
      const failure = yield* expectationFailure(
        matchPage(page, AriaPattern.exactly(AriaPattern.node("list", "", AriaPattern.exactly()))).pipe(
          Deadline.within("1 second")
        )
      )
      const observed = observedTrees(failure)
      assert.match(observed, /^\s*- list\b/m)
      assert.include(observed, `- text: "1.2"`)
    }))

  test("AR-140", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <section>
      <div role="progressbar" aria-label="Alpha Beta" aria-valuenow="7" aria-valuemin="0" aria-valuemax="10">
        <span>Alpha</span>
        <span>7</span>
      </div>
    </section>
  `)
      // `/children: deep-equal` on the section: its only child is the progress bar, named "Alpha Beta", whose only child
      // is the one text `Alpha 7`
      yield* page.locator("section").pipe(Expect.toMatchAria(
        AriaPattern.node(
          "generic",
          "",
          AriaPattern.exactly(
            AriaPattern.node(
              "progressbar",
              "Alpha Beta",
              AriaPattern.exactly(AriaPattern.text("Alpha 7"))
            )
          )
        )
      ))
    }))

  // AR-141 (a regular expression that doesn't compile is kept as text in a `/url` line) is `notApplicable`: a Strider
  // pattern takes a RegExp, which is built in code, so there is no template text to fall back to (see the ledger).

  // AR-132, AR-142 (`[invalid]` and the attributes of the other tests above) are `needsFeature`: their states aren't in
  // AriaPattern (see the ledger).
})
