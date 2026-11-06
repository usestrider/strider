/** Runtime validation for JavaScript callers that bypass Locator's TypeScript contract. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, Locator } from "@usestrider/browser"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"

describe("Locator.fill", () => {
  for (
    const [label, value] of [
      ["number", 123],
      ["null", null],
      ["undefined", undefined],
      ["boolean", true],
      ["object", {}],
      ["Redacted number", Redacted.make(123)]
    ] as const
  ) {
    it.effect(`rejects ${label} before consulting the backend`, () =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        // The test backend has no DOM: reaching it would return Unsupported.
        const error = yield* page.locator("#field").fill(value as unknown as string).pipe(Effect.flip)
        assert(Locator.isLocatorError(error))
        assert.strictEqual(error.reason._tag, "InvalidInput")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }
})

describe("Locator.pressSequentially", () => {
  for (
    const [label, value] of [
      ["number", 123],
      ["null", null],
      ["undefined", undefined],
      ["boolean", true],
      ["object", {}],
      ["array", ["private-caller-value"]],
      ["Redacted number", Redacted.make(123)],
      ["Redacted null", Redacted.make(null)],
      ["Redacted object", Redacted.make({ secret: "private-caller-value" })],
      ["Redacted array", Redacted.make(["private-caller-value"])]
    ] as const
  ) {
    it.effect(`rejects ${label} before consulting the backend`, () =>
      Effect.gen(function*() {
        const page = yield* Browser.newPage()
        // Suspend also captures a synchronous caller-type exception as a defect.
        const result = yield* Effect.suspend(() => page.locator("#field").pressSequentially(value as unknown as string))
          .pipe(Effect.exit)
        const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
        assert(Option.isSome(error) && Locator.isLocatorError(error.value))
        assert.strictEqual(error.value.reason._tag, "InvalidInput")
        assert.notInclude(JSON.stringify(error.value), "private-caller-value")
      }).pipe(Effect.scoped, Effect.provide(Browser.layerTest(""))))
  }
})
