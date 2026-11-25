/** Decision constructors produce Effects whose results are ordinary, branded decisions. */
import { assert, describe, it } from "@effect/vitest"
import {
  AutoResolution,
  Browser,
  Dialog,
  FileChooser,
  FileInput,
  NetworkRequest,
  Page,
  Route
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import { TestClock } from "effect/testing"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"
import * as Handles from "../src/internal/handles.ts"
import * as RouteDecision from "../src/internal/routeDecision.ts"

/** Observes the decisions sent by the real route fold to a deterministic adapter. */
const routed = (refuse: (decision: Adapter.Decision) => boolean = () => false) => {
  let send!: Adapter.Sink
  const calls: Array<Adapter.Decision> = []
  const done = Deferred.makeUnsafe<void>()
  const connection = BrowserImpl.layer((sink) => {
    send = sink
    return Fake.connect([], {
      info: new Browser.Info(Fake.info),
      capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
    })(sink).pipe(Effect.map((adapter) => ({
      ...adapter,
      resolve: (_obligation: Adapter.ObligationId, decision: Adapter.Decision) => {
        calls.push(decision)
        return refuse(decision)
          ? Effect.fail(
            new Adapter.AdapterError({
              reason: { _tag: "Unsupported", capability: "interception.continueUrl", hint: "refused by test adapter" }
            })
          )
          : Deferred.succeed(done, undefined).pipe(Effect.asVoid)
      }
    })))
  })
  const pause = Effect.fnUntraced(function*(page: Page.Page) {
    yield* send({
      _tag: "ObligationOpened",
      obligation: "request-contract" as Adapter.ObligationId,
      subject: {
        _tag: "PausedRequest",
        phase: "request",
        response: Option.none(),
        challenge: Option.none(),
        request: new NetworkRequest.NetworkRequest({
          hop: "Q1.0" as NetworkRequest.HopId,
          method: "GET",
          url: "https://example.com/original" as NetworkRequest.NetworkRequest["url"],
          headers: Headers.fromInput({ "x-one": "1", "x-two": "2" }),
          resourceType: "fetch",
          initiator: { _tag: "Document", navigable: Handles.page(page).entry.id, navigation: Option.none() },
          at: Adapter.now()
        })
      }
    })
    yield* Deferred.await(done)
    return calls
  })
  return { connection, pause }
}

describe("decision Effects", () => {
  it.effect("resolves every Route constructor to its wire decision", () =>
    Effect.gen(function*() {
      const cases = [
        [Route.continue, "Continue"],
        [Route.fallthrough, "Fallthrough"],
        [Route.fallthroughWith(HttpClientRequest.setHeader("x-test", "yes")), "FallthroughWith"],
        [Route.abort(), "Abort"],
        [Route.fulfill(HttpServerResponse.text("ok")), "Fulfill"],
        [Route.continueWith(HttpClientRequest.setHeader("x-test", "yes")), "ContinueWith"],
        [Route.continueWith({ status: 201 }), "ContinueResponse"],
        [Route.provideCredentials({ username: "user", password: Redacted.make("secret") }), "ProvideCredentials"]
      ] as const
      for (const [effect, tag] of cases) {
        assert.isTrue(Effect.isEffect(effect))
        const decision = yield* effect
        assert.isTrue(Route.isDecision(decision))
        assert.isFalse(Effect.isEffect(decision))
        assert.strictEqual(RouteDecision.data(decision)?._tag, tag)
      }
    }))

  for (
    const [label, change, expected] of [
      ["unchanged copied headers", HttpClientRequest.setHeaders({ "x-two": "2", "x-one": "1" }), undefined],
      ["changed header values", HttpClientRequest.setHeader("x-one", "changed"), { "x-one": "changed", "x-two": "2" }],
      ["removed headers", HttpClientRequest.removeHeader("x-one"), { "x-two": "2" }]
    ] as const
  ) {
    it.effect(`diffs ${label} against the paused request`, () => {
      const fixture = routed()
      return Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        yield* page.route("https://example.com/**", () => Route.continueWith(change))
        yield* page.route("https://example.com/**", () => Route.fallthroughWith((request) => request))
        const calls = yield* fixture.pause(page)
        assert.strictEqual(calls.length, 1)
        const decision = calls[0]!
        assert(decision._tag === "Continue")
        assert.deepStrictEqual(Option.getOrThrow(decision.overrides).headers, expected)
      })).pipe(Effect.provide(fixture.connection))
    })
  }

  for (const pendingRefused of [false, true]) {
    it.effect(`preserves pending changes after a refusal, with pending changes refused: ${pendingRefused}`, () => {
      const fixture = routed((decision) =>
        decision._tag === "Continue" && Option.isSome(decision.overrides) &&
        (pendingRefused || decision.overrides.value.url !== undefined)
      )
      return Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const missed = yield* page.route("https://example.com/miss", () => Route.abort())
        yield* page.route(
          "https://example.com/original",
          () => Route.continueWith(HttpClientRequest.setUrl("https://example.com/changed"))
        )
        yield* page.route(
          "https://example.com/original",
          () => Route.fallthroughWith(HttpClientRequest.setHeader("x-pending", "yes"))
        )
        const calls = yield* fixture.pause(page)
        assert.strictEqual(calls.length, pendingRefused ? 3 : 2)
        const retry = calls[1]!
        assert(retry._tag === "Continue")
        assert.deepStrictEqual(Option.getOrThrow(retry.overrides), {
          headers: { "x-one": "1", "x-two": "2", "x-pending": "yes" }
        })
        if (pendingRefused) assert.deepStrictEqual(calls[2], { _tag: "Continue", overrides: Option.none() })
        assert.strictEqual(yield* missed.hits, 0)
        assert.strictEqual((yield* AutoResolution.history(page)).entries.length, 1)
      })).pipe(Effect.provide(fixture.connection))
    })
  }

  it.effect("does not count or publish an automatic decision for unmatched routes", () => {
    const fixture = routed()
    return Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      const missed = yield* page.route("https://example.com/miss", () => Route.abort())
      assert.deepStrictEqual(yield* fixture.pause(page), [{ _tag: "Continue", overrides: Option.none() }])
      assert.strictEqual(yield* missed.hits, 0)
      assert.strictEqual((yield* AutoResolution.history(page)).entries.length, 0)
    })).pipe(Effect.provide(fixture.connection))
  })

  for (const kind of ["alert", "confirm", "prompt", "beforeunload", "unknown"] as const) {
    it.effect(`resolves every pending ${kind} decision and convenience handler`, () => {
      let send!: Adapter.Sink
      const connection = BrowserImpl.layer((sink) => {
        send = sink
        return Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink)
      })
      return Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const captured = yield* Deferred.make<Dialog.Pending>()
        const handler = yield* Dialog.handle(
          page,
          (pending) => Deferred.succeed(captured, pending).pipe(Effect.andThen(Dialog.dismissAll(pending)))
        )
        if (kind === "unknown") {
          yield* send({
            _tag: "ObligationOpened",
            obligation: "dialog-contract" as Adapter.ObligationId,
            subject: {
              _tag: "Prompt",
              prompt: "prompt-contract" as Dialog.PromptId,
              page: Handles.page(page).entry.id,
              kind,
              message: "question",
              defaultValue: "default"
            }
          })
          yield* Effect.yieldNow
        } else yield* TestClock.adjust("10 millis")
        const pending = yield* Deferred.await(captured)
        const effects = pending._tag === "BeforeUnload" ?
          [pending.leave, pending.stay]
          : pending._tag === "Alert" ?
          [pending.accept]
          : pending._tag === "Confirm" ?
          [pending.accept, pending.dismiss]
          : [pending.accept, pending.dismiss, pending.respond("answer")]
        for (const effect of effects) {
          assert.isTrue(Effect.isEffect(effect))
          assert.isTrue(Dialog.isDecision(yield* effect))
        }
        assert.isTrue(Dialog.isDecision(yield* Dialog.acceptAll(pending)))
        assert.isTrue(Dialog.isDecision(yield* Dialog.dismissAll(pending)))
        if (kind !== "unknown") assert.strictEqual(yield* handler.handled, 1)
      })).pipe(Effect.provide(kind === "unknown" ? connection : Browser.layerTest(`-dialog(${kind})`)))
    })
  }

  for (const multiple of [false, true]) {
    it.effect(`resolves selection and cancellation for a ${multiple ? "multiple" : "single"} chooser`, () => {
      let send!: Adapter.Sink
      const connection = BrowserImpl.layer((sink) => {
        send = sink
        return Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({
            entries: Fake.capabilities.map((entry) =>
              entry.name === "fileChooser" ? { ...entry, status: "supported", limitations: [] } : entry
            )
          })
        })(sink)
      })
      return Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const captured = yield* Deferred.make<FileChooser.Pending>()
        yield* FileChooser.handle(
          page,
          (pending) => Deferred.succeed(captured, pending).pipe(Effect.andThen(Effect.never))
        )
        yield* send({
          _tag: "ObligationOpened",
          obligation: "chooser-contract" as Adapter.ObligationId,
          subject: { _tag: "FileChooser", navigable: Handles.page(page).entry.id, multiple, element: Option.none() }
        })
        const pending = yield* Deferred.await(captured)
        const file = FileInput.local("/tmp/decision-contract")
        const select = pending._tag === "Single" ? pending.select(file) : pending.select([file])
        for (const effect of [select, pending.cancel, FileChooser.choose(file)(pending)]) {
          assert.isTrue(Effect.isEffect(effect))
          assert.isTrue(FileChooser.isDecision(yield* effect))
        }
      })).pipe(Effect.provide(connection))
    })
  }
})
