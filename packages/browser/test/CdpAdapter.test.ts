/** Deterministic CDP event ordering regressions, without launching a browser. */
import { assert, describe, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Adapter from "../src/internal/adapter.ts"
import * as CdpAdapter from "../src/internal/cdpAdapter.ts"
import * as Har from "../src/internal/har.ts"
import captured from "./fixtures/redirect-extra-info.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"

describe("CDP adapter redirect headers", () => {
  for (
    const ordering of [
      "captured",
      "early ExtraInfo",
      "all early",
      "all late",
      "failed last hop",
      "first without ExtraInfo",
      "last without ExtraInfo"
    ] as const
  ) {
    for (const assertion of ["per-hop headers", "JSON HAR body"] as const) {
      it.effect(`attributes redirected request ExtraInfo to its own hop: ${ordering}, ${assertion}`, () =>
        Effect.gen(function*() {
          const browser = yield* makeBrowser
          const ready = yield* Deferred.make<void>()
          const finished = yield* Deferred.make<void>()
          const facts: Array<Adapter.Fact> = []
          // Answer only the handshake and target configuration; request events below are captured payloads.
          yield* Effect.gen(function*() {
            while (true) {
              const command = yield* browser.next
              const result = command.method === "Browser.getVersion"
                ? {
                  protocolVersion: "1.3",
                  product: "Chrome/155.0.8059.79",
                  revision: "test",
                  userAgent: "HeadlessChrome",
                  jsVersion: "test"
                }
                : command.method === "Target.getBrowserContexts"
                ? { browserContextIds: [] }
                : command.method === "Page.getFrameTree"
                ? {
                  frameTree: {
                    frame: {
                      id: "76F3487A52CF4F79FE4AD28961E44D32",
                      loaderId: "initial",
                      url: "about:blank",
                      securityOrigin: "://",
                      mimeType: "text/html"
                    }
                  }
                }
                : {}
              yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
            }
          }).pipe(Effect.forkScoped)
          const adapter = yield* CdpAdapter.connect(browser.transport, {
            ownership: "attached",
            sink: Effect.fnUntraced(function*(fact) {
              facts.push(fact)
              if (fact._tag === "PageReady") {
                yield* Deferred.succeed(ready, undefined)
              }
              if (
                (fact._tag === "RequestFinished" || fact._tag === "RequestFailed") &&
                facts.filter((fact) => fact._tag === "RequestFinished" || fact._tag === "RequestFailed").length === 2
              ) {
                yield* Deferred.succeed(finished, undefined)
              }
            })
          })
          yield* browser.receive({
            method: "Target.attachedToTarget",
            params: {
              sessionId: "S1",
              targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
              waitingForDebugger: false
            }
          })
          yield* Deferred.await(ready)
          yield* adapter.declare({ _tag: "UserContext", context: adapter.defaultContext }, {
            _tag: "BodyCollection",
            bodies: ["request"],
            maxBytes: 1024
          })
          // ROOK-104 #10: Chromium 155 capture lines 63, 65–70, 72, 80, unchanged payloads.
          // The vendored CDP requestWillBeSentExtraInfo contract permits either event to arrive first.
          // Preserve ExtraInfo order, moving only the second request ExtraInfo before its main event.
          const events = structuredClone(captured)
          // Give response headers distinct values so attribution cannot pass by matching identical headers.
          Object.assign(events[2]!.params.headers!, { "x-hop": "first" })
          Object.assign(events[5]!.params.headers!, { "x-hop": "last" })
          let reordered = [...events]
          if (ordering === "early ExtraInfo") {
            reordered = [events[0]!, events[1]!, events[2]!, events[4]!, events[3]!, ...events.slice(5)]
          }
          if (ordering === "all early") {
            reordered = [events[1]!, events[2]!, events[4]!, events[5]!, events[0]!, events[3]!, ...events.slice(6)]
          }
          if (ordering === "all late") {
            reordered = [
              events[0]!,
              events[3]!,
              events[6]!,
              events[1]!,
              events[2]!,
              events[4]!,
              events[5]!,
              ...events.slice(7)
            ]
          }
          if (ordering === "first without ExtraInfo") {
            Object.assign(events[3]!.params, { redirectHasExtraInfo: false })
            reordered = [events[0]!, events[4]!, events[5]!, events[3]!, ...events.slice(6)]
          }
          if (ordering === "last without ExtraInfo") {
            Object.assign(events[6]!.params, { hasExtraInfo: false })
            Object.assign(events[3]!.params.request!.headers, { "content-type": "application/json" })
            reordered = [events[0]!, events[3]!, events[1]!, events[2]!, ...events.slice(6)]
          }
          if (ordering === "failed last hop") {
            reordered = events.slice(0, 6)
          }
          for (const event of reordered) {
            yield* browser.receive({ method: event.method, params: event.params, sessionId: "S1" })
          }
          if (ordering === "failed last hop") {
            yield* browser.receive({
              method: "Network.loadingFailed",
              sessionId: "S1",
              params: {
                requestId: events[0]!.params.requestId,
                timestamp: 772297,
                type: "Fetch",
                errorText: "net::ERR_FAILED"
              }
            })
          }
          yield* Deferred.await(finished)
          const requests = facts.filter((fact) => fact._tag === "RequestSent")
          const headers = facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
            fact._tag === "HopHeaders" && fact.phase === "request"
          )
          assert.strictEqual(requests.length, 2)
          if (assertion === "per-hop headers") {
            const received = facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
              fact._tag === "HopHeaders" && fact.phase === "response"
            )
            assert.deepStrictEqual(
              received.map((fact) => ({ hop: fact.hop, value: fact.headers["x-hop"] })),
              ordering === "first without ExtraInfo" ?
                [{ hop: requests[1]!.request.hop, value: "last" }]
                : ordering === "last without ExtraInfo" ?
                [{ hop: requests[0]!.request.hop, value: "first" }]
                : [{ hop: requests[0]!.request.hop, value: "first" }, { hop: requests[1]!.request.hop, value: "last" }]
            )
            assert.deepStrictEqual(
              headers.map((fact) => ({ hop: fact.hop, contentType: fact.headers["content-type"] })),
              [
                { hop: requests[0]!.request.hop, contentType: "application/json" },
                { hop: requests[1]!.request.hop, contentType: "application/json" }
              ]
            )
          } else {for (const { request } of requests) {
              const body = yield* adapter.requestBody(request.hop)
              assert.strictEqual(new TextDecoder().decode(Option.getOrThrow(body)), "{\"q\":\"hats\"}")
              // Apply HopHeaders by hop as the model does; pass the adapter's actual body to the HAR exporter.
              const { entry } = Har.entryOf(
                {
                  request,
                  hop: Option.some({
                    request,
                    response: Option.none(),
                    received: Option.none(),
                    sent: Option.fromUndefinedOr(headers.findLast((fact) => fact.hop === request.hop)?.headers),
                    sentKnown: Deferred.makeUnsafe(),
                    end: Deferred.makeUnsafe(),
                    page: Option.none(),
                    context: Option.none()
                  }),
                  end: Option.none(),
                  body: Option.none(),
                  requestBody: body,
                  frames: [],
                  done: Deferred.makeUnsafe()
                },
                { wall: 0, monotonic: request.at },
                {
                  detail: "full",
                  include: new Set(["requestBodies"]),
                  bodies: { _tag: "Embed" }
                }
              )
              assert.deepStrictEqual((entry.request as Record<string, unknown>).postData, {
                mimeType: "application/json",
                text: "{\"q\":\"hats\"}"
              })
            }}
        }))
    }
  }
})

describe("CDP adapter sent headers before a response", () => {
  it.effect("reports a request's ExtraInfo headers while its response is outstanding", () =>
    Effect.gen(function*() {
      const browser = yield* makeBrowser
      const ready = yield* Deferred.make<void>()
      const settled = yield* Deferred.make<void>()
      const facts: Array<Adapter.Fact> = []
      yield* Effect.gen(function*() {
        while (true) {
          const command = yield* browser.next
          const result = command.method === "Browser.getVersion"
            ? {
              protocolVersion: "1.3",
              product: "Chrome/155.0.8059.79",
              revision: "test",
              userAgent: "HeadlessChrome",
              jsVersion: "test"
            }
            : command.method === "Target.getBrowserContexts"
            ? { browserContextIds: [] }
            : command.method === "Page.getFrameTree"
            ? {
              frameTree: {
                frame: {
                  id: "76F3487A52CF4F79FE4AD28961E44D32",
                  loaderId: "initial",
                  url: "about:blank",
                  securityOrigin: "://",
                  mimeType: "text/html"
                }
              }
            }
            : {}
          yield* browser.receive({ id: command.id, sessionId: command.sessionId, result })
        }
      }).pipe(Effect.forkScoped)
      yield* CdpAdapter.connect(browser.transport, {
        ownership: "attached",
        sink: Effect.fnUntraced(function*(fact) {
          facts.push(fact)
          if (fact._tag === "PageReady") yield* Deferred.succeed(ready, undefined)
          if (fact._tag === "ConnectionOpened") yield* Deferred.succeed(settled, undefined)
        })
      })
      yield* browser.receive({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "S1",
          targetInfo: { targetId: "T1", type: "page", title: "", url: "about:blank", attached: true },
          waitingForDebugger: false
        }
      })
      yield* Deferred.await(ready)
      // The server hasn't answered: only the request event and its ExtraInfo have come, in the captured order.
      for (const event of captured.slice(0, 2)) {
        yield* browser.receive({ method: event.method, params: event.params, sessionId: "S1" })
      }
      // A later event marks that the adapter has handled both.
      yield* browser.receive({
        method: "Network.webSocketCreated",
        sessionId: "S1",
        params: { requestId: "sentinel", url: "ws://127.0.0.1/" }
      })
      yield* Deferred.await(settled)
      const request = facts.find((fact) => fact._tag === "RequestSent")!
      assert.deepStrictEqual(
        facts.flatMap((fact) =>
          fact._tag === "HopHeaders" ? [{ hop: fact.hop, phase: fact.phase, type: fact.headers["content-type"] }] : []
        ),
        [{ hop: request.request.hop, phase: "request", type: "application/json" }]
      )
    }))
})
