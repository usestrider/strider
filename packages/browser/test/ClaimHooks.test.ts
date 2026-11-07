import { assert, it } from "@effect/vitest"
import type { Browser } from "@usestrider/browser"
import * as ClaimHooks from "../src/internal/claimHooks.ts"

it("retains experimental browser operations through a service decorator", () => {
  const browser = {} as Browser.Browser
  const hooks = {} as ClaimHooks.Hooks
  ClaimHooks.register(browser, hooks)
  const decorated = Object.create(browser) as Browser.Browser
  assert.strictEqual(ClaimHooks.get(decorated), hooks)
})
