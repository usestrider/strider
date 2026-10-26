/**
 * The page clock (review 17, candidate 7): no backend has an application clock to drive, so it is a shim of
 * ours, installed in each document's main world before its scripts by an environment-phase init script, and
 * driven by evaluation there.
 *
 * - **One timeline per scope** (CONCEPTS.md §7): a page's, or a context's for every page in it. L1 keeps its
 *   state, which is all a replay of its operations needs: the mode, and the wall time or offset. Each
 *   operation is applied to every current document of the scope, every frame's included, and the init script
 *   is declared again with the new state, so a later document starts where the timeline is. The newer
 *   declaration carries a higher version, and a shim already in a document keeps the newest state it is given.
 * - **The engine is untouched**: it runs in its own world, which keeps the real timers and frames (review 17,
 *   P16), so actionability and expectations run on native rendering.
 * - **What it covers**: `Date`, `performance.now`, and in controlled mode `setTimeout`, `setInterval`,
 *   `requestAnimationFrame` and their clears. Not CSS animations or `document.timeline`.
 * - **Workers**, when installed with `workers: true` (review 22): the init script runs in the scope's dedicated
 *   workers too, and each operation reaches the current ones as it reaches documents.
 */
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Declaration from "../Declaration.ts"
import * as PageClock from "../PageClock.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as InitScripts from "./initScripts.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

/** A timeline's state, as a document needs it to start. */
export type State =
  | { readonly mode: "fixed"; readonly wall: number }
  | { readonly mode: "offset"; readonly by: number }
  /** `wall` is the timeline's wall time now; a document counts what passes after it starts. */
  | { readonly mode: "controlled"; readonly wall: number }

/**
 * The shim: installed once per document under a symbol, it keeps the newest state it is given. It must be
 * self-contained, since it is sent as its source.
 */
const shim = (key: string, initial: State, version: number): string => {
  const global = globalThis as any
  const symbol = Symbol.for(key)
  const existing = global[symbol]
  if (existing !== undefined) {
    existing.set(initial, version)
    return "installed"
  }
  const RealDate = Date
  const realNow = () => RealDate.now()
  const realPerf = performance.now.bind(performance)
  const realSetTimeout = global.setTimeout.bind(global)
  const realClearTimeout = global.clearTimeout.bind(global)
  const realSetInterval = global.setInterval.bind(global)
  const realClearInterval = global.clearInterval.bind(global)
  // A worker may have no animation frames
  const frames = typeof global.requestAnimationFrame === "function"
  const realFrame = frames ? global.requestAnimationFrame.bind(global) : () => 0
  const realCancelFrame = frames ? global.cancelAnimationFrame.bind(global) : () => {}
  const report = (error: unknown) => {
    if (typeof global.reportError === "function") global.reportError(error)
  }

  interface Timer {
    readonly id: number
    at: number
    readonly callback: (...args: Array<unknown>) => void
    readonly args: Array<unknown>
    readonly every: number | undefined
    readonly frame: boolean
  }
  let state: State = initial
  let current = version
  /** Controlled time that passed in this document, in milliseconds. */
  let ticks = 0
  const perfBase = realPerf()
  /** Controlled timers, by an id real timers never reach. */
  const timers = new Map<number, Timer>()
  let nextId = 1_000_000_000
  /** Controlled timers moved to real ones by `resume`, by their controlled id. */
  const moved = new Map<number, { readonly real: number; readonly frame: boolean }>()

  const wall = (): number =>
    state.mode === "fixed" ? state.wall : state.mode === "offset" ? realNow() + state.by : state.wall + ticks
  const perf = (): number => state.mode === "controlled" ? perfBase + ticks : realPerf()

  const callable = (callback: unknown): (...args: Array<unknown>) => void =>
    typeof callback === "function"
      ? callback as (...args: Array<unknown>) => void
      // oxlint-disable-next-line no-eval -- a string is a script, as the platform's own timers run it
      : () => (0, eval)(String(callback))
  const run = (timer: Timer) => {
    try {
      timer.callback.apply(global, timer.frame ? [perf()] : timer.args)
    } catch (error) {
      report(error)
    }
  }
  const schedule = (callback: unknown, delay: unknown, args: Array<unknown>, every: boolean, frame: boolean) => {
    const id = nextId++
    const wait = Math.max(0, Number(delay) || 0)
    timers.set(id, {
      id,
      at: frame ? (Math.floor(ticks / 16) + 1) * 16 : ticks + wait,
      callback: callable(callback),
      args,
      every: every ? Math.max(1, wait) : undefined,
      frame
    })
    return id
  }
  const due = (to: number) => {
    let next: Timer | undefined
    for (const timer of timers.values()) {
      if (
        timer.at <= to && (next === undefined || timer.at < next.at || (timer.at === next.at && timer.id < next.id))
      ) {
        next = timer
      }
    }
    return next
  }
  /** Advances controlled time to `to`: each due timer runs in order, an interval as often as it falls due. */
  const advance = (to: number) => {
    for (let timer = due(to); timer !== undefined; timer = due(to)) {
      ticks = Math.max(ticks, timer.at)
      if (timer.every === undefined) timers.delete(timer.id)
      else timer.at += timer.every
      run(timer)
    }
    ticks = Math.max(ticks, to)
  }
  /** Jumps controlled time to `to`: each due timer runs once, as on waking from sleep. */
  const jump = (to: number) => {
    const list = [...timers.values()].filter((timer) => timer.at <= to).sort((a, b) => a.at - b.at || a.id - b.id)
    ticks = Math.max(ticks, to)
    for (const timer of list) {
      if (timer.every === undefined) timers.delete(timer.id)
      else timer.at = ticks + timer.every
      run(timer)
    }
  }
  const clear = (id: unknown) => {
    const key = Number(id)
    if (timers.delete(key)) return
    const real = moved.get(key)
    if (real === undefined) return realClearTimeout(id)
    moved.delete(key)
    if (real.frame) realCancelFrame(real.real)
    else realClearTimeout(real.real)
  }
  /** Real time again: the controlled timers waiting move to real ones. */
  const release = () => {
    for (const timer of timers.values()) {
      const wait = Math.max(0, timer.at - ticks)
      const real = timer.frame
        ? realFrame((at: number) => {
          moved.delete(timer.id)
          timer.callback.call(global, at)
        })
        : realSetTimeout(() => {
          if (timer.every === undefined) {
            moved.delete(timer.id)
            run(timer)
          } else {
            run(timer)
            moved.set(timer.id, { real: realSetInterval(() => run(timer), timer.every), frame: false })
          }
        }, wait)
      moved.set(timer.id, { real, frame: timer.frame })
    }
    timers.clear()
  }

  function FakeDate(this: unknown, ...args: Array<unknown>) {
    if (new.target === undefined) return new RealDate(wall()).toString()
    return args.length === 0
      ? Reflect.construct(RealDate, [wall()], new.target)
      : Reflect.construct(RealDate, args, new.target)
  }
  FakeDate.prototype = RealDate.prototype
  FakeDate.now = () => wall()
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  Object.defineProperty(FakeDate, "name", { value: "Date" })
  global.Date = FakeDate
  performance.now = () => perf()
  global.setTimeout = (callback: unknown, delay?: unknown, ...args: Array<unknown>) =>
    state.mode === "controlled"
      ? schedule(callback, delay, args, false, false)
      : realSetTimeout(callback, delay, ...args)
  global.setInterval = (callback: unknown, delay?: unknown, ...args: Array<unknown>) =>
    state.mode === "controlled"
      ? schedule(callback, delay, args, true, false)
      : realSetInterval(callback, delay, ...args)
  global.clearTimeout = clear
  global.clearInterval = (id: unknown) => {
    if (timers.has(Number(id)) || moved.has(Number(id))) clear(id)
    else realClearInterval(id)
  }
  if (frames) {
    global.requestAnimationFrame = (callback: unknown) =>
      state.mode === "controlled" ? schedule(callback, 0, [], false, true) : realFrame(callback)
    global.cancelAnimationFrame = (id: unknown) => {
      if (timers.has(Number(id)) || moved.has(Number(id))) clear(id)
      else realCancelFrame(id)
    }
  }

  const controls = {
    get version() {
      return current
    },
    /** A newer state of the timeline, from another declaration or an operation. */
    set: (next: State, at: number) => {
      if (at <= current) return
      current = at
      if (state.mode === "controlled" && next.mode !== "controlled") release()
      // A controlled document keeps the time that passed in it: the timeline's wall time is now `next.wall`
      state = next.mode === "controlled" ? { mode: "controlled", wall: next.wall - ticks } : next
    },
    adjust: (by: number, at: number) => {
      current = Math.max(current, at)
      advance(ticks + by)
    },
    setTime: (to: number, at: number) => {
      current = Math.max(current, at)
      if (state.mode === "fixed") state = { mode: "fixed", wall: to }
      else if (state.mode === "controlled") {
        const delta = to - wall()
        if (delta > 0) jump(ticks + delta)
        state = { mode: "controlled", wall: to - ticks }
      }
    },
    resume: (at: number) => {
      current = Math.max(current, at)
      const by = wall() - realNow()
      if (state.mode === "controlled") release()
      state = { mode: "offset", by }
    }
  }
  Object.defineProperty(global, symbol, { value: controls, enumerable: false })
  return "installed"
}

/** The script that installs the shim with a state: for a document's start, and for evaluation in one now. */
const installer = (key: string, state: State, version: number) =>
  `(${shim.toString()})(${JSON.stringify(key)}, ${JSON.stringify(state)}, ${version})`

/** Runs an operation in a document that has the shim: a function declaration for `evaluate`. */
const operationSource = (
  key: string,
  name: "adjust" | "setTime" | "resume",
  argument: number | undefined,
  version: number
) =>
  `function() {
  const clock = globalThis[Symbol.for(${JSON.stringify(key)})];
  if (clock === undefined) return "missing";
  clock.${name}(${argument === undefined ? "" : `${argument}, `}${version});
  return "done";
}`

/** A timeline, kept by its owner while a clock is installed. */
interface Installed {
  state: State
  version: number
  /** Whether the scope's dedicated workers get it too. */
  readonly workers: boolean
  /** The scope `install` returned the registration of. */
  readonly scope: Scope.Closeable
  /** The current init script's scope, replaced with each operation. */
  script: Scope.Closeable
}

export interface Owner {
  readonly runtime: Runtime.Runtime
  readonly scope: Adapter.DeclarationScope
  /** The pages the timeline covers, now. */
  readonly pages: () => ReadonlyArray<Model.PageEntry>
  /** `Page.clock` or `UserContext.clock`. */
  readonly name: string
  /** Another timeline that covers some of the same pages, which can't be installed beside this one. */
  readonly conflicting: () => Option.Option<string>
}

/** Every timeline, by what owns it: a page's entry or a context's. */
const timelines = new WeakMap<object, { installed: Option.Option<Installed> }>()

/** Whether a page's or a context's clock is installed. */
export const isInstalled = (owner: object): boolean => Option.isSome(timelines.get(owner)?.installed ?? Option.none())

const stateOf = (mode: PageClock.Mode): State | string => {
  const time = (input: DateTime.DateTime.Input) => Option.map(DateTime.make(input), DateTime.toEpochMillis)
  switch (mode.mode) {
    case "fixed": {
      const wall = time(mode.at)
      return Option.isSome(wall) ? { mode: "fixed", wall: wall.value } : `${String(mode.at)} isn't a time`
    }
    case "controlled": {
      const wall = time(mode.at)
      return Option.isSome(wall) ? { mode: "controlled", wall: wall.value } : `${String(mode.at)} isn't a time`
    }
    case "offset": {
      const by = Duration.fromInput(mode.by)
      return Option.isSome(by)
        ? { mode: "offset", by: Duration.toMillis(by.value) }
        : `${String(mode.by)} isn't a duration`
    }
  }
}

/** A page clock over a timeline. */
export const make = (owner: Owner, key: object): PageClock.PageClock => {
  const timeline = { installed: Option.none<Installed>() }
  timelines.set(key, timeline)
  const token = `@usestrider/browser/clock/${crypto.randomUUID()}`
  const adapter = owner.runtime.model.adapter

  /**
   * Evaluates in the main world of every current document of the timeline's pages, and with `workers` in their
   * dedicated workers; a document or worker that ends is skipped.
   */
  const broadcast = (functionDeclaration: string, workers: boolean) =>
    Effect.flatMap(
      workers
        ? Effect.map(Effect.forEach(owner.pages(), (page) => SubscriptionRef.get(page.workers)), (each) => each.flat())
        : Effect.succeed([]),
      (dedicated) =>
        Effect.forEach(
          [
            ...[...owner.runtime.model.documents.values()].filter((document) => {
              const page = owner.runtime.model.pageOf(document.navigable)
              return Option.isSome(page) && owner.pages().includes(page.value)
            }).map((document) => ({ url: document.url, realm: adapter.realm(document.id, { _tag: "Main" }) })),
            ...dedicated.map((worker) => ({ url: worker.url, realm: Effect.succeed(worker.realm) }))
          ],
          (where) =>
            where.realm.pipe(
              Effect.flatMap((realm) =>
                adapter.evaluate(realm, {
                  functionDeclaration,
                  arguments: [],
                  awaitPromise: false,
                  result: "value",
                  userActivation: false
                })
              ),
              Effect.flatMap((result) =>
                result._tag === "Exception"
                  ? Effect.fail(`the clock threw in ${where.url}: ${result.text}`)
                  : Effect.void
              ),
              Effect.catch((error) =>
                typeof error === "string"
                  ? Effect.fail(error)
                  : error.reason._tag === "Gone"
                  ? Effect.void
                  : Effect.fail(error.message)
              )
            ),
          { concurrency: "unbounded", discard: true }
        )
    )

  const declare = Effect.fnUntraced(function*(installed: Installed) {
    const script = yield* Scope.fork(installed.scope)
    yield* adapter.declare(owner.scope, {
      _tag: "InitScript",
      source: installer(token, installed.state, installed.version),
      world: { _tag: "Main" },
      phase: "environment",
      workers: installed.workers,
      timing: "beforeAuthorScript",
      after: []
    }).pipe(Scope.provide(script), Effect.onError(() => Scope.close(script, Exit.void)))
    return script
  })

  const clockError = (operation: string, reason: PageClock.PageClockErrorReason, id = Operation.operationId()) =>
    new PageClock.PageClockError({ operation, reason, diagnostics: Operation.diagnostics(id) })

  const backendFailure = (method: string, hint: string) =>
    new Reason.BackendFailure({ kind: "Rejected", method, metadata: {}, hint })

  /** The installed timeline, or why an operation can't run on it. */
  const require = (operation: string, modes: ReadonlyArray<State["mode"]>) =>
    Effect.suspend(() => {
      if (Option.isNone(timeline.installed)) {
        return Effect.fail(clockError(
          operation,
          new PageClock.NotInstalled({ hint: `Call ${owner.name}.install first` })
        ))
      }
      const installed = timeline.installed.value
      if (!modes.includes(installed.state.mode)) {
        return Effect.fail(clockError(
          operation,
          new PageClock.WrongMode({
            mode: installed.state.mode,
            hint: `${operation} needs a clock that is ${modes.join(" or ")}`
          })
        ))
      }
      return Effect.succeed(installed)
    })

  /** Applies an operation to every document now, then declares the timeline's new state for later ones. */
  const apply = (operation: string, installed: Installed, next: State, run: string) =>
    Effect.gen(function*() {
      installed.version++
      installed.state = next
      yield* broadcast(run, installed.workers).pipe(
        Effect.mapError((hint) => clockError(operation, backendFailure("evaluate", hint)))
      )
      const previous = installed.script
      installed.script = yield* declare(installed).pipe(
        Effect.mapError((error) => clockError(operation, backendFailure("declare", error.message)))
      )
      yield* Scope.close(previous, Exit.void)
    }).pipe(Spans.operation(operation, {
      attributes: { ...Spans.scopeAttributes(owner.scope), "browser.clock.mode": next.mode }
    }))

  return {
    install: (mode, options) =>
      Effect.gen(function*() {
        const operation = `${owner.name}.install`
        const id = Operation.operationId()
        const fail = (reason: Declaration.DeclarationErrorReason) =>
          new Declaration.DeclarationError({ declaration: operation, reason, diagnostics: Operation.diagnostics(id) })
        if (Option.isSome(timeline.installed)) {
          return yield* Effect.fail(fail(
            new Declaration.Conflict({ with: owner.name, hint: "This clock is installed already; remove it first" })
          ))
        }
        const other = owner.conflicting()
        if (Option.isSome(other)) {
          return yield* Effect.fail(fail(
            new Declaration.Conflict({ with: other.value, hint: "One timeline covers a page; remove the other first" })
          ))
        }
        const state = stateOf(mode)
        if (typeof state === "string") {
          return yield* Effect.fail(
            fail(new Reason.InvalidInput({ input: "mode", expected: "a time or a duration", hint: state }))
          )
        }
        const workers = options?.workers === true
        if (workers) yield* InitScripts.inWorkers(owner.runtime).pipe(Effect.mapError(fail))
        const scope = yield* Scope.fork(yield* Effect.scope)
        const installed: Installed = { state, version: 1, workers, scope, script: scope }
        installed.script = yield* declare(installed).pipe(
          Effect.mapError((error) => fail(backendFailure("declare", error.message))),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
        // The documents loaded already get it now; what their scripts captured before keeps real time
        yield* broadcast(`function() { return ${installer(token, state, installed.version)} }`, workers).pipe(
          Effect.mapError((hint) => fail(backendFailure("evaluate", hint))),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
        timeline.installed = Option.some(installed)
        // Removing it affects later documents only: those it reached keep the shim (CONCEPTS.md §7)
        yield* Scope.addFinalizer(scope, Effect.sync(() => (timeline.installed = Option.none())))
        return { remove: Scope.close(scope, Exit.void) } satisfies Declaration.Registration
      }).pipe(Spans.operation(`${owner.name}.install`, {
        attributes: { ...Spans.scopeAttributes(owner.scope), "browser.clock.mode": mode.mode }
      })),
    adjust: Effect.fnUntraced(function*(duration: Duration.Input) {
      const operation = `${owner.name}.adjust`
      const installed = yield* require(operation, ["controlled"])
      const by = Duration.fromInput(duration)
      if (Option.isNone(by)) {
        return yield* Effect.fail(clockError(
          operation,
          new Reason.InvalidInput({ input: "duration", expected: "a duration", hint: `${String(duration)} isn't one` })
        ))
      }
      const ms = Duration.toMillis(by.value)
      const state = installed.state as Extract<State, { mode: "controlled" }>
      yield* apply(
        operation,
        installed,
        { mode: "controlled", wall: state.wall + ms },
        operationSource(token, "adjust", ms, installed.version + 1)
      )
    }),
    setTime: Effect.fnUntraced(function*(at: DateTime.DateTime.Input) {
      const operation = `${owner.name}.setTime`
      const installed = yield* require(operation, ["fixed", "controlled"])
      const wall = Option.map(DateTime.make(at), DateTime.toEpochMillis)
      if (Option.isNone(wall)) {
        return yield* Effect.fail(clockError(
          operation,
          new Reason.InvalidInput({ input: "at", expected: "a time", hint: `${String(at)} isn't one` })
        ))
      }
      yield* apply(
        operation,
        installed,
        { mode: installed.state.mode as "fixed" | "controlled", wall: wall.value },
        operationSource(token, "setTime", wall.value, installed.version + 1)
      )
    }),
    resume: Effect.gen(function*() {
      const operation = `${owner.name}.resume`
      const installed = yield* require(operation, ["fixed", "offset", "controlled"])
      const now = Date.now()
      const wall = installed.state.mode === "offset" ? now + installed.state.by : installed.state.wall
      yield* apply(
        operation,
        installed,
        { mode: "offset", by: wall - now },
        operationSource(token, "resume", undefined, installed.version + 1)
      )
    })
  }
}
