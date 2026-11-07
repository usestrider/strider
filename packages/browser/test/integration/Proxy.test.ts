/**
 * Feasibility probes of the pinned browsers' context proxy and authentication protocols.
 * Raw messages deliberately retain the backend's auth source, status and headers: the adapter currently drops
 * some of these, and Firefox can report a stale proxy status on an origin challenge after proxy authentication.
 * All credentials here are fixture values. Production code must use the generated Redacted password codecs.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import * as ChromiumLauncher from "../../src/internal/chromiumLauncher.ts"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import * as WebKitAdapter from "../../src/internal/webkitAdapter.ts"
import * as WebKitAutomation from "../../src/internal/webkitAutomation.ts"
import { makeRecorder, site, tlsSite } from "./adapter/harness.ts"
import { proxy } from "./adapter/proxy.ts"
import { assertPinned, chromium, firefox, webkitgtk } from "./browsers.ts"
import { socketConnector } from "./sockets.ts"
import { useXvfb } from "./stockWebKit.ts"

for (const browser of ["chromium", "firefox"] as const) {
  describe(`${browser} proxy protocol`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        for (
          const { auth, firstHttps } of (["none", "correct", "wrong"] as const).flatMap((auth) => [
            { auth, firstHttps: false },
            { auth, firstHttps: true }
          ])
        ) {
          it.effect(
            `routes ${firstHttps ? "HTTPS first" : "HTTP first"}, bypasses hosts, authenticates: ${auth}`,
            () =>
              Effect.gen(function*() {
                const origin = yield* site
                const secure = yield* tlsSite
                const local = yield* proxy(
                  auth === "none" ? undefined : { username: "proxy-user", password: "proxy-secret" }
                )
                const { transport } = yield* (browser === "chromium"
                  ? ChromiumLauncher.launch({
                    executablePath: chromium.executable,
                    args: ["--ignore-certificate-errors"]
                  })
                  : FirefoxLauncher.launch({ executablePath: firefox.executable }))
                let id = 0
                const replies = new Map<number, Deferred.Deferred<any>>()
                const events: Array<any> = []
                const call = Effect.fnUntraced(function*(method: string, params: object, sessionId?: string) {
                  const next = ++id
                  const reply = yield* Deferred.make<any>()
                  replies.set(next, reply)
                  yield* transport.send(
                    JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) })
                  )
                  const result = yield* Deferred.await(reply)
                  if (method !== "browsingContext.navigate") {
                    assert.isUndefined(result.error, JSON.stringify(result))
                  }
                  replies.delete(next)
                  return result.error === undefined ? result.result : result
                })
                const attempts = new Map<string, number>()
                yield* transport.messages.pipe(
                  Stream.runForEach((text) =>
                    Effect.gen(function*() {
                      const message = JSON.parse(text)
                      if (message.id !== undefined) {
                        const reply = replies.get(message.id)
                        if (reply) yield* Deferred.succeed(reply, message)
                        return
                      }
                      events.push(message)
                      if (message.method === "Fetch.requestPaused") {
                        yield* call("Fetch.continueRequest", { requestId: message.params.requestId }, message.sessionId)
                          .pipe(Effect.forkScoped)
                      }
                      if (message.method === "Fetch.authRequired" || message.method === "network.authRequired") {
                        const params = message.params
                        const key = browser === "chromium" ? params.requestId : params.request.request
                        const isProxy = browser === "chromium"
                          ? params.authChallenge.source === "Proxy"
                          : params.response.status === 407 &&
                            params.response.headers.some((header: { name: string }) =>
                              header.name.toLowerCase() === "proxy-authenticate"
                            )
                        const attemptKey = `${key}:${isProxy ? "proxy" : "origin"}`
                        const count = attempts.get(attemptKey) ?? 0
                        attempts.set(attemptKey, count + 1)
                        const username = isProxy ? "proxy-user" : "strider"
                        const password = isProxy ? auth === "wrong" ? "wrong" : "proxy-secret" : "secret"
                        const answer = browser === "chromium"
                          ? call("Fetch.continueWithAuth", {
                            requestId: key,
                            authChallengeResponse: count > 0
                              ? { response: "CancelAuth" } :
                              { response: "ProvideCredentials", username, password }
                          }, message.sessionId)
                          : call("network.continueWithAuth", {
                            request: key,
                            ...(count > 0 ?
                              { action: "cancel" }
                              : { action: "provideCredentials", credentials: { type: "password", username, password } })
                          })
                        yield* answer.pipe(Effect.forkScoped)
                      }
                    })
                  ),
                  Effect.forkScoped
                )
                if (browser === "firefox") {
                  const session = yield* call("session.new", { capabilities: {} })
                  assertPinned("Firefox", session.capabilities.browserVersion, firefox.version)
                  yield* call("session.subscribe", { events: ["network.authRequired"] })
                  yield* call("network.addIntercept", { phases: ["authRequired"] })
                }
                if (browser === "chromium") {
                  const version = yield* call("Browser.getVersion", {})
                  assertPinned("Chromium", version.product.split("/")[1], chromium.version)
                }
                const create = Effect.fnUntraced(function*(bypass: ReadonlyArray<string> | undefined) {
                  if (browser === "chromium") {
                    const context = yield* call(
                      "Target.createBrowserContext",
                      bypass === undefined ?
                        {} :
                        { proxyServer: local.address, proxyBypassList: ["<-loopback>", ...bypass].join(",") }
                    )
                    const target = yield* call("Target.createTarget", {
                      url: "about:blank",
                      browserContextId: context.browserContextId
                    })
                    const attached = yield* call("Target.attachToTarget", { targetId: target.targetId, flatten: true })
                    yield* call("Fetch.enable", { handleAuthRequests: true }, attached.sessionId)
                    return attached.sessionId as string
                  }
                  const context = yield* call("browser.createUserContext", {
                    acceptInsecureCerts: true,
                    ...(bypass === undefined
                      ? {}
                      : {
                        proxy: {
                          proxyType: "manual",
                          httpProxy: local.address,
                          sslProxy: local.address,
                          noProxy: bypass
                        }
                      })
                  })
                  return (yield* call("browsingContext.create", { type: "tab", userContext: context.userContext }))
                    .context as string
                })
                const navigate = (page: string, url: string) =>
                  browser === "chromium"
                    ? call("Page.navigate", { url }, page)
                    : call("browsingContext.navigate", { context: page, url, wait: "complete" })
                const page = yield* create([])
                const initialUrl = firstHttps
                  ? secure.origin.replace("127.0.0.1", "proxy.test")
                  : `${origin.origin.replace("127.0.0.1", "proxy.test")}/auth`
                const navigated = yield* navigate(page, initialUrl)
                if (auth !== "wrong") assert.isUndefined(navigated.error)
                if (browser === "firefox" && auth === "wrong") {
                  assert.include(navigated.message, "NS_ERROR_PROXY_CONNECTION_REFUSED")
                }
                // CDP Page.navigate can return before network completion. Observe the local fixture with a bounded wait.
                const waitFor = (predicate: () => boolean) =>
                  Effect.callback<void>((resume) => {
                    const timer = setInterval(() => {
                      if (predicate()) {
                        clearInterval(timer)
                        resume(Effect.void)
                      }
                    }, 10)
                    return Effect.sync(() => clearInterval(timer))
                  }).pipe(Effect.timeout("10 seconds"))
                yield* waitFor(() =>
                  local.requests.some((request) =>
                    firstHttps ? request.url === new URL(initialUrl).host : request.url.endsWith("/auth")
                  )
                )
                if (auth !== "wrong") {
                  if (!firstHttps) {
                    yield* waitFor(() =>
                      origin.served.some((request) =>
                        request.path === "/auth" && request.headers.authorization !== undefined
                      )
                    )
                  }
                  yield* navigate(page, secure.origin.replace("127.0.0.1", "proxy.test"))
                  yield* waitFor(() =>
                    local.requests.some((request) => request.method === "CONNECT" && request.authenticated)
                  )
                  if (browser === "chromium") {
                    yield* Effect.gen(function*() {
                      const result = yield* call("Runtime.evaluate", {
                        expression: "document.title",
                        returnByValue: true
                      }, page)
                      return result.result.value === "secure"
                    }).pipe(Effect.repeat({ until: (ready) => ready }), Effect.timeout("10 seconds"))
                  }
                  assert.isTrue(origin.served.every((request) => request.headers["proxy-authorization"] === undefined))
                } else {
                  if (browser === "chromium") assert.isString(navigated.errorText)
                  yield* waitFor(() => events.filter((event) => event.method.endsWith("authRequired")).length >= 2)
                  assert.isTrue([...attempts.values()].every((count) => count <= 2))
                  assert.isFalse(local.requests.some((request) => request.authenticated))
                }
                const bypassed = yield* create(["localhost", "proxy.test"])
                const before = local.requests.length
                yield* navigate(bypassed, `${origin.crossSite}/bypassed`)
                yield* waitFor(() => origin.served.some((request) => request.path === "/bypassed"))
                assert.isFalse(local.requests.slice(before).some((request) => request.url.includes("/bypassed")))
                // proxy.test resolves only inside the proxy. Bypassing it must fail direct DNS resolution,
                // proving noProxy is honored even where localhost is implicitly excluded by a browser.
                const excluded = yield* navigate(
                  bypassed,
                  `${origin.origin.replace("127.0.0.1", "proxy.test")}/excluded`
                )
                assert.include(
                  browser === "chromium" ? excluded.errorText : excluded.message,
                  browser === "chromium" ? "ERR_NAME_NOT_RESOLVED" : "NS_ERROR_UNKNOWN_HOST"
                )
                assert.isFalse(local.requests.some((request) => request.url.includes("/excluded")))
                const direct = yield* create(undefined)
                const directResult = yield* navigate(direct, `${origin.origin}/unconfigured`)
                assert.isUndefined(directResult.error)
                yield* waitFor(() => origin.served.some((request) => request.path === "/unconfigured"))
                assert.isFalse(local.requests.some((request) => request.url.includes("/unconfigured")))
                console.log(`${browser} ${firstHttps ? "HTTPS first" : "HTTP first"} ${auth}: ${
                  JSON.stringify({
                    requests: local.requests.filter((request) => request.url.includes("proxy.test")),
                    challenges: events.filter((event) => event.method.endsWith("authRequired")).map((event) =>
                      browser === "chromium"
                        ? event.params.authChallenge
                        : { status: event.params.response.status, challenges: event.params.response.authChallenges }
                    ),
                    attempts: [...attempts.values()]
                  })
                }`)
              }).pipe(Effect.timeout("45 seconds")),
            60_000
          )
        }
      }
    )
  })
}

describe("stock WebKit proxy feasibility", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      for (const mode of ["flag", "environment"] as const) {
        it.effect(
          `MiniBrowser proxy via ${mode} in automation mode and context refusal`,
          () =>
            Effect.gen(function*() {
              const origin = yield* site
              const local = yield* proxy()
              const secure = yield* tlsSite
              yield* useXvfb().pipe(Effect.orDie)
              const fs = yield* FileSystem.FileSystem
              const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-proxy-env-" })
              const wrapper = `${directory}/MiniBrowser`
              yield* fs.writeFileString(
                wrapper,
                `#!/bin/sh\nexport http_proxy='http://${local.address}' https_proxy='http://${local.address}' HTTP_PROXY='http://${local.address}' HTTPS_PROXY='http://${local.address}' all_proxy='http://${local.address}' ALL_PROXY='http://${local.address}' no_proxy='localhost,127.0.0.1,::1' NO_PROXY='localhost,127.0.0.1,::1'\nexec '${webkitgtk.executable}' "$@"\n`
              )
              yield* fs.chmod(wrapper, 0o700)
              const group = yield* WebKitAutomation.start({
                executablePath: mode === "flag" ? webkitgtk.executable : wrapper,
                args: mode === "flag" ? [`--proxy=http://${local.address}`] : []
              }).pipe(Effect.provide(socketConnector))
              const facts = makeRecorder()
              const adapter = yield* WebKitAdapter.connect(group.transport, {
                sink: facts.sink,
                ownership: "launched",
                automation: group
              })
              const refused = yield* adapter.createUserContext({
                proxy: Option.some({
                  server: local.address,
                  bypass: [],
                  credentials: { username: "proxy-user", password: Redacted.make("fixture-secret") }
                }),
                acceptInsecureCerts: false
              }).pipe(Effect.flip)
              assert(refused.reason._tag === "Unsupported")
              assert.strictEqual(refused.reason.capability, "userContexts.proxy.credentials")
              const context = mode === "environment"
                ? yield* adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: true })
                : adapter.defaultContext
              const page = yield* adapter.createPage(context)
              const navigation = yield* adapter.navigate(
                page,
                `${mode === "flag" ? origin.origin : origin.origin.replace("127.0.0.1", "proxy.test")}/direct`,
                { referrer: Option.none() }
              )
              const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
              console.log(`WebKit ${mode}: ${JSON.stringify({ outcome: ended.outcome, requests: local.requests })}`)
              assert.strictEqual(ended.outcome._tag, "Committed")
              assert.isTrue(origin.served.some((request) => request.path === "/direct"))
              if (mode === "flag") {
                assert.deepStrictEqual(local.requests, [])
              } else {
                assert.isTrue(
                  local.requests.some((request) => request.url.includes("proxy.test") && request.method === "GET")
                )
                const tlsNavigation = yield* adapter.navigate(page, secure.origin.replace("127.0.0.1", "proxy.test"), {
                  referrer: Option.none()
                })
                const tlsEnded = yield* facts.when("NavigationEnded", (fact) => fact.navigation === tlsNavigation)
                assert.strictEqual(tlsEnded.outcome._tag, "Committed")
                assert.isTrue(
                  local.requests.some((request) => request.method === "CONNECT" && request.url.includes("proxy.test"))
                )
                const directNavigation = yield* adapter.navigate(page, `${origin.crossSite}/bypassed`, {
                  referrer: Option.none()
                })
                const directEnded = yield* facts.when("NavigationEnded", (fact) => fact.navigation === directNavigation)
                assert.strictEqual(directEnded.outcome._tag, "Committed")
                assert.isTrue(origin.served.some((request) => request.path === "/bypassed"))
                assert.isFalse(local.requests.some((request) => request.url.includes("/bypassed")))
                assert.isFalse(local.requests.some((request) => request.url.startsWith("127.0.0.1:")))
              }
            }),
          60_000
        )
      }
    }
  )
})
