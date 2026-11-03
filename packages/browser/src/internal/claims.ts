/** Experimental claims: connection identity belongs to the adapter; ownership belongs to the model. */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
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
import * as BrowserClock from "./browserClock.ts"
import * as Hooks from "./claimHooks.ts"
import * as Handles from "./handles.ts"
import * as Handoff from "./handoff.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"

const identity = { backend: Schema.Literal("chromium"), browser: Schema.String, context: Schema.String }
const PagePayload = Schema.Struct({ ...identity, kind: Schema.Literal("page"), tab: Schema.String })
const ContextPayload = Schema.Struct({ ...identity, kind: Schema.Literal("context") })
const error = (operation: string, reason: Claim.ClaimError["reason"]) =>
  new Claim.ClaimError({ operation, reason, diagnostics: Operation.diagnosticsNow() })
const unsupported = (operation: string, backend: string) =>
  error(
    operation,
    new Reason.Unsupported({
      capability: "claims",
      backend,
      hint:
        "Claims require a Chromium browser WebSocket identity; Firefox and stock WebKit do not support direct recovery"
    })
  )
const gone = (operation: string) => error(operation, new Claim.Gone({ hint: "The claimed target no longer exists" }))
const notOwned = (operation: string) =>
  error(
    operation,
    new Reason.NotPermitted({
      required: "control",
      hint:
        "Claims require ownership in a reclaimable context or of a default-context page; control alone is insufficient"
    })
  )
const mapAdapter = (operation: string, backend: string) => (failure: Adapter.AdapterError | Deadline.Timeout) => {
  const mapped = Operation.fromAdapter(failure, Operation.idNow(), backend)
  return mapped._tag === "Timeout"
    ? mapped.error
    : mapped._tag === "Gone"
    ? gone(operation)
    : error(operation, mapped.reason)
}
const decode = <A>(operation: string, value: string, payload: Schema.Codec<A, unknown>) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(payload)(JSON.parse(value)),
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
const checkBrowser = (operation: string, claims: { readonly browser: string }, payload: { readonly browser: string }) =>
  claims.browser === payload.browser
    ? Effect.void
    : Effect.fail(
      error(operation, new Claim.OtherBrowser({ hint: "The claim belongs to a different Chromium browser" }))
    )

export const claimPage = Operation.fn("Page.claim")(function*(page: Page.Page) {
  const { runtime, entry, grant } = Handles.page(page)
  const claims = runtime.model.adapter.claims
  if (claims === undefined) return yield* Effect.fail(unsupported("Page.claim", runtime.backend))
  yield* Access.check(grant)
  const state = yield* entry.state.get
  if (state.status._tag === "Closed") return yield* Effect.fail(gone("Page.claim"))
  if (!entry.contextEntry.isDefault && !(yield* entry.contextEntry.state.get).settings.reclaimable) {
    return yield* Effect.fail(notOwned("Page.claim"))
  }
  if (Option.isNone(state.owner)) return yield* Effect.fail(notOwned("Page.claim"))
  const identity = yield* claims.page(entry.id).pipe(Effect.mapError(mapAdapter("Page.claim", runtime.backend)))
  Handoff.allow(state.owner.value)
  const claim = PageClaim.Claim.make(JSON.stringify({ backend: "chromium", kind: "page", ...identity }))
  yield* track(state.owner.value, claim, entry)
  return claim
})

export const claimUserContext = Operation.fn("UserContext.claim")(function*(context: UserContext.UserContext) {
  const { behind: { runtime, entry, grant } } = Handles.target(context)
  // Narrow the handle through the context branch; pages are not accepted by this signature.
  if (!("isDefault" in entry)) return yield* Effect.die(new Error("Expected a context"))
  const claims = runtime.model.adapter.claims
  if (claims === undefined) return yield* Effect.fail(unsupported("UserContext.claim", runtime.backend))
  yield* Access.check(grant)
  const state = yield* entry.state.get
  if (Option.isSome(state.closed)) return yield* Effect.fail(gone("UserContext.claim"))
  if (entry.isDefault || !state.settings.owned || !state.settings.reclaimable || Option.isSome(grant)) {
    return yield* Effect.fail(notOwned("UserContext.claim"))
  }
  const identity = yield* claims.context(entry.id).pipe(
    Effect.mapError(mapAdapter("UserContext.claim", runtime.backend))
  )
  const claim = ContextClaim.Claim.make(
    JSON.stringify({ backend: "chromium", kind: "context", browser: claims.browser, context: identity })
  )
  return yield* Effect.uninterruptible(Effect.gen(function*() {
    const owner = Handoff.contextOwner(entry)
    if (owner !== undefined) yield* trackContext(owner, claim, entry)
    return claim
  }))
})

export const createContext = Operation.fn("UserContext.createReclaimable")(
  function*(options: UserContext.Options & { readonly reclaimable: true }) {
    const hooks = Hooks.get(yield* Browser.Browser)
    if (hooks.runtime.model.adapter.claims === undefined) {
      return yield* Effect.fail(unsupported("UserContext.createReclaimable", hooks.runtime.backend))
    }
    return yield* hooks.context(options, { reclaimable: true })
  }
)

export const reclaimPage = Operation.fn("Browser.reclaim")(
  function*(
    claim: PageClaim.Claim,
    options?: { readonly observationTimeout?: number | undefined; readonly lastKnown?: Reclaimed.LastKnown | undefined }
  ) {
    const { runtime } = Hooks.get(yield* Browser.Browser)
    const claims = runtime.model.adapter.claims
    if (claims === undefined) return yield* Effect.fail(unsupported("Browser.reclaim", runtime.backend))
    const milliseconds = yield* observationBound("Browser.reclaim", options?.observationTimeout)
    const payload = yield* decode("Browser.reclaim", claim, PagePayload)
    yield* checkBrowser("Browser.reclaim", claims, payload)
    const id = yield* claims.findPage({ ...payload, tab: payload.tab }).pipe(
      Effect.mapError(mapAdapter("Browser.reclaim", runtime.backend))
    )
    if (id === undefined) return yield* Effect.fail(gone("Browser.reclaim"))
    const entry = runtime.model.page(id)
    if (Option.isNone(entry)) return yield* Effect.fail(gone("Browser.reclaim"))
    if (options?.lastKnown !== undefined && options.lastKnown.claim !== claim) {
      return yield* Effect.fail(error(
        "Browser.reclaim",
        new Reason.InvalidInput({
          input: "lastKnown",
          expected: "a handoff snapshot for this claim",
          hint: "The snapshot belongs to another claim"
        })
      ))
    }
    const found = yield* observe(claims, id, "Browser.reclaim", runtime.backend, milliseconds)
    const scope = yield* Effect.scope
    return yield* Effect.uninterruptible(Effect.gen(function*() {
      yield* runtime.model.transfer(id, scope)
      Handoff.allow(scope)
      yield* track(scope, claim, entry.value)
      const page = Option.getOrThrow(runtime.page(entry.value))
      return {
        page,
        found,
        handoff: options?.lastKnown?.handoff,
        ...(options?.lastKnown === undefined
          ? {}
          : { lastKnown: options.lastKnown })
      } satisfies Reclaimed.Reclaimed
    }))
  }
)

export const reclaimContext = Operation.fn("UserContext.reclaim")(
  function*(
    claim: ContextClaim.Claim,
    options?: UserContext.Options & {
      readonly observationTimeout?: number | undefined
      readonly lastKnown?: Reclaimed.LastKnown | undefined
    }
  ) {
    const hooks = Hooks.get(yield* Browser.Browser)
    const { runtime } = hooks
    const claims = runtime.model.adapter.claims
    if (claims === undefined) return yield* Effect.fail(unsupported("UserContext.reclaim", runtime.backend))
    const milliseconds = yield* observationBound("UserContext.reclaim", options?.observationTimeout)
    const payload = yield* decode("UserContext.reclaim", claim, ContextPayload)
    yield* checkBrowser("UserContext.reclaim", claims, payload)
    const context = yield* claims.findContext(payload.context).pipe(
      Effect.mapError(mapAdapter("UserContext.reclaim", runtime.backend))
    )
    if (context === undefined) return yield* Effect.fail(gone("UserContext.reclaim"))
    const entry = yield* runtime.model.context(context)
    const pages = yield* Effect.forEach(
      (yield* entry.state.get).pages,
      (page) =>
        Effect.map(
          observe(claims, page.id, "UserContext.reclaim", runtime.backend, milliseconds),
          (found) => ({ page: page.id, found })
        )
    )
    if (options?.lastKnown !== undefined && options.lastKnown.claim !== claim) {
      return yield* Effect.fail(
        error(
          "UserContext.reclaim",
          new Reason.InvalidInput({
            input: "lastKnown",
            expected: "a snapshot for this context claim",
            hint: "The snapshot belongs to another claim"
          })
        )
      )
    }
    const requested = options !== undefined &&
      Object.entries(options).some(([key, value]) =>
        key !== "observationTimeout" && key !== "lastKnown" && value !== undefined
      )
    if (requested && pages.some((page) => page.found._tag === "Unknown")) {
      return yield* Effect.fail(
        error(
          "UserContext.reclaim",
          new Reason.BackendFailure({
            kind: "Rejected",
            method: "UserContext.reclaim.settings",
            hint: "Requested settings cannot be confirmed while a page's state is unknown; ownership is not transferred"
          })
        )
      )
    }
    return yield* hooks.recover(
      options,
      context,
      !requested,
      (recovered, scope) =>
        trackContext(scope, claim, entry).pipe(
          Effect.as(
            {
              context: recovered,
              found: { pages },
              handoff: options?.lastKnown?.handoff,
              lastKnown: options?.lastKnown
            } satisfies ContextClaim.Reclaimed
          )
        )
    )
  }
)

const observe = Effect.fnUntraced(function*(
  claims: NonNullable<ReturnType<typeof Hooks.get>["runtime"]["model"]["adapter"]["claims"]>,
  id: import("../Target.ts").NavigableId,
  operation: string,
  backend: string,
  milliseconds = 1000
) {
  const record = yield* Operation.record
  const observed = yield* record.bound(
    claims.dialogs(id).pipe(
      Effect.mapError(mapAdapter(operation, backend)),
      BrowserClock.timeoutOn(record.clock, milliseconds)
    )
  )
  if (record.left() <= 0) return yield* Effect.fail(record.timeout(Option.none()))
  return Option.isSome(observed)
    ? { _tag: "Observed" as const, dialogs: observed.value }
    : { _tag: "Unknown" as const }
})

const track = (scope: Scope.Scope, claim: PageClaim.Claim, entry: Model.PageEntry) =>
  Handoff.observe(scope, claim, () => {
    const state = entry.state.getUnsafe()
    const last = state.status._tag === "Closed" ? undefined : Option.getOrUndefined(state.dialog)
    return {
      _tag: "LastKnown",
      claim,
      handoff: Handoff.outcome(entry),
      dialogs: last === undefined ? [] : [{ kind: last.kind, message: last.message }]
    }
  })

const observationBound = (operation: string, milliseconds = 1000) => {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return Effect.fail(error(
      operation,
      new Reason.InvalidInput({
        input: "observationTimeout",
        expected: "a positive finite number of milliseconds",
        hint: "Observation must have a finite bound"
      })
    ))
  }
  return Effect.succeed(milliseconds)
}

// Capture the page entries before closure; disconnection can empty the context's live page list.
const trackContext = (scope: Scope.Scope, claim: ContextClaim.Claim, entry: Model.ContextEntry) => {
  let pages: ReadonlyArray<Model.PageEntry> = []
  let captured = false
  return Handoff.observe(scope, claim, () => {
    if (!captured) {
      pages = entry.state.getUnsafe().pages
      captured = true
    }
    const outcomes = pages.map(Handoff.outcome)
    const handoff = outcomes.some((outcome) => outcome === undefined || outcome._tag === "Unknown")
      ? { _tag: "Unknown" as const, events: outcomes.flatMap((outcome) => outcome?.events ?? []) }
      : { _tag: "Complete" as const, events: outcomes.flatMap((outcome) => outcome?.events ?? []) }
    return {
      _tag: "LastKnown",
      claim,
      handoff,
      dialogs: pages.flatMap((page) => {
        const dialog = page.state.getUnsafe().dialog
        return Option.isNone(dialog) ? [] : [{ kind: dialog.value.kind, message: dialog.value.message }]
      })
    }
  })
}
