/**
 * Puppeteer's `test/src/accessibility.test.ts`: the accessibility tree a page reports, its roles, names, states, and
 * tree shape, the snapshot of a subtree, and the snapshot's refs to elements.
 *
 * What the port changes:
 * - Puppeteer's `page.accessibility.snapshot()` is Chromium's accessibility tree, which Strider's `sources: "aria"`
 *   snapshot is. Its `RootWebArea` is the snapshot's root, which has no role of its own, so each test compares the
 *   children of `snapshot.root`, where Puppeteer's `RootWebArea` children are. The document's title, which Puppeteer
 *   names the root with, isn't a Strider field, so it isn't asserted.
 * - Each node is read as `{ role, name, checked, disabled, expanded, focused, selected, children }`: Strider's role, its
 *   accessible name (`""` when it has none), and the states it carries as flags. `expected` objects are matched as
 *   Puppeteer's `toMatchObject` matches them (`project` keeps the fields an expectation names, arrays matching at
 *   their length), so an expectation names only the fields it checks.
 * - Puppeteer's `interestingOnly: false` and `includeIframes: false` have no Strider counterpart: a snapshot leaves out
 *   roleless nodes and stitches every frame in, and `Snapshot.Options` has no switch for either. The tests whose point
 *   is one of them aren't ported (see the ledger).
 * - Fields Strider's node doesn't carry are left out of the expectations: a heading's `level`, a link's `url`, a
 *   textbox's `value` and `description`, `readonly`, `multiline`, `orientation`, `haspopup`, `keyshortcuts`, and
 *   `roledescription`. The tests whose point is one of them aren't ported. Where a test's point is the tree and these
 *   fields are incidental, the port checks the rest, and the comment says what it leaves out.
 * - Chromium names an `<img>` `image`; Strider's role for it is `img`, as its `getByRole` takes it, so the port asks for
 *   `img`. A plain contenteditable is `generic` in Chromium's tree; under the default `aria+interactivity` source it is
 *   Strider's inferred `editable` role, so the rich-text tests take that source, and the textbox-role tests the `aria`
 *   one. The text Chromium calls `StaticText` is Strider's `text` role.
 * - Puppeteer's `element.evaluate(e => e.innerHTML)` on a button whose only content is its text is `readText`.
 * - Puppeteer's `snapshot({ root })` is `locator.snapshot()`, and its result is the locator's node. A root with no role
 *   and no name, which Puppeteer returns as `null` for an element it doesn't find interesting, is an empty list here:
 *   the locator's unnamed generic node has no children to report. A generic root is replaced by its children, as the
 *   `aria` tree gives roleless nodes' children to their parent.
 * - Puppeteer's `ElementHandle` for an element in a snapshot is the snapshot node's `ref` as a locator: `ref(id)` is
 *   pinned to that node. A ref to a removed node fails with `StaleRef`, where Puppeteer's snapshot of a detached element
 *   is `null`.
 * - `page.focus(selector)` is `page.locator(selector).focus()`; `page.$eval` runs in the page's main world, as it does.
 * - Iframes: Puppeteer's `attachFrame` is the harness's, and its `frame.evaluate` is `frame.locator("body").evaluate`,
 *   an isolated world that shares the frame's DOM: the page is `about:blank`, so even the "same-origin" frame isn't the
 *   page's origin, and the main world can't reach its `contentDocument`.
 * - Tree shape, where Strider's tree is ARIA-valid but shaped differently from Chromium's after Puppeteer's
 *   `interestingOnly` filter, and the test's point doesn't depend on it, the expectation takes Strider's shape and a
 *   comment says so: Strider keeps `list`, `listitem` and `tablist` wrappers that Puppeteer drops as uninteresting,
 *   leaves a link's text out of its children where it only repeats the name, merges adjacent text into one node, and
 *   collapses and trims whitespace in text (CONCEPTS.md, Queries).
 * - "should work for showcase" accepts either of the two trees Puppeteer's comment names, before and after Chromium
 *   149.0.7819.0, as the original does.
 * - Not ported: the tests whose point is a field or option Strider lacks (see the ledger). The file runs on every
 *   browser: Puppeteer skips Firefox only because its accessibility API is CDP-only, and Strider's snapshot is the same
 *   on each backend.
 */
import { assert } from "@effect/vitest"
import { Expect, Locator, type Page, type Snapshot } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attachFrame, failureOf } from "../harness/playwright.ts"
import { upstream } from "../harness/upstream.ts"

/** One node of a snapshot, as the port reads it: Puppeteer's role and name, its states as flags, and its children. */
interface Shape {
  readonly role: string
  readonly name: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly expanded: boolean
  readonly focused: boolean
  readonly selected: boolean
  readonly children: ReadonlyArray<Shape>
}

const shapeOf = (node: Snapshot.Node): Shape => ({
  role: node.role.role,
  name: node.name._tag === "None" ? "" : node.name.value,
  checked: node.states.has("checked"),
  disabled: node.states.has("disabled"),
  expanded: node.states.has("expanded"),
  focused: node.states.has("focused"),
  selected: node.states.has("selected"),
  children: node.children.map(shapeOf)
})

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === "object" && u !== null && !Array.isArray(u)

/**
 * The part of `actual` that `expected` names, as `toMatchObject` compares it: an object keeps the keys `expected` has,
 * and an array is compared element for element only when it has the same length.
 */
const project = (actual: unknown, expected: unknown): unknown => {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length
      ? actual.map((item, index) => project(item, expected[index]))
      : actual
  }
  if (isRecord(expected) && isRecord(actual)) {
    return Object.fromEntries(Object.keys(expected).map((key) => [key, project(actual[key], expected[key])]))
  }
  return actual
}

/** Puppeteer's `toMatchObject(expected)` over the fields the port's expectation names. */
const expectTree = (actual: unknown, expected: unknown) => assert.deepStrictEqual(project(actual, expected), expected)

/** Whether `actual` matches `expected` as `expectTree` does, for an original that accepts either of two trees. */
const matchesTree = (actual: unknown, expected: unknown) => {
  try {
    expectTree(actual, expected)
    return true
  } catch {
    return false
  }
}

/** The children of a page's snapshot root: Puppeteer's `RootWebArea` children. */
const pageChildren = Effect.fnUntraced(function*(page: Page.ReadonlyPage, options?: Snapshot.Options) {
  const snapshot = yield* page.snapshot({ sources: "aria", ...options })
  return snapshot.root.children.map(shapeOf)
})

/**
 * The nodes of a locator's `snapshot({ root })`: the element's node, or for a generic element with no name, its
 * children. An element Puppeteer finds uninteresting, which it returns as `null`, is an empty list.
 */
const locatorChildren = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator) {
  const snapshot = yield* locator.snapshot({ sources: "aria" })
  const root = snapshot.root
  return root.role.role === "generic" && root.name._tag === "None" ? root.children.map(shapeOf) : [shapeOf(root)]
})

/** The `ref` of a node in a snapshot, which every element node has. */
const refOf = (node: Snapshot.Node | undefined) => {
  assert.isDefined(node)
  return Option.getOrThrow(node.ref)
}

upstream(import.meta.filename, {}, (test) => {
  test("Accessibility should work", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <title>Accessibility Test</title>
        </head>
        <body>
          <div>Hello World</div>
          <h1>Inputs</h1>
          <input placeholder="Empty input" autofocus />
          <input placeholder="readonly input" readonly />
          <input placeholder="disabled input" disabled />
          <input aria-label="Input with whitespace" value="  " />
          <input value="value only" />
          <input aria-placeholder="placeholder" value="and a value" />
          <div aria-hidden="true" id="desc">This is a description!</div>
          <input
            aria-placeholder="placeholder"
            value="and a value"
            aria-describedby="desc"
          />
          <select>
            <option>First Option</option>
            <option>Second Option</option>
          </select>
          <a href="https://example.com">example</a>
        </body>`)
      yield* page.locator("[placeholder=\"Empty input\"]").focus()
      // Each expectation names the fields Strider's node carries. Puppeteer's readonly, value, level, description,
      // haspopup, and url aren't Strider fields, so they aren't checked; the input named "readonly input" keeps its name.
      expectTree(yield* pageChildren(page), [
        { role: "text", name: "Hello World" },
        { role: "heading", name: "Inputs" },
        { role: "textbox", name: "Empty input", focused: true },
        { role: "textbox", name: "readonly input" },
        { role: "textbox", name: "disabled input", disabled: true },
        { role: "textbox", name: "Input with whitespace" },
        { role: "textbox", name: "" },
        // Chromium names an input by `aria-placeholder`; accname has no such source, so Strider's name is "" and these two fail
        { role: "textbox", name: "placeholder" },
        // Puppeteer's second placeholder input also carries a description, which Strider doesn't have
        { role: "textbox", name: "placeholder" },
        {
          role: "combobox",
          name: "",
          expanded: false,
          // Strider omits a closed select's options from the tree, so this fails until that's fixed
          children: [
            { role: "option", name: "First Option", selected: true },
            { role: "option", name: "Second Option" }
          ]
        },
        { role: "link", name: "example" }
      ])
    }))

  test("Accessibility should work for showcase", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/a11y/landmarks.html")
      const actual = yield* pageChildren(page)
      const showcase = (main: ReadonlyArray<unknown>) => [
        {
          role: "banner",
          name: "",
          children: [
            { role: "heading", name: "HTML Elements Showcase" },
            {
              role: "navigation",
              name: "",
              // Puppeteer's tree drops the uninteresting list and listitems and keeps each link's text node; Strider keeps
              // the list structure and folds a link's text, which only repeats its name, into the name
              children: [{
                role: "list",
                name: "",
                children: ["Forms", "Media", "Interactive"].map((name) => ({
                  role: "listitem",
                  name: "",
                  children: [{ role: "link", name, children: [] }]
                }))
              }]
            }
          ]
        },
        { role: "main", name: "", children: main },
        { role: "complementary", name: "", children: [{ role: "text", name: "complementary" }] },
        { role: "contentinfo", name: "", children: [{ role: "text", name: "contentinfo" }] }
      ]
      // Puppeteer accepts either tree: the search inside a form before Chromium 149.0.7819.0, and the search alone after
      const before = showcase([{ role: "form", name: "", children: [{ role: "search", name: "" }] }])
      const after = showcase([{ role: "search", name: "" }])
      if (!matchesTree(actual, before)) expectTree(actual, after)
    }))

  test("Accessibility get snapshots while the tree is re-calculated", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta http-equiv="X-UA-Compatible" content="IE=edge" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />
            <title>Accessible name + aria-expanded puppeteer bug</title>
            <style>
              [aria-expanded='false'] + * {
                display: none;
              }
            </style>
          </head>
          <body>
            <button hidden>Show</button>
            <p>Some content</p>
            <script>
              const button = document.querySelector('button');
              button.removeAttribute('hidden');
              button.setAttribute('aria-expanded', 'false');
              button.addEventListener('click', function () {
                button.setAttribute(
                  'aria-expanded',
                  button.getAttribute('aria-expanded') !== 'true',
                );
                if (button.getAttribute('aria-expanded') == 'true') {
                  button.textContent = 'Hide';
                } else {
                  button.textContent = 'Show';
                }
              });
            </script>
          </body>
        </html>`)
      const button = page.locator("button").first
      const snapshot = yield* button.snapshot({ sources: "aria" })
      assert.strictEqual(shapeOf(snapshot.root).name, "Show")
      yield* button.click()
      // Puppeteer's `aria/Hide` names a button by its text; the one button on the page is the role to ask for
      yield* Expect.toBeAttached(page.getByRole("button", { name: "Hide", exact: true }).first)
    }))

  test("Accessibility iframes same-origin iframe (interesting only)", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      // The page is about:blank, so the frame isn't the page's origin and its document isn't the main world's to write
      // to; Puppeteer's `frame.evaluate` is the frame's isolated world here, which shares its DOM
      yield* frame.locator("body").evaluate((body) => {
        const button = document.createElement("button")
        button.innerText = "value1"
        body.appendChild(button)
      })
      // Strider always stitches a frame's tree in under its iframe, so the iframe is the page's only child here
      expectTree(yield* pageChildren(page), [
        { role: "iframe", children: [{ role: "button", name: "value1" }] }
      ])
    }))

  test("Accessibility iframes cross-origin iframe (interesting only)", ({ page, server }) =>
    Effect.gen(function*() {
      const frame = yield* attachFrame(page, "frame1", server.CROSS_PROCESS_PREFIX + "/empty.html")
      // The frame is out of process, so its main world isn't the page's; its isolated world shares its DOM
      yield* frame.locator("body").evaluate((body) => {
        const button = document.createElement("button")
        button.innerText = "value1"
        body.appendChild(button)
      })
      expectTree(yield* pageChildren(page), [
        { role: "iframe", children: [{ role: "button", name: "value1" }] }
      ])
    }))

  test("Accessibility filtering children of leaf nodes should not report text nodes inside controls", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role="tablist">
          <div role="tab" aria-selected="true"><b>Tab1</b></div>
          <div role="tab">Tab2</div>
        </div>`
      )
      // Puppeteer drops the uninteresting tablist; Strider keeps it, and its tabs have no children, as Puppeteer's don't
      expectTree(yield* pageChildren(page), [{
        role: "tablist",
        children: [
          { role: "tab", name: "Tab1", selected: true, children: [] },
          { role: "tab", name: "Tab2", children: [] }
        ]
      }])
    }))

  test("Accessibility filtering children of leaf nodes rich text editable fields should have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div contenteditable="true">Edit this image: <img src="fakeimage.png" alt="my fake image"></div>`
      )
      // Chromium reports a plain contenteditable as a generic node; Strider infers its `editable` role, which keeps the children
      const first = (yield* pageChildren(page, { sources: "aria+interactivity" }))[0]
      expectTree(first, {
        role: "editable",
        children: [
          // Strider's text is whitespace-trimmed, where Chromium keeps the trailing space
          { role: "text", name: "Edit this image:" },
          { role: "img", name: "my fake image" }
        ]
      })
    }))

  test("Accessibility filtering children of leaf nodes rich text editable fields with role should have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div contenteditable="true" role="textbox">Edit this image: <img src="fakeimage.png" alt="my fake image"></div>`
      )
      // Image node should not be exposed in contenteditable elements. See https://crbug.com/1324392.
      const first = (yield* pageChildren(page))[0]
      expectTree(first, {
        role: "textbox",
        // Strider's text is whitespace-trimmed, where Chromium keeps the trailing space; Strider also keeps the image
        // that Chromium prunes (https://crbug.com/1324392), so this fails on the extra child until that's decided
        children: [{ role: "text", name: "Edit this image:" }]
      })
    }))

  test("Accessibility filtering children of leaf nodes plaintext contenteditable plain text field with role should not have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div contenteditable="plaintext-only" role="textbox">Edit this image:<img src="fakeimage.png" alt="my fake image"></div>`
      )
      expectTree((yield* pageChildren(page))[0], { role: "textbox", name: "" })
    }))

  test("Accessibility filtering children of leaf nodes non editable textbox with role and tabIndex and label should not have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role="textbox" tabindex="0" aria-checked="true" aria-label="my favorite textbox">
          this is the inner content
          <img alt="yo" src="fakeimg.png">
        </div>`
      )
      expectTree((yield* pageChildren(page))[0], { role: "textbox", name: "my favorite textbox" })
    }))

  test("Accessibility filtering children of leaf nodes checkbox with and tabIndex and label should not have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role="checkbox" tabindex="0" aria-checked="true" aria-label="my favorite checkbox">
          this is the inner content
          <img alt="yo" src="fakeimg.png">
        </div>`
      )
      expectTree((yield* pageChildren(page))[0], { role: "checkbox", name: "my favorite checkbox", checked: true })
    }))

  test("Accessibility filtering children of leaf nodes checkbox without label should not have children", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `<div role="checkbox" aria-checked="true">
          this is the inner content
          <img alt="yo" src="fakeimg.png">
        </div>`
      )
      expectTree((yield* pageChildren(page))[0], {
        role: "checkbox",
        name: "this is the inner content yo",
        checked: true
      })
    }))

  test("Accessibility filtering children of leaf nodes root option should work a button", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button>My Button</button>`)
      expectTree(yield* locatorChildren(page.locator("button").first), [{ role: "button", name: "My Button" }])
    }))

  test("Accessibility filtering children of leaf nodes root option should work an input", ({ page }) =>
    Effect.gen(function*() {
      // Puppeteer's `value` for the input isn't a Strider field, so it isn't checked
      yield* page.setContent(`<input title="My Input" value="My Value">`)
      expectTree(yield* locatorChildren(page.locator("input").first), [{ role: "textbox", name: "My Input" }])
    }))

  test("Accessibility filtering children of leaf nodes root option should work a menu", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
          <div role="menu" title="My Menu">
            <div role="menuitem">First Item</div>
            <div role="menuitem">Second Item</div>
            <div role="menuitem">Third Item</div>
          </div>
        `)
      // Puppeteer's `orientation: "vertical"` isn't a Strider field, so it isn't checked
      expectTree(yield* locatorChildren(page.locator("div[role=\"menu\"]").first), [
        {
          role: "menu",
          name: "My Menu",
          children: [
            { role: "menuitem", name: "First Item" },
            { role: "menuitem", name: "Second Item" },
            { role: "menuitem", name: "Third Item" }
          ]
        }
      ])
    }))

  test("Accessibility filtering children of leaf nodes root option should return null when the element is no longer in DOM", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button>My Button</button>`)
      const snapshot = yield* page.snapshot({ sources: "aria" })
      const ref = refOf(snapshot.root.children[0])
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("button")!.remove()
      })
      // Strider's snapshot never returns null: a ref to a node that was removed fails with `StaleRef`
      const failure = yield* failureOf(snapshot.ref(ref).snapshot({ sources: "aria" }), "the removed button's snapshot")
      assert(Locator.isLocatorError(failure))
      assert.strictEqual(failure.reason._tag, "StaleRef")
    }))

  test("Accessibility filtering children of leaf nodes root option should work with nested button inside h1 with interestingOnly:true", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
          <main>
            <h2>
              <button>My Button</button>
            </h2>
          </main>
        `)
      expectTree(yield* locatorChildren(page.locator("button").first), [{ role: "button", name: "My Button" }])
    }))

  test("Accessibility filtering children of leaf nodes elementHandle() should get an ElementHandle from a snapshot item", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button>My Button</button>`)
      const snapshot = yield* page.snapshot({ sources: "aria" })
      const button = snapshot.root.children[0]
      expectTree(button && shapeOf(button), { role: "button", name: "My Button" })
      // The element behind the snapshot item, read through its ref. Its innerHTML is its text, so readText reads it
      assert.strictEqual(yield* snapshot.ref(refOf(button)).readText, "My Button")
    }))

  test("Accessibility filtering children of leaf nodes should not report Document as leaf node", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<main><span>Hello</span><div> </div><div>World</div></main>`)
      expectTree(yield* pageChildren(page), [
        {
          role: "main",
          name: "",
          children: [
            // Strider merges adjacent text, here across the whitespace-only div, into one node
            { role: "text", name: "Hello World" }
          ]
        }
      ])
    }))
})
