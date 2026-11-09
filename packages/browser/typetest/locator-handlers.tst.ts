import type { Deadline, Declaration, Expect, Locator, Page, Target } from "@usestrider/browser"
import { Effect } from "effect"
import type * as Scope from "effect/Scope"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const readonlyPage: Page.ReadonlyPage
declare const locator: Locator.Locator
declare const readonlyLocator: Locator.ReadonlyLocator
declare const callback: (locator: Locator.Locator) => Effect.Effect<void, "callback error", "callback service">

describe("scoped locator handlers", () => {
  it("captures callback requirements without exporting callback errors into registration", () => {
    expect(page.addLocatorHandler(locator, callback)).type.toBe<
      Effect.Effect<
        Declaration.Registration,
        Page.PageError | Target.TargetGone | Deadline.Timeout,
        Scope.Scope | "callback service"
      >
    >()
    expect(page.addLocatorHandler(locator, callback, { times: 1, noWaitAfter: true })).type.not.toRaiseError()
    expect(readonlyPage.addLocatorHandler(locator, callback)).type.toRaiseError()
    expect(page.addLocatorHandler(readonlyLocator, callback)).type.toRaiseError()
  })
  it("includes callback timeouts in matcher and combinator error channels", () => {
    expect<Effect.Error<ReturnType<Expect.Matcher<Locator.ReadonlyLocator>>>>().type.toBe<
      Expect.ExpectationFailed | Target.TargetGone | Deadline.Timeout
    >()
  })
})
