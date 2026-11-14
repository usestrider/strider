/**
 * Playwright's `tests/page/page-aria-snapshot.spec.ts`: the accessibility tree of a locator or page, as the YAML
 * `ariaSnapshot()` returns it.
 *
 * What the port changes:
 * - `checkAndMatchSnapshot` compared a YAML string twice: `ariaSnapshot()` against it, and `toMatchAriaSnapshot`.
 *   Strider's snapshot is a typed tree (`Snapshot.Node`), not YAML, so each YAML expectation is ported as the typed
 *   tree of the same structure: each node's role, its accessible name, its states, and its children, with text
 *   nodes as `text` nodes. `tree` takes a locator's snapshot with `sources: "aria"`, the accessibility tree alone, as
 *   `ariaSnapshot()` does; a generic root with no name is the body's own node, which the YAML leaves out.
 * - The `toMatchAriaSnapshot` half is the matcher's (its own file), so the port doesn't repeat it; the tree
 *   assertion stands for the snapshot half of each expectation.
 * - A node's name is the accessible name Strider reports. Where Playwright's YAML leaves a name out because the
 *   children repeat its text (AR-027, AR-029), the port asserts the name, which the typed node carries.
 * - `Snapshot.Node` carries no heading level, link URL, textbox value, or placeholder, so the YAML's `[level=N]`,
 *   `/url`, `/placeholder` lines and a textbox's value can't be expressed as snapshot assertions. The port asserts
 *   the rest of each expectation (role, name, states, children) and says at each place which YAML line it leaves
 *   out. It doesn't read those values from the DOM: that would prove the page has them, not that the snapshot does.
 *   AR-036 is about nothing else (its link `/url`) and is not ported (see the ledger); AR-035's second half and
 *   AR-032's value are the same case, so the port keeps what is left of them.
 * - A node's `focused` state is Strider's own: the YAML of a default snapshot doesn't print `[active]`.
 * - A group made by `<details>` has no accessible name, and the YAML's `- group: Summary` is a group whose only
 *   child is the text `Summary`; the port asserts that child, not a name (AR-007, AR-008, AR-010, AR-027, AR-028).
 * - Playwright's YAML syntax, such as the escaping of values that look like YAML (AR-030, AR-031) and whitespace
 *   normalization in a template (AR-028), is the rendering. The port asserts the text content those lines carry.
 * - `page.$eval('details', …)` and `locator.evaluate` run page code: a page script runs in the main world with
 *   `page.evaluateInMainWorld`, as Playwright's `$eval` does.
 * - `page.waitForTimeout(2000)` in AR-037 is the original's own fixed wait, ported as written.
 * - `ariaSnapshot({ boxes: true })` has no Strider option, so AR-042, AR-043, and AR-044 are not ported (see the ledger).
 */
import { assert } from "@effect/vitest"
import { Expect, type Locator, type Page, type Snapshot } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** One node of a snapshot, as the expectations spell it: role, name, states, and children. */
interface Shape {
  readonly role: string
  readonly name?: string
  readonly states?: ReadonlyArray<string>
  readonly children?: ReadonlyArray<Shape>
}

const shapeOf = (node: Snapshot.Node): Shape => ({
  role: node.role.role,
  ...(node.name._tag === "None" ? {} : { name: node.name.value }),
  ...(node.states.size === 0 ? {} : { states: [...node.states].sort() }),
  ...(node.children.length === 0 ? {} : { children: node.children.map(shapeOf) })
})

/** A text node, as the YAML's `- text: …` line. */
const text = (name: string): Shape => ({ role: "text", name })

/**
 * The accessibility tree of a locator, as the YAML lists it: the element's own node, or, for a generic unnamed root
 * (the body), that node's children.
 */
const tree = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator, options?: Snapshot.Options) {
  const snapshot = yield* locator.snapshot({ sources: "aria", ...options })
  const root = snapshot.root
  return root.role.role === "generic" && root.name._tag === "None"
    ? root.children.map(shapeOf)
    : [shapeOf(root)]
})

/** The page's accessibility tree, as the YAML lists it: the document's children. */
const pageTree = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const snapshot = yield* page.snapshot({ sources: "aria" })
  return snapshot.root.children.map(shapeOf)
})

/** Playwright's `checkAndMatchSnapshot`, with the typed tree of the same structure as the YAML it compared. */
const checkTree = Effect.fnUntraced(function*(
  locator: Locator.ReadonlyLocator,
  expected: ReadonlyArray<Shape>,
  options?: Snapshot.Options
) {
  assert.deepStrictEqual(yield* tree(locator, options), expected)
})

upstream(import.meta.filename, {}, (test) => {
  test("AR-001", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<h1>title</h1>`)
      // The YAML's `[level=1]` can't be expressed: the snapshot node carries no level
      yield* checkTree(page.locator("body"), [{ role: "heading", name: "title" }])
    }))

  test("AR-002", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>title</h1>
    <h1>title 2</h1>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "heading", name: "title" },
        { role: "heading", name: "title 2" }
      ])
      // The YAML's `[level=1]` lines can't be expressed: the snapshot node carries no level
    }))

  test("AR-003", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul aria-label="my list">
      <li>one</li>
      <li>two</li>
    </ul>
  `)
      yield* checkTree(page.locator("body"), [
        {
          role: "list",
          name: "my list",
          children: [
            { role: "listitem", children: [text("one")] },
            { role: "listitem", children: [text("two")] }
          ]
        }
      ])
    }))

  test("AR-004", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <nav>
      <a href="/">/</a>
      <a href="/docs/">/docs/</a>
      <a href="/a(b/">/a(b/</a>
    </nav>
  `)
      yield* checkTree(page.locator("nav"), [
        {
          role: "navigation",
          children: [
            { role: "link", name: "/" },
            { role: "link", name: "/docs/" },
            { role: "link", name: "/a(b/" }
          ]
        }
      ])
      // The YAML's `/url` lines can't be expressed: the snapshot node carries no URL
    }))

  test("AR-005", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>
        <a href='about:blank'>link</a>
      </li>
    </ul>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "list", children: [{ role: "listitem", children: [{ role: "link", name: "link" }] }] }
      ])
    }))

  test("AR-006", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Microsoft</h1>
    <div>Open source projects and samples from Microsoft</div>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "heading", name: "Microsoft" },
        text("Open source projects and samples from Microsoft")
      ])
    }))

  test("AR-007", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <details>
      <summary>Summary</summary>
      <div>Details</div>
    </details>
  `)
      // The group has no name: its text is its child
      yield* checkTree(page.locator("body"), [{ role: "group", children: [text("Summary")] }])
    }))

  test("AR-008", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <details>
      <summary>Summary</summary>
      Details
    </details>
  `)
      yield* checkTree(page.locator("body"), [{ role: "group", children: [text("Summary")] }])

      yield* page.evaluateInMainWorld(() => {
        document.querySelector("details")!.open = true
      })
      // An open details carries `expanded` in the typed tree, which the YAML doesn't print
      yield* checkTree(page.locator("body"), [{
        role: "group",
        states: ["expanded"],
        children: [text("Summary Details")]
      }])
    }))

  test("AR-009", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div role=button>Light</div>
    <script>
      document.querySelector('div').attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow</p>';
    </script>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "button", name: "Shadow", children: [{ role: "paragraph", children: [text("Shadow")] }] }
      ])
      yield* Expect.toBeVisible(page.getByRole("button", { name: "Shadow", exact: true }))
    }))

  test("AR-010", ({ page }) =>
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
      yield* checkTree(page.locator("body"), [
        { role: "heading", name: "Microsoft" },
        text("Open source projects and samples from Microsoft"),
        {
          role: "list",
          children: [
            { role: "listitem", children: [{ role: "group", children: [text("Verified")] }] },
            { role: "listitem", children: [{ role: "link", name: "Sponsor" }] }
          ]
        }
      ])
    }))

  test("AR-011", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <p>
      Line 1
      Line 2
      Line 3
    </p>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "paragraph", children: [text("Line 1 Line 2 Line 3")] }
      ])
    }))

  test("AR-012", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <span>One</span> <span>Two</span> <span>Three</span>
  `)
      yield* checkTree(page.locator("body"), [text("One Two Three")])
    }))

  test("AR-013", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <span>One </span><span>Two </span><span>Three</span>
  `)
      yield* checkTree(page.locator("body"), [text("One Two Three")])
    }))

  test("AR-014", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>One</div><div>Two</div><div>Three</div>
  `)
      yield* checkTree(page.locator("body"), [text("One Two Three")])
    }))

  test("AR-015", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      span:before {
        content: 'world';
      }
      div:after {
        content: 'bye';
      }
    </style>
    <a href="about:blank">
      <span>hello</span>
      <div>hello</div>
    </a>
  `)
      yield* checkTree(page.locator("body"), [{ role: "link", name: "worldhello hellobye" }])
    }))

  test("AR-016", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      span:before {
        content: 'world';
        display: none;
      }
      div:after {
        content: 'bye';
        visibility: hidden;
      }
    </style>
    <a href="about:blank">
      <span>hello</span>
      <div>hello</div>
    </a>
  `)
      yield* checkTree(page.locator("body"), [{ role: "link", name: "hello hello" }])
    }))

  test("AR-017", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
      span:before {
        content: 'world';
        display: block;
      }
      div:after {
        content: 'bye';
        display: block;
      }
    </style>
    <a href="about:blank">
      <span>hello</span>
      <div>hello</div>
    </a>
  `)
      yield* checkTree(page.locator("body"), [{ role: "link", name: "world hello hello bye" }])
    }))

  test("AR-018", ({ page }) =>
    Effect.gen(function*() {
      // Text "foo" is assigned to the slot, should not be used twice.
      yield* page.setContent(`
    <button><div>foo</div></button>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const slot = document.createElement('slot');
        shadow.appendChild(slot);
      })();
    </script>
  `)
      yield* checkTree(page.locator("body"), [{ role: "button", name: "foo" }])

      // Text "foo" is assigned to the slot, should be used instead of slot content.
      yield* page.setContent(`
    <div>foo</div>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        shadow.appendChild(button);
        const slot = document.createElement('slot');
        button.appendChild(slot);
        const span = document.createElement('span');
        span.textContent = 'pre';
        slot.appendChild(span);
      })();
    </script>
  `)
      yield* checkTree(page.locator("body"), [{ role: "button", name: "foo" }])

      // Nothing is assigned to the slot, should use slot content.
      yield* page.setContent(`
    <div></div>
    <script>
      (() => {
        const container = document.querySelector('div');
        const shadow = container.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        shadow.appendChild(button);
        const slot = document.createElement('slot');
        button.appendChild(slot);
        const span = document.createElement('span');
        span.textContent = 'pre';
        slot.appendChild(span);
      })();
    </script>
  `)
      yield* checkTree(page.locator("body"), [{ role: "button", name: "pre" }])
    }))

  test("AR-019", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div role="listitem">
      <div>
        <div>
          <span title="a.test.ts">a.test.ts</span>
        </div>
        <div>
          <button title="Run"></button>
          <button title="Show source"></button>
          <button title="Watch"></button>
        </div>
      </div>
    </div>
    <div role="listitem">
      <div>
        <div>
          <span title="snapshot">snapshot</span>
        </div>
        <div class="ui-mode-list-item-time">30ms</div>
        <div>
          <button title="Run"></button>
          <button title="Show source"></button>
          <button title="Watch"></button>
        </div>
      </div>
    </div>
  `)
      yield* checkTree(page.locator("body"), [
        {
          role: "listitem",
          children: [
            text("a.test.ts"),
            { role: "button", name: "Run" },
            { role: "button", name: "Show source" },
            { role: "button", name: "Watch" }
          ]
        },
        {
          role: "listitem",
          children: [
            text("snapshot 30ms"),
            { role: "button", name: "Run" },
            { role: "button", name: "Show source" },
            { role: "button", name: "Watch" }
          ]
        }
      ])
    }))

  test("AR-020", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.setContent(`
    <link href="codicon.css" rel="stylesheet" />
    <p class='codicon codicon-check'>hello</p>
  `)
      // The codicon's `::before` glyph is part of the paragraph's text
      yield* checkTree(page.locator("body"), [{ role: "paragraph", children: [text("hello")] }])
    }))

  test("AR-021", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <p>
      <span>hello</span>
      <span aria-hidden="true">world</span>
    </p>
  `)
      yield* checkTree(page.locator("body"), [{ role: "paragraph", children: [text("hello")] }])
    }))

  test("AR-022", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li role='presentation'>hello</li>
      <li role='none'>world</li>
    </ul>
  `)
      yield* checkTree(page.locator("body"), [{ role: "list", children: [text("hello world")] }])
    }))

  test("AR-023", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input value='hello world'>
    <input type=file>
    <input type=checkbox checked>
    <input type=radio checked>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "textbox" },
        { role: "button", name: "Choose File" },
        { role: "checkbox", states: ["checked"] },
        { role: "radio", states: ["checked"] }
      ])
      // The textbox's `hello world` value can't be expressed: the snapshot node carries no value
    }))

  test("AR-024", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input type='checkbox'>
    <input type='radio'>
  `)
      yield* checkTree(page.locator("body"), [{ role: "checkbox" }, { role: "radio" }])
    }))

  test("AR-025", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a href='about:blank' aria-owns='input p'>
      <div role='region'>Link 1</div>
    </a>
    <a href='about:blank' aria-owns='input p'>
      <div role='region'>Link 2</div>
    </a>
    <input id='input' value='Value'>
    <p id='p'>Paragraph</p>
  `)
      // - Different from Chrome DevTools which attributes ownership to the last element.
      // - CDT also does not include non-owned children in accessible name.
      // - Disregarding these as aria-owns can't suggest multiple parts by spec.
      yield* checkTree(page.locator("body"), [
        {
          role: "link",
          name: "Link 1 Value Paragraph",
          children: [
            { role: "region", children: [text("Link 1")] },
            { role: "textbox" },
            { role: "paragraph", children: [text("Paragraph")] }
          ]
        },
        {
          role: "link",
          name: "Link 2 Value Paragraph",
          children: [{ role: "region", children: [text("Link 2")] }]
        }
      ])
      // The textbox's `Value` can't be expressed: the snapshot node carries no value
    }))

  test("AR-026", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a href='about:blank' id='parent'>
      <div role='region' aria-owns='parent'>Hello</div>
    </a>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "link", name: "Hello", children: [{ role: "region", children: [text("Hello")] }] }
      ])
    }))

  test("AR-027", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <details>
      <summary>one: <a href="#">link1</a> "two <a href="#">link2</a> 'three <a href="#">link3</a> \`four</summary>
    </details>
    <ul>
      <a href="#">one</a>,<a href="#">two</a>
      (<a href="#">three</a>)
      {<a href="#">four</a>}
      [<a href="#">five</a>]
    </ul>
    <div>[Select all]</div>
  `)
      // The YAML's `/url: "#"` lines can't be expressed: the snapshot node carries no URL
      yield* checkTree(page.locator("body"), [
        {
          role: "group",
          children: [
            text("one:"),
            { role: "link", name: "link1" },
            text("\"two"),
            { role: "link", name: "link2" },
            text("'three"),
            { role: "link", name: "link3" },
            text("`four")
          ]
        },
        {
          role: "list",
          children: [
            { role: "link", name: "one" },
            text(","),
            { role: "link", name: "two" },
            text("("),
            { role: "link", name: "three" },
            text(") {"),
            { role: "link", name: "four" },
            text("} ["),
            { role: "link", name: "five" },
            text("]")
          ]
        },
        text("[Select all]")
      ])
    }))

  test("AR-028", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <details>
      <summary> one  \n two <a href="#"> link &nbsp;\n  1 </a> </summary>
    </details>
    <input value='  hello   &nbsp; world '>
    <button>hello­​world</button>
  `)
      // The YAML's `/url: "#"` and the textbox's `hello world` (its normalized value) can't be expressed: the snapshot
      // node carries no URL and no value. The button's name is the YAML's `helloworld`: Playwright's whitespace
      // normalization removes the soft hyphen and the zero-width space.
      yield* checkTree(page.locator("body"), [
        {
          role: "group",
          children: [text("one two"), { role: "link", name: "link 1" }]
        },
        { role: "textbox" },
        { role: "button", name: "helloworld" }
      ])
    }))

  test("AR-029", ({ page }) =>
    Effect.gen(function*() {
      const s = "a".repeat(10000)
      yield* page.setContent(`
    <a href='about:blank'>
      <div role='region'>${s}</div>
    </a>
  `)
      // The YAML prints `- link:` with no name for this 10000-character name, and no `/url` line can be expressed;
      // the port asserts Strider's name, which the typed node carries
      yield* checkTree(page.locator("body"), [
        { role: "link", name: s, children: [{ role: "region", children: [text(s)] }] }
      ])
    }))

  test("AR-030", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a href="#">@hello</a>@hello
    <a href="#">]hello</a>]hello
    <a href="#">hello\n</a>
    hello\n<a href="#">\n hello</a>\n hello
    <a href="#">#hello</a>#hello
  `)
      yield* checkTree(page.locator("body"), [
        { role: "link", name: "@hello" },
        text("@hello"),
        { role: "link", name: "]hello" },
        text("]hello"),
        { role: "link", name: "hello" },
        text("hello"),
        { role: "link", name: "hello" },
        text("hello"),
        { role: "link", name: "#hello" },
        text("#hello")
      ])
    }))

  test("AR-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a href="#">true</a>False
    <a href="#">NO</a>yes
    <a href="#">y</a>N
    <a href="#">on</a>Off
    <a href="#">null</a>NULL
    <a href="#">123</a>123
    <a href="#">-1.2</a>-1.2
    <a href="#">-</a>-
    <a href="#">~</a>~
    <a href="#">.inf</a>.NaN
    <input type=text value="555">
  `)
      yield* checkTree(page.locator("body"), [
        { role: "link", name: "true" },
        text("False"),
        { role: "link", name: "NO" },
        text("yes"),
        { role: "link", name: "y" },
        text("N"),
        { role: "link", name: "on" },
        text("Off"),
        { role: "link", name: "null" },
        text("NULL"),
        { role: "link", name: "123" },
        text("123"),
        { role: "link", name: "-1.2" },
        text("-1.2"),
        { role: "link", name: "-" },
        text("-"),
        { role: "link", name: "~" },
        text("~"),
        { role: "link", name: ".inf" },
        text(".NaN"),
        { role: "textbox" }
      ])
      // The YAML's `/url: "#"` lines and the textbox's `"555"` value can't be expressed: the snapshot node carries
      // no URL and no value
    }))

  test("AR-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<textarea>Before</textarea>`)
      // The textbox's value (`Before`, then `After`) can't be expressed: the snapshot node carries no value. What is
      // left is that the textarea's text content is not a child of the textbox.
      yield* checkTree(page.locator("body"), [{ role: "textbox" }])
      yield* page.evaluateInMainWorld(() => {
        document.querySelector("textarea")!.value = "After"
      })
      yield* checkTree(page.locator("body"), [{ role: "textbox" }])
    }))

  test("AR-033", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="visibility: hidden;">
      <div style="visibility: visible;">
        <button>Button</button>
      </div>
    </div>
  `)
      yield* checkTree(page.locator("body"), [])
    }))

  test("AR-034", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div aria-hidden="true">
      <div aria-hidden="false">
        <button>Button</button>
      </div>
    </div>
  `)
      yield* checkTree(page.locator("body"), [])
    }))

  test("AR-035", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input placeholder="Placeholder">
  `)
      yield* checkTree(page.locator("body"), [{ role: "textbox", name: "Placeholder" }])

      yield* page.setContent(`
    <input placeholder="Placeholder" aria-label="Label">
  `)
      // The YAML's `/placeholder: Placeholder` line can't be expressed: the snapshot node carries no placeholder.
      // Its absence is the point of this half, so only the label is asserted.
      yield* checkTree(page.locator("body"), [{ role: "textbox", name: "Label" }])
    }))

  test("AR-037", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>Hello</div>
  `)
      // The snapshot of a locator that doesn't exist yet waits for it to appear, as the original's promise does
      const waiting = yield* startWaiting(page.locator("#target").snapshot({ sources: "aria" }))
      // The original's own fixed wait, ported as written
      yield* Effect.sleep("2 seconds")
      yield* page.setContent(`
    <div id=target>
      Hello
      <iframe srcdoc="<ul><li>Item 1</li><li>Item 2</li></ul>"></iframe>
    </div>
  `)
      const snapshot = yield* Fiber.join(waiting.fiber)
      const children = snapshot.root.children.map(shapeOf)
      // The YAML's `- text: Hello`; the frame is listed without its content
      assert.deepStrictEqual(children.slice(0, 1), [text("Hello")])
      assert.deepStrictEqual(children.slice(1), [{ role: "iframe" }])
    }))

  test("AR-038", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul id=target>
      <li>item2</li>
      <li>
        <ul>
          <li>item3</li>
        </ul>
      </li>
    </ul>
  `)
      yield* checkTree(page.locator("#target"), [
        {
          role: "list",
          children: [
            { role: "listitem", children: [text("item2")] },
            { role: "listitem" }
          ]
        }
      ], { depth: 1 })
    }))

  test("AR-039", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Main Page</h1>
    <iframe srcdoc="<ul><li>Item 1</li><li>Item 2</li></ul>"></iframe>
  `)
      yield* checkTree(page.frame(page.locator("iframe")).locator("ul"), [
        {
          role: "list",
          children: [
            { role: "listitem", children: [text("Item 1")] },
            { role: "listitem", children: [text("Item 2")] }
          ]
        }
      ])
    }))

  test("AR-040", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frameset.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<frameset cols="50%,50%"><frame src="/frames/frame.html"><frame src="/frames/frame.html"></frameset>`)
      })
      yield* page.goto(server.PREFIX + "/frameset.html")
      // Like iframes, frames are listed in the snapshot, but their content is not included.
      assert.deepStrictEqual(yield* pageTree(page), [{ role: "iframe" }, { role: "iframe" }])
    }))

  test("AR-041", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/frameset.html")
      yield* checkTree(page.frame(page.locator("frame").first).locator("body"), [text("Hi, I'm frame")])
    }))

  test("AR-045", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <iframe name="visible" srcdoc="<button>Visible</button>"></iframe>
    <iframe name="hidden" style="visibility: hidden" srcdoc="<button>Hidden</button>"></iframe>
    <iframe name="none" style="display: none" srcdoc="<button>None</button>"></iframe>
  `)
      // Only the visible frame is listed, and without its content
      assert.deepStrictEqual(yield* pageTree(page), [{ role: "iframe" }])
    }))

  test("AR-046", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Hi</button>
    <button inert>Hello</button>
    <div inert>
      <button>Yay</button>
      <p>Some text</p>
    </div>
    <p>Visible <span inert>inert</span> text</p>
    <button><span inert>Save</span></button>
  `)
      yield* checkTree(page.locator("body"), [
        { role: "button", name: "Hi" },
        { role: "paragraph", children: [text("Visible text")] },
        { role: "button" }
      ])
    }))

  test("AR-047", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Title</h1>
    <button>Outside</button>
    <dialog id=dialog>
      <h2>Dialog</h2>
      <button>Inside</button>
      <div inert><button>Inert inside</button></div>
    </dialog>
    <script>
      document.getElementById('dialog').showModal();
    </script>
  `)
      yield* checkTree(page.locator("body"), [
        {
          role: "dialog",
          children: [
            { role: "heading", name: "Dialog" },
            // showModal() focuses the dialog's first button; the default YAML doesn't print `[active]`, Strider's tree has
            // the state
            { role: "button", name: "Inside", states: ["focused"] }
          ]
        }
      ])
      // The headings' `[level=N]` can't be expressed: the snapshot node carries no level

      yield* page.evaluateInMainWorld(() => {
        ;(document.getElementById("dialog") as HTMLDialogElement).close()
      })
      yield* checkTree(page.locator("body"), [
        { role: "heading", name: "Title" },
        { role: "button", name: "Outside" }
      ])
    }))
})
