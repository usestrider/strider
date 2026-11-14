/**
 * Puppeteer's `test/src/frame.test.ts`: frame lifecycle, frame navigation events, and the frame tree.
 *
 * What the port changes:
 * - `page.mainFrame()`, `page.frames()`, and `frame.parentFrame()` are reads of the `page.frames` tree, read once as the
 *   original reads them. A frame is identified by its tree id, as Puppeteer's Frame objects are; `frameById` finds one.
 * - Puppeteer's `frameattached` and `framedetached` events are tree states: the port waits for the frame to be in the
 *   tree, or gone from it, and counts the frames it holds. Strider's tree is the latest value (`page.frames.changes`
 *   may skip a value between two samples), so a frame that attaches and detaches between two samples is not seen; the
 *   matrix row for these events says the same.
 * - `framenavigated`, `framenavigatednewdocument`, and `framenavigatedsamedocument` are `PageNavigation.stream` with
 *   `frames: "all"`: each committed navigation is `framenavigated` and then `framenavigatednewdocument`, and each
 *   same-document one `framenavigated` and then `framenavigatedsamedocument`, as the original's events come. The events
 *   are collected from the moment the port subscribes, as Puppeteer's `page.on` listeners are.
 * - Puppeteer's `page.evaluate` runs in the main world, so the port uses `page.evaluateInMainWorld` for page code. Its
 *   `evaluateHandle` is Strider's `page.evaluateHandle`, which runs in the isolated world, the only one the handle
 *   needs to be truthy in.
 * - `frame.evaluate` is a frame locator's `:root` evaluated in the frame's isolated world, the only one a frame has.
 * - `navigateFrame`, `detachFrame`, and `dumpFrames` are the local equivalents in `harness/puppeteer.ts`, and
 *   `attachFrame` and `frameCount` are the harness's.
 * - The tests whose point is a Puppeteer object (`frame.page()`, `frame.client`, `frameElement()`) aren't ported; the
 *   ledger says why each is.
 * - "should support lazy frames": Puppeteer reads the private `_hasStartedLoading`; the port reads the lazy frame's URL,
 *   which stays `about:blank` until it starts loading.
 * - "should not send attach/detach events for main frame" collects the tree's values (`page.frames.changes`) across the
 *   load and checks none has a child.
 * - "should support framesets" and "should click elements in a frameset" use the `frame` elements of a frameset, which
 *   `page.frame` enters as it enters an `iframe`.
 * - "should evaluate ... with readonly array": the port checks the array the page returns, which the original doesn't.
 * - Puppeteer's `page.setViewport` is `page.emulate({ viewport })`, whose registration lasts as long as the test.
 */
import { assert } from "@effect/vitest"
import { Condition, Expect, Locator, type Page, PageNavigation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import { attachFrame, failureOf, frameCount } from "../harness/playwright.ts"
import { detachFrame, dumpFrames, flatten, frameById, navigateFrame } from "../harness/puppeteer.ts"
import { upstream } from "../harness/upstream.ts"

type Navigation = PageNavigation.PageNavigation

/** A page's `Ref` of the navigations of the page and its frames, from the moment it's called, as `page.on` would collect. */
const collectNavigations = Effect.fnUntraced(function*(page: Page.Page) {
  const seen = yield* Ref.make<ReadonlyArray<Navigation>>([])
  const navigations = yield* PageNavigation.stream(page, { frames: "all" })
  yield* navigations.pipe(
    Stream.runForEach((navigation) => Ref.update(seen, (list) => [...list, navigation])),
    Effect.forkScoped
  )
  return seen
})

/** Puppeteer's `framenavigated` events and their companion events, in the order the original emits them. */
const frameEvents = (navigations: ReadonlyArray<Navigation>): ReadonlyArray<string> =>
  navigations.flatMap((navigation) => [
    "framenavigated",
    navigation._tag === "SameDocument" ? "framenavigatedsamedocument" : "framenavigatednewdocument"
  ])

/** Waits until the collected navigations satisfy `holds`, as Puppeteer's `waitEvent` waits for its event. */
const waitForNavigations = (
  seen: Ref.Ref<ReadonlyArray<Navigation>>,
  label: string,
  holds: (list: ReadonlyArray<Navigation>) => boolean
) => Expect.that(Ref.get(seen), Condition.make(label, holds))

/** Empties the collected list, for the events of the next step. */
const takeNavigations = (seen: Ref.Ref<ReadonlyArray<Navigation>>) => Ref.getAndSet(seen, [])

/** The `id` of the one child of the main frame, after waiting for it to attach. */
const onlyChildId = Effect.fnUntraced(function*(page: Page.Page) {
  const tree = yield* page.frames.waitFor((tree) => tree.children.length === 1)
  return tree.children[0]!.id
})

/** The frame with `id`'s URL, read from the tree. */
const urlOf = Effect.fnUntraced(function*(page: Page.Page, id: Page.FrameTree["id"]) {
  const frame = frameById(yield* page.frames, id)
  assert.isDefined(frame, `the tree has no frame ${id}`)
  return String(frame!.url)
})

/** The ids of the frames in a tree, other than the main frame. */
const childIds = (tree: Page.FrameTree) => flatten(tree).slice(1).map((frame) => frame.id)

upstream(import.meta.filename, {}, (test) => {
  test("Frame specs Frame.evaluateHandle should work", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const windowHandle = yield* page.evaluateHandle(() => window)
      assert.isDefined(windowHandle)
    }))

  test("Frame specs Frame.evaluate should throw for detached frames", ({ page, server }) =>
    Effect.gen(function*() {
      const frame1 = yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* detachFrame(page, "frame1")
      const error = yield* failureOf(frame1.locator(":root").evaluate(() => 7 * 8), "evaluating in a detached frame")
      // Puppeteer's message is "Attempted to use detached Frame"; Strider's frame locator finds no iframe to enter
      assert(Locator.isLocatorError(error), String(error))
      assert.strictEqual(error.reason._tag, "NoMatch")
    }))

  test("Frame specs Frame.evaluate allows readonly array to be an argument", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // The readonly array of issue puppeteer/puppeteer#6953: the page gets the array back, which the original doesn't check
      const readonlyArray: ReadonlyArray<string> = ["a", "b", "c"]
      const returned = yield* page.evaluateInMainWorld((arr: ReadonlyArray<string>) => arr, readonlyArray)
      assert.deepStrictEqual(returned, ["a", "b", "c"])
    }))

  test("Frame specs Frame Management should handle nested frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/nested-frames.html", { waitUntil: "load" })
      assert.deepStrictEqual(dumpFrames(yield* page.frames), [
        "http://localhost:<PORT>/frames/nested-frames.html",
        "    http://localhost:<PORT>/frames/two-frames.html (2frames)",
        "        http://localhost:<PORT>/frames/frame.html (uno)",
        "        http://localhost:<PORT>/frames/frame.html (dos)",
        "    http://localhost:<PORT>/frames/frame.html (aframe)"
      ])
    }))

  test("Frame specs Frame Management should send events when frames are manipulated dynamically", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // frameattached: the frame is in the tree, once, with its URL
      yield* attachFrame(page, "frame1", "./assets/frame.html")
      const childId = yield* onlyChildId(page)
      assert.strictEqual((yield* page.frames).children.length, 1)
      assert.include(yield* urlOf(page, childId), "/assets/frame.html")

      // framenavigated: the child's one navigation, to where it's sent
      const navigations = yield* collectNavigations(page)
      yield* navigateFrame(page, "frame1", "./empty.html")
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      // Puppeteer counts every frame's navigation, not only the child's: there is one, and it is the child's
      const navigated = yield* Ref.get(navigations)
      assert.strictEqual(navigated.length, 1)
      assert.strictEqual(navigated[0]!.frame, childId)
      assert.strictEqual(String(navigated[0]!.url), server.EMPTY_PAGE)

      // framedetached: the frame is gone from the tree
      yield* detachFrame(page, "frame1")
      const tree = yield* page.frames.waitFor((tree) => tree.children.length === 0)
      assert.isUndefined(frameById(tree, childId))
    }))

  test("Frame specs Frame Management should send \"framenavigated\" when navigating on anchor URLs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      // Puppeteer waits for the framenavigated event the anchor navigation fires
      const navigations = yield* collectNavigations(page)
      yield* page.goto(server.EMPTY_PAGE + "#foo", { waitUntil: "load" })
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      assert.strictEqual(String(yield* page.url), server.EMPTY_PAGE + "#foo")
    }))

  test("Frame specs Frame Management should send \"framenavigatednewdocument\" when navigating to a new document", ({ page, server }) =>
    Effect.gen(function*() {
      const navigations = yield* collectNavigations(page)
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      const events = yield* Ref.get(navigations)
      assert.deepStrictEqual(frameEvents(events), ["framenavigated", "framenavigatednewdocument"])
      // navigatedFrames[0] is the main frame, and its URL is the empty page
      const main = yield* page.frames
      assert.strictEqual(events[0]!.frame, main.id)
      assert.strictEqual(String(events[0]!.url), server.EMPTY_PAGE)
    }))

  test("Frame specs Frame Management should send \"framenavigatedsamedocument\" when navigating on anchor URLs", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const navigations = yield* collectNavigations(page)
      yield* page.goto(server.EMPTY_PAGE + "#foo", { waitUntil: "load" })
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      const events = yield* Ref.get(navigations)
      assert.deepStrictEqual(frameEvents(events), ["framenavigated", "framenavigatedsamedocument"])
      const main = yield* page.frames
      assert.strictEqual(events[0]!.frame, main.id)
      assert.strictEqual(String(events[0]!.url), server.EMPTY_PAGE + "#foo")
    }))

  // Puppeteer's test runs once per method. Its key keeps the literal `${method}`, so each run is a variant of that key.
  for (const method of ["pushState", "replaceState"] as const) {
    test("Frame specs Frame Management should send \"framenavigatedsamedocument\" on history.${method}", {
      variant: method
    }, ({ page, server }) =>
      Effect.gen(function*() {
        yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
        const navigations = yield* collectNavigations(page)
        yield* page.evaluateInMainWorld((method: "pushState" | "replaceState") => {
          history[method]({}, "", "/history-api.html")
        }, method)
        yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
        const events = yield* Ref.get(navigations)
        assert.deepStrictEqual(frameEvents(events), ["framenavigated", "framenavigatedsamedocument"])
        const [navigation] = events
        // Strider names the History API as the cause of the same-document navigation
        assert.strictEqual(navigation?._tag === "SameDocument" && navigation.via, "historyApi")
        const main = yield* page.frames
        assert.strictEqual(navigation?.frame, main.id)
        assert.strictEqual(String(navigation?.url), server.PREFIX + "/history-api.html")
      }))
  }

  test("Frame specs Frame Management should send \"framenavigatednewdocument\" for child frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const childId = yield* onlyChildId(page)
      const navigations = yield* collectNavigations(page)
      yield* navigateFrame(page, "frame1", "./assets/frame.html")
      yield* waitForNavigations(
        navigations,
        "one child navigation",
        (list) => list.some((navigation) => navigation.frame === childId)
      )
      const events = yield* Ref.get(navigations)
      const forChild = events.filter((navigation) => navigation.frame === childId)
      assert.strictEqual(forChild.filter((navigation) => navigation._tag === "SameDocument").length, 0)
      assert.strictEqual(forChild.length, 1)
      assert.include(String(forChild[0]!.url), "/assets/frame.html")
    }))

  test("Frame specs Frame Management should persist mainFrame on cross-process navigation", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const before = (yield* page.frames).id
      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.strictEqual((yield* page.frames).id, before)
    }))

  test("Frame specs Frame Management should not send attach/detach events for main frame", ({ page, server }) =>
    Effect.gen(function*() {
      // The tree's values from the start, which Puppeteer's frameattached and framedetached listeners are on: the tree
      // is a latest value, so a frame that came and went between two samples would not show, as the header says
      const states = yield* Ref.make<ReadonlyArray<Page.FrameTree>>([])
      yield* page.frames.changes.pipe(
        Stream.runForEach((tree) => Ref.update(states, (list) => [...list, tree])),
        Effect.forkScoped
      )
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* Expect.that(Ref.get(states), Condition.make("a tree state", (list) => list.length >= 1))
      // Only the main frame is ever in the tree: nothing attached, and nothing detached
      assert.strictEqual(yield* frameCount(page), 1)
      assert.isTrue((yield* Ref.get(states)).every((tree) => tree.children.length === 0))
    }))

  test("Frame specs Frame Management should detach child frames on navigation", ({ page, server }) =>
    Effect.gen(function*() {
      const navigations = yield* collectNavigations(page)
      yield* page.goto(server.PREFIX + "/frames/nested-frames.html", { waitUntil: "load" })
      yield* waitForNavigations(navigations, "five navigations", (list) => list.length >= 5)
      // attached: four child frames; navigated: the page and its four frames
      const attached = childIds(yield* page.frames)
      assert.strictEqual(attached.length, 4)
      assert.strictEqual((yield* takeNavigations(navigations)).length, 5)

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      const tree = yield* page.frames
      // detached: each of the four is gone from the tree; attached: none; navigated: the page only
      assert.strictEqual(attached.filter((id) => frameById(tree, id) !== undefined).length, 0)
      assert.strictEqual(childIds(tree).length, 0)
      assert.strictEqual((yield* takeNavigations(navigations)).length, 1)
    }))

  test("Frame specs Frame Management should support framesets", ({ page, server }) =>
    Effect.gen(function*() {
      const navigations = yield* collectNavigations(page)
      yield* page.goto(server.PREFIX + "/frames/frameset.html", { waitUntil: "load" })
      yield* waitForNavigations(navigations, "five navigations", (list) => list.length >= 5)
      // attached: the frameset's four frames; navigated: the page and its four frames
      assert.strictEqual(childIds(yield* page.frames).length, 4)
      assert.strictEqual((yield* takeNavigations(navigations)).length, 5)

      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* waitForNavigations(navigations, "one navigation", (list) => list.length >= 1)
      assert.strictEqual(childIds(yield* page.frames).length, 0)
      assert.strictEqual((yield* takeNavigations(navigations)).length, 1)
    }))

  test("Frame specs Frame Management should click elements in a frameset", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/frameset.html", { waitUntil: "load" })
      // Puppeteer's waitForFrame: the frame whose URL ends in /frames/frame.html
      yield* page.frames.waitFor((tree) =>
        flatten(tree).some((frame) => String(frame.url).endsWith("/frames/frame.html"))
      )
      const frame = page.frame(page.locator("frame[src='./frame.html']"))
      yield* frame.locator("div").click()
      assert.strictEqual(yield* frame.locator("div").readText, "Hi, I'm frame")
    }))

  test("Frame specs Frame Management should report frame from-inside shadow DOM", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/shadow.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(async (url: string) => {
        const frame = document.createElement("iframe")
        frame.src = url
        document.body.shadowRoot!.appendChild(frame)
        await new Promise((resolve) => frame.onload = resolve)
      }, server.EMPTY_PAGE)
      const frames = flatten(yield* page.frames)
      assert.strictEqual(frames.length, 2)
      assert.strictEqual(String(frames[1]!.url), server.EMPTY_PAGE)
    }))

  test("Frame specs Frame Management should report frame.parent()", ({ page, server }) =>
    Effect.gen(function*() {
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      yield* attachFrame(page, "frame2", server.EMPTY_PAGE)
      const tree = yield* page.frames.waitFor((tree) => tree.children.length === 2)
      // frames()[0] has no parent; frames()[1] and frames()[2] have the main frame, which holds them as children
      assert.strictEqual(flatten(tree).length, 3)
      assert.strictEqual(tree.children.length, 2)
    }))

  test("Frame specs Frame Management should report different frame instance when frame re-attaches", ({ page, server }) =>
    Effect.gen(function*() {
      yield* attachFrame(page, "frame1", server.EMPTY_PAGE)
      const frame1 = yield* onlyChildId(page)
      yield* page.evaluateInMainWorld(() => {
        const global = globalThis as unknown as Record<string, unknown>
        global["frame"] = document.querySelector("#frame1")
        ;(global["frame"] as Element).remove()
      })
      const detached = yield* page.frames.waitFor((tree) => tree.children.length === 0)
      assert.isUndefined(frameById(detached, frame1))
      yield* page.evaluateInMainWorld(() => {
        const global = globalThis as unknown as Record<string, unknown>
        document.body.appendChild(global["frame"] as Node)
      })
      const frame2 = yield* onlyChildId(page)
      assert.notStrictEqual(frame1, frame2)
      assert.isDefined(frameById(yield* page.frames, frame2))
    }))

  test("Frame specs Frame Management should support lazy frames", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.emulate({ viewport: { width: 1000, height: 1000 } })
      yield* page.goto(server.PREFIX + "/frames/lazy-frame.html", { waitUntil: "load" })
      // Puppeteer reads each frame's private _hasStartedLoading: [true, true, false]. The tree has no load state, so the
      // port reads what it says: the lazy frame, below the fold, is in the tree and still at about:blank, where its
      // src (frame.html) would have taken it had it started loading; the other two frames are loaded or blank by src
      const frames = flatten(yield* page.frames)
      assert.strictEqual(frames.length, 3)
      assert.strictEqual(String(frames[1]!.url), "about:blank")
      assert.strictEqual(String(frames[2]!.url), "about:blank")
    }))

  test("Frame specs Frame Management should support url fragment", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/frames/one-frame-url-fragment.html", { waitUntil: "load" })
      const frames = flatten(yield* page.frames)
      assert.strictEqual(frames.length, 2)
      assert.strictEqual(String(frames[1]!.url), server.PREFIX + "/frames/frame.html?param=value#fragment")
    }))
})
