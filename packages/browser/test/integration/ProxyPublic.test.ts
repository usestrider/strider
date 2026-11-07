/** Proxy routing through the public context API, including independent contexts and auth routes. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Diagnostics, Expect, Route, Trace, UserContext } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Layer from "effect/Layer"
import * as Logger from "effect/Logger"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site, tlsSite } from "./adapter/harness.ts"
import { proxy } from "./adapter/proxy.ts"
import { chromium, firefox, webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

const options = (
  server: string,
  bypass: ReadonlyArray<string> = [],
  password?: string,
  username = "proxy-user"
): UserContext.Options => ({
  proxy: {
    server,
    bypass,
    ...(password === undefined ? {} : { credentials: { username, password: Redacted.make(password) } })
  }
})

const archiveText = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      entry.body.pipe(
        Stream.runCollect,
        Effect.map((chunks) => Array.from(chunks, (chunk) => new TextDecoder().decode(chunk)).join(""))
      )
    ),
    Stream.runCollect,
    Effect.map((entries) => Array.from(entries).join("\n"))
  )

const services = Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)
const display = Layer.effectDiscard(useXvfb()).pipe(Layer.provide(NodeServices.layer))
for (
  const [name, backend] of [
    ["Chromium", Chromium.layer({ executablePath: chromium.executable })],
    ["Firefox", Firefox.layer({ executablePath: firefox.executable })],
    [
      "WebKit",
      WebKit.layer({ executablePath: webkitgtk.executable }).pipe(Layer.provide(Layer.merge(socketConnector, display)))
    ]
  ] as const
) {
  describe(`${name} public proxy`, () => {
    layer(backend.pipe(Layer.provide(services)), { excludeTestServices: true })((it) => {
      it.effect(
        "routes isolated contexts through different proxies, bypasses hosts and cleans up",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const a = yield* proxy()
            const b = yield* proxy()
            const url = served.origin.replace("127.0.0.1", "proxy.test")
            const closed = yield* Effect.scoped(Effect.gen(function*() {
              const first = yield* Browser.newPage(options(`http://${a.address}`))
              const second = yield* Browser.newPage(options(b.address))
              yield* first.goto(`${url}/first`)
              yield* second.goto(`${url}/second`)
              assert.isTrue(a.requests.some((request) => request.url.endsWith("/first")))
              assert.isFalse(a.requests.some((request) => request.url.endsWith("/second")))
              assert.isTrue(b.requests.some((request) => request.url.endsWith("/second")))
              const bypassed = yield* Browser.newPage(options(a.address, ["proxy.test"]))
              const error = yield* bypassed.goto(`${url}/excluded`).pipe(Deadline.within("10 seconds"), Effect.flip)
              assert.notEqual(error._tag, "Timeout")
              assert.isFalse(a.requests.some((request) => request.url.endsWith("/excluded")))
              const direct = yield* Browser.newPage()
              yield* direct.goto(`${served.origin}/direct`)
              // Loopback destinations always remain direct, including on WebKit's process environment.
              yield* first.goto(`${served.crossSite}/loopback`)
              assert.isFalse(a.requests.some((request) => request.url.endsWith("/loopback")))
              return first
            }))
            const error = yield* closed.goto(`${served.origin}/after-close`).pipe(Effect.flip)
            assert.strictEqual(error._tag, "TargetGone")
            assert.isFalse(served.served.some((request) => request.path === "/after-close"))
          }),
        60_000
      )

      it.effect("routes HTTPS through CONNECT and retains certificate verification", () =>
        Effect.gen(function*() {
          const secure = yield* tlsSite
          const local = yield* proxy()
          const page = yield* Browser.newPage(options(local.address))
          const error = yield* page.goto(secure.origin.replace("127.0.0.1", "proxy.test")).pipe(
            Deadline.within("10 seconds"),
            Effect.flip
          )
          assert.notEqual(error._tag, "Timeout")
          assert.isTrue(
            local.requests.some((request) => request.method === "CONNECT" && request.url.includes("proxy.test"))
          )
        }), 60_000)

      for (const password of ["proxy-secret", "wrong-password"]) {
        it.effect(
          `authenticates proxy separately from website routes: ${password === "proxy-secret" ? "correct" : "wrong"}`,
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const local = yield* proxy({ username: "proxy-user", password: "proxy-secret" })
              if (name === "WebKit") {
                const error = yield* Browser.newContext(options(local.address, [], password)).pipe(Effect.flip)
                assert(UserContext.isUserContextError(error) && error.reason._tag === "Unsupported")
                assert.strictEqual(error.reason.capability, "userContexts.proxy.credentials")
                assert.deepStrictEqual(local.requests, [])
                return
              }
              const page = yield* Browser.newPage(options(local.address, [], password))
              let websiteChallenges = 0
              let requests = 0
              yield* page.route("**/*", () => {
                requests++
                return Route.continue
              })
              yield* page.route("**/auth", (paused) => {
                websiteChallenges++
                assert.strictEqual(paused.challenge.scheme, "basic")
                assert.strictEqual(paused.challenge.realm, "strider")
                return Route.provideCredentials({ username: "strider", password: Redacted.make("secret") })
              }, { phase: "auth" })
              const navigation = page.goto(`${served.origin.replace("127.0.0.1", "proxy.test")}/auth`).pipe(
                Deadline.within("10 seconds")
              )
              if (password === "proxy-secret") {
                yield* navigation
                assert.strictEqual(websiteChallenges, 1)
                assert.isAbove(requests, 0)
                assert.isTrue(served.served.some((request) => request.headers.authorization !== undefined))
                assert.isTrue(served.served.every((request) => request.headers["proxy-authorization"] === undefined))
              } else {
                const error = yield* navigation.pipe(Effect.flip)
                assert.notEqual(error._tag, "Timeout")
                assert.strictEqual(websiteChallenges, 0)
                assert.strictEqual(local.requests.filter((request) => request.url.endsWith("/auth")).length, 2)
                assert.isFalse(local.requests.some((request) => request.authenticated))
              }
            }),
          60_000
        )
      }

      it.effect(
        "keeps proxy credentials out of logs, spans and strict/local trace archives on success and rejection",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const username = `username-${crypto.randomUUID()}`
            const password = `password-${crypto.randomUUID()}`
            const wrong = `wrong-${crypto.randomUUID()}`

            const observed: Array<unknown> = []
            const spans: Array<Tracer.NativeSpan> = []
            const tracer = Tracer.make({
              span(options) {
                const span = new Tracer.NativeSpan(options)
                spans.push(span)
                return span
              }
            })
            const logger = Logger.make((entry) => observed.push(entry.message))
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-proxy-traces-"))
            yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
            yield* Effect.gen(function*() {
              // Creation failures must be safe even when the caller logs the full error under the local preset.
              const invalid = yield* Browser.newContext(options(`http://${username}:${password}@localhost:8000`)).pipe(
                Effect.flip
              )
              yield* Effect.logWarning(invalid)
              for (const supplied of [password, wrong]) {
                const local = yield* proxy({ username, password })
                if (name === "WebKit") {
                  const refused = yield* Browser.newContext(options(local.address, [], supplied, username)).pipe(
                    Effect.flip
                  )
                  yield* Effect.logWarning(refused)
                  continue
                }
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* Browser.newPage(options(local.address, [], supplied, username))
                  const recording = yield* Trace.record(page, { screenshots: "off", network: true })
                  const navigate = page.goto(`${served.origin.replace("127.0.0.1", "proxy.test")}/recorded`).pipe(
                    Deadline.within("10 seconds")
                  )
                  if (supplied === password) yield* navigate
                  else {
                    const rejected = yield* navigate.pipe(Effect.flip)
                    assert.notEqual(rejected._tag, "Timeout")
                    yield* Effect.logWarning(rejected)
                  }
                  for (const preset of ["strict", "local"] as const) {
                    const file = path.join(directory, `${supplied === password ? "success" : "wrong"}-${preset}.zip`)
                    yield* recording.exportTrace(file).pipe(Diagnostics.withPreset(preset))
                    observed.push(yield* archiveText(file))
                  }
                }))
              }
            }).pipe(
              Effect.withTracer(tracer),
              Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
              Effect.provideService(Browser.TraceProtocolCommands, true),
              Diagnostics.withPreset("local")
            )
            observed.push(
              spans.map((span) => ({
                name: span.name,
                attributes: [...span.attributes],
                events: span.events,
                status: span.status
              }))
            )
            const text = JSON.stringify(observed, (_, value) => typeof value === "bigint" ? String(value) : value)
            for (
              const secret of [
                username,
                password,
                wrong,
                Buffer.from(`${username}:${password}`).toString("base64"),
                Buffer.from(`${username}:${wrong}`).toString("base64")
              ]
            ) assert.isFalse(text.includes(secret), "proxy credentials must be absent from diagnostics")
            assert.isAbove(spans.length, 0)
          }),
        60_000
      )

      if (name !== "WebKit") {
        it.effect("authenticates a worker's first proxied request from a bypassed page", () =>
          Effect.gen(function*() {
            const served = yield* site
            const local = yield* proxy({ username: "proxy-user", password: "worker-proxy" })
            const page = yield* Browser.newPage(options(local.address, [], "worker-proxy"))
            const worker = `fetch(${
              JSON.stringify(`${served.origin.replace("127.0.0.1", "proxy.test")}/worker-request`)
            }, { mode: "no-cors" }).then(() => postMessage("proxied"), () => postMessage("failed"))`
            const html = `<p id="result">pending</p><script>const w = new Worker(URL.createObjectURL(new Blob([${
              JSON.stringify(worker)
            }], { type: "text/javascript" }))); w.onmessage = e => document.getElementById("result").textContent = e.data</script>`
            yield* page.goto(`${served.origin}/fixture?html=${encodeURIComponent(html)}`)
            yield* page.locator("#result").pipe(Expect.toHaveText("proxied"), Deadline.within("10 seconds"))
            assert.isTrue(
              local.requests.some((request) => request.url.endsWith("/worker-request") && request.authenticated)
            )
          }), 60_000)
      }

      if (name !== "WebKit") {
        it.effect(
          "answers HTTPS CONNECT proxy challenges before certificate verification",
          () =>
            Effect.gen(function*() {
              const secure = yield* tlsSite
              for (const password of ["proxy-secret", "wrong-password"]) {
                const local = yield* proxy({ username: "proxy-user", password: "proxy-secret" })
                yield* Effect.scoped(Effect.gen(function*() {
                  const page = yield* Browser.newPage(options(local.address, [], password))
                  const error = yield* page.goto(secure.origin.replace("127.0.0.1", "proxy.test")).pipe(
                    Deadline.within("10 seconds"),
                    Effect.flip
                  )
                  assert.notEqual(error._tag, "Timeout")
                  const tunnels = local.requests.filter((request) =>
                    request.method === "CONNECT" && request.url.includes("proxy.test")
                  )
                  assert.isAbove(tunnels.length, 0)
                  assert.strictEqual(
                    tunnels.some((request) => request.authenticated),
                    password === "proxy-secret"
                  )
                }))
              }
            }),
          60_000
        )
      }

      if (name === "Chromium") {
        it.effect("does not reuse another context's cached proxy credentials", () =>
          Effect.gen(function*() {
            const served = yield* site
            const local = yield* proxy({ username: "proxy-user", password: "first-proxy" })
            const url = `${served.origin.replace("127.0.0.1", "proxy.test")}/cache-isolation`
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage(options(local.address, [], "first-proxy"))
              yield* page.goto(url)
            }))
            const page = yield* Browser.newPage(options(local.address, [], "wrong-proxy"))
            const error = yield* page.goto(url).pipe(Deadline.within("10 seconds"), Effect.flip)
            assert.notEqual(error._tag, "Timeout")
          }), 60_000)
      }

      if (name === "Firefox") {
        it.effect(
          "refuses conflicting proxy credentials even after their context closes",
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const local = yield* proxy({ username: "proxy-user", password: "first-proxy" })
              yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* Browser.newPage(options(local.address, [], "first-proxy"))
                yield* page.goto(`${served.origin.replace("127.0.0.1", "proxy.test")}/bound`)
              }))
              for (const password of ["different-proxy-password", undefined]) {
                const error = yield* Browser.newContext(options(local.address, [], password)).pipe(Effect.flip)
                assert(UserContext.isUserContextError(error) && error.reason._tag === "Unsupported")
                assert.strictEqual(error.reason.capability, "userContexts.proxy.credentials.isolation")
                assert.notInclude(String(error), "different-proxy-password")
              }
            }),
          60_000
        )
      }

      if (name !== "WebKit") {
        it.effect(
          "keeps authenticated contexts independent and preserves website wrong-password decisions",
          () =>
            Effect.gen(function*() {
              const served = yield* site
              const firstProxy = yield* proxy({ username: "proxy-user", password: "first-proxy" })
              const secondProxy = yield* proxy({ username: "proxy-user", password: "second-proxy" })
              const first = yield* Browser.newPage(options(firstProxy.address, [], "first-proxy"))
              const second = yield* Browser.newPage(options(secondProxy.address, [], "second-proxy"))
              const url = served.origin.replace("127.0.0.1", "proxy.test")
              yield* first.goto(`${url}/one`)
              yield* second.goto(`${url}/two`)
              let challenges = 0
              yield* first.route("**/auth", () =>
                ++challenges === 1
                  ? Route.provideCredentials({ username: "strider", password: Redacted.make("wrong-website-password") })
                  : Route.continue, { phase: "auth" })
              yield* first.goto(`${url}/auth`)
              assert.strictEqual(challenges, 2)
              assert.isTrue(
                firstProxy.requests.some((request) => request.url.endsWith("/one") && request.authenticated)
              )
              assert.isTrue(
                secondProxy.requests.some((request) => request.url.endsWith("/two") && request.authenticated)
              )
              assert.isFalse(firstProxy.requests.some((request) => request.url.endsWith("/two")))
              assert.isFalse(secondProxy.requests.some((request) => request.url.endsWith("/one")))
            }),
          60_000
        )
      }

      it.effect("rejects invalid proxy settings without reflecting embedded secrets", () =>
        Effect.gen(function*() {
          for (
            const server of [
              "http://user:embedded-secret@localhost:8000",
              "socks5://localhost:8000",
              "http://localhost:8000/path"
            ]
          ) {
            const error = yield* Browser.newContext(options(server)).pipe(Effect.flip)
            assert(UserContext.isUserContextError(error))
            assert.notInclude(String(error), "embedded-secret")
            assert.include(["InvalidInput", "Unsupported"], error.reason._tag)
          }
        }), 60_000)
    })
  })
}
