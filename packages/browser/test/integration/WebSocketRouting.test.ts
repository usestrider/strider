/** Public context WebSocket declarations, including stock WebKit's console transport. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Condition, ConsoleMessage, Expect, Popup, WebSocketRoute } from "@usestrider/browser"
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
      it.effect(
        "keeps other contexts native, restores overlap precedence and removes loaded-document shims",
        () =>
          Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const sibling = yield* Browser.newPage()
            const options = {
              implementation: "script" as const,
              timing: name === "WebKit" ? "bestEffort" as const : "beforeAuthorScript" as const
            }
            const register = (text: string) =>
              page.context.routeWebSocket("**/socket", (socket) =>
                socket.open({
                  fromPage: (_, endpoint) => endpoint.send({ _tag: "Text", data: text })
                }), options)
            const first = yield* register("old")
            assert.strictEqual(yield* sibling.evaluateInMainWorld(() => WebSocket.name), "WebSocket")
            const inspect = () =>
              page.evaluateInMainWorld(() =>
                new Promise<string>((resolve, reject) => {
                  const ws = new WebSocket("ws://example.invalid/socket")
                  ws.onopen = () => ws.send("ping")
                  ws.onmessage = (event) => {
                    resolve(String(event.data))
                    ws.close()
                  }
                  ws.onerror = () => reject(new Error("socket failed"))
                })
              )
            assert.strictEqual(yield* inspect(), "old")
            const newest = yield* register("new")
            assert.strictEqual(yield* inspect(), "new")
            yield* newest.remove
            assert.strictEqual(yield* inspect(), "old")
            yield* first.remove
            assert.strictEqual(yield* page.evaluateInMainWorld(() => WebSocket.name), "WebSocket")
            const again = yield* register("again")
            assert.strictEqual(yield* inspect(), "again")
            yield* again.remove
          }),
        60_000
      )

      it.effect(
        "forwards absent directions and lets installed handlers replace both directions without observation changing it",
        () =>
          Effect.gen(function*() {
            const { origin } = yield* site
            const page = yield* Browser.newPage()
            const target = origin.replace("http:", "ws:")
            const options = {
              implementation: "script" as const,
              timing: name === "WebKit" ? "bestEffort" as const : "beforeAuthorScript" as const
            }
            const observations: Array<WebSocketRoute.Event> = []
            yield* page.context.routeWebSocket(`${target}/pass`, (connection) =>
              Effect.gen(function*() {
                const stream = yield* connection.events
                yield* stream.pipe(
                  Stream.runForEach((event) => Effect.sync(() => observations.push(event))),
                  Effect.forkScoped
                )
                yield* connection.connectToServer({})
              }), options)
            yield* page.context.routeWebSocket(`${target}/edit`, (connection) =>
              connection.connectToServer({
                fromPage: (message, endpoints) =>
                  endpoints.server.send({
                    _tag: "Text",
                    data: message._tag === "Text" ? message.data.toUpperCase() : "binary"
                  }),
                fromServer: (message, endpoints) =>
                  endpoints.page.send({ _tag: "Text", data: message._tag === "Text" ? message.data + "!" : "binary" })
              }).pipe(Effect.asVoid), options)
            const html = `<pre id="out">pending</pre><script>
            const exchange = path => new Promise((resolve,reject) => {
              const ws = new WebSocket(${JSON.stringify(target)} + path);
              ws.onopen=()=>ws.send('hello');ws.onmessage=e=>{resolve(e.data);ws.close()};ws.onerror=reject;
            });
            (async()=>{const a=await exchange('/pass');const b=await exchange('/edit');document.querySelector('#out').textContent=JSON.stringify([a,b])})()
          </script>`
            yield* page.goto(`${origin}/fixture?html=${encodeURIComponent(html)}`)
            yield* Expect.that(
              page.locator("#out").readText,
              Condition.make("forwarded", (text: string) => text !== "pending")
            )
            assert.deepStrictEqual(JSON.parse(yield* page.locator("#out").readText), ["hello", "HELLO!"])
            assert.isTrue(observations.some((event) => event._tag === "Message" && event.direction === "page"))
            assert.isTrue(observations.some((event) => event._tag === "Message" && event.direction === "server"))
          }),
        60_000
      )

      it.effect("reaches first-script new pages and supported early workers and popups", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* Browser.newPage()
          yield* page.context.routeWebSocket("**/socket", (connection) =>
            connection.open({
              fromPage: (message, endpoint) => endpoint.send(message)
            }), {
            implementation: "script",
            timing: name === "WebKit" ? "bestEffort" : "beforeAuthorScript",
            workers: name !== "Firefox"
          })
          const html =
            `<pre id="out">pending</pre><script>const ws=new WebSocket('ws://example.invalid/socket');ws.onopen=()=>ws.send('first author script');ws.onmessage=e=>{document.querySelector('#out').textContent=e.data;ws.close()}</script>`
          const target = `${served.origin}/fixture?html=${encodeURIComponent(html)}`
          const next = yield* page.context.newPage
          yield* next.goto(target)
          yield* next.locator("#out").pipe(Expect.toHaveText("first author script"))
          if (name !== "Firefox") {
            yield* page.goto(`${served.origin}/empty`)
            const result = yield* page.evaluateInMainWorld(() =>
              new Promise<string>((resolve) => {
                const code =
                  `const ws=new WebSocket('ws://example.invalid/socket');ws.onopen=()=>ws.send('worker first');ws.onmessage=e=>{postMessage(e.data);ws.close()}`
                const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
                const worker = new Worker(url)
                worker.onmessage = (event) => {
                  resolve(String(event.data))
                  worker.terminate()
                  URL.revokeObjectURL(url)
                }
              })
            )
            assert.strictEqual(result, "worker first")
          }
          if (name !== "WebKit") {
            yield* page.goto(
              `${served.origin}/fixture?html=${encodeURIComponent(`<a href="${target}" target="_blank">Open</a>`)}`
            )
            const opened = yield* Popup.next(page)
            yield* page.getByText("Open", { exact: true }).click()
            const popup = yield* opened
            yield* popup.locator("#out").pipe(Expect.toHaveText("first author script"))
          }
        }), 60_000)

      it.effect(
        "enforces one registration reservation ceiling across origins and releases destroyed realms",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const page = yield* Browser.newPage()
            yield* page.context.routeWebSocket("**/socket", (connection) => connection.open({}), {
              implementation: "script",
              timing: name === "WebKit" ? "bestEffort" : "beforeAuthorScript"
            })
            const child =
              `<script>const sockets=[];for(let n=0;n<5;n++){const ws=new WebSocket('ws://example.invalid/socket');sockets.push(ws);let sent=false;const report=value=>{if(!sent){sent=true;parent.postMessage(value,'*')}};ws.onopen=()=>report('open');ws.onclose=()=>report('closed')}</script>`
            const url = (origin: string) => `${origin}/fixture?html=${encodeURIComponent(child)}`
            const html =
              `<pre id="out">pending</pre><script>const replies=[];onmessage=e=>{replies.push(e.data);if(replies.length===10)document.querySelector('#out').textContent=JSON.stringify(replies.sort())}</script><iframe src="${
                url(served.origin)
              }"></iframe><iframe src="${url(served.crossSite)}"></iframe>`
            yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
            yield* Expect.that(
              page.locator("#out").readText,
              Condition.make("all constructor admissions settled", (text: string) => text !== "pending")
            )
            const admissions = JSON.parse(yield* page.locator("#out").readText) as Array<string>
            assert.strictEqual(admissions.filter((value) => value === "open").length, 8)
            assert.strictEqual(admissions.filter((value) => value === "closed").length, 2)
            // Navigation destroys both frame generations. All their unused credits must become usable again.
            yield* page.goto(`${served.origin}/empty`)
            const result = yield* page.evaluateInMainWorld(() =>
              new Promise<string>((resolve) => {
                const ws = new WebSocket("ws://example.invalid/socket")
                ws.onopen = () => {
                  resolve("opened after reclamation")
                  ws.close()
                }
                ws.onclose = () => resolve("closed")
              })
            )
            assert.strictEqual(result, "opened after reclamation")
          }),
        60_000
      )

      it.effect("refuses unsupported timing/workers before modifying the context", () =>
        Effect.gen(function*() {
          const page = yield* Browser.newPage()
          if (name === "WebKit") {
            const error = yield* page.context.routeWebSocket("**", () => Effect.void, { implementation: "script" })
              .pipe(Effect.flip)
            assert.strictEqual(error._tag, "WebSocketRouteError")
            assert(error._tag === "WebSocketRouteError" && error.reason._tag === "Unsupported")
          } else if (name === "Firefox") {
            const error = yield* page.context.routeWebSocket("**", () => Effect.void, {
              implementation: "script",
              workers: true
            }).pipe(Effect.flip)
            assert(error._tag === "WebSocketRouteError" && error.reason._tag === "Unsupported")
          }
          assert.strictEqual(yield* page.evaluateInMainWorld(() => WebSocket.name), "WebSocket")
        }), 60_000)

      it.effect("closes on handler failure and rejects native-reserved close codes", () =>
        Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const options = {
            implementation: "script" as const,
            timing: name === "WebKit" ? "bestEffort" as const : "beforeAuthorScript" as const
          }
          yield* page.context.routeWebSocket("**/fail", () => Effect.fail("deliberate handler failure"), options)
          const failed = yield* page.evaluateInMainWorld(() =>
            new Promise<number>((resolve) => {
              const ws = new WebSocket("ws://example.invalid/fail")
              ws.onclose = (event) => resolve(event.code)
            })
          )
          assert.strictEqual(failed, 1006)
          yield* page.context.routeWebSocket("**/close", (connection) =>
            Effect.gen(function*() {
              yield* connection.open({})
              const invalid = yield* connection.page.close({ code: 1011 }).pipe(Effect.flip)
              assert(invalid._tag === "WebSocketRouteError" && invalid.reason._tag === "InvalidInput")
              yield* connection.page.close({ code: 4001, reason: "finished" })
            }), options)
          const closed = yield* page.evaluateInMainWorld(() =>
            new Promise<number>((resolve) => {
              const ws = new WebSocket("ws://example.invalid/close")
              ws.onclose = (event) => resolve(event.code)
            })
          )
          assert.strictEqual(closed, 4001)
        }), 60_000)
    })
  })
}
