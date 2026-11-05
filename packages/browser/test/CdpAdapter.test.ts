/** Deterministic CDP event ordering regressions, without launching a browser. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Capability, Deadline, NetworkRequest } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { TestClock } from "effect/testing"
import type * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as CdpAdapter from "../src/internal/cdpAdapter.ts"
import * as Har from "../src/internal/har.ts"
import * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Readable from "../src/internal/readable.ts"
import captured from "./fixtures/redirect-extra-info.ts"
import { makeBrowser, type Sent } from "./utils/FakeBrowser.ts"

describe("CDP adapter redirect headers", () => {
  for (
    const ordering of [
      "captured",
      "early ExtraInfo",
      "all early",
      "ambiguous prefix",
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
          const settled = yield* Deferred.make<void>()
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
              if (fact._tag === "ConnectionOpened") yield* Deferred.succeed(settled, undefined)
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
          // Chromium 155 capture lines 63, 65–70, 72, 80, unchanged payloads.
          // The vendored CDP requestWillBeSentExtraInfo contract permits either event to arrive first.
          // Synthetic variants preserve each ExtraInfo stream's hop order and exercise the absence flags.
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
          if (ordering === "ambiguous prefix") {
            // Exactly the prefix used by the outstanding-response test below. Only later events reveal
            // that this ExtraInfo belongs to the next hop, rather than the visible request.
            for (const event of captured.slice(0, 2)) {
              yield* browser.receive({ method: event.method, params: event.params, sessionId: "S1" })
            }
            yield* browser.receive({
              method: "Network.webSocketCreated",
              sessionId: "S1",
              params: { requestId: "sentinel", url: "ws://127.0.0.1/" }
            })
            yield* Deferred.await(settled)
            assert.deepStrictEqual(facts.filter((fact) => fact._tag === "HopHeaders"), [])
            Object.assign(events[3]!.params, { redirectHasExtraInfo: false })
            Object.assign(events[3]!.params.redirectResponse!, { fromDiskCache: true, timing: undefined })
            reordered = [events[3]!, events[5]!, ...events.slice(6)]
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
          if (ordering === "ambiguous prefix") {
            assert.deepStrictEqual(headers.map((fact) => ({ hop: fact.hop, cookie: fact.headers.cookie })), [
              { hop: requests[0]!.request.hop, cookie: undefined },
              { hop: requests[1]!.request.hop, cookie: "flavor=oat" }
            ])
          }
          if (assertion === "per-hop headers") {
            const received = facts.filter((fact): fact is Extract<Adapter.Fact, { _tag: "HopHeaders" }> =>
              fact._tag === "HopHeaders" && fact.phase === "response"
            )
            assert.deepStrictEqual(
              received.map((fact) => ({ hop: fact.hop, value: fact.headers["x-hop"] })),
              (ordering === "first without ExtraInfo" || ordering === "ambiguous prefix") ?
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
                    state: Readable.of(
                      yield* SubscriptionRef.make({
                        response: Option.none(),
                        received: Option.none(),
                        sent: Option.fromUndefinedOr(headers.findLast((fact) => fact.hop === request.hop)?.headers)
                      })
                    ),
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

const metrics = {
  cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 },
  cssVisualViewport: {
    offsetX: 0,
    offsetY: 0,
    pageX: 10,
    pageY: 20,
    clientWidth: 800,
    clientHeight: 600,
    scale: 1
  },
  cssContentSize: { x: 0, y: 0, width: 900, height: 1800 }
}
const replyMetrics = (browser: Effect.Success<typeof makeBrowser>, command: Sent) =>
  browser.receive({ id: command.id, sessionId: command.sessionId, result: metrics })

/** A synthetic CDP connection folded into the real public Browser layer. */
const sentHeaders = Effect.fnUntraced(
  function*(holdMetrics = false, holdStart = false, holdStop = false, blockStop = false, blockStart = false) {
    const browser = yield* makeBrowser
    const ready = yield* Deferred.make<void>()
    const settled = yield* Queue.unbounded<void>()
    const facts: Array<Adapter.Fact> = []
    const commands: Array<Sent> = []
    const screenshotWork = yield* Queue.unbounded<Sent>()
    const stops = yield* Queue.unbounded<Sent>()
    const stopDeadlines: Array<Option.Option<number>> = []
    const stopWrites = yield* Queue.unbounded<void>()
    const stopWriteGate = yield* Deferred.make<void>()
    const startWrites = yield* Queue.unbounded<void>()
    const startWriteGate = yield* Deferred.make<void>()
    const captures = yield* Queue.unbounded<Sent>()
    const preparation = yield* Queue.unbounded<Sent>()
    yield* Effect.gen(function*() {
      while (true) {
        const command = yield* browser.next
        commands.push(command)
        if (
          command.method === "Page.getLayoutMetrics" || command.method === "Page.captureScreenshot" ||
          command.method === "Page.startScreencast"
        ) {
          yield* Queue.offer(screenshotWork, command)
        }
        if (command.method === "Page.getLayoutMetrics" && !holdMetrics) {
          yield* replyMetrics(browser, command)
          continue
        }
        if (command.method === "Page.captureScreenshot") {
          yield* Queue.offer(captures, command)
          continue
        }
        if (
          command.method === "Page.getLayoutMetrics" || command.method === "Page.createIsolatedWorld" ||
          (command.method === "Emulation.setDefaultBackgroundColorOverride" && command.params?.color === undefined)
        ) {
          yield* Queue.offer(preparation, command)
          continue
        }
        if (command.method === "Page.stopScreencast") {
          yield* Queue.offer(stops, command)
          if (holdStop) continue
        }
        if (holdStart && command.method === "Page.startScreencast") continue
        const result = command.method === "Runtime.evaluate"
          ? { result: { type: "number", value: 2 } }
          : command.method === "Browser.getVersion"
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
    const services = yield* Layer.build(BrowserImpl.layer((sink) =>
      CdpAdapter.connect({
        ...browser.transport,
        send: Effect.fnUntraced(function*(message: string) {
          if (JSON.parse(message).method === "Page.startScreencast" && blockStart) {
            yield* Queue.offer(startWrites, undefined)
            yield* Deferred.await(startWriteGate)
          }
          if (JSON.parse(message).method === "Page.stopScreencast") {
            stopDeadlines.push(yield* ProtocolClient.CommandDeadline)
            yield* Queue.offer(stopWrites, undefined)
            if (blockStop) yield* Deferred.await(stopWriteGate)
          }
          yield* browser.transport.send(message)
        })
      }, {
        ownership: "attached",
        sink: Effect.fnUntraced(function*(fact) {
          yield* sink(fact)
          facts.push(fact)
          if (fact._tag === "PageReady") yield* Deferred.succeed(ready, undefined)
          if (fact._tag === "ConnectionOpened") yield* Queue.offer(settled, undefined)
        })
      })
    ))
    yield* browser.receive({
      method: "Target.attachedToTarget",
      params: {
        sessionId: "S1",
        targetInfo: {
          targetId: "76F3487A52CF4F79FE4AD28961E44D32",
          type: "page",
          title: "",
          url: "about:blank",
          attached: true
        },
        waitingForDebugger: false
      }
    })
    yield* Deferred.await(ready)
    const service = Context.get(services, Browser.Browser)
    const page = (yield* service.pages.waitFor((pages) => pages.length > 0))[0]!
    const next = yield* NetworkRequest.next(page, { url: "**" })
    const send = (event: (typeof captured)[number]) => browser.receive({ ...event, sessionId: "S1" })
    const barrier = Effect.gen(function*() {
      yield* browser.receive({
        method: "Network.webSocketCreated",
        sessionId: "S1",
        params: {
          requestId: `sentinel-${facts.length}`,
          url: "ws://127.0.0.1/"
        }
      })
      yield* Queue.take(settled)
    })
    yield* send(captured[0]!)
    yield* barrier
    const request = yield* next
    return {
      browser,
      page,
      request,
      send,
      barrier,
      captures,
      stops,
      stopDeadlines,
      stopWrites,
      stopWriteGate,
      startWrites,
      startWriteGate,
      commands,
      screenshotWork,
      preparation,
      facts
    }
  }
)

/** Advance deadlines without delays, retaining the live epoch used by the real protocol client's command deadline. */
const onTestClock = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Clock.clockWith((clock) =>
    Effect.suspend(() => {
      const test = BrowserClock.fromClock(clock)
      const origin = BrowserClock.live.now() - test.now()
      return Effect.provideService(self, BrowserClock.CurrentClock, {
        now: () => (origin + test.now()) as ReturnType<typeof test.now>,
        sleep: test.sleep
      })
    })
  )

describe("Chromium public sent-header waiting", () => {
  it.effect("waits for attribution, then returns the network headers", () =>
    Effect.gen(function*() {
      const { page, request, send, barrier } = yield* sentHeaders()
      const waiting = yield* Effect.forkScoped(
        NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"))
      )
      yield* send(captured[1]!)
      yield* barrier
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(waiting.pollUnsafe())
      yield* send(captured[2]!)
      yield* send(captured[3]!)
      yield* barrier
      yield* TestClock.adjust("0 millis")
      assert.isDefined(waiting.pollUnsafe())
      assert.strictEqual((yield* Fiber.join(waiting)).cookie, "flavor=oat")
    }).pipe(onTestClock))

  it.effect("times out at its public deadline while attribution is unavailable", () =>
    Effect.gen(function*() {
      const { page, request, send, barrier } = yield* sentHeaders()
      yield* send(captured[1]!)
      yield* barrier
      const waiting = yield* Effect.forkScoped(
        NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"), Effect.flip)
      )
      yield* TestClock.adjust("999 millis")
      assert.isUndefined(waiting.pollUnsafe())
      yield* TestClock.adjust("1 millis")
      const timeout = yield* Fiber.join(waiting)
      assert(Deadline.isTimeout(timeout))
      assert.strictEqual(timeout.operation, "NetworkRequest.headersSent")
      assert.strictEqual(timeout.phase, "waitingForEvent")
    }).pipe(onTestClock))

  for (const terminal of ["fails", "is canceled", "loses its page"] as const) {
    it.effect(`settles without advancing the deadline when a request ${terminal}`, () =>
      Effect.gen(function*() {
        const { browser, page, request, send, barrier } = yield* sentHeaders()
        // Failure attributes queued headers to the last hop; page removal cannot safely do that.
        if (terminal !== "is canceled") yield* send(captured[1]!)
        yield* barrier
        const waiting = yield* Effect.forkScoped(
          NetworkRequest.headersSent(page, request).pipe(Deadline.within("1 second"))
        )
        yield* TestClock.adjust("0 millis")
        assert.isUndefined(waiting.pollUnsafe())
        if (terminal === "loses its page") {
          yield* browser.receive({
            method: "Target.detachedFromTarget",
            params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
          })
          yield* page.closed
        } else {
          yield* browser.receive({
            method: "Network.loadingFailed",
            sessionId: "S1",
            params: {
              requestId: captured[0]!.params.requestId,
              timestamp: 772297,
              type: "Fetch",
              errorText: terminal === "fails" ? "net::ERR_FAILED" : "net::ERR_ABORTED",
              canceled: terminal === "is canceled"
            }
          })
          yield* barrier
        }
        yield* TestClock.adjust("0 millis")
        assert.isDefined(waiting.pollUnsafe(), "the terminal event must settle headers without advancing the clock")
        const headers = yield* Fiber.join(waiting)
        if (terminal === "fails") assert.strictEqual(headers.cookie, "flavor=oat")
        else assert.deepStrictEqual(headers, request.headers)
      }).pipe(onTestClock))
  }
})

const replacementEvent = (loaderId = "replacement") => ({
  sessionId: "S1",
  method: "Page.frameNavigated",
  params: {
    frame: {
      id: "76F3487A52CF4F79FE4AD28961E44D32",
      loaderId,
      url: "https://example.com/replacement",
      securityOrigin: "https://example.com",
      mimeType: "text/html"
    }
  }
})

const replyCapture = (browser: Effect.Success<typeof makeBrowser>, command: Sent) =>
  browser.receive({ id: command.id, sessionId: command.sessionId, result: { data: "AA==" } })

describe("Chromium capture document replacement", () => {
  for (const preparation of ["native", "layout", "element"] as const) {
    it.effect(`fails promptly during ${preparation} capture preparation or dispatch`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(preparation === "layout")
        const reader = yield* h.page.control
        const pending = yield* Effect.forkScoped(
          reader.screenshot(
            preparation === "layout"
              ? { area: { _tag: "FullPage" } }
              : preparation === "element"
              ? { area: { _tag: "Element", locator: reader.locator("main") } }
              : undefined
          ).pipe(Effect.flip)
        )
        yield* Queue.take(preparation !== "native" ? h.preparation : h.captures)
        yield* h.browser.receive(replacementEvent())
        yield* h.barrier
        yield* TestClock.adjust("0 millis")
        assert.isDefined(pending.pollUnsafe(), "capture must fail on commit without advancing its deadline")
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "PageError")
        if (error._tag === "PageError") {
          assert.strictEqual(error.reason._tag, "CaptureInvalidated")
          if (error.reason._tag === "CaptureInvalidated") {
            const documents = h.facts.filter((fact) => fact._tag === "DocumentCommitted")
            assert.deepStrictEqual([error.reason.document, error.reason.replacement], [
              documents.at(-2)?.document,
              documents.at(-1)?.document
            ])
          }
        }
        if (preparation !== "native") assert.strictEqual(yield* Queue.size(h.captures), 0)
      }).pipe(onTestClock))
  }

  it.effect("keeps a native reply received before replacement terminal", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot())
      const command = yield* Queue.take(h.captures)
      yield* replyCapture(h.browser, command)
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
    }).pipe(onTestClock))

  for (const errorReply of [false, true]) {
    it.effect(`keeps an earlier native ${errorReply ? "error" : "success"} receipt while background cleanup is pending`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(Effect.exit(page.screenshot({ omitBackground: true })))
        const command = yield* Queue.take(h.captures)
        yield* h.browser.receive({
          id: command.id,
          sessionId: command.sessionId,
          ...(errorReply ? { error: { code: -32000, message: "capture failed" } } : { result: { data: "AA==" } })
        })
        const cleanup = yield* Queue.take(h.preparation)
        yield* h.browser.receive(replacementEvent())
        yield* h.barrier
        yield* h.browser.receive({ id: cleanup.id, sessionId: cleanup.sessionId, result: {} })
        const exit = yield* Fiber.join(pending)
        if (errorReply) {
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          assert.strictEqual(error.value._tag, "PageError")
          if (error.value._tag === "PageError") assert.strictEqual(error.value.reason._tag, "BackendFailure")
        } else {
          assert(Exit.isSuccess(exit))
          assert.deepStrictEqual(Array.from(exit.value), [0])
        }
      }).pipe(onTestClock))
  }

  it.effect("keeps a native error reply received before replacement terminal", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive({
        id: command.id,
        sessionId: command.sessionId,
        error: { code: -32000, message: "capture failed" }
      })
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "BackendFailure")
    }).pipe(onTestClock))

  it.effect("invalidates when replacement was received before a native error reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive(replacementEvent())
      yield* h.browser.receive({
        id: command.id,
        sessionId: command.sessionId,
        error: { code: -32000, message: "capture failed" }
      })
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  it.effect("keeps a page crash as TargetGone instead of capture invalidation", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      yield* h.browser.receive({ method: "Inspector.targetCrashed", sessionId: "S1", params: {} })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "TargetGone")
      if (error._tag === "TargetGone") assert.strictEqual(error.reason._tag, "PageCrashed")
    }).pipe(onTestClock))

  it.effect("invalidates when commit was received before the native reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const command = yield* Queue.take(h.captures)
      yield* h.browser.receive(replacementEvent())
      yield* replyCapture(h.browser, command)
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
      // A late reply and the old guard cannot affect a subsequent caller.
      const next = yield* Effect.forkScoped(page.screenshot())
      yield* replyCapture(h.browser, yield* Queue.take(h.captures))
      assert.deepStrictEqual(Array.from(yield* Fiber.join(next)), [0])
    }).pipe(onTestClock))

  for (const method of ["Page.navigatedWithinDocument", "Page.frameStartedLoading", "Page.frameStoppedLoading"]) {
    it.effect(`does not invalidate for ${method}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders()
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot())
        const command = yield* Queue.take(h.captures)
        yield* h.browser.receive({
          sessionId: "S1",
          method,
          params: {
            frameId: "76F3487A52CF4F79FE4AD28961E44D32",
            url: "about:blank#hash",
            navigationType: "fragment"
          }
        })
        yield* h.barrier
        assert.isUndefined(pending.pollUnsafe())
        yield* replyCapture(h.browser, command)
        assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
      }).pipe(onTestClock))
  }

  it.effect("does not invalidate for a committed child-frame replacement", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot())
      const command = yield* Queue.take(h.captures)
      const event = replacementEvent()
      yield* h.browser.receive({
        ...event,
        params: { frame: { ...event.params.frame, id: "child", parentId: event.params.frame.id } }
      })
      yield* h.barrier
      assert.isUndefined(pending.pollUnsafe())
      yield* replyCapture(h.browser, command)
      assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
    }).pipe(onTestClock))

  it.effect("invalidates a same-URL reload with a new document identity", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      const event = replacementEvent()
      yield* h.browser.receive({ ...event, params: { frame: { ...event.params.frame, url: "about:blank" } } })
      yield* h.barrier
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  it.effect("retains the native session-ended error instead of reporting document invalidation", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      yield* Queue.take(h.captures)
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "BackendFailure")
    }).pipe(onTestClock))

  it.effect("retains an already expired deadline across later replacement", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Deadline.within("1 second"), Effect.flip))
      yield* Queue.take(h.captures)
      yield* TestClock.adjust("1 second")
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "Timeout")
      yield* h.browser.receive(replacementEvent())
      yield* h.barrier
      const next = yield* Effect.forkScoped(page.screenshot())
      yield* replyCapture(h.browser, yield* Queue.take(h.captures))
      assert.deepStrictEqual(Array.from(yield* Fiber.join(next)), [0])
    }).pipe(onTestClock))
})

describe("Chromium screenshot renderer readiness", () => {
  it.effect("invalidates when replacement was received before a metrics error reply", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
      const readiness = yield* Queue.take(h.preparation)
      yield* h.browser.receive(replacementEvent())
      yield* h.browser.receive({
        id: readiness.id,
        sessionId: readiness.sessionId,
        error: { code: -32000, message: "renderer metrics failed" }
      })
      const error = yield* Fiber.join(pending)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") assert.strictEqual(error.reason._tag, "CaptureInvalidated")
    }).pipe(onTestClock))

  for (const replace of [false, true]) {
    it.effect(`handles a malformed metrics reply ${replace ? "after replacement" : "without replacement"}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot().pipe(Effect.flip))
        const readiness = yield* Queue.take(h.preparation)
        if (replace) yield* h.browser.receive(replacementEvent())
        yield* h.browser.receive({ id: readiness.id, sessionId: readiness.sessionId, result: {} })
        const error = yield* Fiber.join(pending)
        assert.strictEqual(error._tag, "PageError")
        if (error._tag === "PageError") {
          assert.strictEqual(error.reason._tag, replace ? "CaptureInvalidated" : "BackendFailure")
          if (error.reason._tag === "BackendFailure") {
            assert.strictEqual(error.reason.kind, "IncompatibleResponse")
            assert.strictEqual(error.reason.method, "Page.getLayoutMetrics")
          }
        }
        assert.strictEqual(yield* Queue.size(h.captures), 0)
      }).pipe(onTestClock))
  }

  for (const sizing of ["viewport", "fullPage", "css", "fullPageCss"] as const) {
    it.effect(`reads metrics once before ${sizing} capture and reuses sizing`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(page.screenshot({
          ...(sizing === "fullPage" || sizing === "fullPageCss" ? { area: { _tag: "FullPage" as const } } : {}),
          scale: sizing === "css" || sizing === "fullPageCss" ? "css" : "device"
        }))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics", "renderer metrics must precede capture")
        assert.strictEqual(yield* Queue.size(h.captures), 0)
        const readiness = yield* Queue.take(h.preparation)
        assert.strictEqual(readiness.method, "Page.getLayoutMetrics")
        yield* replyMetrics(h.browser, readiness)
        const capture = yield* Queue.take(h.captures)
        const clip = sizing === "viewport" ? undefined : sizing === "css"
          ? { x: 10, y: 20, width: 800, height: 600, scale: 0.5 }
          : { x: 0, y: 0, width: 900, height: 1800, scale: sizing === "fullPageCss" ? 0.5 : 1 }
        assert.deepStrictEqual(capture.params?.clip, clip)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.getLayoutMetrics").length, 1)
        yield* replyCapture(h.browser, capture)
        assert.deepStrictEqual(Array.from(yield* Fiber.join(pending)), [0])
      }).pipe(onTestClock))
  }

  for (const terminal of ["timeout", "interrupt", "close", "replace", "reject"] as const) {
    it.effect(`prevents dispatch after readiness ${terminal}, including a late metrics reply`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const pending = yield* Effect.forkScoped(Effect.exit(page.screenshot().pipe(Deadline.within("1 second"))))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics", "viewport capture must await renderer readiness")
        const readiness = yield* Queue.take(h.preparation)
        if (terminal === "timeout") yield* TestClock.adjust("1 second")
        if (terminal === "interrupt") yield* Fiber.interrupt(pending)
        if (terminal === "close") {
          yield* h.browser.receive({
            method: "Target.detachedFromTarget",
            params: {
              sessionId: "S1",
              targetId: "76F3487A52CF4F79FE4AD28961E44D32"
            }
          })
        }
        if (terminal === "replace") {
          yield* h.browser.receive(replacementEvent())
          // Queue the reply immediately behind the commit: dispatch must drain observed events.
          yield* replyMetrics(h.browser, readiness)
        }
        if (terminal === "reject") {
          yield* h.browser.receive({
            id: readiness.id,
            sessionId: readiness.sessionId,
            error: { code: -32000, message: "renderer metrics failed" }
          })
        }
        if (terminal !== "interrupt") {
          const exit = yield* Fiber.join(pending)
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          if (terminal === "timeout") {
            assert(Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.operation, "Page.screenshot")
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          } else {
            assert.strictEqual(error.value._tag, "PageError")
            if (error.value._tag === "PageError") {
              assert.strictEqual(
                error.value.reason._tag,
                terminal === "replace" ? "CaptureInvalidated" : "BackendFailure"
              )
              if (terminal === "reject" && error.value.reason._tag === "BackendFailure") {
                assert.strictEqual(error.value.reason.kind, "Rejected")
                assert.strictEqual(error.value.reason.method, "Page.getLayoutMetrics")
                assert.include(error.value.reason.hint, "renderer metrics failed")
              }
            }
          }
        }
        yield* replyMetrics(h.browser, readiness)
        yield* h.browser.delivered
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(yield* Queue.size(h.captures), 0, "late readiness must never resume capture")
      }).pipe(onTestClock))
  }
})

describe("Chromium screencast renderer readiness", () => {
  it.effect("holds start until one valid metrics reply, then acknowledges frames and stops normally", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const closedFrames = yield* Effect.scoped(Effect.gen(function*() {
        const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics")
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
        yield* replyMetrics(h.browser, first)
        const acquired = yield* Fiber.join(pending)
        const collecting = yield* Effect.forkScoped(acquired.frames.pipe(Stream.take(1), Stream.runCollect))
        yield* h.browser.receive({
          method: "Page.screencastFrame",
          sessionId: "S1",
          params: {
            data: "/9j/2Q==",
            sessionId: 7,
            metadata: {
              offsetTop: 0,
              pageScaleFactor: 1,
              deviceWidth: 800,
              deviceHeight: 600,
              scrollOffsetX: 0,
              scrollOffsetY: 0
            }
          }
        })
        assert.strictEqual((yield* Fiber.join(collecting)).length, 1)
        return acquired.frames
      }))
      assert.deepStrictEqual(yield* Stream.runCollect(closedFrames), [], "caller scope closes the frame subscription")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.getLayoutMetrics").length, 1)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      assert.deepStrictEqual(h.commands.find((c) => c.method === "Page.screencastFrameAck")?.params, { sessionId: 7 })
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("spends the same acquisition deadline on metrics and start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(Effect.exit(
        page.capability(Capability.Screencast).pipe(
          Deadline.within("1 second")
        )
      ))
      const first = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(first.method, "Page.getLayoutMetrics")
      yield* TestClock.adjust("750 millis")
      yield* replyMetrics(h.browser, first)
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.startScreencast")
      yield* TestClock.adjust("250 millis")
      const exit = yield* Fiber.join(pending)
      assert(Exit.isFailure(exit))
      const error = Exit.findErrorOption(exit)
      assert(Option.isSome(error) && Deadline.isTimeout(error.value))
      assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
    }).pipe(onTestClock))

  for (const terminal of ["interrupt", "timeout"] as const) {
    for (const replyAt of ["before scope close", "after scope close"] as const) {
      it.effect(`releases a late successful start after ${terminal}, reply ${replyAt}`, () =>
        Effect.gen(function*() {
          const h = yield* sentHeaders(false, true)
          const page = yield* h.page.control
          const scope = yield* Scope.make()
          const pending = yield* Effect.forkScoped(Effect.exit(
            page.capability(Capability.Screencast).pipe(
              Deadline.within("1 second"),
              Effect.provideService(Scope.Scope, scope)
            )
          ))
          assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
          const start = yield* Queue.take(h.screenshotWork)
          assert.strictEqual(start.method, "Page.startScreencast")
          if (terminal === "interrupt") yield* Fiber.interrupt(pending)
          else {
            yield* TestClock.adjust("1 second")
            const exit = yield* Fiber.join(pending)
            const error = Exit.findErrorOption(exit)
            assert(Option.isSome(error) && Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          }
          if (replyAt === "after scope close") yield* Scope.close(scope, Exit.void)
          yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
          yield* h.browser.delivered
          yield* TestClock.adjust("0 millis")
          if (replyAt === "before scope close") yield* Scope.close(scope, Exit.void)
          yield* TestClock.adjust("0 millis")
          assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 2)
        }).pipe(onTestClock))
    }
  }

  it.effect("waits for stop confirmation when the acquisition deadline expired before scope closure", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(
        Deadline.within("1 second"),
        Effect.provideService(Scope.Scope, scope)
      )
      yield* TestClock.adjust("2 seconds")
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
      const stop = yield* Queue.take(h.stops)
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(closing.pollUnsafe(), "cleanup must wait for the held stop reply")
      const deadline = h.stopDeadlines[0]!
      const now = (yield* BrowserClock.CurrentClock).now()
      assert(Option.isNone(deadline) || deadline.value > now, "cleanup command deadline must still be usable")
      yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      yield* Fiber.join(closing)
    }).pipe(onTestClock))

  it.effect("stops exactly once when interruption follows start reply delivery", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, scope)
        )
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* Fiber.interrupt(pending)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("does not add cleanup when an abandoned start is later rejected", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, scope)
        )
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      yield* h.browser.receive({
        id: start.id,
        sessionId: start.sessionId,
        error: { code: -32000, message: "start rejected" }
      })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("bounds unresponsive stop confirmation independently of acquisition", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(
        Deadline.within("1 second"),
        Effect.provideService(Scope.Scope, scope)
      )
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void))
      yield* Queue.take(h.stops)
      yield* TestClock.adjust("0 millis")
      assert.isUndefined(closing.pollUnsafe())
      yield* TestClock.adjust("1 second")
      yield* Fiber.join(closing)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("closing the acquisition scope interrupts a pending metrics read before any start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      const metrics = yield* Queue.take(h.screenshotWork)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      const closedExit = acquiring.pollUnsafe()
      yield* replyMetrics(h.browser, metrics)
      yield* Fiber.await(acquiring)
      yield* TestClock.adjust("1 second")
      assert.isDefined(closedExit, "scope closure must interrupt acquisition without waiting for a metrics reply")
      assert(Exit.hasInterrupts(closedExit!))
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  it.effect("closing the acquisition scope cancels a blocked start write before cleanup can be overtaken", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.startWrites)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      const closedExit = acquiring.pollUnsafe()
      yield* TestClock.adjust("1 second")
      yield* Deferred.succeed(h.startWriteGate, undefined)
      yield* Fiber.await(acquiring)
      yield* TestClock.adjust("0 millis")
      assert.isDefined(closedExit, "scope closure must interrupt acquisition without waiting for the blocked write")
      assert(Exit.hasInterrupts(closedExit!))
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.startScreencast").length,
        0,
        "a canceled write must not dispatch start after its cleanup"
      )
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("bounds a blocked stop write and lets a new acquisition proceed afterward", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      yield* Queue.take(h.stopWrites)
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, second)
        )
      )
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      yield* TestClock.adjust("0 millis")
      const startsBeforeBudget = h.commands.filter((c) => c.method === "Page.startScreencast").length
      const earlyClose = closing.pollUnsafe()
      yield* TestClock.adjust("1 second")
      const boundedClose = closing.pollUnsafe()
      // Release the gate before asserting, so a regression cannot strand the test's closing fiber.
      yield* Deferred.succeed(h.stopWriteGate, undefined)
      yield* TestClock.adjust("0 millis")
      yield* Fiber.join(closing)
      yield* Fiber.join(acquiring)
      const stopsBeforeLastRelease = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* Scope.close(second, Exit.void)
      assert.isDefined(boundedClose, "the whole stop exchange, including its write, must be bounded")
      assert.strictEqual(startsBeforeBudget, 1, "a new start must wait for the previous stop exchange")
      assert.isUndefined(earlyClose)
      assert.strictEqual(stopsBeforeLastRelease, 0, "releasing the write gate cannot resurrect the canceled stop")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("interrupts acquisition promptly while a stop write is blocked without retaining ownership", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      yield* Queue.take(h.stopWrites)
      const acquiring = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      // This must finish before advancing time or releasing the blocked write.
      yield* Fiber.interrupt(acquiring)
      yield* TestClock.adjust("1 second")
      const boundedClose = closing.pollUnsafe()
      yield* Deferred.succeed(h.stopWriteGate, undefined)
      yield* Fiber.join(closing)
      yield* TestClock.adjust("1 second")
      assert.isDefined(boundedClose)
      assert.strictEqual(h.stopDeadlines.length, 1, "a canceled waiter never dispatched start and needs no later stop")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("waits for an in-flight stop confirmation before dispatching a newer start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const closing = yield* Effect.forkScoped(Scope.close(first, Exit.void))
      const stop = yield* Queue.take(h.stops)
      const acquiring = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(
          Effect.provideService(Scope.Scope, second)
        )
      )
      yield* Queue.take(h.screenshotWork)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      yield* Fiber.join(closing)
      yield* Fiber.join(acquiring)
      const closingSecond = yield* Effect.forkScoped(Scope.close(second, Exit.void))
      const finalStop = yield* Queue.take(h.stops)
      yield* h.browser.receive({ id: finalStop.id, sessionId: finalStop.sessionId, result: {} })
      yield* Fiber.join(closingSecond)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 2)
    }).pipe(onTestClock))

  it.effect("releases an abandoned start with no reply without retaining a consumer count", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("cleans a late successful start observed during an earlier unconfirmed cleanup exchange", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      const uncertainStop = yield* Queue.take(h.stops)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* h.browser.receive({ id: uncertainStop.id, sessionId: uncertainStop.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      const stops = h.commands.filter((c) => c.method === "Page.stopScreencast")
      // Settle all held commands before asserting, including when this regresses to just one stop.
      for (const stop of stops.slice(1)) {
        yield* h.browser.receive({ id: stop.id, sessionId: stop.sessionId, result: {} })
      }
      yield* h.browser.delivered
      assert.strictEqual(stops.length, 2, "new success evidence during cleanup needs release after that exchange")
    }).pipe(onTestClock))

  it.effect("does not repeat cleanup of an unconfirmed start already covered by the last consumer's stop", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      yield* Queue.take(h.screenshotWork)
      const scope = yield* Scope.make()
      const b = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* Fiber.join(b)
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("drops an abandoned start on detach without scheduling further cleanup", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const pending = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(pending)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  for (const interruptAt of ["receipt", "consumed"] as const) {
    it.effect(`owns stop before interruption at start reply ${interruptAt}`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(false, true)
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        let replies = 0
        let interrupt: () => void = () => {}
        const pending = yield* Effect.forkScoped(Effect.withFiber((fiber) => {
          interrupt = () => fiber.interruptUnsafe()
          return page.capability(Capability.Screencast).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.provideService(ProtocolClient.ReplyReceived, () => {
              if (++replies === 2 && interruptAt === "receipt") interrupt()
            }),
            Effect.tap(() => interruptAt === "consumed" ? Effect.sync(interrupt) : Effect.void)
          )
        }))
        yield* Queue.take(h.screenshotWork)
        const start = yield* Queue.take(h.screenshotWork)
        yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
        yield* Fiber.await(pending)
        yield* Scope.close(scope, Exit.void)
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(
          h.commands.filter((c) => c.method === "Page.stopScreencast").length,
          interruptAt === "receipt" ? 2 : 1
        )
      }).pipe(onTestClock))
  }

  it.effect("retains the stream during another consumer's metrics read and releases it if that read fails", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const a = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      )
      yield* replyMetrics(h.browser, yield* Queue.take(h.screenshotWork))
      yield* Queue.take(h.screenshotWork)
      yield* Fiber.join(a)
      const b = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second)))
      )
      const read = yield* Queue.take(h.screenshotWork)
      yield* Scope.close(first, Exit.void)
      const prematureStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* h.browser.receive({
        id: read.id,
        sessionId: read.sessionId,
        error: { code: -32000, message: "metrics rejected" }
      })
      assert(Exit.isFailure(yield* Fiber.join(b)))
      yield* Scope.close(second, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(prematureStops, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("preserves a live consumer when an overlapping pending start is rejected", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      const a = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      )
      yield* Queue.take(h.screenshotWork)
      const startA = yield* Queue.take(h.screenshotWork)
      const b = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second)))
      )
      yield* Queue.take(h.screenshotWork)
      const startB = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({ id: startA.id, sessionId: startA.sessionId, result: {} })
      yield* Fiber.join(a)
      yield* h.browser.receive({
        id: startB.id,
        sessionId: startB.sessionId,
        error: { code: -32000, message: "rejected" }
      })
      assert(Exit.isFailure(yield* Fiber.join(b)))
      yield* Scope.close(second, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
      yield* Scope.close(first, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("requires a native start outcome before joining an abandoned start whose reply never arrived", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(true, true)
      const page = yield* h.page.control
      const a = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      yield* replyMetrics(h.browser, yield* Queue.take(h.screenshotWork))
      yield* Queue.take(h.screenshotWork)
      const scope = yield* Scope.make()
      const b = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      const metrics = yield* Queue.take(h.screenshotWork)
      yield* Fiber.interrupt(a)
      yield* replyMetrics(h.browser, metrics)
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      const starts = h.commands.filter((c) => c.method === "Page.startScreencast")
      if (starts.length > 1) {
        const start = starts[1]!
        yield* h.browser.receive({
          id: start.id,
          sessionId: start.sessionId,
          error: { code: -32000, message: "Screencast is already active" }
        })
      }
      yield* Fiber.join(b)
      yield* Scope.close(scope, Exit.void)
      assert.strictEqual(starts.length, 2, "an unconfirmed stream cannot be reused without native evidence")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("joins a confirmed session stream without sending another native start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
      yield* Scope.close(first, Exit.void)
      const earlyStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      yield* Scope.close(second, Exit.void)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 1)
      assert.strictEqual(earlyStops, 0)
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  for (const previous of ["pending", "abandoned"] as const) {
    it.effect(`joins the native already-active stream of an earlier ${previous} start`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(false, true)
        const page = yield* h.page.control
        const first = yield* Scope.make()
        const second = yield* Scope.make()
        const a = yield* Effect.forkScoped(
          page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
        )
        yield* Queue.take(h.screenshotWork)
        const startA = yield* Queue.take(h.screenshotWork)
        const b = yield* Effect.forkScoped(
          page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
        )
        yield* Queue.take(h.screenshotWork)
        const startB = yield* Queue.take(h.screenshotWork)
        if (previous === "abandoned") yield* Fiber.interrupt(a)
        yield* h.browser.receive({
          id: startB.id,
          sessionId: startB.sessionId,
          error: { code: -32000, message: "Screencast is already active" }
        })
        yield* Fiber.join(b)
        yield* h.browser.receive({ id: startA.id, sessionId: startA.sessionId, result: {} })
        if (previous === "pending") yield* Fiber.join(a)
        yield* Scope.close(first, Exit.void)
        yield* TestClock.adjust("0 millis")
        const earlyStops = h.commands.filter((c) => c.method === "Page.stopScreencast").length
        yield* Scope.close(second, Exit.void)
        assert.strictEqual(earlyStops, 0)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
      }).pipe(onTestClock))
  }

  it.effect("preserves already-active rejection when this session has no earlier owned start", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const acquiring = yield* Effect.forkScoped(
        Effect.exit(page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope)))
      )
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      yield* h.browser.receive({
        id: start.id,
        sessionId: start.sessionId,
        error: { code: -32000, message: "Screencast is already active" }
      })
      const error = Exit.findErrorOption(yield* Fiber.join(acquiring))
      assert(Option.isSome(error) && Capability.isCapabilityError(error.value))
      assert.strictEqual(error.value.reason._tag, "BackendFailure")
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("1 second")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  // Page.stopScreencast is parameterless and session-wide, so a stop for one acquisition also ends another's frames.
  it.effect("keeps a newer acquisition streaming when an abandoned start succeeds late", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const abandoned = yield* Effect.forkScoped(page.capability(Capability.Screencast))
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      const first = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(first.method, "Page.startScreencast")
      yield* Fiber.interrupt(abandoned)
      yield* TestClock.adjust("0 millis")
      const beforeRetry = h.commands.filter((c) => c.method === "Page.stopScreencast").length
      assert.strictEqual(beforeRetry, 1, "abandonment cleans uncertainty before a future consumer exists")

      const scope = yield* Scope.make()
      const retry = yield* Effect.forkScoped(
        page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, scope))
      )
      assert.strictEqual((yield* Queue.take(h.screenshotWork)).method, "Page.getLayoutMetrics")
      const second = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(second.method, "Page.startScreencast")

      // Chromium replies in order: the abandoned start first, once the retry's start is already sent
      yield* h.browser.receive({ id: first.id, sessionId: first.sessionId, result: {} })
      yield* h.browser.receive({ id: second.id, sessionId: second.sessionId, result: {} })
      yield* h.browser.delivered
      yield* Fiber.join(retry)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.stopScreencast").length,
        beforeRetry,
        "the retry's scope is open, so nothing may stop the session's screencast"
      )

      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, beforeRetry + 1)
    }).pipe(onTestClock))

  it.effect("keeps a second acquisition streaming when the first one's scope closes", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders()
      const page = yield* h.page.control
      const first = yield* Scope.make()
      const second = yield* Scope.make()
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, first))
      yield* page.capability(Capability.Screencast).pipe(Effect.provideService(Scope.Scope, second))
      yield* Scope.close(first, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(
        h.commands.filter((c) => c.method === "Page.stopScreencast").length,
        0,
        "the second scope is open, so nothing may stop the session's screencast"
      )
      yield* Scope.close(second, Exit.void)
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 1)
    }).pipe(onTestClock))

  it.effect("settles a dispatched start on session loss and closes its scope", () =>
    Effect.gen(function*() {
      const h = yield* sentHeaders(false, true)
      const page = yield* h.page.control
      const scope = yield* Scope.make()
      const pending = yield* Effect.forkScoped(Effect.exit(
        page.capability(Capability.Screencast).pipe(
          Deadline.within("1 second"),
          Effect.provideService(Scope.Scope, scope)
        )
      ))
      yield* Queue.take(h.screenshotWork)
      const start = yield* Queue.take(h.screenshotWork)
      assert.strictEqual(start.method, "Page.startScreencast")
      yield* h.browser.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
      })
      const error = Exit.findErrorOption(yield* Fiber.join(pending))
      assert(Option.isSome(error) && Capability.isCapabilityError(error.value))
      assert.strictEqual(error.value.reason._tag, "BackendFailure")
      yield* Scope.close(scope, Exit.void)
      yield* h.browser.receive({ id: start.id, sessionId: start.sessionId, result: {} })
      yield* h.browser.delivered
      yield* TestClock.adjust("0 millis")
      assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
    }).pipe(onTestClock))

  for (const terminal of ["reject", "malformed", "detach", "deadline", "interrupt"] as const) {
    it.effect(`prevents start after metrics ${terminal} and a late reply, closing the caller scope`, () =>
      Effect.gen(function*() {
        const h = yield* sentHeaders(true)
        const page = yield* h.page.control
        const scope = yield* Scope.make()
        const pending = yield* Effect.forkScoped(Effect.exit(
          page.capability(Capability.Screencast).pipe(
            Deadline.within("1 second"),
            Effect.provideService(Scope.Scope, scope)
          )
        ))
        const first = yield* Queue.take(h.screenshotWork)
        assert.strictEqual(first.method, "Page.getLayoutMetrics")
        if (terminal === "deadline") yield* TestClock.adjust("1 second")
        if (terminal === "interrupt") yield* Fiber.interrupt(pending)
        if (terminal === "detach") {
          yield* h.browser.receive({
            method: "Target.detachedFromTarget",
            params: { sessionId: "S1", targetId: "76F3487A52CF4F79FE4AD28961E44D32" }
          })
        }
        if (terminal === "reject") {
          yield* h.browser.receive({
            id: first.id,
            sessionId: first.sessionId,
            error: { code: -32000, message: "renderer metrics failed" }
          })
        }
        if (terminal === "malformed") yield* h.browser.receive({ id: first.id, sessionId: first.sessionId, result: {} })
        if (terminal !== "interrupt") {
          const exit = yield* Fiber.join(pending)
          assert(Exit.isFailure(exit))
          const error = Exit.findErrorOption(exit)
          assert(Option.isSome(error))
          if (terminal === "deadline") {
            assert(Deadline.isTimeout(error.value))
            assert.strictEqual(error.value.phase, "dispatchedUnconfirmed")
          } else {
            assert(Capability.isCapabilityError(error.value))
            assert.strictEqual(error.value.reason._tag, "BackendFailure")
            if (error.value.reason._tag === "BackendFailure") {
              assert.strictEqual(error.value.reason.method, terminal === "detach" ? "unknown" : "Page.getLayoutMetrics")
              assert.strictEqual(
                error.value.reason.kind,
                terminal === "malformed" ? "IncompatibleResponse" : "Rejected"
              )
            }
          }
        }
        yield* Scope.close(scope, Exit.void)
        yield* replyMetrics(h.browser, first)
        yield* h.browser.delivered
        yield* TestClock.adjust("0 millis")
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.startScreencast").length, 0)
        assert.strictEqual(h.commands.filter((c) => c.method === "Page.stopScreencast").length, 0)
      }).pipe(onTestClock))
  }
})
