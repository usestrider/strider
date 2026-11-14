/**
 * Playwright's `tests/page/frame-hierarchy.spec.ts`: the frame tree a page's documents make, and the frame events
 * their attaching, navigating, and detaching raise.
 *
 * What the port changes:
 * - A frame is entered by its iframe element (`page.frame(page.locator("iframe"))`), and the frame tree is
 *   `page.frames`: each node's `id`, `url`, and `children`. No backend reports a frame's name, so FR-024 and FR-032,
 *   which assert names, are `needsFeature`, and FR-036's `frame.page()` is too, since a frame locator doesn't carry its
 *   page (see the ledger).
 * - Playwright's frame events are callbacks. Here `frameattached` and `framedetached` are the frames the tree gains and
 *   loses between two reads, taken once the step's change is in the tree (`gained` and `lost`). `framenavigated` is
 *   the page's navigation log with `frames: "all"` (`PageNavigation.history`), counted from where the original starts
 *   counting. A count is what the step did, not the order its events arrived in.
 * - Playwright's `page.evaluate` runs in the page's main world, so each page script is `page.evaluateInMainWorld`,
 *   and `attachFrame` is the harness's, which runs there too.
 * - Playwright's `goto` waits for `load` by default and Strider's for `commit`, so each `goto` passes
 *   `waitUntil: "load"`, and FR-026's `goto` to a fragment does too.
 * - FR-025 attaches `./assets/frame.html`, which is no vendored file. Playwright's test server answers it 404 as the
 *   fixture server does, and the test checks only the frame's URL, which is the same.
 * - FR-035's console refusal is `ConsoleMessage.next` filtered on the same text.
 */
import { assert } from "@effect/vitest"
import { ConsoleMessage, PageNavigation } from "@usestrider/browser"
import type { Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { attachFrame, frameCount } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/** A frame tree's nodes, the root first. */
const nodesOf = (tree: Page.FrameTree): ReadonlyArray<Page.FrameTree> => [tree, ...tree.children.flatMap(nodesOf)]

/** The frames of `after` that `before` doesn't have: what attached between the two reads. */
const gained = (before: Page.FrameTree, after: Page.FrameTree): ReadonlyArray<Page.FrameTree> => {
  const known = new Set(nodesOf(before).map((node) => node.id))
  return nodesOf(after).filter((node) => !known.has(node.id))
}

/** The frames of `before` that `after` doesn't have: what detached between the two reads. */
const lost = (before: Page.FrameTree, after: Page.FrameTree): ReadonlyArray<Page.FrameTree> => gained(after, before)

/** The page's navigation log, every frame's navigations included. */
const logged = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  return (yield* PageNavigation.history(page, { frames: "all" })).entries
})

/**
 * What the frame tree gained and lost, and how many navigations happened, while `step` runs. Playwright's
 * `attachedFrames`, `detachedFrames`, and `navigatedFrames` are these counts.
 */
const eventsOf = Effect.fnUntraced(function*(
  page: Page.ReadonlyPage,
  step: Effect.Effect<unknown, unknown>,
  settled: (tree: Page.FrameTree) => boolean
) {
  const before = yield* page.frames
  const navigations = (yield* logged(page)).length
  yield* step
  const after = yield* page.frames.waitFor(settled)
  return {
    attached: gained(before, after).length,
    detached: lost(before, after).length,
    navigated: (yield* logged(page)).length - navigations
  }
})

upstream(import.meta.filename, {}, (test) => {
  // FR-024 and FR-032 need frame names, which no backend reports (`FrameTree.name` is always `None`): see the ledger.
  test("FR-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // validate frameattached events
      const beforeAttach = yield* page.frames
      yield* attachFrame(page, "frame1", "./assets/frame.html")
      const attached = yield* page.frames.waitFor((tree) =>
        gained(beforeAttach, tree).some((node) => node.url.includes("/assets/frame.html"))
      )
      assert.strictEqual(gained(beforeAttach, attached).length, 1)

      // validate framenavigated events
      const navigated = yield* PageNavigation.next(page, { frames: "all", url: server.EMPTY_PAGE, waitUntil: "load" })
      const navigationsBefore = (yield* logged(page)).length
      yield* page.evaluateInMainWorld(async () => {
        const frame = document.getElementById("frame1") as HTMLIFrameElement
        frame.src = "./empty.html"
        await new Promise((resolve) => frame.onload = resolve)
      })
      yield* navigated
      const navigatedFrames = (yield* logged(page)).slice(navigationsBefore)
      assert.strictEqual(navigatedFrames.length, 1)
      assert.strictEqual(navigatedFrames[0]!.url, server.EMPTY_PAGE)

      // validate framedetached events
      const beforeDetach = yield* page.frames
      yield* page.evaluateInMainWorld(() => document.getElementById("frame1")!.remove())
      const detached = yield* page.frames.waitFor((tree) => lost(beforeDetach, tree).length === 1)
      // isDetached(): the frame is no longer in the tree
      assert.strictEqual(lost(beforeDetach, detached).length, 1)
    }))

  test("FR-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Playwright's Promise.all: the wait is subscribed before the navigation starts
      const navigated = yield* PageNavigation.next(page)
      yield* page.goto(server.EMPTY_PAGE + "#foo", { waitUntil: "load" })
      yield* navigated
      assert.strictEqual(yield* page.url, server.EMPTY_PAGE + "#foo")
    }))

  test("FR-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const mainFrame = (yield* page.frames).id
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      // The root of the tree is the page's main frame, the same frame after the navigation
      assert.strictEqual((yield* page.frames).id, mainFrame)
    }))

  test("FR-028", ({ page, server }) =>
    Effect.gen(function*() {
      const before = yield* page.frames
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const after = yield* page.frames
      assert.strictEqual(gained(before, after).length, 0)
      assert.strictEqual(lost(before, after).length, 0)
    }))

  test("FR-029", ({ page, server }) =>
    Effect.gen(function*() {
      const loaded = yield* eventsOf(
        page,
        page.goto(server.PREFIX + "/frames/nested-frames.html", { waitUntil: "load" }).pipe(Effect.asVoid),
        (tree) => nodesOf(tree).length === 5
      )
      assert.strictEqual(loaded.attached, 4)
      assert.strictEqual(loaded.detached, 0)
      assert.strictEqual(loaded.navigated, 5)

      const emptied = yield* eventsOf(
        page,
        page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.asVoid),
        (tree) => nodesOf(tree).length === 1
      )
      assert.strictEqual(emptied.attached, 0)
      assert.strictEqual(emptied.detached, 4)
      assert.strictEqual(emptied.navigated, 1)
    }))

  test("FR-030", ({ page, server }) =>
    Effect.gen(function*() {
      const loaded = yield* eventsOf(
        page,
        page.goto(server.PREFIX + "/frames/frameset.html", { waitUntil: "load" }).pipe(Effect.asVoid),
        (tree) => nodesOf(tree).length === 5
      )
      assert.strictEqual(loaded.attached, 4)
      assert.strictEqual(loaded.detached, 0)
      assert.strictEqual(loaded.navigated, 5)

      const emptied = yield* eventsOf(
        page,
        page.goto(server.EMPTY_PAGE, { waitUntil: "load" }).pipe(Effect.asVoid),
        (tree) => nodesOf(tree).length === 1
      )
      assert.strictEqual(emptied.attached, 0)
      assert.strictEqual(emptied.detached, 4)
      assert.strictEqual(emptied.navigated, 1)
    }))

  test("FR-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shadow.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async (url) => {
        const frame = document.createElement("iframe")
        frame.src = url
        document.body.shadowRoot!.appendChild(frame)
        await new Promise((resolve) => frame.onload = resolve)
      }, server.EMPTY_PAGE)
      assert.strictEqual(yield* frameCount(page), 2)
      assert.strictEqual((yield* page.frames).children[0]!.url, server.EMPTY_PAGE)
    }))

  // FR-032 needs frame names too: see the ledger.
  test("FR-033", ({ page, server }) =>
    Effect.gen(function*() {
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const tree = yield* page.frames
      // The main frame has no parent; each iframe is a child of it, and has none of its own
      assert.strictEqual(tree.children.length, 2)
      assert.deepStrictEqual(tree.children.map((child) => child.children.length), [0, 0])
    }))

  test("FR-034", ({ page, server }) =>
    Effect.gen(function*() {
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const firstId = (yield* page.frames).children[0]!.id
      // `window.frame` is the element, held across the two steps as the original holds it
      yield* page.evaluateInMainWorld(() => {
        const held = window as unknown as { frame: Element | null }
        held.frame = document.querySelector("#frame1")
        held.frame!.remove()
      })
      // frame1.isDetached(): its frame is gone from the tree
      yield* page.frames.waitFor((tree) => !nodesOf(tree).some((node) => node.id === firstId))
      yield* page.evaluateInMainWorld(() => {
        document.body.appendChild((window as unknown as { frame: Element }).frame)
      })
      // frame2 is attached and not detached, and it is a new frame, not frame1 again
      const reattached = yield* page.frames.waitFor((tree) => tree.children.length === 1)
      assert.notStrictEqual(reattached.children[0]!.id, firstId)
      assert.isFalse(nodesOf(reattached).some((node) => node.id === firstId))
    }))

  test("FR-035", ({ page, server }) =>
    Effect.gen(function*() {
      server.setRoute("/x-frame-options-deny.html", (_request, response) => {
        response.setHeader("Content-Type", "text/html")
        response.setHeader("X-Frame-Options", "DENY")
        response.end(
          `<!DOCTYPE html><html><head><title>login</title></head><body style="background-color: red;"><p>dangerous login page</p></body></html>`
        )
      })
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const refusal = yield* ConsoleMessage.next(page, { text: /Refused to display/i })
      yield* page.setContent(`<iframe src="${server.CROSS_PROCESS_PREFIX}/x-frame-options-deny.html"></iframe>`)
      const message = yield* refusal
      assert.match(message.text, /Refused to display .* in a frame because it set 'X-Frame-Options' to 'deny'./i)
    }))

  // FR-036 needs `frame.page()`, which a frame locator doesn't carry: see the ledger.
})
