/** Public context WebSocket declarations, including stock WebKit's console transport. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Condition, ConsoleMessage, Expect } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { site } from "./adapter/harness.ts"
import { chromium, firefox, webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))
const backends = [
  ["Chromium", Chromium.layer({ executablePath: chromium.executable }).pipe(Layer.provide(NodeServices.layer))],
  [
    "Firefox",
    Firefox.layer({ executablePath: firefox.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
    )
  ],
  [
    "WebKit",
    WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
      Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector, display))
    )
  ]
] as const

for (const [name, backend] of backends) {
  describe(`${name} context WebSocket routing`, () => {
    layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect(
        "mocks binary sends in order and keeps bridge envelopes out of public console events",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* Browser.newPage()
            const console: Array<string> = []
            const messages = yield* ConsoleMessage.stream(page)
            yield* messages.pipe(
              Stream.runForEach((message) => Effect.sync(() => console.push(message.text))),
              Effect.forkScoped
            )
            const registration = yield* page.context.routeWebSocket(
              "**/socket",
              (connection) => connection.open({ fromPage: (message, endpoint) => endpoint.send(message) }),
              {
                implementation: "script",
                timing: name === "WebKit" ? "bestEffort" : "beforeAuthorScript"
              }
            )
            const html = `<pre id="out">pending</pre><script>
            console.debug('ordinary text'); console.debug({ ordinary: true });
            const ws = new WebSocket('ws://example.invalid/socket'); ws.binaryType = 'arraybuffer';
            const received = []; ws.onmessage = event => {
              received.push(typeof event.data === 'string' ? event.data : [...new Uint8Array(event.data)]);
              if (received.length === 3) document.querySelector('#out').textContent = JSON.stringify(received);
            };
            ws.onopen = () => {
              ws.send(new Blob([new Uint8Array([0, 255, 1])]));
              const bytes = new Uint8Array([99, 2, 3, 88]); ws.send(bytes.subarray(1, 3)); bytes.fill(9);
              ws.send('雪');
            };
          </script>`
            yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(html)}`)
            yield* Expect.that(
              page.locator("#out").readText,
              Condition.make("echoed all messages", (text: string) => text !== "pending")
            )
            assert.deepStrictEqual(JSON.parse(yield* page.locator("#out").readText), [[0, 255, 1], [2, 3], "雪"])
            assert.lengthOf(console, 2)
            assert.strictEqual(console[0], "ordinary text")
            yield* registration.remove
            yield* registration.remove
          }),
        60_000
      )
    })
  })
}
