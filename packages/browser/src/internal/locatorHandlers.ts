/** Scoped page-local overlay dispatch; never entered by pages that have not registered a handler. */
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as References from "effect/References"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Tracer from "effect/Tracer"
import * as Deadline from "../Deadline.ts"
import type * as Declaration from "../Declaration.ts"
import type * as Locator from "../Locator.ts"
import * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import * as Target from "../Target.ts"
import * as Access from "./access.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Execution from "./execution.ts"
import * as ExpectImpl from "./expect.ts"
import * as Handles from "./handles.ts"
import { LocatorImpl } from "./locator.ts"
import type { Owner } from "./locatorOwner.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Recorders from "./recorders.ts"
import * as Runtime from "./runtime.ts"

const Suppressed = Context.Reference<boolean>("@usestrider/browser/LocatorHandlers/Suppressed", {
  defaultValue: () => false
})
interface Entry {
  readonly locator: LocatorImpl
  readonly pageGrant: Owner["grant"]
  readonly closed: Deferred.Deferred<void>
  callback: (() => Effect.Effect<void, unknown>) | undefined
  remaining: number
  stopped: boolean
  done: Deferred.Deferred<void> | undefined
  invokingFiber: Fiber.Fiber<unknown, unknown> | undefined
  readonly noWaitAfter: boolean
}
interface State {
  readonly entries: Set<Entry>
  readonly serial: Semaphore.Semaphore
  readonly serviced: WeakMap<Operation.Record, Set<Entry>>
  running: number
  busy: boolean
}
const states = new WeakMap<Model.PageEntry, State>()
const restore = (page: Model.PageEntry, state: State) => {
  if (states.get(page) === state && state.entries.size === 0 && state.running === 0 && !state.busy) {
    page.execution = Execution.ordinary
    states.delete(page)
  }
}
const failureHint = (error: unknown): string => {
  try {
    if (typeof error === "string") return error
    if (error instanceof Error) {
      const message: unknown = error.message
      if (typeof message === "string") return message
    }
  } catch {
    // Reading user-defined error properties can itself throw; the original typed value still belongs to the failure.
  }
  return "Inspect error for the original callback failure"
}
const asFailure = (failure: Runtime.SendFailure): Execution.Failure => failure
const probe = Effect.fnUntraced(function*(entry: Entry, record: Operation.Record) {
  yield* Access.check(entry.pageGrant)
  yield* Access.check(entry.locator.owner.grant)
  const response = yield* Runtime.send(
    entry.locator.owner.runtime,
    entry.locator.owner.page,
    {
      op: "visible",
      steps: entry.locator.steps
    },
    record.id,
    record.budget.at
  ).pipe(Effect.mapError(asFailure))
  if (response._tag === "Visible") return response.visible
  return yield* Effect.fail<Execution.Failure>({
    _tag: "Reason",
    reason: new Reason.BackendFailure({
      kind: "IncompatibleResponse",
      method: "Page.addLocatorHandler",
      hint: `Trigger ${entry.locator.description} returned ${response._tag}`
    })
  })
})
const check = (state: State, final: boolean): Effect.Effect<"continue" | "invalidate" | "restart", Execution.Failure> =>
  Effect.gen(function*() {
    if (final && state.busy) return "restart" as const
    const record = yield* Operation.record
    const work = Effect.gen(function*() {
      let invoked = false
      let serviced = state.serviced.get(record)
      if (serviced === undefined) state.serviced.set(record, serviced = new Set())
      for (const entry of state.entries) {
        if (entry.remaining <= 0 || entry.callback === undefined) continue
        if (final && entry.noWaitAfter && serviced.has(entry)) continue
        if (!(yield* probe(entry, record))) continue
        if (final) return "restart" as const
        const callback = entry.callback
        if (callback === undefined || !state.entries.has(entry)) continue
        entry.remaining--
        if (entry.remaining === 0) {
          state.entries.delete(entry)
          entry.callback = undefined
        }
        serviced.add(entry)
        invoked = true
        state.busy = true
        const done = yield* Deferred.make<void>()
        entry.done = done
        const invoke = Effect.gen(function*() {
          entry.invokingFiber = Fiber.getCurrent()
          if (entry.stopped) return yield* Effect.interrupt
          yield* Access.check(entry.pageGrant)
          yield* Access.check(entry.locator.owner.grant)
          yield* callback().pipe(Effect.catch((error) => {
            if (Deadline.isTimeout(error) || Target.isTargetGone(error)) return Effect.fail(error)
            return Effect.fail<Execution.Failure>({
              _tag: "Reason",
              reason: new Reason.LocatorHandlerFailed({
                error,
                trigger: entry.locator.description,
                hint: failureHint(error)
              })
            })
          }))
          if (entry.stopped) return yield* Effect.interrupt
          if (!entry.noWaitAfter) {
            while (true) {
              yield* Access.check(entry.pageGrant)
              yield* Access.check(entry.locator.owner.grant)
              const response = yield* Runtime.send(
                entry.locator.owner.runtime,
                entry.locator.owner.page,
                {
                  op: "expect",
                  steps: entry.locator.steps,
                  expectation: { _tag: "Hidden" },
                  cap: Runtime.roundCap(record.left())
                },
                record.id,
                record.budget.at
              )
              if (response._tag === "Expected" && response.passed) break
              if (record.left() <= 0) {
                return yield* Effect.fail(
                  record.timeout(Option.some("Waiting for the locator handler trigger to disappear"))
                )
              }
            }
          }
        }).pipe(
          Effect.provideService(Suppressed, true),
          Effect.raceFirst(Deferred.await(entry.closed).pipe(Effect.andThen(Effect.interrupt))),
          Effect.ensuring(Effect.sync(() => {
            state.busy = false
          }))
        )
        yield* record.bound(invoke, () => Option.some("Waiting for the locator handler callback and disappearance"))
          .pipe(
            Effect.ensuring(Effect.andThen(
              Deferred.succeed(done, undefined),
              Effect.sync(() => {
                entry.done = undefined
                entry.invokingFiber = undefined
              })
            ))
          )
        if (entry.stopped) return yield* Effect.interrupt
      }
      return invoked ? "invalidate" as const : "continue" as const
    })
    // Never queue behind a callback while holding the input permit: that callback may need input itself.
    if (final) {
      const available = yield* state.serial.withPermitsIfAvailable(1)(work)
      return Option.isSome(available) ? available.value : "restart" as const
    }
    return yield* record.bound(state.serial.withPermit(work), () => Option.some("Waiting for another locator handler"))
  })

const activate = (page: Model.PageEntry, state: State) => {
  const managed = Effect.fnUntraced(function*<A>(self: Effect.Effect<A, Execution.Failure>) {
    state.running++
    return yield* self.pipe(Effect.ensuring(Effect.sync(() => {
      state.running--
      restore(page, state)
    })))
  })
  const dispatch = Effect.fnUntraced(
    function*<A>(self: Effect.Effect<A, Execution.Failure>, ordinary: Effect.Effect<A, Execution.Failure>) {
      if (yield* Effect.service(Suppressed)) return yield* ordinary
      return yield* managed(self)
    }
  )
  page.execution = {
    url: Effect.fnUntraced(function*(page: Page.ReadonlyPage, expected: string | RegExp) {
      if (yield* Effect.service(Suppressed)) return yield* ExpectImpl.watchURL(page, expected)
      return yield* ExpectImpl.handlerURL(page, expected, (request, record) =>
        managed(
          Runtime.sendCooperative<Execution.Failure, never>(
            Handles.page(page).runtime,
            Handles.page(page).entry,
            request,
            record.id,
            record.budget.at,
            (_route, last) => check(state, last)
          ).pipe(
            Effect.flatMap((answer) =>
              "_tag" in answer ? Effect.die("URL assertion unexpectedly restarted") : Effect.succeed(answer.response)
            )
          )
        ))
    }),
    action: (runtime, target, request, id, at, final) =>
      dispatch(
        Runtime.sendCooperative<Execution.Failure, never>(runtime, target, request, id, at, (_route, last) =>
          check(state, last), { final: final === true }),
        Runtime.sendRouted(runtime, target, request, id, at)
      ),
    expect: (runtime, target, request, id, at) =>
      dispatch(
        Runtime.sendCooperative<Execution.Failure, never>(runtime, target, request, id, at, (_route, last) =>
          check(state, last)).pipe(
            Effect.flatMap((answer) =>
              "_tag" in answer ? Effect.die("Assertion unexpectedly restarted") : Effect.succeed(answer.response)
            )
          ),
        Runtime.send(runtime, target, request, id, at)
      )
  }
}

// Keep captured services in a separate lexical environment: a retained remove handle must not retain them.
const captureCallback = <E, R>(
  handler: (locator: Locator.Locator) => Effect.Effect<void, E, R>,
  locator: Locator.Locator,
  services: Context.Context<R>
): () => Effect.Effect<void, unknown> =>
() =>
  Effect.contextWith((current: Context.Context<never>) =>
    Effect.provideContext(Effect.suspend(() => handler(locator)), Context.merge(current, services))
  )

export const add = Effect.fnUntraced(function*<E, R>(
  owner: Owner,
  locator: Locator.Locator,
  handler: (locator: Locator.Locator) => Effect.Effect<void, E, R>,
  options?: { readonly times?: number | undefined; readonly noWaitAfter?: boolean | undefined }
) {
  yield* Access.check(owner.grant)
  const record = yield* Operation.record
  if (
    !(locator instanceof LocatorImpl) || locator.owner.page !== owner.page || locator.owner.runtime !== owner.runtime
  ) {
    return yield* Effect.fail(
      new Page.PageError({
        operation: "Page.addLocatorHandler",
        reason: new Reason.InvalidInput({
          input: "locator",
          expected: "a locator from this exact page and connection",
          hint: "Create the trigger through this page"
        }),
        diagnostics: Operation.diagnostics(record.id)
      })
    )
  }
  yield* Access.check(locator.owner.grant)
  const times = options?.times ?? Infinity
  if (options?.times !== undefined && (!Number.isSafeInteger(times) || times <= 0)) {
    return yield* Effect.fail(
      new Page.PageError({
        operation: "Page.addLocatorHandler",
        reason: new Reason.InvalidInput({
          input: "times",
          expected: "a positive safe integer",
          hint: "Omit times for unlimited invocations"
        }),
        diagnostics: Operation.diagnostics(record.id)
      })
    )
  }
  const captured = Context.omit(
    Context.Service<unknown, unknown>(Operation.CurrentKey),
    Deadline.CurrentDeadline,
    BrowserClock.CurrentClock,
    Tracer.ParentSpan,
    References.CurrentStackFrame,
    Recorders.CurrentSubject,
    Suppressed
  )(yield* Effect.context<R>())
  const entry: Entry = {
    locator,
    pageGrant: owner.grant,
    closed: yield* Deferred.make<void>(),
    remaining: times,
    stopped: false,
    done: undefined,
    invokingFiber: undefined,
    noWaitAfter: options?.noWaitAfter === true,
    callback: captureCallback(handler, locator, captured as Context.Context<R>)
  }
  const page = owner.page
  let state = states.get(page)
  if (state === undefined) {
    state = { entries: new Set(), serial: yield* Semaphore.make(1), running: 0, busy: false, serviced: new WeakMap() }
  }
  const registry = state
  const remove = Effect.sync(() => {
    registry.entries.delete(entry)
    entry.callback = undefined
    restore(page, registry)
  })
  const close = Effect.gen(function*() {
    entry.stopped = true
    yield* remove
    yield* Deferred.succeed(entry.closed, undefined)
    // A callback closing its own registration scope cannot join itself; its return is interrupted above.
    if (entry.done !== undefined && entry.invokingFiber !== Fiber.getCurrent()) yield* Deferred.await(entry.done)
  })
  // This finalizer needs no caller services; Effect.addFinalizer would capture the entire registration context.
  yield* Scope.addFinalizer(yield* Effect.scope, close)
  if (Option.isSome(owner.grant)) yield* owner.grant.value.onRelease(close)
  if (Option.isSome(locator.owner.grant)) yield* locator.owner.grant.value.onRelease(close)
  yield* Effect.sync(() => {
    if (entry.callback === undefined) return
    registry.entries.add(entry)
    states.set(page, registry)
    activate(page, registry)
  })
  const watcher = yield* Runtime.pageEnded(page).pipe(
    Effect.ignore,
    Effect.andThen(close),
    Operation.detached,
    Effect.forkScoped
  )
  const registration: Declaration.Registration = {
    remove: Effect.andThen(remove, Fiber.interrupt(watcher)).pipe(Effect.asVoid)
  }
  return registration
}, Operation.named("Page.addLocatorHandler"))
