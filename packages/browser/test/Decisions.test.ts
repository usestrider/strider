/** Decision constructors produce Effects whose results are ordinary, branded decisions. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Dialog, FileChooser, FileInput, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
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

describe("decision Effects", () => {
  it.effect("resolves every Route constructor to its wire decision", () =>
    Effect.gen(function*() {
      const cases = [
        [Route.continue, "Continue"],
        [Route.fallthrough, "Fallthrough"],
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

  for (const kind of ["alert", "confirm", "prompt", "beforeunload"] as const) {
    it.effect(`resolves every pending ${kind} decision and convenience handler`, () =>
      Effect.scoped(Effect.gen(function*() {
        const page = yield* Browser.newPage()
        const captured = yield* Deferred.make<Dialog.Pending>()
        const handler = yield* Dialog.handle(
          page,
          (pending) => Deferred.succeed(captured, pending).pipe(Effect.andThen(Dialog.dismissAll(pending)))
        )
        yield* TestClock.adjust("10 millis")
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
        assert.strictEqual(yield* handler.handled, 1)
      })).pipe(Effect.provide(Browser.layerTest(`-dialog(${kind})`))))
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
