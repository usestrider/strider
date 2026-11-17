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
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as nodeFs from "node:fs"
import * as os from "node:os"
import * as nodePath from "node:path"
import * as ChromiumLauncher from "../../src/internal/chromiumLauncher.ts"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import * as WebKitAdapter from "../../src/internal/webkitAdapter.ts"
import * as WebKitAutomation from "../../src/internal/webkitAutomation.ts"
import { makeRecorder, site, tlsSite } from "./adapter/harness.ts"
import { proxy } from "./adapter/proxy.ts"
import { socks, type SocksRequest } from "./adapter/socks.ts"
import { assertPinned, chromium, firefox, openssl, webkitgtk } from "./browsers.ts"
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

describe("Firefox interception scope feasibility", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
    (it) => {
      it.effect(
        "ignores unsupported userContexts on addIntercept and still blocks another context",
        () =>
          Effect.gen(function*() {
            const origin = yield* site
            const { transport } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
            let id = 0
            const replies = new Map<number, Deferred.Deferred<any>>()
            const challenges: Array<string> = []
            const call = Effect.fnUntraced(function*(method: string, params: object) {
              const next = ++id
              const reply = yield* Deferred.make<any>()
              replies.set(next, reply)
              yield* transport.send(JSON.stringify({ id: next, method, params }))
              const result = yield* Deferred.await(reply)
              replies.delete(next)
              return result
            })
            yield* transport.messages.pipe(
              Stream.runForEach((text) =>
                Effect.gen(function*() {
                  const message = JSON.parse(text)
                  if (message.id !== undefined) {
                    const reply = replies.get(message.id)
                    if (reply) yield* Deferred.succeed(reply, message)
                  } else if (message.method === "network.authRequired") {
                    challenges.push(message.params.userContext)
                    yield* call("network.continueWithAuth", {
                      request: message.params.request.request,
                      action: "cancel"
                    })
                      .pipe(Effect.forkScoped)
                  }
                })
              ),
              Effect.forkScoped
            )
            const session = yield* call("session.new", { capabilities: {} })
            assertPinned("Firefox", session.result.capabilities.browserVersion, firefox.version)
            yield* call("session.subscribe", { events: ["network.authRequired"] })
            const selected = (yield* call("browser.createUserContext", {})).result.userContext
            const other = (yield* call("browser.createUserContext", {})).result.userContext
            const interceptor = yield* call("network.addIntercept", {
              phases: ["authRequired"],
              userContexts: [selected]
            })
            assert.isUndefined(interceptor.error)
            const page = (yield* call("browsingContext.create", { type: "tab", userContext: other })).result.context
            yield* call("browsingContext.navigate", { context: page, url: `${origin.origin}/auth`, wait: "complete" })
            assert.deepStrictEqual(
              challenges,
              [other],
              "Firefox ignores the extra field rather than scoping interception"
            )
          }).pipe(Effect.timeout("20 seconds")),
        30_000
      )
    }
  )
})

/**
 * Feasibility probes of SOCKS and TLS proxy endpoints. Each backend takes the same probes; a probe records what the
 * navigation returned and what crossed the SOCKS fixture, and the assertions pin what the pinned builds do.
 * `proxy.test` resolves only inside the proxies, so a name the browser bypasses, or resolves itself, fails to resolve.
 */
interface Seen {
  /** `proxied, proxy DNS`, `proxied, local DNS`, `direct` or `failed`. */
  readonly outcome: string
  readonly error: string | undefined
  readonly settled: boolean
  readonly via: ReadonlyArray<string>
}

interface ProbeBrowser {
  /** A page in a new context whose proxy is described as the backend's protocol takes it. */
  readonly open: (
    proxy: {
      readonly scheme: string
      readonly address: string
      readonly bypass: ReadonlyArray<string>
      /** Further environment for launched stock WebKit, which the others ignore. */
      readonly env?: Record<string, string>
    }
  ) => Effect.Effect<(url: string) => Effect.Effect<string | undefined, any, any>, any, any>
}

/** A self-signed key pair for `127.0.0.1`, which no browser trusts. */
const tlsKeyPair = Effect.acquireRelease(
  Effect.sync(() => {
    const directory = nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "strider-proxy-tls-"))
    const key = nodePath.join(directory, "key.pem")
    const cert = nodePath.join(directory, "cert.pem")
    execFileSync(openssl, [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1"
    ], { stdio: "ignore" })
    return { directory, key: nodeFs.readFileSync(key), cert: nodeFs.readFileSync(cert) }
  }),
  ({ directory }) => Effect.sync(() => nodeFs.rmSync(directory, { recursive: true, force: true }))
)

/** Whether `predicate` holds within `duration`, polled every 10 ms. */
const until = (predicate: () => boolean, duration: Duration.Input) =>
  Effect.callback<void>((resume) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer)
        resume(Effect.void)
      }
    }, 10)
    return Effect.sync(() => clearInterval(timer))
  }).pipe(Effect.timeoutOption(duration), Effect.map(Option.isSome))

const rawClient = Effect.fnUntraced(function*(transport: {
  readonly send: (text: string) => Effect.Effect<void, any>
  readonly messages: Stream.Stream<string, any>
}) {
  let id = 0
  const replies = new Map<number, Deferred.Deferred<any>>()
  yield* transport.messages.pipe(
    Stream.runForEach((text) =>
      Effect.suspend(() => {
        const message = JSON.parse(text)
        const reply = message.id === undefined ? undefined : replies.get(message.id)
        return reply === undefined ? Effect.void : Deferred.succeed(reply, message)
      })
    ),
    Effect.forkScoped
  )
  return Effect.fnUntraced(function*(method: string, params: object, sessionId?: string) {
    const next = ++id
    const reply = yield* Deferred.make<any>()
    replies.set(next, reply)
    yield* transport.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }))
    const message = yield* Deferred.await(reply)
    replies.delete(next)
    return message
  })
})

const probeBrowsers = {
  chromium: Effect.gen(function*() {
    const { transport } = yield* ChromiumLauncher.launch({
      executablePath: chromium.executable,
      args: ["--ignore-certificate-errors"]
    })
    const call = yield* rawClient(transport)
    assertPinned("Chromium", (yield* call("Browser.getVersion", {})).result.product.split("/")[1], chromium.version)
    return {
      open: Effect.fnUntraced(function*({ address, bypass, scheme }) {
        const context = yield* call("Target.createBrowserContext", {
          proxyServer: `${scheme}://${address}`,
          proxyBypassList: bypass.join(",")
        })
        if (context.error !== undefined) return yield* Effect.fail(context.error)
        const target = yield* call("Target.createTarget", {
          url: "about:blank",
          browserContextId: context.result.browserContextId
        })
        const { sessionId } =
          (yield* call("Target.attachToTarget", { targetId: target.result.targetId, flatten: true }))
            .result
        return (url: string) =>
          call("Page.navigate", { url }, sessionId).pipe(
            Effect.map((reply) => reply.error?.message ?? reply.result.errorText)
          )
      })
    } satisfies ProbeBrowser
  }),
  firefox: Effect.gen(function*() {
    const { transport } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
    const call = yield* rawClient(transport)
    const session = yield* call("session.new", { capabilities: {} })
    assertPinned("Firefox", session.result.capabilities.browserVersion, firefox.version)
    return {
      open: Effect.fnUntraced(function*({ address, bypass, scheme }) {
        const context = yield* call("browser.createUserContext", {
          acceptInsecureCerts: true,
          proxy: scheme.startsWith("socks")
            ? { proxyType: "manual", socksProxy: address, socksVersion: scheme === "socks4" ? 4 : 5, noProxy: bypass }
            : { proxyType: "manual", httpProxy: `${scheme}://${address}`, noProxy: bypass }
        })
        if (context.error !== undefined) return yield* Effect.fail(`${context.error}: ${context.message}`)
        const page = (yield* call("browsingContext.create", { type: "tab", userContext: context.result.userContext }))
          .result.context
        return (url: string) =>
          call("browsingContext.navigate", { context: page, url, wait: "complete" }).pipe(
            Effect.map((reply) => reply.error === undefined ? undefined : reply.message)
          )
      })
    } satisfies ProbeBrowser
  }),
  // Launched stock WebKit takes a proxy from its environment, one per browser process.
  webkit: Effect.gen(function*() {
    yield* useXvfb().pipe(Effect.orDie)
    const fs = yield* FileSystem.FileSystem
    return {
      open: Effect.fnUntraced(function*({ address, bypass, env: extra, scheme }: Parameters<ProbeBrowser["open"]>[0]) {
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-proxy-env-" })
        const wrapper = `${directory}/MiniBrowser`
        const endpoint = `${scheme}://${address}`
        const env = {
          http_proxy: endpoint,
          https_proxy: endpoint,
          all_proxy: endpoint,
          // Without loopback here, its own automation connection goes through the proxy, as Strider's launch knows
          no_proxy: ["localhost", "127.0.0.1", "::1", ...bypass].join(","),
          ...extra
        }
        yield* fs.writeFileString(
          wrapper,
          `#!/bin/sh\nexport ${
            Object.entries(env).map(([name, value]) => `${name}='${value}' ${name.toUpperCase()}='${value}'`).join(" ")
          }\nexec '${webkitgtk.executable}' "$@"\n`
        )
        yield* fs.chmod(wrapper, 0o700)
        const group = yield* WebKitAutomation.start({ executablePath: wrapper }).pipe(Effect.provide(socketConnector))
        const facts = makeRecorder()
        const adapter = yield* WebKitAdapter.connect(group.transport, {
          sink: facts.sink,
          ownership: "launched",
          automation: group
        })
        const context = yield* adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: true })
        const page = yield* adapter.createPage(context)
        return (url: string) =>
          Effect.gen(function*() {
            const navigation = yield* adapter.navigate(page, url, { referrer: Option.none() })
            const ended = yield* facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
            return ended.outcome._tag === "Committed" ? undefined : JSON.stringify(ended.outcome)
          }).pipe(Effect.timeout("10 seconds"), Effect.catch((error) => Effect.succeed(String(error))))
      })
    } satisfies ProbeBrowser
  })
} as const

for (const backend of ["chromium", "firefox", "webkit"] as const) {
  describe(`${backend} SOCKS and TLS proxy endpoints`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        it.effect(
          "routes destinations, resolves names, bypasses hosts and refuses credentials",
          () =>
            Effect.gen(function*() {
              const origin = yield* site
              const secure = yield* tlsSite
              const port = new URL(origin.origin).port
              const browser = yield* probeBrowsers[backend]
              const observe = Effect.fnUntraced(function*(
                go: (url: string) => Effect.Effect<string | undefined, any, any>,
                log: ReadonlyArray<SocksRequest>,
                url: string,
                done?: (fresh: ReadonlyArray<SocksRequest>) => boolean
              ) {
                const before = log.length
                const path = new URL(url).pathname
                const error = yield* go(url)
                const settled = yield* until(
                  () => {
                    const fresh = log.slice(before)
                    return done === undefined
                      ? origin.served.some((request) => request.path === path) ||
                        fresh.some((request) => request.received !== undefined)
                      : done(fresh)
                  },
                  error === undefined ? "5 seconds" : "500 millis"
                )
                const host = new URL(url).hostname
                const tunnel = log.slice(before).find((request) =>
                  request.received !== undefined &&
                  (request.host === host ||
                    (request.version === "socks4" && request.port === Number(new URL(url).port)))
                )
                return {
                  outcome: tunnel !== undefined
                    ? `proxied, ${tunnel.remoteDns ? "proxy" : "local"} DNS`
                    : error === undefined && settled
                    ? "direct"
                    : "failed",
                  error,
                  settled,
                  via: log.slice(before).map((request) =>
                    `${request.version} ${request.remoteDns ? "name" : "address"} ${request.host}:${request.port}` +
                    ` methods=${request.methods.join("/")} ${request.sent ?? "-"} => ${request.received ?? "-"}`
                  )
                } satisfies Seen
              })
              const results: Record<string, Seen | string> = {}
              const attempt = (name: string, effect: Effect.Effect<Seen | string, unknown, any>) =>
                effect.pipe(
                  Effect.scoped,
                  Effect.catch((error) => Effect.succeed(`refused: ${JSON.stringify(error)}`)),
                  Effect.tap((seen) => Effect.sync(() => results[name] = seen))
                )
              const tlsPort = new URL(secure.origin).port
              for (const scheme of ["socks5", "socks4"] as const) {
                yield* Effect.scoped(Effect.gen(function*() {
                  const local = yield* socks()
                  const go = yield* browser.open({ scheme, address: local.address, bypass: [] })
                  yield* attempt(
                    `${scheme} http`,
                    observe(go, local.requests, `http://proxy.test:${port}/${scheme}-http`)
                  )
                  yield* attempt(
                    `${scheme} https`,
                    observe(go, local.requests, `https://proxy.test:${tlsPort}/`)
                  )
                  yield* attempt(
                    `${scheme} websocket`,
                    observe(
                      go,
                      local.requests,
                      `http://proxy.test:${port}/socket`,
                      (fresh) => fresh.some((request) => request.sent === "GET /ws HTTP/1.1" && request.received)
                    )
                  )
                  yield* attempt(
                    `${scheme} 127.0.0.1`,
                    observe(go, local.requests, `http://127.0.0.1:${port}/${scheme}-loopback-address`)
                  )
                  yield* attempt(
                    `${scheme} localhost`,
                    observe(go, local.requests, `http://localhost:${port}/${scheme}-loopback-name`)
                  )
                }))
              }
              for (const entry of [".proxy.test", "proxy.test"]) {
                yield* Effect.scoped(Effect.gen(function*() {
                  const local = yield* socks()
                  const go = yield* browser.open({ scheme: "socks5", address: local.address, bypass: [entry] })
                  for (const host of ["proxy.test", "sub.proxy.test", "control.test"]) {
                    yield* attempt(
                      `bypass ${entry}: ${host}`,
                      observe(go, local.requests, `http://${host}:${port}/bypass-${entry}-${host}`)
                    )
                  }
                }))
              }
              const guarded = yield* socks({ username: "socks-user", password: "socks-secret" })
              yield* attempt(
                "socks5 credentials, none given",
                Effect.flatMap(
                  browser.open({ scheme: "socks5", address: guarded.address, bypass: [] }),
                  (go) => observe(go, guarded.requests, `http://proxy.test:${port}/socks-unauthenticated`)
                )
              )
              yield* attempt(
                "socks5 credentials in the endpoint",
                Effect.flatMap(
                  browser.open({ scheme: "socks5", address: `socks-user:socks-secret@${guarded.address}`, bypass: [] }),
                  (go) => observe(go, guarded.requests, `http://proxy.test:${port}/socks-authenticated`)
                )
              )
              const key = yield* tlsKeyPair
              const overTls = yield* proxy(undefined, { tls: key })
              yield* attempt(
                "https proxy",
                Effect.flatMap(
                  browser.open({
                    scheme: "https",
                    address: overTls.address,
                    bypass: []
                  }),
                  (go) =>
                    Effect.gen(function*() {
                      const path = "/https-proxy"
                      const error = yield* go(`http://proxy.test:${port}${path}`)
                      const settled = yield* until(
                        () => origin.served.some((request) => request.path === path),
                        error === undefined ? "5 seconds" : "500 millis"
                      )
                      const tunneled = overTls.requests.some((request) => request.url.endsWith(path))
                      return {
                        outcome: tunneled && settled ? "proxied, proxy DNS" : "failed",
                        error,
                        settled,
                        via: overTls.requests.map((request) => `${request.method} ${request.url}`)
                      } satisfies Seen
                    })
                )
              )
              if (backend === "webkit") {
                // Which of GLib's proxy resolvers reads the environment: GIO picks one unless told
                for (const resolver of ["libproxy", "gnome", "dummy"]) {
                  yield* Effect.scoped(Effect.gen(function*() {
                    const local = yield* socks()
                    const go = yield* browser.open({
                      scheme: "socks5",
                      address: local.address,
                      bypass: [],
                      env: { GIO_USE_PROXY_RESOLVER: resolver }
                    })
                    yield* attempt(
                      `resolver ${resolver}`,
                      observe(go, local.requests, `http://proxy.test:${port}/resolver-${resolver}`)
                    )
                  }))
                }
                yield* Effect.scoped(Effect.gen(function*() {
                  const local = yield* socks()
                  const go = yield* browser.open({ scheme: "socks4a", address: local.address, bypass: [] })
                  yield* attempt("socks4a http", observe(go, local.requests, `http://proxy.test:${port}/socks4a-http`))
                }))
              }
              console.log(`${backend} SOCKS and TLS proxies: ${JSON.stringify(results, null, 2)}`)
              const proxied = "proxied, proxy DNS"
              const common = {
                "socks5 http": proxied,
                "socks5 https": proxied,
                "socks5 websocket": proxied,
                "socks5 127.0.0.1": "direct",
                "socks5 localhost": "direct",
                "socks4 127.0.0.1": "direct",
                "socks4 localhost": "direct",
                "bypass .proxy.test: control.test": proxied,
                "bypass proxy.test: control.test": proxied,
                // Neither offers SOCKS5 username and password authentication
                "socks5 credentials, none given": "failed"
              }
              // Chromium and GLib speak SOCKS4 without its 4a extension, resolving names themselves
              const socks4 = backend === "firefox" ? proxied : "failed"
              assert.deepStrictEqual(
                Object.fromEntries(
                  Object.entries(results).map((
                    [name, seen]
                  ) => [name, typeof seen === "string" ? "refused" : seen.outcome])
                ),
                {
                  ...common,
                  "socks4 http": socks4,
                  "socks4 https": socks4,
                  "socks4 websocket": socks4,
                  // Chromium and Firefox: a leading dot matches subdomains only, a bare host only itself.
                  // GLib's libproxy matches both forms against the host and its subdomains.
                  "bypass .proxy.test: proxy.test": backend === "webkit" ? "failed" : proxied,
                  "bypass .proxy.test: sub.proxy.test": "failed",
                  "bypass proxy.test: proxy.test": "failed",
                  "bypass proxy.test: sub.proxy.test": backend === "webkit" ? "failed" : proxied,
                  ...(backend === "chromium"
                    ? {
                      "socks5 credentials in the endpoint": "failed",
                      // With certificate errors ignored browser-wide; nothing trusts it per context
                      "https proxy": proxied
                    }
                    : backend === "firefox"
                    ? { "socks5 credentials in the endpoint": "refused", "https proxy": "refused" }
                    : {
                      "socks5 credentials in the endpoint": proxied,
                      // A context's acceptInsecureCerts doesn't reach GLib's TLS connection to the proxy,
                      // and GLib's GnuTLS backend takes no trust store from the environment
                      "https proxy": "failed",
                      "resolver libproxy": proxied,
                      "resolver gnome": proxied,
                      "resolver dummy": "failed",
                      "socks4a http": proxied
                    })
                }
              )
            }).pipe(Effect.timeout("150 seconds")),
          180_000
        )
      }
    )
  })
}
