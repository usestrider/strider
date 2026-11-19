/** Recording overlays cost nothing on a page that never acquires them. */
import { assert, it } from "@effect/vitest"
import { Browser, Capability } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Execution from "../src/internal/execution.ts"
import type { LocatorImpl } from "../src/internal/locator.ts"
import * as Overlays from "../src/internal/overlays.ts"

it.effect("leaves a page without overlays on the ordinary dispatch, with no navigation listener", () =>
  Effect.gen(function*() {
    const page = yield* Browser.newPage()
    const entry = (page.locator("body") as LocatorImpl).owner.page
    yield* page.goto("about:blank")
    assert.strictEqual(entry.execution, Execution.ordinary)
    assert.isFalse(Overlays.listening(entry))
    // The test backend paints nothing, so acquiring fails before anything is installed
    const error = yield* page.capability(Capability.Overlay).pipe(Effect.flip)
    assert.strictEqual(error._tag, "CapabilityError")
    if (error._tag === "CapabilityError") assert.strictEqual(error.reason._tag, "Unsupported")
    assert.strictEqual(entry.execution, Execution.ordinary)
    assert.isFalse(Overlays.listening(entry))
  }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
