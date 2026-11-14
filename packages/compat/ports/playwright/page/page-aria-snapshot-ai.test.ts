/**
 * Playwright's `tests/page/page-aria-snapshot-ai.spec.ts`: the snapshot an agent reads, with a ref for each element it
 * can act on. Playwright's `mode: "ai"` is Strider's default `page.snapshot()`, which carries inferred interactivity
 * and refs.
 *
 * What the port changes:
 * - Each YAML expectation (`toContainYaml`, or an exact string) is ported as the typed tree of the same structure:
 *   roles, accessible names, states, children, and each node's `ref` (whether it has one). A node's `cursor: "pointer"`
 *   is the inferred `cursorPointer` evidence, the typed form of `[cursor=pointer]`. The YAML is compared exactly, as
 *   the typed tree is; the sibling check of `toContainYaml` is the same comparison.
 * - Playwright's YAML keeps `generic` wrappers and prints them. Strider's tree gives a roleless element's children to
 *   its parent (API.md, Agents), so the port's shapes flatten the wrappers the YAML shows.
 * - Ref numbers are the YAML's counter (`e2`, `f1e3`). Strider's ref numbering is its own, so the port asserts what
 *   refs do: a ref names its node (`snapshot.ref(id)`), survives a rename, is stale after a navigation, and whether a
 *   node has one at all. Where the YAML's ref string is the point, the port compares which node it names.
 * - `page.getByRef(id).normalize()` and `ownerDocument` have no Strider equivalent (`method-locator-normalize` is
 *   missing), so the tests that use them are not ported (see the ledger).
 * - Playwright's `ariaSnapshot({ mode: "ai" })` also distills its output: it drops a generic whose text repeats its
 *   ancestor's name, and annotates aria-hidden subtrees. Those are the YAML's rendering, not the tree, and Strider's
 *   tree has no such annotation, so those tests are not ported (see the ledger).
 * - `page.evaluate(…)` and `locator.evaluate(…)` run page code: the page's own scripts run in the main world with
 *   `page.evaluateInMainWorld`, as Playwright's `evaluate` does.
 * - `page.waitForSelector("iframe")` is an attachment wait, which `Expect.toBeAttached` expresses.
 * - Playwright's `depth` counts from the topmost element its snapshot prints; Strider's page snapshot counts the
 *   document as the root, so the page snapshots here ask for one level more (AR-051, AR-090). A locator's snapshot
 *   counts the same in both. A node at the limit keeps its single text child in Playwright, where Strider's text
 *   child is a level of its own and is cut.
 * - Playwright's AI mode omits a name that only repeats printed descendants (AR-059 to AR-062), and keeps one that
 *   doesn't (AR-063, AR-064). The port asserts the YAML as written, so where Strider keeps the repeated name the
 *   test fails; Strider's tree has the accessible name.
 * - A heading's `[level=N]` and a link's `/url` can't be expressed: `Snapshot.Node` carries neither, so the port
 *   asserts the rest of the expectation (AR-049, AR-060 to AR-062, AR-064).
 * - The `[active]` on the root generic is the document, which the port reads from the document node's children and
 *   doesn't assert. A focused element's `[active]` is the `focused` state.
 */
import { assert } from "@effect/vitest"
import { Deadline, Expect, Locator, type Page, type Snapshot } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { failureOf } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** One node of an AI snapshot: role, name, states, its ref, its inferred cursor, and its children. */
interface Shape {
  readonly role: string
  readonly name?: string
  readonly states?: ReadonlyArray<string>
  readonly ref: boolean
  readonly cursor?: "pointer"
  readonly children?: ReadonlyArray<Shape>
}

const shapeOf = (node: Snapshot.Node): Shape => ({
  role: node.role.role,
  ...(node.name._tag === "None" ? {} : { name: node.name.value }),
  ...(node.states.size === 0 ? {} : { states: [...node.states].sort() }),
  ref: Option.isSome(node.ref),
  ...(node.role._tag === "Inferred" && node.role.evidence.includes("cursorPointer")
    ? { cursor: "pointer" as const }
    : {}),
  ...(node.children.length === 0 ? {} : { children: node.children.map(shapeOf) })
})

/** A text node, as the YAML's `- text: …`, which carries no ref. */
const T = (name: string): Shape => ({ role: "text", name, ref: false })

/** A node the YAML shows with a ref. */
const R = (role: string, name?: string, children?: ReadonlyArray<Shape>, extra?: Partial<Shape>): Shape => ({
  role,
  ...(name === undefined ? {} : { name }),
  ref: true,
  ...(children === undefined ? {} : { children }),
  ...extra
})

/** A node the YAML shows without a ref. */
const N = (role: string, name?: string, children?: ReadonlyArray<Shape>, extra?: Partial<Shape>): Shape => ({
  role,
  ...(name === undefined ? {} : { name }),
  ref: false,
  ...(children === undefined ? {} : { children }),
  ...extra
})

/** The page's children in the default snapshot: the document's, as the YAML's root generic's. */
const pageTree = Effect.fnUntraced(function*(page: Page.ReadonlyPage, options?: Snapshot.Options) {
  const snapshot = yield* page.snapshot(options)
  return snapshot.root.children.map(shapeOf)
})

/** A locator's default snapshot: the element's node, or a generic unnamed root's children. */
const locatorTree = Effect.fnUntraced(function*(locator: Locator.ReadonlyLocator, options?: Snapshot.Options) {
  const snapshot = yield* locator.snapshot(options)
  const root = snapshot.root
  return root.role.role === "generic" && root.name._tag === "None" ? root.children.map(shapeOf) : [shapeOf(root)]
})

/** The ref of the first node with `role` and `name` in a snapshot, which the test then acts on. */
const refNamed = (snapshot: Snapshot.Snapshot, role: string, name: string): Snapshot.RefId => {
  const find = (nodes: ReadonlyArray<Snapshot.Node>): Snapshot.RefId | undefined => {
    for (const node of nodes) {
      if (node.role.role === role && node.name._tag !== "None" && node.name.value === name && Option.isSome(node.ref)) {
        return node.ref.value
      }
      const inner = find(node.children)
      if (inner !== undefined) return inner
    }
    return undefined
  }
  const found = find(snapshot.root.children)
  assert.isDefined(found, `no ${role} "${name}" with a ref`)
  return found
}

/** The names of every node in a tree, in order, for a check that a name appears somewhere. */
const namesOf = (nodes: ReadonlyArray<Shape>): Array<string> =>
  nodes.flatMap((node) => [...(node.name === undefined ? [] : [node.name]), ...namesOf(node.children ?? [])])

upstream(import.meta.filename, {}, (test) => {
  test("AR-048", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>One</button>
    <button>Two</button>
    <button>Three</button>
  `)
      const snapshot1 = yield* page.snapshot()
      assert.deepStrictEqual(snapshot1.root.children.map(shapeOf), [
        R("button", "One"),
        R("button", "Two"),
        R("button", "Three")
      ])
      const two = refNamed(snapshot1, "button", "Two")
      assert.strictEqual(yield* snapshot1.ref(refNamed(snapshot1, "button", "One")).readText, "One")
      assert.strictEqual(yield* snapshot1.ref(two).readText, "Two")
      assert.strictEqual(yield* snapshot1.ref(refNamed(snapshot1, "button", "Three")).readText, "Three")

      yield* page.evaluateInMainWorld(() => {
        document.querySelectorAll("button")[1]!.textContent = "Not Two"
      })
      const snapshot2 = yield* page.snapshot()
      // The renamed button keeps its ref: the same node
      assert.deepStrictEqual(snapshot2.root.children.map(shapeOf), [
        R("button", "One"),
        R("button", "Not Two"),
        R("button", "Three")
      ])
      assert.strictEqual(refNamed(snapshot2, "button", "Not Two"), two)
    }))

  test("AR-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Hello</h1>
    <iframe name="foo" src="data:text/html,<h1>World</h1>">
  `)
      const snapshot1 = yield* pageTree(page)
      assert.isTrue(snapshot1.some((node) => node.role === "iframe"))
      assert.deepStrictEqual(snapshot1, [
        R("heading", "Hello"),
        R("iframe", undefined, [R("heading", "World")])
      ])
      const frameBody = yield* locatorTree(page.frame(page.locator("iframe")).locator("body"))
      assert.deepStrictEqual(frameBody.map((node) => [node.role, node.name]), [["heading", "World"]])
      assert.strictEqual(yield* page.frame(page.locator("iframe")).locator("h1").count, 1)
    }))

  test("AR-050", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Main Page</h1>
    <iframe srcdoc="<ul><li>Item 1</li><li>Item 2</li></ul>"></iframe>
  `)
      const list = yield* locatorTree(page.frame(page.locator("iframe")).locator("ul"))
      assert.deepStrictEqual(list, [
        R("list", undefined, [
          R("listitem", undefined, [T("Item 1")]),
          R("listitem", undefined, [T("Item 2")])
        ])
      ])
    }))

  test("AR-051", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <nav>
      <iframe srcdoc="<ul><li><button>Deep</button></li></ul>"></iframe>
    </nav>
  `)
      // Playwright counts levels from the topmost element it prints (the nav, once the body's generic is dropped);
      // Strider counts from the document, so Playwright's depth 3 is 4 here
      const tree = yield* pageTree(page, { depth: 4 })
      assert.deepStrictEqual(tree, [
        R("navigation", undefined, [
          R("iframe", undefined, [
            R("list", undefined, [R("listitem")])
          ])
        ])
      ])
      assert.notInclude(namesOf(tree), "Deep")
    }))

  test("AR-053", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/one.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end("<button>One</button>")
      })
      server.setRoute("/two.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end("<button>Two</button>")
      })

      yield* page.goto(server.PREFIX + "/one.html")
      const one = yield* page.snapshot()
      const oneRef = refNamed(one, "button", "One")
      assert.strictEqual(yield* one.ref(oneRef).readText, "One")

      // Cross-document navigation replaces the document, so the earlier snapshot's refs go stale
      yield* page.goto(server.PREFIX + "/two.html")
      const two = yield* page.snapshot()
      const twoRef = refNamed(two, "button", "Two")
      assert.strictEqual(yield* two.ref(twoRef).readText, "Two")

      // The stale ref from the previous document must not resolve against the new one
      const failure = yield* failureOf(one.ref(oneRef).readText, "the stale ref's read")
      assert(Locator.isLocatorError(failure))
      assert.strictEqual(failure.reason._tag, "StaleRef")

      // Same-document navigation keeps refs intact
      yield* page.evaluateInMainWorld(() => history.pushState({}, "", "/pushed.html"))
      assert.strictEqual(refNamed(yield* page.snapshot(), "button", "Two"), twoRef)
      assert.strictEqual(yield* two.ref(twoRef).readText, "Two")
    }))

  test("AR-054", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li><iframe srcdoc="<button>button1</button>"></iframe></li>
      <li><iframe srcdoc="<button>button2</button>"></iframe></li>
    </ul>
  `)
      const first = yield* page.snapshot()
      assert.deepStrictEqual(first.root.children.map(shapeOf), [
        R("list", undefined, [
          R("listitem", undefined, [R("iframe", undefined, [R("button", "button1")])]),
          R("listitem", undefined, [R("iframe", undefined, [R("button", "button2")])])
        ])
      ])
      const button2 = refNamed(first, "button", "button2")

      yield* page.evaluateInMainWorld(() => document.querySelector("iframe")!.remove())
      const second = yield* page.snapshot()
      assert.deepStrictEqual(second.root.children.map(shapeOf), [
        R("list", undefined, [
          R("listitem"),
          R("listitem", undefined, [R("iframe", undefined, [R("button", "button2")])])
        ])
      ])
      // The frame's refs persist across the change: the same button, the same ref
      assert.strictEqual(refNamed(second, "button", "button2"), button2)
      assert.strictEqual(yield* second.ref(button2).readText, "button2")

      yield* page.evaluateInMainWorld(() => {
        const frame = document.createElement("iframe")
        frame.setAttribute("srcdoc", "<button>button1</button>")
        document.querySelector("li")!.appendChild(frame)
      })
      const third = yield* page.snapshot()
      assert.deepStrictEqual(third.root.children.map(shapeOf), [
        R("list", undefined, [
          R("listitem", undefined, [R("iframe", undefined, [R("button", "button1")])]),
          R("listitem", undefined, [R("iframe", undefined, [R("button", "button2")])])
        ])
      ])
      assert.strictEqual(yield* third.ref(refNamed(third, "button", "button1")).readText, "button1")
      assert.strictEqual(yield* third.ref(refNamed(third, "button", "button2")).readText, "button2")
    }))

  test("AR-055", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button style="pointer-events: none">no-ref</button>
    <div style="pointer-events: none">
      <button style="pointer-events: auto">with-ref</button>
    </div>
    <div style="pointer-events: none">
      <div style="pointer-events: initial">
        <button>with-ref</button>
      </div>
    </div>
    <div style="pointer-events: none">
      <div style="pointer-events: auto">
        <button>with-ref</button>
      </div>
    </div>
    <div style="pointer-events: auto">
      <div style="pointer-events: none">
        <button>no-ref</button>
      </div>
    </div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        N("button", "no-ref"),
        R("button", "with-ref"),
        R("button", "with-ref"),
        R("button", "with-ref"),
        N("button", "no-ref")
      ])
    }))

  test("AR-056", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <style>
    input {
      width: 0;
      height: 0;
      opacity: 0;
    }
    </style>
    <div>
      <label>
        <span>
          <input type="radio" value="Apple" checked="">
        </span>
        <span>Apple</span>
      </label>
      <label>
        <span>
          <input type="radio" value="Pear">
        </span>
        <span>Pear</span>
      </label>
      <label>
        <span>
          <input type="radio" value="Orange">
        </span>
        <span>Orange</span>
      </label>
    </div>
  `)
      // The YAML's generic wrappers are flattened into their parent
      assert.deepStrictEqual(yield* pageTree(page), [
        N("radio", "Apple", undefined, { states: ["checked"] }),
        T("Apple"),
        N("radio", "Pear"),
        T("Pear"),
        N("radio", "Orange"),
        T("Orange")
      ])
    }))

  test("AR-057", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div>
      <div>
        <div>
          <button>Button</button>
        </div>
      </div>
    </div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [R("button", "Button")])
    }))

  test("AR-058", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button style="cursor: pointer">Button</button>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [R("button", "Button", undefined, { cursor: "pointer" })])
    }))

  test("AR-059", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a style="cursor: pointer" href="about:blank">
      Link with a button
      <button style="cursor: pointer">Button</button>
    </a>
  `)
      // The YAML leaves the link's name out: it repeats the text and the button printed inside it. Strider keeps it.
      assert.deepStrictEqual(yield* pageTree(page), [
        R("link", undefined, [
          T("Link with a button"),
          R("button", "Button", undefined, { cursor: "pointer" })
        ], {
          cursor: "pointer"
        })
      ])
    }))

  test("AR-060", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h3><a style="cursor: pointer" href="/issues/1">Clipboard API</a></h3>
  `)
      // The YAML leaves the heading's name out: it repeats its link's. Strider keeps it.
      assert.deepStrictEqual(yield* pageTree(page), [
        R("heading", undefined, [R("link", "Clipboard API", undefined, { cursor: "pointer" })])
      ])
    }))

  test("AR-061", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h3><span style="display: flex"><a style="cursor: pointer" href="/issues/1">Clipboard API</a></span></h3>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("heading", undefined, [R("link", "Clipboard API", undefined, { cursor: "pointer" })])
      ])
    }))

  test("AR-062", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h3><a style="cursor: pointer" href="/issues/1"><span><span>Clipboard API</span></span></a></h3>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("heading", undefined, [R("link", "Clipboard API", undefined, { cursor: "pointer" })])
      ])
    }))

  test("AR-063", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>
      <span>
        <span>
          <svg focusable="false" tabindex="-1" aria-hidden="true" viewBox="0 0 448 512">
            <path d="M416 208H272V64c0-17.67-14.33-32-32-32h-32c-17.67 0-32 14.33-32 32v144H32c-17.67 0-32 14.33-32 32v32c0 17.67 14.33 32 32 32h144v144c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32V304h144c17.67 0 32-14.33 32-32v-32c0-17.67-14.33-32-32-32z"/>
          </svg>
        </span>
        <span>Add New Item</span>
      </span>
    </button>
    <button><span>\n  <svg aria-hidden="true"></svg></span>New survey</button>
    <button><span><svg aria-hidden="true" style="width: 1em; height: 1em; display: inline-block"></svg></span>Edit survey</button>
  `)
      // The name a wrapper contributes survives its collapse, so each button keeps the name it had
      assert.deepStrictEqual(yield* pageTree(page), [
        R("button", "Add New Item"),
        R("button", "New survey"),
        R("button", "Edit survey")
      ])
    }))

  test("AR-064", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h3 aria-label="Clipboard API issue"><a style="cursor: pointer" href="/issues/1">Clipboard API</a></h3>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("heading", "Clipboard API issue", [R("link", "Clipboard API", undefined, { cursor: "pointer" })])
      ])
    }))

  test("AR-065", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">
    <img alt="A cat" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">
    <img style="cursor: pointer" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">
  `)
      // A nameless image that cannot be clicked carries no information and is omitted
      assert.deepStrictEqual(yield* pageTree(page), [
        R("img", "A cat"),
        R("img", undefined, undefined, { cursor: "pointer" })
      ])
    }))

  test("AR-066", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a style="cursor: pointer" href="/issue/1">Open issue <img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="></a>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("link", "Open issue", undefined, { cursor: "pointer" })
      ])
    }))

  test("AR-067", ({ page }) =>
    Effect.gen(function*() {
      const icon = `<svg viewBox="0 0 1024 1024"><use xlink:href="#icon"></use></svg>`
      yield* page.setContent(`
    <div style="cursor: pointer" aria-haspopup="true"><i>${icon}</i></div>
    <img style="cursor: pointer" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">
    <a style="cursor: pointer" href="/target">${icon}</a>
    <div onclick="void 0">${icon}</div>
  `)
      const tree = yield* pageTree(page)
      // The icon-only clickable elements are kept: the div, the image, and the link
      assert.deepStrictEqual(tree.slice(0, 3), [
        R("clickable", undefined, undefined, { cursor: "pointer" }),
        R("img", undefined, undefined, { cursor: "pointer" }),
        R("link", undefined, undefined, { cursor: "pointer" })
      ])
    }))

  test("AR-068", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a style="cursor: pointer" href="/issues/15860"><div>[Feature] a dedicated clipboard API</div></a>
  `)
      // The inner leaf is dropped: its text is the link's name
      assert.deepStrictEqual(yield* pageTree(page), [
        R("link", "[Feature] a dedicated clipboard API", undefined, { cursor: "pointer" })
      ])
    }))

  test("AR-069", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <a style="cursor: pointer" href="/labels"><span style="display: inline-block"><span style="display: inline-block"><span>P3-collecting-feedback</span></span></span></a>
  `)
      const tree = yield* pageTree(page)
      assert.deepStrictEqual(tree, [R("link", "P3-collecting-feedback", undefined, { cursor: "pointer" })])
      assert.strictEqual(namesOf(tree).filter((name) => name === "P3-collecting-feedback").length, 1)
    }))

  test("AR-071", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h3><a href="/issues/1">Clipboard API</a></h3>
  `)
      // The non-AI tree keeps the heading's name, which the AI snapshot may omit
      assert.deepStrictEqual(yield* pageTree(page, { sources: "aria" }), [
        R("heading", "Clipboard API", [R("link", "Clipboard API")])
      ])
    }))

  test("AR-073", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(
        `
    <p>Test</p>
    <iframe src="${server.PREFIX}/redirectloop1.html#depth=100000"></iframe>
  `,
        { waitUntil: "domContentLoaded" }
      )
      assert.deepStrictEqual(yield* pageTree(page), [
        R("paragraph", undefined, [T("Test")]),
        R("iframe")
      ])
    }))

  test("AR-074", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/frame.html")
      const [, snapshot] = yield* Effect.all([
        page.evaluateInMainWorld(() => window.location.reload()),
        page.snapshot()
      ], { concurrency: 2 })
      // The snapshot races the reload, which may re-number the main frame, so accept any ref
      assert.include(namesOf(snapshot.root.children.map(shapeOf)), "Hi, I'm frame")
    }))

  test("AR-075", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/css", (_req, res) => {
        res.setHeader("Content-Type", "text/css")
        setTimeout(() => res.end(`body { monospace }`), 1000)
      })
      yield* page.setContent(
        `
    <script src="${server.PREFIX}/css"></script>
    <p>Hello World</p>
  `,
        { waitUntil: "commit" }
      )
      assert.include(namesOf(yield* pageTree(page)), "Hello World")
    }))

  test("AR-076", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="visibility: hidden">
      <div style="visibility: visible">
        <button>Visible</button>
      </div>
      <div style="visibility: hidden">
        <button style="visibility: visible">Visible</button>
      </div>
      <div>
        <div style="visibility: visible">
          <button style="visibility: hidden">Hidden</button>
        </div>
        <button>Hidden</button>
      </div>
    </div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [R("button", "Visible"), R("button", "Visible")])
    }))

  test("AR-077", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button id="btn1">Button 1</button>
    <button id="btn2" autofocus>Button 2</button>
    <div>Not focusable</div>
  `)
      // Wait for autofocus to take effect
      yield* Expect.toBeFocused(page.locator("#btn2"))
      assert.deepStrictEqual(yield* pageTree(page), [
        R("button", "Button 1"),
        R("button", "Button 2", undefined, { states: ["focused"] }),
        T("Not focusable")
      ])
    }))

  test("AR-078", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id="input1" placeholder="First input">
    <input id="input2" placeholder="Second input">
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("textbox", "First input"),
        R("textbox", "Second input")
      ])
      yield* page.locator("#input2").focus()
      assert.deepStrictEqual(yield* pageTree(page), [
        R("textbox", "First input"),
        R("textbox", "Second input", undefined, { states: ["focused"] })
      ])
    }))

  test("AR-079", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id="regular-input" placeholder="Regular input">
    <iframe src="data:text/html,<input id='iframe-input' placeholder='Input in iframe'>" tabindex="0"></iframe>
  `)
      yield* page.frame(page.locator("iframe")).locator("#iframe-input").focus()
      // The iframe is marked active when it contains the focused element
      assert.deepStrictEqual(yield* pageTree(page), [
        R("textbox", "Regular input"),
        R("iframe", undefined, [R("textbox", "Input in iframe", undefined, { states: ["focused"] })], {
          states: ["focused"]
        })
      ])
    }))

  test("AR-080", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <div style="height: 5000px;">Test</div>
    <iframe loading="lazy" src="${server.PREFIX}/frame.html"></iframe>
  `)
      // The iframe should be present, and empty while it's not loaded
      yield* Expect.toBeAttached(page.locator("iframe"))
      const snapshot = yield* page.snapshot().pipe(Deadline.within("3 seconds"))
      assert.deepStrictEqual(snapshot.root.children.map(shapeOf), [T("Test"), R("iframe")])
    }))

  test("AR-081", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input id="regular-input" placeholder="Regular input">
    <iframe style='cursor: pointer' src="data:text/html,<input id='iframe-input' placeholder='Input in iframe'/>" tabindex="0"></iframe>
  `)
      yield* page.frame(page.locator("iframe")).locator("#iframe-input").focus()
      assert.deepStrictEqual(yield* pageTree(page), [
        R("textbox", "Regular input"),
        R("iframe", undefined, [R("textbox", "Input in iframe", undefined, { states: ["focused"] })], {
          states: ["focused"],
          cursor: "pointer"
        })
      ])
    }))

  test("AR-082", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/frameset.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(
          `<frameset rows="50%,50%"><frameset cols="50%,50%"><frame src="/frame-one.html"><frame src="/frame-two.html"></frameset><frame src="/frame-three.html"></frameset>`
        )
      })
      for (const name of ["one", "two", "three"]) {
        server.setRoute(`/frame-${name}.html`, (_req, res) => {
          res.setHeader("Content-Type", "text/html")
          res.end(`<button>Button ${name}</button>`)
        })
      }
      yield* page.goto(server.PREFIX + "/frameset.html")
      const snapshot = yield* page.snapshot().pipe(Deadline.within("3 seconds"))
      // The frameset's wrappers are flattened into the page's children
      assert.deepStrictEqual(snapshot.root.children.map(shapeOf), [
        R("iframe", undefined, [R("button", "Button one")]),
        R("iframe", undefined, [R("button", "Button two")]),
        R("iframe", undefined, [R("button", "Button three")])
      ])
      assert.strictEqual(yield* snapshot.ref(refNamed(snapshot, "button", "Button two")).readText, "Button two")
    }))

  test("AR-085", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/outer-frameset.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<frameset><frame src="/inner-frameset.html"></frameset>`)
      })
      server.setRoute("/inner-frameset.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<frameset><frameset><frame src="/leaf.html"></frameset></frameset>`)
      })
      server.setRoute("/leaf.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<button>Leaf button</button>`)
      })
      yield* page.goto(server.PREFIX + "/outer-frameset.html")
      const snapshot = yield* page.snapshot()
      assert.deepStrictEqual(snapshot.root.children.map(shapeOf), [
        R("iframe", undefined, [R("iframe", undefined, [R("button", "Leaf button")])])
      ])
      assert.strictEqual(yield* snapshot.ref(refNamed(snapshot, "button", "Leaf button")).readText, "Leaf button")
    }))

  test("AR-086", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li><b>3</b> <abbr>bds</abbr></li>
      <li><b>2</b> <abbr>ba</abbr></li>
      <li><b>1,200</b> <abbr>sqft</abbr></li>
    </ul>
    <ul>
      <li><div>3</div></li>
      <li><div>2</div></li>
      <li><div>1,200</div></li>
    </ul>`)
      // Inline wrappers collapse into their text; the second list's divs are flattened into their items
      assert.deepStrictEqual(yield* pageTree(page), [
        R("list", undefined, [
          R("listitem", undefined, [T("3 bds")]),
          R("listitem", undefined, [T("2 ba")]),
          R("listitem", undefined, [T("1,200 sqft")])
        ]),
        R("list", undefined, [
          R("listitem", undefined, [T("3")]),
          R("listitem", undefined, [T("2")]),
          R("listitem", undefined, [T("1,200")])
        ])
      ])
    }))

  test("AR-087", ({ page }) =>
    Effect.gen(function*() {
      // The nameless images are distilled away, so each wrapper is left with a single leaf generic child, whose text
      // is inlined into the wrapper, recursively for the second one.
      yield* page.setContent(`
    <div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="><div>Status: Open.</div></div>
    <div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="><div><img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA="><div>Nested twice.</div></div></div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("generic", undefined, [T("Status: Open.")]),
        R("generic", undefined, [T("Nested twice.")])
      ])
    }))

  test("AR-088", ({ page }) =>
    Effect.gen(function*() {
      // Every wrapper contains a nameless image (distilled away) plus a single generic child, so the
      // text bubbles up the whole chain - all the way into the body.
      const img = `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=">`
      yield* page.setContent(`
    <div>${img}<div>${img}<div>${img}<div>${img}<div>Deeply nested.</div></div></div></div></div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [T("Deeply nested.")])
    }))

  test("AR-089", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<div title="Element title">Element content</div>`)
      assert.deepStrictEqual(yield* pageTree(page), [R("generic", "Element title", [T("Element content")])])
    }))

  test("AR-090", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <ul>
      <li>item1</li>
      <a href="about:blank" style="cursor:pointer">link</a>
      <li>
        <ul id=target>
          <li>item2</li>
          <li>
            <ul>
              <li>item3</li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  `)
      const link = R("link", "link", undefined, { cursor: "pointer" })
      // Playwright's depth 1 and 3 are Strider's 2 and 4 for a page: Strider counts the document as the root
      assert.deepStrictEqual(yield* pageTree(page, { depth: 2 }), [
        R("list", undefined, [
          R("listitem", undefined, [T("item1")]),
          link,
          R("listitem")
        ])
      ])
      assert.deepStrictEqual(yield* pageTree(page, { depth: 4 }), [
        R("list", undefined, [
          R("listitem", undefined, [T("item1")]),
          link,
          R("listitem", undefined, [
            R("list", undefined, [
              R("listitem", undefined, [T("item2")]),
              R("listitem")
            ])
          ])
        ])
      ])
      assert.deepStrictEqual(yield* pageTree(page, { depth: 100 }), [
        R("list", undefined, [
          R("listitem", undefined, [T("item1")]),
          link,
          R("listitem", undefined, [
            R("list", undefined, [
              R("listitem", undefined, [T("item2")]),
              R("listitem", undefined, [
                R("list", undefined, [R("listitem", undefined, [T("item3")])])
              ])
            ])
          ])
        ])
      ])
      assert.deepStrictEqual(yield* locatorTree(page.locator("#target"), { depth: 1 }), [
        R("list", undefined, [
          R("listitem", undefined, [T("item2")]),
          R("listitem")
        ])
      ])
    }))

  test("AR-093", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <iframe name="visible" srcdoc="<button>Visible</button>"></iframe>
    <iframe name="hidden" style="visibility: hidden" srcdoc="<button>Hidden</button>"></iframe>
    <iframe name="none" style="display: none" srcdoc="<button>None</button>"></iframe>
  `)
      const tree = yield* pageTree(page)
      assert.deepStrictEqual(tree, [R("iframe", undefined, [R("button", "Visible")])])
      assert.notInclude(namesOf(tree), "Hidden")
      assert.notInclude(namesOf(tree), "None")
    }))

  test("AR-094", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>with-ref</button>
    <button inert>no-ref</button>
    <div inert>
      <button>no-ref</button>
    </div>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        R("button", "with-ref"),
        N("button", undefined, [T("no-ref")]),
        N("button", undefined, [T("no-ref")])
      ])
    }))

  test("AR-095", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>Outside</button>
    <dialog id=dialog>
      <button>Inside</button>
    </dialog>
    <script>
      document.getElementById('dialog').showModal();
    </script>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        N("button", undefined, [T("Outside")]),
        R("dialog", undefined, [R("button", "Inside", undefined, { states: ["focused"] })])
      ])
    }))
})
