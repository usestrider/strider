/** Page-local execution dispatch. Ordinary pages share the ordinary functions, without feature preflights. */
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
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
    expected: string | RegExp,
    options?: ExpectImpl.URLOptions | undefined
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
  /**
   * Draws an input action's annotation and waits before its input, on a page that shows its actions: absent on
   * every other page, so an action there makes no added call.
   */
  readonly annotate?: Annotate | undefined
  /** Services the page's locator handlers once, before a check that doesn't go through the engine. */
  readonly beforeCheck: Effect.Effect<void, Failure>
}

/** An input action about to be checked a last time and sent: what it is, and its point in the top-level page. */
export interface Annotation {
  readonly title: string
  readonly point: { readonly x: number; readonly y: number } | null
  /** The target's box in the top-level page, read only when the annotation draws it. */
  readonly box: Effect.Effect<
    Option.Option<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>
  >
}
export type Annotate = (annotation: Annotation) => Effect.Effect<void>

/** A page's dispatch, of the parts installed on it: a locator handler's routing, and an annotation. */
const handled = new WeakMap<Model.PageEntry, Omit<Dispatch, "annotate">>()
const annotating = new WeakMap<Model.PageEntry, Annotate>()
const compose = (page: Model.PageEntry) => {
  const handler = handled.get(page)
  const annotate = annotating.get(page)
  page.execution = handler === undefined && annotate === undefined
    ? ordinary
    : { ...(handler ?? ordinary), annotate }
}

/** Installs a page's locator-handler routing, or with `undefined` removes it, keeping any annotation. */
export const handleWith = (page: Model.PageEntry, dispatch: Omit<Dispatch, "annotate"> | undefined): void => {
  if (dispatch === undefined) handled.delete(page)
  else handled.set(page, dispatch)
  compose(page)
}

/** Installs a page's annotation, or with `undefined` removes it, keeping any locator-handler routing. */
export const annotateWith = (page: Model.PageEntry, annotate: Annotate | undefined): void => {
  if (annotate === undefined) annotating.delete(page)
  else annotating.set(page, annotate)
  compose(page)
}

export const ordinary: Dispatch = {
  action: Runtime.sendRouted,
  expect: Runtime.send,
  beforeCheck: Effect.void,
  url: (page, expected, options) => ExpectImpl.watchURL(page, expected, options)
}
