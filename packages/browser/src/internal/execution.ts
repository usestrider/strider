/** Page-local execution dispatch. Ordinary pages share the ordinary functions, without feature preflights. */
import type * as Effect from "effect/Effect"
import type * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Expect from "../Expect.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as Page from "../Page.ts"
import type * as Reason from "../Reason.ts"
import type * as Target from "../Target.ts"
import type * as Engine from "./engine.ts"
import * as ExpectImpl from "./expect.ts"
import type * as Model from "./model.ts"
import * as Runtime from "./runtime.ts"

export type Failure = Runtime.SendFailure | Deadline.Timeout | Target.TargetGone | {
  readonly _tag: "Reason"
  readonly reason: Reason.LocatorHandlerFailed
}
export interface Dispatch {
  readonly url: (
    page: Page.ReadonlyPage,
    expected: string | RegExp
  ) => Effect.Effect<void, Expect.ExpectationFailed | Target.TargetGone | Deadline.Timeout>
  readonly action: (
    runtime: Runtime.Runtime,
    page: Model.PageEntry,
    request: Extract<Engine.Request, { readonly op: "act" }>,
    id: Diagnostics.OperationId,
    at: MonotonicInstant.MonotonicInstant,
    final?: boolean
  ) => Effect.Effect<Runtime.Answer | { readonly _tag: "Restart" }, Failure>
  readonly expect: (
    runtime: Runtime.Runtime,
    page: Model.PageEntry,
    request: Extract<Engine.Request, { readonly op: "expect" }>,
    id: Diagnostics.OperationId,
    at: MonotonicInstant.MonotonicInstant
  ) => Effect.Effect<Engine.Response, Failure>
}
export const ordinary: Dispatch = {
  action: Runtime.sendRouted,
  expect: Runtime.send,
  url: (page, expected) => ExpectImpl.watchURL(page, expected)
}
