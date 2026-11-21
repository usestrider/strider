/**
 * Console calls (`ConsoleMessage.nextCall`, `streamCalls`) where the backend keeps no console arguments.
 */
import { assert, it } from "@effect/vitest"
import { Browser, ConsoleMessage } from "@usestrider/browser"
import * as Effect from "effect/Effect"

it.effect("refuses console calls where the backend keeps no console arguments", () =>
  Effect.scoped(Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const refusals = [
      yield* Effect.flip(ConsoleMessage.nextCall(page)),
      yield* Effect.flip(ConsoleMessage.streamCalls(page))
    ]
    for (const error of refusals) {
      if (error._tag !== "SubscriptionError") return assert.fail(`expected a SubscriptionError, got ${error._tag}`)
      assert.strictEqual(error.reason._tag, "Unsupported")
      assert.strictEqual(error.reason._tag === "Unsupported" ? error.reason.capability : "", "console.arguments")
    }
  })).pipe(Effect.provide(Browser.layerTest(""))))
