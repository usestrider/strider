/** Test-only proposed ROOK-95 contract. Replace this bridge with static imports once approved and built. */
import type { Browser, Page, UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"

// Claims cross the process boundary as JSON; their representation is deliberately not inspected by these tests.
export type Claim = unknown
export interface Contract {
  readonly Page: {
    readonly claim: (page: Page.Page) => Effect.Effect<Claim, unknown>
  }
  readonly Browser: {
    readonly reclaim: (claim: Claim) => Effect.Effect<
      {
        readonly page: Page.Page
        readonly found: { readonly dialogs: ReadonlyArray<{ readonly message: string }> }
      },
      unknown,
      Browser.Browser | Scope.Scope
    >
  }
  readonly UserContext: {
    readonly create: (
      options: UserContext.Options & { readonly reclaimable: true }
    ) => Effect.Effect<UserContext.UserContext, unknown, Browser.Browser | Scope.Scope>
    readonly claim: (context: UserContext.UserContext) => Effect.Effect<Claim, unknown>
    readonly reclaim: (
      claim: Claim,
      options?: UserContext.Options
    ) => Effect.Effect<UserContext.UserContext, unknown, Browser.Browser | Scope.Scope>
  }
}

export const contract = Effect.promise(async () => {
  // A computed URL keeps the test-first commit type-checkable without declaring an unbuilt production API.
  const url = new URL("../../../src/experimental/index.ts", import.meta.url).href
  return await import(/* @vite-ignore */ url) as Contract
})

export const handoff = (scope: Scope.Scope) =>
  Effect.promise(async () => {
    const url = new URL("../../../src/internal/handoff.ts", import.meta.url).href
    const internal = await import(/* @vite-ignore */ url) as {
      readonly handoff: (scope: Scope.Scope) => Effect.Effect<void>
    }
    return internal.handoff(scope)
  }).pipe(Effect.flatten)
