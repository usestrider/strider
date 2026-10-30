/**
 * Stock WebKit's transport, without a browser: the inspector server's list, the envelope a page's messages reach
 * the adapter in, and the endpoint both transports share (QUIRKS.md, Q196).
 */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Stream from "effect/Stream"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Envelope from "../src/internal/webkitEnvelope.ts"
import * as WebKitStockTransport from "../src/internal/webkitStockTransport.ts"
import * as WebKitWire from "../src/internal/webkitWire.ts"
import * as Protocol from "../src/protocol/Protocol.ts"
import * as Transport from "../src/protocol/Transport.ts"

/** The list WebKitGTK's inspector server serves, a row a page, with the page's title and URL unescaped. */
const row = (title: string, url: string, path: string) =>
  `<tr><td class="data"><div class="targetname">${title}</div><div class="targeturl">${url}</div></td><td class="input"><input type="button" value="Inspect" onclick="window.open('Main.html?ws=' + window.location.host + '/${path}', '_blank', 'location=no,menubar=no,status=no,toolbar=no');"></td></tr>`

const fromTarget = (targetId: string, message: unknown) =>
  JSON.stringify({ method: "Target.dispatchMessageFromTarget", params: { targetId, message: JSON.stringify(message) } })

const gone = () => new Transport.ConnectionLost({ initiator: "remote", description: "The browser went away" })

describe("Stock WebKit's transport", () => {
  it("reads each page's WebSocket from its Inspect button, not from what the page wrote", () => {
    const html = `<table><tbody>${
      row("socket/9/9/WebPage", "data:text/html,socket/8/8/WebPage", "socket/1/1/WebPage")
    }${row("second", "http://example.test/", "socket/1/2/WebPage")}</tbody></table>`
    assert.deepStrictEqual(WebKitStockTransport.pagesOf(html), ["socket/1/1/WebPage", "socket/1/2/WebPage"])
  })

  it("puts a page proxy's id in a page's message, and takes it off a command, leaving the page's ids its own", () => {
    const event = WebKitWire.decode(Envelope.wrap(
      "1-1",
      fromTarget("page-8", { method: "Page.frameDetached", params: { frameId: "0.1" } })
    ))
    assert.deepStrictEqual(
      event,
      Result.succeed({
        _tag: "Event" as const,
        key: WebKitWire.targetKey("1-1", "page-8"),
        method: "Page.frameDetached",
        params: { frameId: "0.1" }
      })
    )
    const command = Envelope.unwrap(
      WebKitWire.encode(4, "Network.getResponseBody", { requestId: "0.15" }, WebKitWire.targetKey("1-1", "page-8"))
    )
    assert.strictEqual(command?.pageProxyId, "1-1")
    const wrapper = JSON.parse(command!.message) as { readonly params: { readonly message: string } }
    assert.deepStrictEqual(JSON.parse(wrapper.params.message), {
      id: 4,
      method: "Network.getResponseBody",
      params: { requestId: "0.15" }
    })
    // The browser's session has no page proxy
    assert.isUndefined(Envelope.unwrap(WebKitWire.encode(1, Envelope.enable.method, undefined, undefined)))
    // What a page sent that isn't an object stays malformed, for the wire to fail
    assert(Result.isFailure(WebKitWire.decode(Envelope.wrap("1-1", "[1]"))))
  })

  it.effect("delivers what the pages sent, then fails with why the connection was lost, and fails sends at once", () =>
    Effect.gen(function*() {
      const pages = yield* Envelope.makeEndpoint(Effect.void)
      pages.created("1-1", "default", () => Effect.void)
      yield* pages.transport.send(WebKitWire.encode(1, Envelope.enable.method, undefined, undefined))
      pages.message("1-1", fromTarget("page-8", { method: "Page.loadEventFired", params: { timestamp: 1 } }))
      pages.lose(gone())
      const seen: Array<string> = []
      const failure = yield* pages.transport.messages.pipe(
        Stream.runForEach((message) =>
          Effect.sync(() => {
            const incoming = Result.getOrThrow(WebKitWire.decode(message))
            seen.push(incoming._tag === "Event" ? incoming.method : incoming._tag)
          })
        ),
        Effect.flip
      )
      assert.deepStrictEqual(seen, ["Envelope.pageProxyCreated", "Reply", "Page.loadEventFired"])
      assert.strictEqual(failure.reason._tag === "ConnectionLost" && failure.reason.description, gone().description)
      const refused = yield* Effect.flip(pages.transport.send(WebKitWire.encode(2, "Nope.nothing", {}, undefined)))
      assert.strictEqual(refused.reason._tag, "ConnectionLost")
    }))

  it.effect("ends the client with why the connection was lost, not with its messages' end", () =>
    Effect.gen(function*() {
      const pages = yield* Envelope.makeEndpoint(Effect.void)
      const client = yield* ProtocolClient.make(pages.transport, WebKitWire.wire)
      yield* Envelope.enable().pipe(Protocol.on(client.root))
      // A method the endpoint doesn't serve is answered as one the browser doesn't have
      const unknown = yield* Effect.flip(
        Protocol.command("Nope.nothing", undefined, undefined, { status: "stable", session: "browser" })().pipe(
          Protocol.on(client.root)
        )
      )
      assert.strictEqual(unknown.reason._tag, "Unsupported")
      pages.lose(gone())
      const lost = yield* client.closed
      assert.strictEqual(lost.description, gone().description)
    }).pipe(Effect.scoped))
})
