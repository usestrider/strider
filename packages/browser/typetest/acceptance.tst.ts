/**
 * The claims the acceptance scenarios make about their channels: an ordinary call site sees only Browser and
 * Scope, reads require nothing, and errors stay small and named.
 */
import type { Browser, Deadline, Locator, Page, Subscription, Target } from "@usestrider/browser"
import type { Effect, Scope } from "effect"
import { describe, expect, it } from "tstyche"
import type * as Acceptance from "../scenarios/acceptance.ts"

describe("requirements", () => {
  it("a program that starts from the Browser needs only Browser and Scope", () => {
    expect<Effect.Services<typeof Acceptance.loginOnce>>().type.toBe<Browser.Browser | Scope.Scope>()
  })

  it("a helper that takes a page needs only Scope, for its subscriptions", () => {
    expect<Effect.Services<ReturnType<typeof Acceptance.namedOutcome>>>().type.toBe<Scope.Scope>()
  })

  it("scopes closed inside don't leak out", () => {
    expect<Effect.Services<ReturnType<typeof Acceptance.concurrentPages>>>().type.toBe<Browser.Browser>()
  })

  it("history never waits and never subscribes", () => {
    expect<Effect.Services<ReturnType<typeof Acceptance.history>>>().type.toBe<never>()
  })
})

describe("errors", () => {
  it("a click and a navigation wait fail with their modules' errors, plus the cross-cutting two", () => {
    expect<Effect.Error<ReturnType<typeof Acceptance.namedOutcome>>>().type.toBe<
      | Subscription.SubscriptionError
      | Locator.LocatorError
      | Page.PageError
      | Target.TargetGone
      | Deadline.Timeout
    >()
  })
})
