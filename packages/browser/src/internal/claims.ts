/** Experimental claims: connection identity belongs to the adapter; ownership belongs to the model. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Browser from "../Browser.ts"
import type * as Deadline from "../Deadline.ts"
import type * as Reclaimed from "../experimental/Browser.ts"
import * as Claim from "../experimental/Claim.ts"
import * as PageClaim from "../experimental/Page.ts"
import * as ContextClaim from "../experimental/UserContext.ts"
import type * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import type * as UserContext from "../UserContext.ts"
import * as Access from "./access.ts"
import type * as Adapter from "./adapter.ts"
import * as Hooks from "./claimHooks.ts"
import * as Handles from "./handles.ts"
import * as Handoff from "./handoff.ts"
import * as Operation from "./operation.ts"

const Payload = Schema.Struct({
  backend: Schema.Literal("chromium"),
  browser: Schema.String,
  context: Schema.String,
  tab: Schema.optional(Schema.String)
})
const error = (operation: string, reason: Claim.ClaimError["reason"]) =>
  new Claim.ClaimError({ operation, reason, diagnostics: Operation.diagnosticsNow() })
const unsupported = (operation: string) =>
  error(
    operation,
    new Reason.Unsupported({
      capability: "claims",
      backend: "this connection",
      hint:
        "Claims require a Chromium browser WebSocket identity; Firefox and stock WebKit do not support direct recovery"
    })
  )
const gone = (operation: string) => error(operation, new Claim.Gone({ hint: "The claimed target no longer exists" }))
const notOwned = (operation: string) =>
  error(
    operation,
    new Reason.NotPermitted({ required: "control", hint: "Claims require ownership, not a control grant" })
  )
const mapAdapter = (operation: string, backend: string) => (failure: Adapter.AdapterError | Deadline.Timeout) => {
  const mapped = Operation.fromAdapter(failure, Operation.idNow(), backend)
  return mapped._tag === "Timeout"
    ? mapped.error
    : mapped._tag === "Gone"
    ? gone(operation)
    : error(operation, mapped.reason)
}
const decode = (operation: string, value: string) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(Payload)(JSON.parse(value)),
    catch: () =>
      error(
        operation,
        new Reason.InvalidInput({
          input: "claim",
          expected: "an encoded Chromium claim",
          hint: "The saved claim is malformed"
        })
      )
  })
const checkBrowser = (operation: string, claims: { readonly browser: string }, payload: typeof Payload.Type) =>
  claims.browser === payload.browser
    ? Effect.void
    : Effect.fail(
      error(operation, new Claim.OtherBrowser({ hint: "The claim belongs to a different Chromium browser" }))
    )

export const claimPage = Operation.fn("Page.claim")(function*(page: Page.Page) {
  const { runtime, entry, grant } = Handles.page(page)
  const claims = runtime.model.adapter.claims
  if (claims === undefined) return yield* Effect.fail(unsupported("Page.claim"))
  yield* Access.check(grant)
  const state = yield* entry.state.get
  if (state.status._tag === "Closed") return yield* Effect.fail(gone("Page.claim"))
  if (Option.isNone(state.owner)) return yield* Effect.fail(notOwned("Page.claim"))
  const identity = yield* claims.page(entry.id).pipe(Effect.mapError(mapAdapter("Page.claim", runtime.backend)))
  Handoff.allow(state.owner.value)
  return PageClaim.Claim.make(JSON.stringify({ backend: "chromium", ...identity }))
})

export const claimUserContext = Operation.fn("UserContext.claim")(function*(context: UserContext.UserContext) {
  const { behind: { runtime, entry, grant } } = Handles.target(context)
  // Narrow the handle through the context branch; pages are not accepted by this signature.
  if (!("isDefault" in entry)) return yield* Effect.die(new Error("Expected a context"))
  const claims = runtime.model.adapter.claims
  if (claims === undefined) return yield* Effect.fail(unsupported("UserContext.claim"))
  yield* Access.check(grant)
  const state = yield* entry.state.get
  if (Option.isSome(state.closed)) return yield* Effect.fail(gone("UserContext.claim"))
  if (entry.isDefault || !state.settings.owned || Option.isSome(grant)) {
    return yield* Effect.fail(notOwned("UserContext.claim"))
  }
  const identity = yield* claims.context(entry.id).pipe(
    Effect.mapError(mapAdapter("UserContext.claim", runtime.backend))
  )
  return ContextClaim.Claim.make(JSON.stringify({ backend: "chromium", browser: claims.browser, context: identity }))
})

export const createContext = Operation.fn("UserContext.createReclaimable")(
  function*(options: UserContext.Options & { readonly reclaimable: true }) {
    const hooks = Hooks.get(yield* Browser.Browser)
    if (hooks.runtime.model.adapter.claims === undefined) {
      return yield* Effect.fail(unsupported("UserContext.createReclaimable"))
    }
    return yield* hooks.context(options, { reclaimable: true })
  }
)

export const reclaimPage = Operation.fn("Browser.reclaim")(function*(claim: PageClaim.Claim) {
  const { runtime } = Hooks.get(yield* Browser.Browser)
  const claims = runtime.model.adapter.claims
  if (claims === undefined) return yield* Effect.fail(unsupported("Browser.reclaim"))
  const payload = yield* decode("Browser.reclaim", claim)
  yield* checkBrowser("Browser.reclaim", claims, payload)
  if (payload.tab === undefined) return yield* Effect.fail(gone("Browser.reclaim"))
  const id = yield* claims.findPage({ ...payload, tab: payload.tab }).pipe(
    Effect.mapError(mapAdapter("Browser.reclaim", runtime.backend))
  )
  if (id === undefined) return yield* Effect.fail(gone("Browser.reclaim"))
  const entry = runtime.model.page(id)
  if (Option.isNone(entry)) return yield* Effect.fail(gone("Browser.reclaim"))
  // Observe first: a failed observation must not acquire close-on-exit ownership of somebody else's tab.
  const found: Reclaimed.Found = {
    dialogs: yield* claims.dialogs(id).pipe(Effect.mapError(mapAdapter("Browser.reclaim", runtime.backend)))
  }
  const scope = yield* Effect.scope
  yield* runtime.model.transfer(id, scope).pipe(Effect.uninterruptible)
  Handoff.allow(scope)
  const page = Option.getOrThrow(runtime.page(entry.value))
  return { page, found } satisfies Reclaimed.Reclaimed
})

export const reclaimContext = Operation.fn("UserContext.reclaim")(
  function*(claim: ContextClaim.Claim, options?: UserContext.Options) {
    const hooks = Hooks.get(yield* Browser.Browser)
    const { runtime } = hooks
    const claims = runtime.model.adapter.claims
    if (claims === undefined) return yield* Effect.fail(unsupported("UserContext.reclaim"))
    const payload = yield* decode("UserContext.reclaim", claim)
    yield* checkBrowser("UserContext.reclaim", claims, payload)
    const context = yield* claims.findContext(payload.context).pipe(
      Effect.mapError(mapAdapter("UserContext.reclaim", runtime.backend))
    )
    if (context === undefined) return yield* Effect.fail(gone("UserContext.reclaim"))
    return yield* hooks.context(options, { context })
  }
)
