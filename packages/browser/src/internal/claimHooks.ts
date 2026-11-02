/** Experimental operations reach an existing browser without widening its ordinary interface. */
import type * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Browser from "../Browser.ts"
import type * as Deadline from "../Deadline.ts"
import type * as UserContext from "../UserContext.ts"
import type * as Runtime from "./runtime.ts"

export interface Hooks {
  readonly runtime: Runtime.Runtime
  readonly context: (
    options: UserContext.Options | undefined,
    mode: { readonly reclaimable: true } | { readonly context: UserContext.Id }
  ) => Effect.Effect<UserContext.UserContext, UserContext.UserContextError | Deadline.Timeout, Scope.Scope>
}
const browsers = new WeakMap<Browser.Browser, Hooks>()
export const register = (browser: Browser.Browser, hooks: Hooks): void => {
  browsers.set(browser, hooks)
}
export const get = (browser: Browser.Browser): Hooks => {
  const hooks = browsers.get(browser)
  if (hooks === undefined) throw new Error("Browser has no runtime")
  return hooks
}
