import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import * as http from "node:http"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { chromium } from "../browsers.ts"
import { makeRecorder } from "./harness.ts"

const page = (script: string) => `<title>p</title><script>${script}</script>`
const server = http.createServer((q, s) => {
  const url = q.url ?? ""
  const html = (b: string) => { s.writeHead(200, { "content-type": "text/html" }); s.end(b) }
  if (url === "/p-cache") return html(page(`(async()=>{await fetch('/c301',{method:'GET'});await fetch('/c301');await fetch('/done')})()`))
  if (url === "/c301") { s.writeHead(301, { location: "/c-target", "cache-control": "max-age=3600", "x-hop": "c301" }); return s.end() }
  if (url === "/c-target") { s.writeHead(200, { "cache-control": "no-store", "x-hop": "c-target", "set-cookie": "a=b" }); return s.end("t") }
  if (url === "/p-hang") return html(page(`fetch('/hang',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})`))
  if (url === "/hang") return
  if (url === "/a-start") {
    if (q.headers.authorization === undefined) { s.writeHead(401, { "www-authenticate": `Basic realm="r"`, "x-hop": "a-401" }); return s.end() }
    s.writeHead(302, { location: "/a-end", "x-hop": "a-302" }); return s.end()
  }
  if (url === "/a-end") { s.writeHead(200, { "content-type": "text/html", "x-hop": "a-end" }); return s.end("end") }
  if (url === "/p-route") return html(page(`(async()=>{await fetch('/r-start');await fetch('/done')})()`))
  if (url === "/r-end") { s.writeHead(200, { "x-hop": "r-end", "set-cookie": "c=d" }); return s.end("r") }
  html("done")
})

describe("scratch", () => {
  layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })((it) => {
    it.effect("probe", () => Effect.gen(function*() {
      yield* Effect.promise(() => new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r())))
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
      const log = (...a: Array<unknown>) => console.log("PROBE", ...a.map((x) => typeof x === "string" ? x : JSON.stringify(x)))
      const facts = makeRecorder()
      const { transport } = yield* ChromiumLauncher.launchWithPort({ executablePath: chromium.executable })
      const tapped = { ...transport, messages: transport.messages.pipe(Stream.tap((text) => Effect.sync(() => {
        const m = JSON.parse(text) as { method?: string; params?: any }
        if (!m.method?.startsWith("Network.")) return
        if (!/requestWillBeSent|ExtraInfo|responseReceived$|loadingF|ServedFromCache/.test(m.method)) return
        const p = m.params
        log(m.method, { id: p.requestId, url: p.request?.url?.replace(origin, ""), status: p.statusCode ?? p.response?.status, redirectStatus: p.redirectResponse?.status,
          redirectHasExtraInfo: p.redirectHasExtraInfo, hasExtraInfo: p.hasExtraInfo, rFromDisk: p.redirectResponse?.fromDiskCache, fromDisk: p.response?.fromDiskCache,
          xhop: p.headers?.["x-hop"], auth: p.headers?.Authorization, err: p.errorText })
      })))}
      const sink = (fact: any) => { if (fact._tag === "HopHeaders") log("  FACT", fact._tag, fact.hop, fact.phase, fact.headers["x-hop"] ?? fact.headers[":path"] ?? ""); if (fact._tag === "RequestSent") log("  FACT sent", fact.request.hop, fact.request.url.replace(origin, "")); if (fact._tag === "ResponseReceived") log("  FACT resp", fact.response.hop, fact.response.status, fact.response.headers["x-hop"], fact.response.servedBy); return facts.sink(fact) }
      const adapter = yield* CdpAdapter.connect(tapped, { sink, ownership: "launched" })
      const p = yield* adapter.createPage(adapter.defaultContext)
      const context = adapter.defaultContext
      log("=== cached redirect")
      yield* adapter.navigate(p, `${origin}/p-cache`, { referrer: Option.none() })
      yield* Effect.sleep("1500 millis")
      log("=== hanging")
      yield* adapter.navigate(p, `${origin}/p-hang`, { referrer: Option.none() })
      yield* Effect.sleep("1500 millis")
      log("=== auth then redirect")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* adapter.declare({ _tag: "UserContext", context }, { _tag: "Intercept", patterns: [`${origin}/a-start*`], phases: ["auth"] })
        yield* adapter.navigate(p, `${origin}/a-start`, { referrer: Option.none() }).pipe(Effect.forkChild)
        const opened = yield* facts.when("ObligationOpened", (f: any) => f.subject._tag === "PausedRequest" && f.subject.phase === "auth")
        yield* adapter.resolve(opened.obligation, { _tag: "ProvideCredentials", username: "u", password: "p" })
        yield* Effect.sleep("1500 millis")
      }))
      log("=== routed redirect")
      yield* Effect.scoped(Effect.gen(function*() {
        yield* adapter.declare({ _tag: "UserContext", context }, { _tag: "Intercept", patterns: [`${origin}/r-start*`], phases: ["request"] })
        yield* adapter.navigate(p, `${origin}/p-route`, { referrer: Option.none() }).pipe(Effect.forkChild)
        const opened = yield* facts.when("ObligationOpened", (f: any) => f.subject._tag === "PausedRequest" && f.subject.phase === "request")
        yield* adapter.resolve(opened.obligation, { _tag: "Fulfill", status: 302, headers: { location: "/r-end", "x-hop": "r-302" }, body: Option.none() } as any)
        yield* Effect.sleep("1500 millis")
      }))
    }).pipe(Effect.scoped), 60_000)
  })
})
