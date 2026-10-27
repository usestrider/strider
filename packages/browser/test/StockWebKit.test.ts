/**
 * Stock WebKit's transport, without a browser: the inspector server's list, and the ids
 * each target numbers for itself (QUIRKS.md, Q195 and Q196).
 */
import { assert, describe, it } from "@effect/vitest"
import * as WebKitStockTransport from "../src/internal/webkitStockTransport.ts"

/** The list WebKitGTK's inspector server serves, a row a page, with the page's title and URL unescaped. */
const row = (title: string, url: string, path: string) =>
  `<tr><td class="data"><div class="targetname">${title}</div><div class="targeturl">${url}</div></td><td class="input"><input type="button" value="Inspect" onclick="window.open('Main.html?ws=' + window.location.host + '/${path}', '_blank', 'location=no,menubar=no,status=no,toolbar=no');"></td></tr>`

const fromTarget = (targetId: string, message: unknown) => ({
  method: "Target.dispatchMessageFromTarget",
  params: { targetId, message: JSON.stringify(message) }
})
const toTarget = (targetId: string, message: unknown) => ({
  id: 7,
  method: "Target.sendMessageToTarget",
  params: { targetId, message: JSON.stringify(message) }
})
const innerOf = (message: Record<string, any>) => JSON.parse(message.params.message)

describe("Stock WebKit's transport", () => {
  it("reads each page's WebSocket from its Inspect button, not from what the page wrote", () => {
    const html = `<table><tbody>${
      row("socket/9/9/WebPage", "data:text/html,socket/8/8/WebPage", "socket/1/1/WebPage")
    }${row("second", "http://example.test/", "socket/1/2/WebPage")}</tbody></table>`
    assert.deepStrictEqual(WebKitStockTransport.pagesOf(html), ["socket/1/1/WebPage", "socket/1/2/WebPage"])
  })

  it("qualifies a target's frame, loader and request ids on the paths the adapter reads", () => {
    const answering = new Map<string, string>()
    const navigated = innerOf(WebKitStockTransport.qualifyIncoming(
      fromTarget("page-8", {
        method: "Page.frameNavigated",
        params: { frame: { id: "0.5", parentId: "0.1", loaderId: "0.6", url: "http://a.test/" } }
      }),
      "1-1",
      answering
    ))
    assert.deepStrictEqual(navigated.params.frame, {
      id: "1-1:page-8:0.5",
      parentId: "1-1:page-8:0.1",
      loaderId: "1-1:page-8:0.6",
      url: "http://a.test/"
    })
    // A header's name is the page's, not an id
    const sent = innerOf(WebKitStockTransport.qualifyIncoming(
      fromTarget("page-8", {
        method: "Network.requestWillBeSent",
        params: { requestId: "0.15", frameId: "0.1", loaderId: "0.3", request: { headers: { requestId: "0.15" } } }
      }),
      "1-1",
      answering
    ))
    assert.deepStrictEqual(sent.params, {
      requestId: "1-1:page-8:0.15",
      frameId: "1-1:page-8:0.1",
      loaderId: "1-1:page-8:0.3",
      request: { headers: { requestId: "0.15" } }
    })
    // Another target of the same page, another web process, numbers its own
    const swapped = innerOf(WebKitStockTransport.qualifyIncoming(
      fromTarget("page-17", { method: "Page.frameDetached", params: { frameId: "0.1" } }),
      "1-1",
      answering
    ))
    assert.strictEqual(swapped.params.frameId, "1-1:page-17:0.1")
  })

  it("leaves an evaluation's value alone, and qualifies a resource tree it was asked for", () => {
    const answering = new Map<string, string>()
    const evaluated = fromTarget("page-8", { id: 3, result: { result: { type: "object", value: { frameId: "0.1" } } } })
    assert.deepStrictEqual(WebKitStockTransport.qualifyIncoming(evaluated, "1-1", answering), evaluated)
    WebKitStockTransport.unqualifyOutgoing(
      toTarget("page-8", { id: 4, method: "Page.getResourceTree" }),
      "1-1",
      answering
    )
    const tree = innerOf(WebKitStockTransport.qualifyIncoming(
      fromTarget("page-8", {
        id: 4,
        result: {
          frameTree: {
            frame: { id: "0.1", loaderId: "0.2" },
            childFrames: [{ frame: { id: "0.5", parentId: "0.1", loaderId: "0.6" }, resources: [] }],
            resources: []
          }
        }
      }),
      "1-1",
      answering
    ))
    assert.deepStrictEqual(tree.result.frameTree.childFrames[0].frame, {
      id: "1-1:page-8:0.5",
      parentId: "1-1:page-8:0.1",
      loaderId: "1-1:page-8:0.6"
    })
    assert.strictEqual(answering.size, 0)
  })

  it("takes the qualification off a command's ids, for the target they're its own", () => {
    const answering = new Map<string, string>()
    const command = innerOf(WebKitStockTransport.unqualifyOutgoing(
      toTarget("page-8", {
        id: 5,
        method: "Network.interceptRequestWithError",
        params: { requestId: "1-1:page-8:0.15", errorType: "Cancellation" }
      }),
      "1-1",
      answering
    ))
    assert.deepStrictEqual(command.params, { requestId: "0.15", errorType: "Cancellation" })
  })
})
