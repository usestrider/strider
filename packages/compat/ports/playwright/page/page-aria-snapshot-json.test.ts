/**
 * Playwright's `tests/page/page-aria-snapshot-json.spec.ts`: the structured snapshot a page or locator returns, its roles,
 * names, states, text, children, refs in AI mode, inferred cursors, iframes, and depth.
 *
 * What the port changes:
 * - Playwright's JSON node is `{ role, name, level, checked, disabled, url, value, text, children, ref, box }`. Strider's
 *   snapshot node carries a role, an accessible name, states, its children, and an optional ref, so each expectation
 *   is the same tree in those fields. Text is a child text node, `{ role: "text", name }`, as in page-aria-snapshot-ai.
 *   A `text` on an element with one text child is that child.
 * - Strider's `Snapshot.Node` carries no heading `level` (AR-096) and no link `url` (AR-099). The port asserts the rest
 *   of each expectation and leaves those fields out; AR-098's point is its `url` and textbox `value`, so it isn't ported
 *   (see the ledger). AR-105's `boxes` isn't in Strider's node either (see the ledger).
 * - `page.ariaSnapshotJSON()` is `page.snapshot()`, and `locator.ariaSnapshotJSON()` is `locator.snapshot()`. Strider's
 *   default is the AI-mode tree, with refs and inferred interactivity, so `mode: "ai"` is the default and AR-101 uses it.
 * - Playwright's `ariaSnapshotJSON({ mode: "ai" })` lists the root as a `generic` node that holds the page's elements.
 *   Strider's tree gives a roleless element's children to its parent, so the document's children are the tree's roots.
 * - AR-101's `ref: "e2"` is Playwright's own counter, and Strider's refs are opaque: the port checks that each button has a
 *   ref and that `snapshot.ref(ref)` names the node it came from, as page-aria-snapshot-ai's ports do.
 * - AR-102's `cursor: "pointer"` is Strider's `cursorPointer` evidence on the node's role. Strider records that evidence
 *   only on a node whose role it inferred (an element with no role of its own), so a button with a pointer cursor carries
 *   none and the test fails.
 * - AR-103's frame refs are `f<frame>e<n>` in Playwright; Strider's are opaque, so the port checks that the iframe and its
 *   button each have a ref.
 * - AR-104's `depth: 1` counts from the topmost element Playwright prints. Strider counts from the document, so the port
 *   asks for `depth: 2`, as page-aria-snapshot-ai does.
 * - `page.setContent` is the same call. The original's `expect(...).toEqual` over the result is `assert.deepStrictEqual`.
 */
import { assert } from "@effect/vitest"
import { Expect, type Locator, type Page, type Snapshot } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** One node of a structured snapshot: its role, name, states, and children. */
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

/** A text node: the text of an element's child, as Playwright's `text` or a top-level text fragment. */
const T = (name: string): Shape => ({ role: "text", name })

/** The page's children in the default snapshot: the document's, as Playwright's root generic's. */
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

/** The first node in a tree that satisfies `predicate`, in document order. */
const findNode = (
  nodes: ReadonlyArray<Snapshot.Node>,
  predicate: (node: Snapshot.Node) => boolean
): Snapshot.Node | undefined => {
  for (const node of nodes) {
    if (predicate(node)) return node
    const inner = findNode(node.children, predicate)
    if (inner !== undefined) return inner
  }
  return undefined
}

/** Whether a node's role was inferred from a pointer cursor, which Playwright's AI mode prints as `[cursor=pointer]`. */
const hasCursorPointer = (node: Snapshot.Node) =>
  node.role._tag === "Inferred" && node.role.evidence.includes("cursorPointer")

upstream(import.meta.filename, {}, (test) => {
  test("AR-096", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>title</h1>
    <ul aria-label="my list">
      <li>one</li>
      <li>two</li>
    </ul>
  `)
      // Playwright's heading also carries `level: 1`, which Snapshot.Node doesn't have
      assert.deepStrictEqual(yield* pageTree(page), [
        { role: "heading", name: "title" },
        {
          role: "list",
          name: "my list",
          children: [
            { role: "listitem", children: [T("one")] },
            { role: "listitem", children: [T("two")] }
          ]
        }
      ])
    }))

  test("AR-097", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <input type="checkbox" title="Check" checked>
    <button disabled>Click</button>
  `)
      assert.deepStrictEqual(yield* pageTree(page), [
        { role: "checkbox", name: "Check", states: ["checked"] },
        { role: "button", name: "Click", states: ["disabled"] }
      ])
    }))

  test("AR-099", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<p>Hello <a href="/link">world</a> again</p>`)
      // Playwright's link also carries `url: "/link"`, which Snapshot.Node doesn't have
      assert.deepStrictEqual(yield* pageTree(page), [
        {
          role: "paragraph",
          children: [
            T("Hello"),
            { role: "link", name: "world" },
            T("again")
          ]
        }
      ])
    }))

  test("AR-100", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`Hello <button>One</button> again`)
      assert.deepStrictEqual(yield* pageTree(page), [
        T("Hello"),
        { role: "button", name: "One" },
        T("again")
      ])
    }))

  test("AR-101", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <button>One</button>
    <button>Two</button>
  `)
      const snapshot = yield* page.snapshot()
      // Playwright's root `generic` holds the buttons; Strider's roleless root gives them to the document
      assert.deepStrictEqual(snapshot.root.children.map(shapeOf), [
        { role: "button", name: "One" },
        { role: "button", name: "Two" }
      ])
      const [one, two] = snapshot.root.children
      // `page.getByRef("e2")` names the first button
      yield* snapshot.ref(Option.getOrThrow(one!.ref)).pipe(Expect.toHaveText("One"))
      yield* snapshot.ref(Option.getOrThrow(two!.ref)).pipe(Expect.toHaveText("Two"))
    }))

  test("AR-102", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<button style="cursor: pointer">One</button>`)
      const snapshot = yield* page.snapshot()
      const button = findNode(snapshot.root.children, (node) => node.role.role === "button")
      assert.isDefined(button)
      assert.isTrue(hasCursorPointer(button!))
    }))

  test("AR-103", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>Hello</h1>
    <iframe srcdoc="<button>In frame</button>"></iframe>
  `)
      const snapshot = yield* page.snapshot()
      assert.deepStrictEqual(snapshot.root.children.map(shapeOf), [
        { role: "heading", name: "Hello" },
        { role: "iframe", children: [{ role: "button", name: "In frame" }] }
      ])
      // Playwright's frame refs are `f<n>e<n>`; Strider's are opaque, so the port checks that both nodes have one
      const iframe = snapshot.root.children[1]!
      assert.isTrue(Option.isSome(iframe.ref))
      assert.isTrue(Option.isSome(iframe.children[0]!.ref))
    }))

  test("AR-104", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`<ul><li><button>One</button></li></ul>`)
      // Strider counts the document as the root, so Playwright's depth 1 is depth 2 here
      assert.deepStrictEqual(yield* pageTree(page, { depth: 2 }), [
        {
          role: "list",
          children: [
            { role: "listitem" }
          ]
        }
      ])
    }))

  test("AR-106", ({ page }) =>
    Effect.gen(function*() {
      yield* page.setContent(`
    <h1>title</h1>
    <ul>
      <li>one</li>
      <li>two</li>
    </ul>
  `)
      assert.deepStrictEqual(yield* locatorTree(page.locator("ul")), [
        {
          role: "list",
          children: [
            { role: "listitem", children: [T("one")] },
            { role: "listitem", children: [T("two")] }
          ]
        }
      ])
    }))
})
