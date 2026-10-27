/**
 * What a `Route.Decision` is at run time: what was decided, under a key of its own beside the public TypeId,
 * whose type only carries the phases it is valid at.
 */
import type * as Headers from "effect/http/Headers"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpServerResponse from "effect/http/HttpServerResponse"
import type * as Redacted from "effect/Redacted"
import type * as Route from "../Route.ts"

export const TypeId = "~@usestrider/browser/Route/Decision"
const DataKey = "~@usestrider/browser/Route/Decision/data"

/** What a decision says. */
export type Data =
  | { readonly _tag: "Continue" }
  | { readonly _tag: "Fallthrough" }
  | {
    readonly _tag: "ContinueWith"
    readonly change: (request: HttpClientRequest.HttpClientRequest) => HttpClientRequest.HttpClientRequest
  }
  | { readonly _tag: "Fulfill"; readonly response: HttpServerResponse.HttpServerResponse }
  | {
    readonly _tag: "ContinueResponse"
    readonly status: number | undefined
    readonly headers: Headers.Headers | undefined
  }
  | { readonly _tag: "Abort"; readonly reason: Route.AbortReason }
  | { readonly _tag: "ProvideCredentials"; readonly username: string; readonly password: Redacted.Redacted<string> }

/** The phases each kind of decision is valid at. */
export const phases: Readonly<Record<Data["_tag"], ReadonlyArray<Route.Phase>>> = {
  Continue: ["request", "response", "auth"],
  Fallthrough: ["request", "response", "auth"],
  ContinueWith: ["request"],
  ContinueResponse: ["response"],
  Fulfill: ["request", "response"],
  Abort: ["request", "response"],
  ProvideCredentials: ["auth"]
}

export const make = <P extends Route.Phase>(data: Data): Route.Decision<P> =>
  ({ [TypeId]: () => {}, [DataKey]: data }) as unknown as Route.Decision<P>

/** What a decision says, or `undefined` for a value that isn't one of this library's decisions. */
export const data = (decision: unknown): Data | undefined =>
  typeof decision === "object" && decision !== null && DataKey in decision
    ? (decision as { readonly [DataKey]: Data })[DataKey]
    : undefined
