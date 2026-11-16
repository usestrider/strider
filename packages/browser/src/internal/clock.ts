/**
 * The page clock: no backend has an application clock to drive, so it is a shim of
 * ours, installed in each document's main world before its scripts by an environment-phase init script, and
 * driven by evaluation there.
 *
 * - **One timeline per scope** (CONCEPTS.md §7): a page's, or a context's for every page in it. L1 keeps its
 *   state, which is all a replay of its operations needs: the mode, and the wall time or offset. Each
 *   operation is applied to every current document of the scope, every frame's included, and the init script
 *   is declared again with the new state, so a later document starts where the timeline is. The newer
 *   declaration carries a higher version, and a shim already in a document keeps the newest state it is given.
 * - **The engine is untouched**: it runs in its own world, which keeps the real timers and frames, so
 *   actionability and expectations run on native rendering. Where it shares the page's world, as on
 *   stock WebKit, the shim leaves the real ones under a symbol the engine takes them from (QUIRKS.md, Q222).
 * - **What it covers**: `Date`, `performance.now`, and in controlled mode `performance.timeOrigin`, `setTimeout`,
 *   `setInterval`, `requestAnimationFrame` and their clears. Not CSS animations or `document.timeline`.
 * - **The timeline's rules** are Playwright's clock's: controlled time moves by whole milliseconds, and
 *   `performance.now()` counts it from 0 where the clock reaches a document, or where a document's clock becomes
 *   controlled. An operation runs one due timer at a time, then lets the page's queued tasks run, so the evaluation
 *   that drives it awaits a promise: it waits on its own port while the document keeps posting messages, not for other documents' work, counted by
 *   wrapping `postMessage`, until the host's deadline, then for one real timer. A timer set during that turn with
 *   no delay waits 1 ms. After `resume`, animation frames carry times on the timeline `performance.now()` reads. A timer that throws is reported to the page and the rest still run;
 *   the operation then fails with the first error. A document runs its controls one after another, since a host
 *   deadline can leave one running when the next arrives.
 * - **Workers**, when installed with `workers: true`: the init script runs in the scope's dedicated
 *   workers too, and each operation reaches the current ones as it reaches documents.
 */
import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Deadline from "../Deadline.ts"
import * as Declaration from "../Declaration.ts"
import * as PageClock from "../PageClock.ts"
import * as Reason from "../Reason.ts"
import type * as Adapter from "./adapter.ts"
import * as DurationInput from "./durationInput.ts"
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
  /**
   * The messages the page has posted, to a port or to this window: the evidence that it has tasks queued. Counting
   * leaves what each call does unchanged.
   */
  let posted = 0
  const Port = global.MessagePort
  const realPortPost: ((...args: Array<unknown>) => void) | undefined = typeof Port === "function"
    ? Port.prototype.postMessage
    : undefined
  if (realPortPost !== undefined) {
    Port.prototype.postMessage = function postMessage(this: unknown, ...args: Array<unknown>) {
      posted++
      return realPortPost.apply(this, args)
    }
  }
  // A worker's `postMessage` goes to the page that made it, not to its own queue
  if (typeof global.Window === "function" && global instanceof global.Window) {
    const realWindowPost = global.postMessage
    global.postMessage = function postMessage(this: unknown, ...args: Array<unknown>) {
      posted++
      return realWindowPost.apply(this, args)
    }
  }
  // The real timers, for the engine where it shares this world (`engine.ts`): the first shim's, which found them
  const real = Symbol.for("@usestrider/browser/clock/real")
  if (global[real] === undefined) {
    Object.defineProperty(global, real, {
      value: {
        setTimeout: realSetTimeout,
        clearTimeout: realClearTimeout,
        requestAnimationFrame: realFrame,
        cancelAnimationFrame: realCancelFrame,
        now: realPerf
      },
      enumerable: false
    })
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
  /** After `resume`, what `performance.now()` adds to the real one, so it carries on from `ticks`. */
  let perfBy: number | undefined = undefined
  /** After `resume`, the time it resumed at: no animation frame of the resumed clock is earlier. */
  let resumedAt = 0
  const realOrigin = performance.timeOrigin
  /** A controlled clock's `performance.timeOrigin`: the timeline's wall time where it reached this document. */
  let origin: number | undefined = initial.mode === "controlled" ? initial.wall : undefined
  Object.defineProperty(performance, "timeOrigin", {
    get: () => origin === undefined ? realOrigin : origin,
    configurable: true,
    enumerable: true
  })
  /** Whether a timer is running, or the page's tasks after it: a timer set then waits at least 1 ms. */
  let duringTick = false
  /** The controls run one after another: a host deadline can leave one running when the next arrives. */
  let chain: Promise<unknown> = Promise.resolve()
  /** Controlled timers, by an id real timers never reach. */
  const timers = new Map<number, Timer>()
  let nextId = 1_000_000_000
  /** Controlled timers moved to real ones by `resume`, by their controlled id. */
  const moved = new Map<number, { readonly real: number; readonly frame: boolean }>()

  const wall = (): number =>
    state.mode === "fixed" ? state.wall : state.mode === "offset" ? realNow() + state.by : state.wall + ticks
  const perf = (): number =>
    state.mode === "controlled" ? ticks : perfBy === undefined ? realPerf() : realPerf() + perfBy

  const callable = (callback: unknown): (...args: Array<unknown>) => void =>
    typeof callback === "function"
      ? callback as (...args: Array<unknown>) => void
      // oxlint-disable-next-line no-eval -- a string is a script, as the platform's own timers run it
      : () => (0, eval)(String(callback))
  /** Runs a timer, reporting what it throws to the page, and returns that. */
  const run = (timer: Timer): { readonly error: unknown } | undefined => {
    try {
      timer.callback.apply(global, timer.frame ? [perf()] : timer.args)
      return undefined
    } catch (error) {
      report(error)
      return { error }
    }
  }
  /**
   * Until when, on the real monotonic clock, the current control lets the page's tasks run: the host's deadline.
   * Past it, the remaining timers run without waiting, so a page that posts messages without end can't keep its
   * clock busy after the operation timed out.
   */
  let until = Infinity
  /**
   * Lets the page's queued tasks run: a message through a channel of our own, which arrives after the ones the page
   * posted before it, again while the page posted more since, then a real timer.
   */
  const yieldToPage = async () => {
    if (realPortPost !== undefined && typeof global.MessageChannel === "function") {
      const channel = new global.MessageChannel()
      let seen: number
      do {
        seen = posted
        await new Promise((resolve) => {
          channel.port1.onmessage = resolve
          realPortPost.call(channel.port2, null)
        })
      } while (posted !== seen && realPerf() < until)
      channel.port1.close()
    }
    if (realPerf() < until) await new Promise((resolve) => realSetTimeout(resolve, 0))
  }
  /** The first error the timers of one control threw, as the host reads it. */
  let thrown: { readonly error: unknown } | undefined = undefined
  /**
   * Runs one timer of `advance` or `jump`, then lets the page's tasks run, such as the messages it posted, through
   * one real timer: a timer they set counts from the time it fired at.
   */
  const step = async (timer: Timer) => {
    duringTick = true
    try {
      const result = run(timer)
      if (thrown === undefined) thrown = result
      if (realPerf() < until) await yieldToPage()
    } finally {
      duringTick = false
    }
  }
  const schedule = (callback: unknown, delay: unknown, args: Array<unknown>, every: boolean, frame: boolean) => {
    const id = nextId++
    const wait = Math.max(duringTick ? 1 : 0, Math.floor(Number(delay) || 0))
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
  const advance = async (to: number) => {
    for (let timer = due(to); timer !== undefined; timer = due(to)) {
      ticks = Math.max(ticks, timer.at)
      if (timer.every === undefined) timers.delete(timer.id)
      else timer.at += timer.every
      await step(timer)
    }
    ticks = Math.max(ticks, to)
  }
  /** Jumps controlled time to `to`: each due timer runs once, as on waking from sleep. */
  const jump = async (to: number) => {
    const list = [...timers.values()].filter((timer) => timer.at <= to).sort((a, b) => a.at - b.at || a.id - b.id)
    ticks = Math.max(ticks, to)
    for (const timer of list) {
      // One an earlier timer cleared doesn't run
      if (timers.get(timer.id) !== timer) continue
      if (timer.every === undefined) timers.delete(timer.id)
      else timer.at = ticks + timer.every
      await step(timer)
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
  /**
   * A real animation frame's time on the timeline `performance.now()` reads: not before the clock resumed, nor
   * after now, which Firefox's coarser `performance.now()` can otherwise read as earlier than the frame.
   */
  const frameTime = (at: number): number =>
    perfBy === undefined ? at : Math.min(perf(), Math.max(resumedAt, at + perfBy))
  /** Real time again: the controlled timers waiting move to real ones. */
  const release = () => {
    for (const timer of timers.values()) {
      const wait = Math.max(0, timer.at - ticks)
      const real = timer.frame
        ? realFrame((at: number) => {
          moved.delete(timer.id)
          timer.callback.call(global, frameTime(at))
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
      state.mode === "controlled"
        ? schedule(callback, 0, [], false, true)
        : perfBy !== undefined && typeof callback === "function"
        ? realFrame((at: number) => callback.call(global, frameTime(at)))
        : realFrame(callback)
    global.cancelAnimationFrame = (id: unknown) => {
      if (timers.has(Number(id)) || moved.has(Number(id))) clear(id)
      else realCancelFrame(id)
    }
  }

  /** Moves controlled real time to an offset one, `performance.now()` carrying on from where it is. */
  const toReal = () => {
    perfBy = ticks - realPerf()
    resumedAt = ticks
    release()
  }
  /** Starts a controlled timeline in this document, from 0 at the timeline's wall time `wall`. */
  const toControlled = (wall: number) => {
    ticks = 0
    perfBy = undefined
    origin = wall
  }
  /**
   * What the host can read of a thrown value, whatever it is: a property read, a conversion and even `instanceof`
   * can run the page's getters or a proxy's traps, so each runs guarded, and what throws or isn't a string is left
   * out.
   */
  const describe = (error: unknown) => {
    const attempt = <A>(read: () => A): A | undefined => {
      try {
        return read()
      } catch {
        return undefined
      }
    }
    const text = (read: () => unknown) => {
      const value = attempt(read)
      return typeof value === "string" ? value : undefined
    }
    if (typeof error !== "object" && typeof error !== "function") {
      return { name: "Error", message: typeof error === "symbol" ? error.toString() : String(error), stack: null }
    }
    if (error === null) return { name: "Error", message: "null", stack: null }
    const isError = attempt(() => error instanceof Error) === true
    return {
      name: (isError ? text(() => (error as Error).name) : undefined) ?? "Error",
      message: (isError ? text(() => (error as Error).message) : undefined)
        ?? text(() => Object.prototype.toString.call(error))
        ?? "a value that can't be read",
      stack: (isError ? text(() => (error as Error).stack) : undefined) ?? null
    }
  }
  /**
   * Runs a control after the ones before it. It resolves to `"done"`, or to the first error a timer threw, as
   * `"threw "` and the JSON of its name, message, and stack.
   */
  const queue = (control: () => void | Promise<void>, budget = Infinity): Promise<string> => {
    // The budget counts from when the host sent the control, not from when the ones before it finish
    const stop = realPerf() + budget
    const next = chain.then(async () => {
      thrown = undefined
      until = stop
      await control()
      // `thrown` is set inside `control`, which narrowing can't see
      const result = thrown as { readonly error: unknown } | undefined
      thrown = undefined
      if (result === undefined) return "done"
      return "threw " + JSON.stringify(describe(result.error))
    })
    chain = next.catch(() => undefined)
    return next
  }

  const controls = {
    get version() {
      return current
    },
    /** A newer state of the timeline, from another declaration or an operation. */
    set: (next: State, at: number) =>
      queue(() => {
        if (at <= current) return
        current = at
        if (state.mode === "controlled" && next.mode !== "controlled") toReal()
        if (state.mode !== "controlled" && next.mode === "controlled") toControlled(next.wall)
        // A controlled document keeps the time that passed in it: the timeline's wall time is now `next.wall`
        state = next.mode === "controlled" ? { mode: "controlled", wall: next.wall - ticks } : next
      }),
    adjust: (by: number, at: number, budget: number) =>
      queue(async () => {
        current = Math.max(current, at)
        await advance(ticks + by)
      }, budget),
    setTime: (to: number, at: number, budget: number) =>
      queue(async () => {
        current = Math.max(current, at)
        if (state.mode === "fixed") state = { mode: "fixed", wall: to }
        else if (state.mode === "controlled") {
          const delta = to - wall()
          if (delta > 0) await jump(ticks + delta)
          state = { mode: "controlled", wall: to - ticks }
        }
      }, budget),
    resume: (at: number) =>
      queue(() => {
        current = Math.max(current, at)
        const by = wall() - realNow()
        if (state.mode === "controlled") toReal()
        state = { mode: "offset", by }
      })
  }
  Object.defineProperty(global, symbol, { value: controls, enumerable: false })
  return "installed"
}

/** The script that installs the shim with a state: for a document's start, and for evaluation in one now. */
const installer = (key: string, state: State, version: number) =>
  `(${shim.toString()})(${JSON.stringify(key)}, ${JSON.stringify(state)}, ${version})`

/**
 * Runs an operation in a document that has the shim: a function declaration for `evaluate`, whose promise
 * resolves to `"missing"`, `"done"`, or `"threw "` and the JSON of the first error a timer threw.
 */
const operationSource = (
  key: string,
  name: "adjust" | "setTime" | "resume",
  argument: number | undefined,
  version: number
) =>
(budget: number) =>
  `function() {
  const clock = globalThis[Symbol.for(${JSON.stringify(key)})];
  if (clock === undefined) return "missing";
  return clock.${name}(${argument === undefined ? "" : `${argument}, `}${version}, ${budget});
}`

/** A timer's error in one document, from the JSON the shim resolved to. */
interface Thrown {
  readonly url: string
  readonly exception: typeof ThrownException.Type
}

/** What the shim reads of a thrown value. */
const ThrownException = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
  stack: Schema.NullOr(Schema.String)
})

/**
 * The thrown value the shim described. The page's world runs the shim, so a page that replaced `JSON.stringify`
 * can send anything; what doesn't decode is still a timer's error, one that can't be read.
 */
const decodeThrown = (text: string): typeof ThrownException.Type =>
  Option.getOrElse(
    Schema.decodeUnknownOption(Schema.fromJsonString(ThrownException))(text),
    () => ({ name: "Error", message: "a value that can't be read", stack: null })
  )

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

/** Every timeline of a connection, by what owns it: a page's entry or a context's. The runtime holds them. */
export type Timelines = WeakMap<object, { installed: Option.Option<Installed> }>

/** A connection's timelines, none yet. */
export const makeTimelines = (): Timelines => new WeakMap()

/** Whether a page's or a context's clock is installed. */
export const isInstalled = (timelines: Timelines, owner: object): boolean =>
  Option.isSome(timelines.get(owner)?.installed ?? Option.none())

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
      // A whole millisecond, as `Date.now()` is, truncated toward zero
      const by = DurationInput.toFiniteMillis(mode.by)
      return Option.isSome(by)
        ? { mode: "offset", by: Math.trunc(by.value) }
        : `${String(mode.by)} isn't a finite duration`
    }
  }
}

/** A page clock over a timeline. */
export const make = (owner: Owner, key: object): PageClock.PageClock => {
  const timeline = { installed: Option.none<Installed>() }
  owner.runtime.timelines.set(key, timeline)
  const token = `@usestrider/browser/clock/${crypto.randomUUID()}`
  /**
   * The newest version any install of this clock declared: a document keeps the shim of an earlier install, under
   * the same symbol, and takes only a newer state.
   */
  let latest = 0
  const adapter = owner.runtime.model.adapter
  // One operation at a time reads the timeline and replaces its init script, so each closes the one it replaced
  const permit = Semaphore.makeUnsafe(1)
  /**
   * Runs an operation's body holding the permit. Waiting for it is bounded by the operation's deadline, on the
   * browser's clock, and fails with the operation's `Timeout`; the body, once it holds the permit, keeps it to its end.
   */
  const exclusive = <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.flatMap(Operation.record, (record) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.andThen(
          restore(record.bound(permit.take(1), () => Option.some("another operation of this clock was still running"))),
          restore(self).pipe(Effect.ensuring(permit.release(1)))
        )
      ))

  /**
   * Evaluates in the main world of every current document of the timeline's pages, and with `workers` in their
   * dedicated workers; a document or worker that ends is skipped. Every one runs to its end, and the errors their
   * timers threw are returned, by where they threw; then it fails with the first that failed, if any did.
   */
  const broadcast = (functionDeclaration: string, workers: boolean, awaitPromise: boolean) =>
    Effect.flatMap(
      Effect.forEach(owner.pages(), (page) => page.state.get),
      (states) =>
        Effect.forEach(
          [
            // Each page's document and its frames'
            ...states.flatMap((state) => [
              ...(state.status._tag === "Open" ? [{ id: state.status.document.id, url: state.status.url }] : []),
              ...state.frames.flatMap((frame) =>
                Option.toArray(Option.map(frame.document, (id) => ({ id, url: frame.url })))
              )
            ]).map((document) => ({ url: document.url, realm: adapter.realm(document.id, { _tag: "Main" }) })),
            ...(workers ? states.flatMap((state) => state.workers) : []).map((worker) => ({
              url: worker.url,
              realm: Effect.succeed(worker.realm)
            }))
          ],
          (where) =>
            where.realm.pipe(
              Effect.flatMap((realm) =>
                adapter.evaluate(realm, {
                  functionDeclaration,
                  arguments: [],
                  awaitPromise,
                  result: "value",
                  userActivation: false
                })
              ),
              Effect.flatMap((result): Effect.Effect<Array<Thrown>, string> => {
                if (result._tag === "Exception") {
                  return Effect.fail(`the clock threw in ${where.url}: ${result.text}`)
                }
                const value = result.value
                return Effect.succeed(
                  value.type === "string" && value.value.startsWith("threw ")
                    ? [{ url: where.url, exception: decodeThrown(value.value.slice("threw ".length)) }]
                    : []
                )
              }),
              Effect.catch((error) =>
                typeof error === "string" || Deadline.isTimeout(error)
                  ? Effect.fail(error)
                  : error.reason._tag === "Gone"
                  ? Effect.succeed([])
                  : Effect.fail(error.message)
              ),
              Effect.exit
            ),
          { concurrency: "unbounded" }
        )
    ).pipe(Effect.flatMap((exits) => {
      const failed = exits.find(Exit.isFailure)
      return failed === undefined
        ? Effect.succeed(exits.flatMap((exit) => Exit.isSuccess(exit) ? exit.value : []))
        : Effect.failCause(failed.cause)
    }))

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

  const clockError = (operation: string, reason: PageClock.PageClockErrorReason, id = Operation.idNow()) =>
    new PageClock.PageClockError({ operation, reason, diagnostics: Operation.diagnostics(id) })

  const backendFailure = (method: string, hint: string) => new Reason.BackendFailure({ kind: "Rejected", method, hint })

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

  /**
   * Applies an operation to every document now, then declares the timeline's new state for later ones, which the
   * timeline has whether or not the documents took it. Fails with the first error a page's timer threw. `step`
   * reads the timeline under the permit, so an operation waiting on another sees what that one left.
   */
  const apply = (
    operation: string,
    modes: ReadonlyArray<State["mode"]>,
    step: (installed: Installed) => { readonly next: State; readonly run: (budget: number) => string }
  ) =>
    exclusive(Effect.gen(function*() {
      const installed = yield* require(operation, modes)
      const { next, run } = step(installed)
      yield* Effect.annotateCurrentSpan("browser.clock.mode", next.mode)
      installed.version++
      latest = installed.version
      installed.state = next
      // The page stops waiting for its own tasks once the operation's time is up, so its clock stays usable
      const budget = Option.match(yield* Deadline.remaining, {
        onNone: () => Infinity,
        onSome: (left) => Math.max(0, Duration.toMillis(left))
      })
      const applied = yield* Effect.exit(
        broadcast(run(budget), installed.workers, true).pipe(
          Effect.mapError((hint) =>
            Deadline.isTimeout(hint) ? hint : clockError(operation, backendFailure("evaluate", hint))
          )
        )
      )
      const previous = installed.script
      const declared = yield* Effect.exit(
        declare(installed).pipe(
          Effect.mapError((error) =>
            Deadline.isTimeout(error) ? error : clockError(operation, backendFailure("declare", error.message))
          )
        )
      )
      if (Exit.isSuccess(declared)) {
        installed.script = declared.value
        yield* Scope.close(previous, Exit.void)
      }
      const thrown = yield* applied
      yield* declared
      if (thrown.length > 0) {
        const first = thrown[0]!
        return yield* Effect.fail(clockError(
          operation,
          new Reason.EvaluationThrown({
            exception: { ...first.exception, stack: Option.fromNullishOr(first.exception.stack) },
            hint: `A timer threw in ${first.url}${
              thrown.length > 1 ? `, and in ${thrown.length - 1} more documents` : ""
            }; the clock still reached its time, and the page saw each error`
          })
        ))
      }
    })).pipe(Operation.named(operation, { attributes: Spans.scopeAttributes(owner.scope) }))

  return {
    install: (mode, options) =>
      exclusive(Effect.gen(function*() {
        const operation = `${owner.name}.install`
        const { id } = yield* Operation.record
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
        const installed: Installed = { state, version: ++latest, workers, scope, script: scope }
        installed.script = yield* declare(installed).pipe(
          Effect.mapError((error) =>
            Deadline.isTimeout(error) ? error : fail(backendFailure("declare", error.message))
          ),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
        // The documents loaded already get it now; what their scripts captured before keeps real time
        yield* broadcast(`function() { return ${installer(token, state, installed.version)} }`, workers, false).pipe(
          Effect.mapError((hint) => Deadline.isTimeout(hint) ? hint : fail(backendFailure("evaluate", hint))),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
        timeline.installed = Option.some(installed)
        // Removing it affects later documents only: those it reached keep the shim (CONCEPTS.md §7)
        yield* Scope.addFinalizer(scope, Effect.sync(() => (timeline.installed = Option.none())))
        return { remove: Scope.close(scope, Exit.void) } satisfies Declaration.Registration
      })).pipe(Operation.named(`${owner.name}.install`, {
        attributes: { ...Spans.scopeAttributes(owner.scope), "browser.clock.mode": mode.mode }
      })),
    adjust: Effect.fnUntraced(function*(duration: Duration.Input) {
      const operation = `${owner.name}.adjust`
      const by = Option.filter(DurationInput.toFiniteMillis(duration), (ms) => ms >= 0)
      if (Option.isNone(by)) {
        return yield* Effect.fail(clockError(
          operation,
          new Reason.InvalidInput({
            input: "duration",
            expected: "a finite duration of zero or more",
            hint: `${String(duration)} isn't one`
          })
        ))
      }
      // Up to a whole millisecond, as timers and `Date.now()` count
      const ms = Math.ceil(by.value)
      yield* apply(operation, ["controlled"], (installed) => ({
        next: { mode: "controlled", wall: (installed.state as Extract<State, { mode: "controlled" }>).wall + ms },
        run: operationSource(token, "adjust", ms, installed.version + 1)
      }))
    }),
    setTime: Effect.fnUntraced(function*(at: DateTime.DateTime.Input) {
      const operation = `${owner.name}.setTime`
      const wall = Option.map(DateTime.make(at), DateTime.toEpochMillis)
      if (Option.isNone(wall)) {
        return yield* Effect.fail(clockError(
          operation,
          new Reason.InvalidInput({ input: "at", expected: "a time", hint: `${String(at)} isn't one` })
        ))
      }
      yield* apply(operation, ["fixed", "controlled"], (installed) => ({
        next: { mode: installed.state.mode as "fixed" | "controlled", wall: wall.value },
        run: operationSource(token, "setTime", wall.value, installed.version + 1)
      }))
    }),
    resume: apply(`${owner.name}.resume`, ["fixed", "offset", "controlled"], (installed) => {
      const now = Date.now()
      const wall = installed.state.mode === "offset" ? now + installed.state.by : installed.state.wall
      return {
        next: { mode: "offset", by: wall - now },
        run: operationSource(token, "resume", undefined, installed.version + 1)
      }
    })
  }
}
