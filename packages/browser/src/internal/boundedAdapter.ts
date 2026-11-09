/**
 * The adapter as L1 calls it. Inside an operation, a call ends at the operation's deadline and fails with the
 * operation's `Timeout`. Its commands wait for their replies until that deadline too, in place of
 * `Protocol.CommandTimeout` (`ProtocolClient.CommandDeadline`), so even a command the adapter sends where it can't be
 * interrupted ends on time. Each method is classified once, by what it does to the browser:
 *
 * - a read leaves the record alone, so a read the browser never answers times out `resolving`, unless the operation
 *   observed something first;
 * - a write marks the record sent before it goes, so its `Timeout` says it may have taken effect;
 * - a creation runs in a fiber of its own, which the operation waits for until its deadline; what it makes after
 *   that is closed, by the release of a late reply or once the creation finishes (CONCEPTS.md §9, resource
 *   creation);
 * - a release is cleanup, never bounded by an operation, so a page or context still closes after a deadline passed.
 *
 * Outside an operation, as in the model's own fibers and finalizers, a call is the adapter's, under
 * `CommandTimeout`.
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import type * as Deadline from "../Deadline.ts"
import type * as Target from "../Target.ts"
import type * as UserContext from "../UserContext.ts"
import * as Adapter from "./adapter.ts"
import * as Operation from "./operation.ts"
import * as ProtocolClient from "./protocolClient.ts"

type Connection = Adapter.AdapterConnection

/** The adapter's methods: its members that are functions returning an effect. */
type Method = {
  [K in keyof Connection]-?: Connection[K] extends (...args: Array<any>) => Effect.Effect<any, any, any> ? K : never
}[keyof Connection]

/** The methods that are cleanup. */
type Release = "releaseAuthenticator" | "removeUserContext" | "closePage" | "releaseHandles" | "resetPermissions"

/** What a call does to the browser, and what a `Timeout`'s hint calls it. */
type Kind =
  | { readonly _tag: "Read"; readonly what: string }
  | { readonly _tag: "Write"; readonly what: string }
  | { readonly _tag: "Create"; readonly what: string }

const read = (what: string): Kind => ({ _tag: "Read", what })
const write = (what: string): Kind => ({ _tag: "Write", what })
const release = { _tag: "Release" } as const

/** Every method, classified; a new one doesn't compile until it is. */
const methods: { readonly [K in Method]: K extends Release ? typeof release : Kind } = {
  createUserContext: { _tag: "Create", what: "creating the context" },
  removeUserContext: release,
  createPage: { _tag: "Create", what: "creating the page" },
  closePage: release,
  activatePage: write("bringing the page forward"),
  navigate: write("the navigation"),
  reload: write("the reload"),
  traverse: write("the move through history"),
  realm: read("the document's realm"),
  // A call into the page is a write only as its caller knows: the caller marks one that may change the page
  evaluate: read("the call into the page"),
  releaseHandles: release,
  dispatchInput: write("the input"),
  contentFrame: read("the iframe's frame"),
  resolve: write("the decision"),
  declare: write("the declaration"),
  screenshot: read("the screenshot"),
  pdf: read("the PDF"),
  accessibilityTree: read("the accessibility tree"),
  screencast: write("starting the screencast"),
  video: write("starting the video"),
  createAuthenticator: { _tag: "Create", what: "creating the virtual authenticator" },
  releaseAuthenticator: release,
  authenticatorCredentials: read("the virtual authenticator credentials"),
  updateAuthenticator: write("updating the virtual authenticator"),
  cookies: read("the cookie read"),
  setCookies: write("setting the cookies"),
  clearCookies: write("clearing the cookies"),
  grantPermissions: write("the grant"),
  resetPermissions: release,
  responseBody: read("the response body"),
  captureRequestBody: read("the request body"),
  requestBody: read("the request body"),
  pausedRequestBody: read("the paused request's body"),
  pausedResponseBody: read("the paused response's body"),
  setInputFiles: write("setting the files"),
  downloadPath: read("the download's path"),
  cancelDownload: write("cancelling the download")
}

/** How what a creation made is closed, when the operation stopped waiting for it. */
const closes = {
  createAuthenticator: (adapter: Connection, ref: Adapter.Authenticator) => adapter.releaseAuthenticator(ref),
  createPage: (adapter: Connection, page: Target.NavigableId) => adapter.closePage(page, { runBeforeUnload: false }),
  createUserContext: (adapter: Connection, context: UserContext.Id) => adapter.removeUserContext(context)
}

/** The adapter as L1 calls it: every method but a release can fail with the operation's `Timeout` too. */
export type Bounded = {
  readonly [K in keyof Connection]: K extends "claims" ? BoundedClaims | undefined : K extends Release ? Connection[K]
  : Connection[K] extends (...args: infer P) => infer Call ? (
      ...args: P
    ) => Effect.Effect<Effect.Success<Call>, Effect.Error<Call> | Deadline.Timeout, Effect.Services<Call>>
  : Connection[K]
}

type BoundedClaims = {
  readonly [K in keyof Adapter.Claims]: Adapter.Claims[K] extends (...args: infer P) => infer Call
    ? (...args: P) => Effect.Effect<Effect.Success<Call>, Effect.Error<Call> | Deadline.Timeout>
    : Adapter.Claims[K]
}

/** Whether a call failed because a command got no reply: inside an operation, because its deadline passed. */
const noReply = (error: unknown): boolean =>
  error instanceof Adapter.AdapterError && error.reason._tag === "Protocol" &&
  error.reason.error.reason._tag === "NoReply"

/** The hint of a call's `Timeout`. */
const hint = (kind: Kind) => (): Option.Option<string> =>
  Option.some(
    kind._tag === "Read"
      ? `The browser didn't answer ${kind.what} before the deadline`
      : kind._tag === "Write"
      ? `The browser didn't answer ${kind.what} before the deadline; it may have taken effect`
      : `The browser didn't finish ${kind.what} before the deadline; what it makes is closed once it exists`
  )

/**
 * A creation, bounded: it runs in a fiber of its own, which the operation waits for until its deadline. If the
 * operation stops waiting first, what the creation makes is closed once it exists.
 */
const creating = <A, E, R>(
  record: Operation.Record,
  kind: Kind,
  call: Effect.Effect<A, E, R>,
  close: (made: A) => Effect.Effect<void, unknown>
): Effect.Effect<A, E | Deadline.Timeout, R> =>
  Effect.gen(function*() {
    record.markSent()
    const fiber = yield* Effect.forkDetach(call)
    return yield* record.bound(Operation.answered(record, Fiber.join(fiber)), () => {
      record.noteCleanup({ _tag: "Pending" })
      return hint(kind)()
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? Effect.void
          : Effect.sync(() => {
            if (Cause.hasInterrupts(exit.cause)) record.noteCleanup({ _tag: "Pending" })
          }).pipe(
            Effect.andThen(
              Fiber.join(fiber).pipe(Effect.flatMap(close), Effect.ignore, Effect.forkDetach, Effect.asVoid)
            )
          )
      )
    )
  })

/** The adapter as L1 calls it, its calls bounded by the operation they run in. */
export const make = (adapter: Connection): Bounded => {
  const bounded: Record<string, unknown> = { ...adapter }
  for (const name of Object.keys(methods) as Array<Method>) {
    const kind = methods[name]
    if (kind._tag === "Release") continue
    const method = adapter[name] as (...args: Array<unknown>) => Effect.Effect<unknown, unknown, unknown>
    const close = name === "createPage" || name === "createUserContext" || name === "createAuthenticator"
      ? closes[name]
      : undefined
    bounded[name] = (...args: Array<unknown>) =>
      Effect.flatMap(Operation.current, (current) => {
        const call = Effect.suspend(() => method(...args))
        if (Option.isNone(current)) return call
        const record = current.value
        // The operation's deadline is its commands'; one that passes it is the operation's Timeout
        const unbounded = call.pipe(
          Effect.provideService(ProtocolClient.CommandDeadline, Option.some(record.budget.at)),
          Effect.mapError((error) => {
            if (!noReply(error)) return error
            if (kind._tag === "Create") record.noteCleanup({ _tag: "Pending" })
            return record.timeout(hint(kind)())
          })
        )
        switch (kind._tag) {
          case "Read":
            return record.bound(unbounded, hint(kind))
          case "Write":
            return Effect.suspend(() => {
              record.markSent()
              return record.bound(Operation.answered(record, unbounded), hint(kind))
            })
          case "Create":
            return creating(record, kind, unbounded, (made) => close!(adapter, made as never))
        }
      })
  }
  if (adapter.claims !== undefined) {
    // Identity and observation are reads; planned handoff dismissal is explicitly a write.
    const claims = adapter.claims
    const bound = <A>(call: Effect.Effect<A, Adapter.AdapterError>, kind: Kind = read("the claim identity")) =>
      Effect.flatMap(Operation.current, (current) => {
        if (Option.isNone(current)) return call
        const record = current.value
        if (kind._tag === "Write") record.markSent()
        return record.bound(
          (kind._tag === "Write" ? Operation.answered(record, call) : call).pipe(
            Effect.provideService(ProtocolClient.CommandDeadline, Option.some(record.budget.at)),
            Effect.mapError((error) => noReply(error) ? record.timeout(hint(kind)()) : error)
          ),
          hint(kind)
        )
      })
    bounded.claims = {
      browser: claims.browser,
      dismiss: (id: Target.NavigableId, prompt: import("../Dialog.ts").PromptId) =>
        bound(claims.dismiss(id, prompt), write("handoff dialog dismissal")),
      dialogs: (id: Target.NavigableId) => bound(claims.dialogs(id)),
      page: (id: Target.NavigableId) => bound(claims.page(id)),
      context: (id: UserContext.Id) => bound(claims.context(id)),
      findPage: (identity: Adapter.ClaimIdentity) => bound(claims.findPage(identity)),
      findContext: (id: string) => bound(claims.findContext(id))
    }
  }
  return bounded as Bounded
}
