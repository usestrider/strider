/**
 * Playwright's `tests/page/page-event-network.spec.ts`: what a page's `request` and `response` events report for the
 * main document. Its `requestfailed` and `requestfinished` events, which Strider has no counterpart of, are in the
 * ledger.
 *
 * What the port changes:
 * - `page.on("request")` and `page.on("response")` are read from the page's request and response histories, as
 *   page-network-request.test.ts and page-network-response.test.ts read them: a fresh page's history is the whole of what
 *   the original's listener saw.
 * - `request.response()` is `NetworkRequest.response`, which is a wait; NE-084 awaits it after the load.
 * - `request.frame()` is the request's initiator, the navigable it was sent from, and `frame().url()` is that frame's URL
 *   in `page.frames`.
 * - A response has no `request()` in Strider (page-network-response.test.ts, NE-054). NE-085 finds the request with the
 *   response's hop instead, and checks that it is there.
 * - `response.ok()` is Playwright's status test, 200 to 299, which the port states as it is.
 * - Playwright's `page.goto` waits for `load`, so each navigation passes `waitUntil: "load"`, where Strider's resolves at
 *   commit.
 * - Playwright's `request` and `response` histories don't report the browser's own `/favicon.ico`, which Strider does, so
 *   the reads leave that one out (page-network-request.test.ts, `requestsOf`).
 * - NE-086, NE-087, NE-088, NE-089, NE-090, and NE-143 are about `requestfailed` or `requestfinished` events, which Strider
 *   doesn't have (matrix rows event-page-requestfailed and event-page-requestfinished). They're in the ledger, not ported.
 */
import { assert } from "@effect/vitest"
import { NetworkRequest, NetworkResponse, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** Every request the page has made since it was created, except the browser's own `/favicon.ico`. */
const requestsOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkRequest.history(page)
  // A missing entry proves nothing unless nothing was dropped
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((request) => new URL(request.url).pathname !== "/favicon.ico")
})

/** Every response the page has received since it was created, except the browser's own `/favicon.ico`. */
const responsesOf = Effect.fnUntraced(function*(page: Page.ReadonlyPage) {
  const history = yield* NetworkResponse.history(page)
  assert.strictEqual(history.dropped, 0)
  return history.entries.filter((response) => new URL(response.url).pathname !== "/favicon.ico")
})

/** The navigable a request was sent from, when a document sent it: Playwright's `request.frame()`. */
const frameOf = (request: NetworkRequest.NetworkRequest): string | undefined =>
  request.initiator._tag === "Document" ? request.initiator.navigable : undefined

/** The frame with this id in a frame tree, the tree's own frame included. */
const frameWithId = (tree: Page.FrameTree, id: string): Page.FrameTree | undefined => {
  if (tree.id === id) return tree
  for (const child of tree.children) {
    const found = frameWithId(child, id)
    if (found !== undefined) return found
  }
  return undefined
}

upstream(import.meta.filename, {}, (test) => {
  test("NE-084", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const requests = yield* requestsOf(page)
      assert.strictEqual(requests.length, 1)
      const [request] = requests
      assert.isDefined(request)
      assert.strictEqual(request.url, server.EMPTY_PAGE)
      assert.strictEqual(request.resourceType, "document")
      assert.strictEqual(request.method, "GET")
      const response = yield* yield* NetworkRequest.response(page, request)
      assert.isTrue(Option.isSome(response), "the navigation's request has no response")
      const mainFrame = yield* page.frames
      assert.strictEqual(frameOf(request), mainFrame.id)
      assert.strictEqual(frameWithId(mainFrame, frameOf(request)!)?.url, server.EMPTY_PAGE)
    }))

  test("NE-085", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      const responses = yield* responsesOf(page)
      assert.strictEqual(responses.length, 1)
      const [response] = responses
      assert.isDefined(response)
      assert.strictEqual(response.url, server.EMPTY_PAGE)
      assert.strictEqual(response.status, 200)
      // Playwright's `ok()`: a status from 200 to 299
      assert.isTrue(response.status >= 200 && response.status <= 299)
      // Strider's response has no request of its own; the request is the one on the same hop
      const requests = yield* requestsOf(page)
      assert.isTrue(requests.some((request) => request.hop === response.hop))
    }))
})
