/** Proxy routing through the public context API, including independent contexts and auth routes. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Route, UserContext } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { site, tlsSite } from "./adapter/harness.ts"
import { proxy } from "./adapter/proxy.ts"
import { chromium, firefox, webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

// The intersection permits test-first compilation before the option is implemented.
const options = (server: string, bypass: ReadonlyArray<string> = [], password?: string): UserContext.Options & {
  proxy: {
    server: string
    bypass: ReadonlyArray<string>
    credentials?: { username: string; password: Redacted.Redacted<string> }
  }
} => ({
  dialogs: "dismiss",
  proxy: {
    server,
    bypass,
    ...(password === undefined ? {} : { credentials: { username: "proxy-user", password: Redacted.make(password) } })
  }
})

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
