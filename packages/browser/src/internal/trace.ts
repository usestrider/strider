/**
 * Trace recordings (review 20, candidate 4): a page's or context's operations as the steps of a Playwright trace,
 * format version 9 (research/playwright-trace-format.md), which trace.playwright.dev opens.
 *
 * - **Steps.** Each library operation on the target is a step, through the span helper: its name, its
 *   attributes as params, its duration and its error. A span of the caller's that encloses one is a step too, so
 *   the trace nests as the program did; it spans the operations recorded inside it.
 * - **Events.** Console messages, uncaught exceptions as `pageError`s, a screenshot after each action, and
 *   screencast frames, native or polled.
 * - **Network.** The HAR's entries, in `trace.network`, with their bodies in `resources/`.
 *
 * Times come from the library's monotonic clock, never Effect's `Clock` (review 20); params are redacted under
 * the diagnostics preset in force at export.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Tracer from "effect/Tracer"
import * as Capability from "../Capability.ts"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import * as Diagnostics from "../Diagnostics.ts"
import type * as FilePath from "../FilePath.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as Target from "../Target.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import * as Adapter from "./adapter.ts"
import * as Capabilities from "./capabilities.ts"
import * as Events from "./events.ts"
import * as HarImpl from "./har.ts"
import type * as Model from "./model.ts"
import * as Recorders from "./recorders.ts"
import * as Recordings from "./recordings.ts"
import type * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

/** What a recording asks for. */
export interface Settings {
  readonly screenshots: "perAction" | "off"
  readonly screencast: "native" | { readonly polled: Duration.Input } | "off"
  readonly network: boolean
}

/** What a trace records about. */
export type Recorded =
  | { readonly _tag: "Page"; readonly entry: Model.PageEntry }
  | { readonly _tag: "UserContext"; readonly entry: Model.ContextEntry }

interface Step {
  readonly callId: string
  readonly parentId: Option.Option<string>
  readonly name: string
  readonly params: Readonly<Record<string, unknown>>
  readonly start: MonotonicInstant.MonotonicInstant
  end: Option.Option<MonotonicInstant.MonotonicInstant>
  error: Option.Option<{ readonly name: string; readonly message: string }>
  /** A span of the caller's, which spans the operations recorded inside it. */
  readonly group: boolean
}

interface Shot {
  readonly callId: string
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly png: Uint8Array
}

interface Frame {
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly width: number
  readonly height: number
  readonly jpeg: Uint8Array
}

/** The operations an action screenshot follows: the ones that change the page. */
const actions = new Set([
  "Locator.click",
  "Locator.dblclick",
  "Locator.tap",
  "Locator.hover",
  "Locator.check",
  "Locator.uncheck",
  "Locator.focus",
  "Locator.clear",
  "Locator.fill",
  "Locator.press",
  "Locator.pressSequentially",
  "Locator.selectOption",
  "Locator.setInputFiles",
  "Locator.dragTo",
  "Locator.scrollIntoView",
  "Page.goto",
  "Page.reload",
  "Page.back",
  "Page.forward"
])

const errorOf = (exit: Exit.Exit<unknown, unknown>): Option.Option<{ name: string; message: string }> => {
  if (Exit.isSuccess(exit)) return Option.none()
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (failure !== undefined) {
    const error = failure.error as { readonly _tag?: unknown; readonly name?: unknown; readonly message?: unknown }
    return Option.some({
      name: typeof error._tag === "string" ? error._tag : typeof error.name === "string" ? error.name : "Error",
      message: typeof error.message === "string" ? error.message : String(failure.error)
    })
  }
  return Option.some(
    Cause.hasInterruptsOnly(exit.cause)
      ? { name: "Interrupted", message: "The operation was interrupted" }
      : { name: "Defect", message: Cause.pretty(exit.cause) }
  )
}

const png: Adapter.ScreenshotOptions = {
  format: "png",
  quality: Option.none(),
  clip: Option.none(),
  fullPage: false,
  scale: "device",
  omitBackground: false
}

/** Starts recording for the scope: a child scope of it, which `stop` closes. */
export const start = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  target: Recorded,
  settings: Settings,
  scope: Scope.Scope
) {
  const own = yield* Scope.fork(scope)
  const clock = Recordings.anchor()
  const steps: Array<Step> = []
  const bySpan = new Map<string, string>()
  const shots: Array<Shot> = []
  const frames: Array<Frame> = []
  const consoles: Array<{ readonly message: ConsoleMessage.ConsoleMessage }> = []
  const exceptions: Array<UncaughtException.UncaughtException> = []
  let calls = 0

  const pageOf = (id: unknown): Option.Option<Model.PageEntry> =>
    typeof id === "string" ? Option.fromNullishOr(runtime.model.pages.get(id as Target.NavigableId)) : Option.none()

  const covers = (attributes: Readonly<Record<string, unknown>>): boolean => {
    const page = attributes["browser.page.id"]
    if (target._tag === "Page") return page === target.entry.id
    return attributes["browser.context.id"] === target.entry.id ||
      Option.exists(pageOf(page), (entry) => entry.context === target.entry.id)
  }

  // A span the step runs in: a recorded operation's, or one of the caller's, which becomes a step of its own
  const stepOf = (span: Tracer.AnySpan): Option.Option<string> => {
    const known = bySpan.get(span.spanId)
    if (known !== undefined) return Option.some(known)
    if (span._tag === "ExternalSpan") return Option.none()
    const callId = `g${++calls}`
    bySpan.set(span.spanId, callId)
    steps.push({
      callId,
      parentId: Option.flatMap(span.parent, stepOf),
      name: span.name,
      params: Object.fromEntries(span.attributes),
      start: Adapter.now(),
      end: Option.none(),
      error: Option.none(),
      group: true
    })
    return Option.some(callId)
  }

  const recorder: Recorders.Recorder = {
    covers,
    begin: (started) => {
      const callId = `c${++calls}`
      let parentId: Option.Option<string>
      if (started.own && Option.isSome(started.span)) {
        bySpan.set(started.span.value.spanId, callId)
        parentId = started.span.value._tag === "Span"
          ? Option.flatMap(started.span.value.parent, stepOf)
          : Option.none()
      } else {
        parentId = Option.flatMap(started.span, stepOf)
      }
      const step: Step = {
        callId,
        parentId,
        name: started.name,
        params: started.attributes,
        start: Adapter.now(),
        end: Option.none(),
        error: Option.none(),
        group: false
      }
      steps.push(step)
      return (exit) =>
        Effect.gen(function*() {
          step.end = Option.some(Adapter.now())
          step.error = errorOf(exit)
          const page = started.attributes["browser.page.id"]
          if (settings.screenshots !== "perAction" || !actions.has(started.name) || typeof page !== "string") return
          const shot = yield* runtime.model.adapter.screenshot(page as Target.NavigableId, png).pipe(Effect.option)
          if (Option.isSome(shot)) {
            shots.push({ callId, page: page as Target.NavigableId, at: Adapter.now(), png: shot.value })
          }
        })
    }
  }
  yield* Recorders.register(recorder).pipe(Scope.provide(own))

  // Console messages and uncaught exceptions
  const messages = yield* Events.recorded(target.entry.events.console, () => true).pipe(Scope.provide(own))
  yield* Effect.gen(function*() {
    while (true) consoles.push({ message: (yield* Queue.take(messages)).value })
  }).pipe(Effect.ignore, Effect.forkIn(own))
  const thrown = yield* Events.recorded(target.entry.events.exception, () => true).pipe(Scope.provide(own))
  yield* Effect.gen(function*() {
    while (true) exceptions.push((yield* Queue.take(thrown)).value)
  }).pipe(Effect.ignore, Effect.forkIn(own))

  // Screencast frames, from each page of the target as it appears
  const screencast = settings.screencast
  if (screencast !== "off") {
    const seen = new Set<Target.NavigableId>()
    const cast = (page: Model.PageEntry) =>
      screencast === "native"
        ? Capabilities.acquire(runtime, page, Capability.Screencast).pipe(
          Effect.flatMap((control) =>
            Stream.runForEach(control.frames, (frame) =>
              Effect.sync(() =>
                frames.push({ page: page.id, at: frame.at, width: frame.width, height: frame.height, jpeg: frame.jpeg })
              ))
          ),
          Effect.scoped
        )
        : Effect.gen(function*() {
          const jpeg: Adapter.ScreenshotOptions = { ...png, format: "jpeg", quality: Option.some(50) }
          while (true) {
            yield* Effect.sleep(screencast.polled)
            const shot = yield* runtime.model.adapter.screenshot(page.id, jpeg)
            frames.push({ page: page.id, at: Adapter.now(), ...Adapter.jpegSize(shot), jpeg: shot })
          }
        })
    const follow = (page: Model.PageEntry) =>
      Effect.suspend(() => {
        if (seen.has(page.id)) return Effect.void
        seen.add(page.id)
        return cast(page).pipe(Effect.ignore, Effect.forkIn(own), Effect.asVoid)
      })
    if (target._tag === "Page") yield* follow(target.entry)
    else {
      yield* SubscriptionRef.changes(target.entry.state).pipe(
        Stream.runForEach((state) =>
          Effect.forEach(state.pages, (id) => Option.match(pageOf(id), { onNone: () => Effect.void, onSome: follow }), {
            discard: true
          })
        ),
        Effect.forkIn(own)
      )
    }
  }

  // Network entries, with their bodies, as a HAR records them
  const network = settings.network
    ? Option.some(
      (yield* HarImpl.start(runtime, target.entry, {
        content: "attach",
        matches: () => true,
        webSocketFrames: false,
        inFlightAtStop: "markIncomplete"
      }, own)).recorder
    )
    : Option.none()

  const exportTrace = Effect.fnUntraced(function*(path: FilePath.Local | string) {
    const preset = yield* Diagnostics.CurrentPreset
    const exported = Adapter.now()
    const info = runtime.model.adapter.info
    const events: Array<{ readonly time: number; readonly event: Record<string, unknown> }> = []
    // A caller's span spans the operations recorded inside it
    const children = new Map<string, Array<Step>>()
    for (const step of steps) {
      if (Option.isSome(step.parentId)) {
        const list = children.get(step.parentId.value) ?? []
        list.push(step)
        children.set(step.parentId.value, list)
      }
    }
    const bounds = (step: Step): { start: number; end: number } => {
      if (!step.group) {
        return { start: step.start, end: Option.getOrElse(step.end, () => exported) }
      }
      const nested = (children.get(step.callId) ?? []).map(bounds)
      return nested.length === 0
        ? { start: step.start, end: step.start }
        : { start: Math.min(...nested.map((each) => each.start)), end: Math.max(...nested.map((each) => each.end)) }
    }
    const params = (raw: Readonly<Record<string, unknown>>) =>
      Object.fromEntries(
        Object.entries(raw).flatMap(([key, value]) =>
          value === undefined || typeof value === "object" && value !== null
            ? []
            : [[
              key,
              typeof value === "string" && (key === "url.full" || key === "browser.endpoint")
                ? Spans.redactUrl(value, preset)
                : value
            ]]
        )
      )
    for (const step of steps) {
      const { start, end } = bounds(step)
      const dot = step.name.indexOf(".")
      events.push({
        time: start,
        event: {
          type: "before",
          callId: step.callId,
          startTime: Recordings.millis(start as MonotonicInstant.MonotonicInstant),
          title: step.name,
          class: step.group ? "Effect" : dot > 0 ? step.name.slice(0, dot) : "Strider",
          method: step.group ? "span" : dot > 0 ? step.name.slice(dot + 1) : step.name,
          params: params(step.params),
          ...(Option.isSome(step.parentId) ? { parentId: step.parentId.value } : {})
        }
      })
      events.push({
        time: end,
        event: {
          type: "after",
          callId: step.callId,
          endTime: Recordings.millis(end as MonotonicInstant.MonotonicInstant),
          ...(Option.isSome(step.error) ? { error: step.error.value } : {})
        }
      })
    }
    const files: Array<{ path: string; content: string | Uint8Array }> = []
    for (const shot of shots) {
      const file = `screenshots/${shot.callId}-after.png`
      files.push({ path: file, content: shot.png })
      events.push({
        time: shot.at,
        event: {
          type: "screenshot",
          callId: shot.callId,
          phase: "after",
          pageId: shot.page,
          timestamp: Recordings.millis(shot.at),
          file
        }
      })
    }
    frames.forEach((frame, index) => {
      const file = `screencast/${frame.page}-${index}.jpeg`
      files.push({ path: file, content: frame.jpeg })
      events.push({
        time: frame.at,
        event: {
          type: "screencast-frame",
          pageId: frame.page,
          file,
          width: frame.width,
          height: frame.height,
          timestamp: Recordings.millis(frame.at)
        }
      })
    })
    for (const { message } of consoles) {
      events.push({
        time: message.at,
        event: {
          type: "console",
          time: Recordings.millis(message.at),
          ...(message.origin._tag === "Page" ? { pageId: message.origin.page } : {}),
          messageType: message.level,
          text: message.text,
          location: Option.match(message.location, {
            onNone: () => ({ url: "", lineNumber: 0, columnNumber: 0 }),
            onSome: (location) => ({ url: location.url, lineNumber: location.line, columnNumber: location.column })
          })
        }
      })
    }
    for (const exception of exceptions) {
      events.push({
        time: exception.at,
        event: {
          type: "event",
          time: Recordings.millis(exception.at),
          class: "BrowserContext",
          method: "pageError",
          params: {
            error: {
              error: {
                name: exception.name,
                message: exception.message,
                ...(Option.isSome(exception.stack) ? { stack: exception.stack.value } : {})
              }
            }
          },
          ...(exception.origin._tag === "Page" ? { pageId: exception.origin.page } : {})
        }
      })
    }
    events.sort((a, b) => a.time - b.time)
    const header = {
      version: 9,
      type: "context-options",
      origin: "library",
      browserName: info.protocol === "cdp"
        ? "chromium"
        : info.protocol === "webkit"
        ? "webkit"
        : info.protocol === "bidi"
        ? "firefox"
        : info.protocol,
      platform: (globalThis as { readonly process?: { readonly platform?: string } }).process?.platform ??
        "unknown",
      wallTime: clock.wall,
      monotonicTime: Recordings.millis(clock.monotonic),
      options: {}
    }
    const lines = [header, ...events.map((each) => each.event)].map((line) => JSON.stringify(line)).join("\n")
    files.unshift({ path: "trace.trace", content: `${lines}\n` })
    if (Option.isSome(network)) {
      const recorder = network.value
      yield* recorder.flush
      const { files: bodies, log } = HarImpl.logOf(recorder.entries, recorder.clock, {
        detail: "full",
        include: new Set(),
        bodies: { _tag: "File", prefix: "resources/" }
      }, { name: info.product, version: info.version })
      const resources = log.log.entries.map((entry) => JSON.stringify({ type: "resource-snapshot", snapshot: entry }))
      files.push({ path: "trace.network", content: resources.length === 0 ? "" : `${resources.join("\n")}\n` })
      files.push(...bodies)
    }
    const resolved = yield* Recordings.resolve(runtime, path)
    const bytes = yield* Recordings.zip(files)
    return yield* Recordings.write(runtime, resolved, bytes)
  })

  return { exportTrace, stop: Scope.close(own, Exit.void) }
})
