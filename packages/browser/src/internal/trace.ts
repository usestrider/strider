/**
 * Trace recordings: a page's or context's operations as the steps of a Playwright trace,
 * format version 9 (research/playwright-trace-format.md), which trace.playwright.dev opens.
 *
 * - **Steps.** Each library operation on the target is a step, through the span helper: its name, its
 *   attributes as params, its duration and its error. A span of the caller's that encloses one is a step too, so
 *   the trace nests as the program did; it spans the operations recorded inside it.
 * - **Events.** Console messages, uncaught exceptions as `pageError`s, a screenshot after each action and page expectation, and
 *   screencast frames, native or polled, or on Firefox its video of each page.
 * - **DOM snapshots** (`capture.ts`): every frame of the action's page captured before and after each
 *   action, the target, resolved by the action's locator, marked in the one after. A snapshot's secret values
 *   are redacted at export under the strict preset.
 * - **Network.** The HAR's entries, in `trace.network`, with their bodies in `resources/`.
 *
 * Times come from the library's monotonic clock, never Effect's `Clock`; params are redacted under
 * the diagnostics preset in force at export.
 */
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Hex from "effect/encoding/Hex"
import * as Exit from "effect/Exit"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Tracer from "effect/Tracer"
import * as Capability from "../Capability.ts"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import * as Diagnostics from "../Diagnostics.ts"
import * as Expect from "../Expect.ts"
import type * as FilePath from "../FilePath.ts"
import type * as MonotonicInstant from "../MonotonicInstant.ts"
import type * as Target from "../Target.ts"
import * as TestRun from "../test/TestRun.ts"
import type * as UncaughtException from "../UncaughtException.ts"
import * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Capabilities from "./capabilities.ts"
import * as Capture from "./capture.ts"
import * as Events from "./events.ts"
import * as ExpectImpl from "./expect.ts"
import * as Filters from "./filters.ts"
import * as HarImpl from "./har.ts"
import * as HarLog from "./harLog.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Recorders from "./recorders.ts"
import * as Recordings from "./recordings.ts"
import * as Runtime from "./runtime.ts"
import * as Spans from "./spans.ts"

/** What a recording asks for. */
export interface Settings {
  readonly screenshots: "perAction" | "off"
  readonly screencast: "native" | { readonly polled: Duration.Input } | "off"
  readonly network: boolean
  readonly domSnapshots: boolean
}

/** What a trace records about. */
export type Recorded =
  | { readonly _tag: "Page"; readonly entry: Model.PageEntry }
  | { readonly _tag: "UserContext"; readonly entry: Model.ContextEntry }

/** Ordinary errors are already text; expectations retain evidence until the export chooses its preset. */
type RecordedError = { readonly name: string; readonly message: string } | Expect.ExpectationFailed

interface Step {
  readonly stack: ReadonlyArray<Recorders.Location>
  readonly callId: string
  readonly parentId: Option.Option<string>
  readonly name: string
  readonly params: Readonly<Record<string, unknown>>
  readonly start: MonotonicInstant.MonotonicInstant
  end: Option.Option<MonotonicInstant.MonotonicInstant>
  error: Option.Option<RecordedError>
  /** A span of the caller's, which spans the operations recorded inside it. */
  readonly group: boolean
}

interface Shot {
  readonly callId: string
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly png: Uint8Array
}

/** One action's capture of its page, before or after it. */
interface Snapshot {
  readonly callId: string
  readonly phase: "before" | "after"
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly captures: ReadonlyArray<Capture.FrameCapture>
}

/** A video of a page: recording until the first export, which reads its file. */
interface Video {
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly scope: Scope.Closeable
  readonly recording: Capability.VideoRecording
  finished: boolean
  read: Option.Option<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }>
}

/** Kept as a cause until export, so each export applies its own diagnostics preset. */
interface VideoFailure {
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly stage: "acquisition" | "stop" | "file-read"
  readonly cause: Cause.Cause<unknown>
}

/** Console errors are displayed by the reader, including their page and the complete underlying cause. */
const videoFailureEvent = (failure: VideoFailure, preset: Diagnostics.Preset): Record<string, unknown> => {
  let detail: string
  try {
    detail = Cause.pretty(failure.cause)
  } catch {
    detail = "[Unprintable video failure]"
  }
  if (preset === "strict") {
    detail = detail.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/g, (url) => Spans.redactUrl(url, preset))
  }
  return {
    type: "console",
    time: Recordings.millis(failure.at),
    pageId: failure.page,
    messageType: "error",
    text: `Native video for page ${failure.page} failed during ${failure.stage}:\n${detail}`,
    location: { url: "", lineNumber: 0, columnNumber: 0 }
  }
}

/** A snapshot of incomplete acquisition, not a terminal recording failure. */
const pendingVideoEvent = (
  page: Target.NavigableId,
  at: MonotonicInstant.MonotonicInstant
): Record<string, unknown> => ({
  type: "console",
  time: Recordings.millis(at),
  pageId: page,
  messageType: "error",
  text: `Native video for page ${page}: acquisition is still pending at export; no video is available in this export.`,
  location: { url: "", lineNumber: 0, columnNumber: 0 }
})

interface Frame {
  readonly page: Target.NavigableId
  readonly at: MonotonicInstant.MonotonicInstant
  readonly width: number
  readonly height: number
  /** JPEG, or PNG where the backend writes nothing else (stock WebKit). */
  readonly image: Uint8Array
  readonly format: "jpeg" | "png"
}

/** A PNG's size, from its header. */

/** The operations whose DOM snapshots surround changes to the page. */
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

/** Observations may contain cycles, bigints or user-defined inspection that throws. */
const observedText = (value: unknown): string => {
  try {
    return Inspectable.toStringUnknown(value)
  } catch {
    return "[Unprintable observed value]"
  }
}

/** Keep the evidence in the message: existing trace viewers display only name and message. */
const expectationMessage = (error: Expect.ExpectationFailed, preset: Diagnostics.Preset): string => {
  const kind = ExpectImpl.evidenceKind(error)
  const url = kind === "URL" || kind === "SourceURL"
  // Form values are classified typed text in both presets; titles are hidden only under strict.
  const hidden = kind === "Value" || (kind === "Title" || kind === "SourceTitle") && preset === "strict"
  const valueText = (value: unknown) =>
    hidden
      ? "REDACTED"
      : observedText(url && typeof value === "string" ? Spans.redactUrl(value, preset) : value)
  let condition = error.condition
  if (hidden && kind !== "SourceTitle") {
    condition = kind === "Value"
      ? "to have the value REDACTED"
      : "to have the title REDACTED"
  } else if (kind === "URL" && preset === "strict") {
    // String matchers are JSON-quoted by the expectation. A regexp isn't a URL and can't be safely parsed.
    let expected = "REDACTED"
    try {
      const raw: unknown = JSON.parse(condition.slice("to have the URL ".length))
      if (typeof raw === "string") expected = JSON.stringify(Spans.redactUrl(raw, preset))
    } catch {
      // Keep the URL redactor's refusal for input that isn't a whole URL.
    }
    condition = `to have the URL ${expected}`
  }
  const lines = [`Expected ${error.subject} ${condition}`]
  if (Option.isSome(error.last)) lines.push(`Last observed: ${valueText(error.last.value.value)}`)
  if (error.history.length > 0) {
    lines.push("History:", ...error.history.map((entry) => `  ${valueText(entry.value)}`))
  }
  lines.push(
    `Checks: ${error.checks.count}${
      error.checks.triggeredBy.length > 0 ? ` (${error.checks.triggeredBy.join(", ")})` : ""
    }`,
    `Elapsed: ${Math.round(Duration.toMillis(error.elapsed))} ms`
  )
  if (Option.isSome(error.nearest)) lines.push(`Nearest match:\n${error.nearest.value}`)
  if (error.suggestions.length > 0) lines.push(`Suggestions:\n${error.suggestions.join("\n")}`)
  return lines.join("\n")
}

const errorOf = (exit: Exit.Exit<unknown, unknown>, name: string): Option.Option<RecordedError> => {
  if (Exit.isSuccess(exit)) return Option.none()
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  if (failure !== undefined) {
    const error = failure.error as { readonly _tag?: unknown; readonly name?: unknown; readonly message?: unknown }
    if (Expect.isExpectationFailed(error)) {
      // Library failures are classified at creation, even without a recording. A manually constructed failure
      // can acquire metadata from its first recorded canonical expectation; later steps never override it.
      if (ExpectImpl.evidenceKind(error) === undefined && name.startsWith("Expect.")) {
        ExpectImpl.classifyFailure(error, name.slice("Expect.".length))
      }
      return Option.some(error)
    }
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

/** A line of `trace.network`: one HAR entry, which the trace viewer reads as a resource. */
const ResourceSnapshot = Schema.fromJsonString(Schema.Struct({
  type: Schema.Literal("resource-snapshot"),
  snapshot: HarLog.Entry
}))

/** A text's SHA-1, in hex: the name of a stylesheet's file in the trace, as the viewer's own traces name theirs. */
const digest = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-1", new TextEncoder().encode(text))).pipe(
    Effect.map((hash) => Hex.encode(new Uint8Array(hash)))
  )

/**
 * A snapshot with its secret values flagged by the capture: unflagged, and under the strict preset redacted, a
 * password input's value or a field's filled with `Redacted` text.
 */
const redactSecrets = (node: unknown, preset: Diagnostics.Preset): unknown => {
  if (!Array.isArray(node) || typeof node[0] !== "string") return node
  const [name, attributes, ...children] = node as [string, Record<string, string> | undefined, ...Array<unknown>]
  if (attributes === undefined) return node
  let written = attributes
  if (Capture.secretAttribute in attributes) {
    const { [Capture.secretAttribute]: _flag, ...rest } = attributes
    written = preset === "strict"
      ? {
        ...rest,
        "__playwright_value_": "REDACTED",
        ...("value" in rest ? { value: "REDACTED" } : {})
      }
      : rest
  }
  return [name, written, ...children.map((child) => redactSecrets(child, preset))]
}

/** A WebM file's frame size, from its first video track's `PixelWidth` and `PixelHeight`; 0 where it has none. */
const webmSize = (bytes: Uint8Array): { readonly width: number; readonly height: number } => {
  const size = { width: 0, height: 0 }
  // An EBML variable-length integer at `at`: its value, its length, and whether it is all ones (unknown size)
  const vint = (at: number, keepMarker: boolean) => {
    const first = bytes[at] ?? 0
    let length = 1
    while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length++
    let value = keepMarker ? first : first & (0xff >> length)
    let ones = value === (0xff >> length)
    for (let index = 1; index < length; index++) {
      const byte = bytes[at + index] ?? 0
      value = value * 256 + byte
      ones = ones && byte === 0xff
    }
    return { value, length, unknown: !keepMarker && ones }
  }
  // Segment, Tracks, TrackEntry and Video, the masters on the way to the size
  const masters = new Set([0x18538067, 0x1654ae6b, 0xae, 0xe0])
  const walk = (start: number, end: number) => {
    let at = start
    while (at < end && at < bytes.length && (size.width === 0 || size.height === 0)) {
      const id = vint(at, true)
      const length = vint(at + id.length, false)
      const body = at + id.length + length.length
      const stop = length.unknown ? end : Math.min(end, body + length.value)
      if (masters.has(id.value)) walk(body, stop)
      else if (id.value === 0xb0 || id.value === 0xba) {
        let value = 0
        for (let index = body; index < body + length.value; index++) value = value * 256 + (bytes[index] ?? 0)
        if (id.value === 0xb0) size.width = value
        else size.height = value
      }
      if (length.unknown && !masters.has(id.value)) return
      at = length.unknown ? body : body + length.value
    }
  }
  // The EBML header comes first; the segment after it
  walk(0, bytes.length)
  return size
}

/** Starts recording for the scope: a child scope of it, which `stop` closes. */
export const start = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  target: Recorded,
  settings: Settings,
  scope: Scope.Scope
) {
  const run = yield* Effect.serviceOption(TestRun.TestRun)
  const info = Option.isSome(run) ? run.value.info : undefined
  // Copy scalar fields now: export may run in another test or after its retry count changes.
  const test = info === undefined || info.id === "" ? undefined : {
    project: info.project,
    file: info.file,
    id: info.id,
    attempt: info.attempt,
    repeat: info.repeat ?? 0
  }
  const own = yield* Scope.fork(scope)
  const clock = Recordings.anchor()
  const steps: Array<Step> = []
  const bySpan = new Map<string, string>()
  const shots: Array<Shot> = []
  const frames: Array<Frame> = []
  const consoles: Array<{ readonly message: ConsoleMessage.ConsoleMessage }> = []
  const exceptions: Array<UncaughtException.UncaughtException> = []
  const snapshots: Array<Snapshot> = []
  const videos: Array<Video> = []
  const pendingVideos = new Set<Target.NavigableId>()
  const videoFailures: Array<VideoFailure> = []
  const retainVideoFailure = (failure: VideoFailure) => Effect.sync(() => void videoFailures.push(failure))
  const observeVideo = <A, E, R>(
    page: Target.NavigableId,
    stage: VideoFailure["stage"],
    effect: Effect.Effect<A, E, R>
  ) =>
    effect.pipe(
      Effect.map(Option.some),
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause)
          // Preserve cancellation rather than turning an interrupted export into a successful archive.
          ? Effect.failCause(cause as Cause.Cause<never>)
          : retainVideoFailure({ page, stage, at: Adapter.now(), cause }).pipe(Effect.as(Option.none<A>()))
      )
    )
  // The recording's captures in each document are one stream, numbered apart from any other recording's
  const stream = `trace-${crypto.randomUUID()}`
  const failedCaptures = new Set<Target.DocumentId>()
  let calls = 0

  const pageOf = (id: unknown): Option.Option<Model.PageEntry> =>
    typeof id === "string" ? runtime.model.page(id as Target.NavigableId) : Option.none()

  const covers = (attributes: Readonly<Record<string, unknown>>): boolean => {
    const page = attributes["browser.page.id"]
    if (target._tag === "Page") return page === target.entry.id
    return attributes["browser.context.id"] === target.entry.id ||
      Option.exists(pageOf(page), (entry) => entry.context === target.entry.id)
  }

  // A span the step runs in: a recorded operation's, or one of the caller's, which becomes a step of its own
  const stepOf = (span: Tracer.AnySpan, stack: ReadonlyArray<Recorders.Location>): Option.Option<string> => {
    const known = bySpan.get(span.spanId)
    if (known !== undefined) return Option.some(known)
    if (span._tag === "ExternalSpan") return Option.none()
    const callId = `g${++calls}`
    const frame = stack.findIndex((frame) => frame.function === span.name)
    const ownStack = frame < 0 ? [] : stack.slice(frame)
    const parentStack = frame < 0 ? stack : stack.slice(frame + 1)
    bySpan.set(span.spanId, callId)
    steps.push({
      callId,
      stack: ownStack,
      parentId: Option.flatMap(span.parent, (parent) => stepOf(parent, parentStack)),
      name: span.name,
      params: Object.fromEntries(span.attributes),
      start: Adapter.now(),
      end: Option.none(),
      error: Option.none(),
      group: true
    })
    return Option.some(callId)
  }

  /** Every frame of the page, captured for the step; a page with a prompt open can't be read, so it isn't. */
  const snapshot = (
    callId: string,
    phase: Snapshot["phase"],
    page: Model.PageEntry,
    target: Option.Option<Capture.CaptureTarget>
  ) =>
    Effect.flatMap(Capture.capturePage(runtime, page, stream, target, failedCaptures), (captures) =>
      Effect.sync(() => {
        if (captures.length > 0) snapshots.push({ callId, phase, page: page.id, at: Adapter.now(), captures })
      }))

  /** The action's target, by its locator, now: `None` where it matches no one element. */
  const targetOf = (page: Model.PageEntry, subject: Recorders.Subject) =>
    // A second on the browser's clock
    Effect.flatMap(
      BrowserClock.after(1000),
      (at) => Runtime.element(runtime, page, subject.steps, Operation.idNow(), at)
    ).pipe(
      Effect.map((found): Option.Option<Capture.CaptureTarget> =>
        found._tag === "Found" ? Option.some({ node: found.node, secret: subject.secret }) : Option.none()
      ),
      Effect.orElseSucceed(() => Option.none<Capture.CaptureTarget>())
    )

  const recorder: Recorders.Recorder = {
    covers,
    begin: Effect.fnUntraced(function*(started) {
      const callId = `c${++calls}`
      let parentId: Option.Option<string>
      if (started.own && Option.isSome(started.span)) {
        bySpan.set(started.span.value.spanId, callId)
        parentId = started.span.value._tag === "Span"
          ? Option.flatMap(started.span.value.parent, (parent) => stepOf(parent, started.enclosingStack))
          : Option.none()
      } else {
        parentId = Option.flatMap(started.span, (span) => stepOf(span, started.enclosingStack))
      }
      const step: Step = {
        callId,
        stack: started.stack,
        parentId,
        name: started.name,
        params: started.attributes,
        start: Adapter.now(),
        end: Option.none(),
        error: Option.none(),
        group: false
      }
      steps.push(step)
      const page = pageOf(started.attributes["browser.page.id"])
      const action = actions.has(started.name)
      const screenshot = action || started.name.startsWith("Expect.")
      // The target is resolved as the action starts, where it is now, and again after it, if it wasn't there yet
      let target = Option.none<Capture.CaptureTarget>()
      if (settings.domSnapshots && action && Option.isSome(page)) {
        yield* snapshot(callId, "before", page.value, Option.none())
        if (Option.isSome(started.subject)) {
          target = yield* targetOf(page.value, started.subject.value)
        }
      }
      return (exit) =>
        Effect.gen(function*() {
          step.end = Option.some(Adapter.now())
          step.error = errorOf(exit, started.name)
          if (Option.isNone(page)) {
            return
          }
          if (settings.domSnapshots && action) {
            if (Option.isNone(target) && Option.isSome(started.subject)) {
              target = yield* targetOf(page.value, started.subject.value)
            }
            yield* snapshot(callId, "after", page.value, target)
          }
          if (settings.screenshots !== "perAction" || !screenshot) {
            return
          }
          // Completion can follow the enclosing deadline; capture has a bounded budget of its own.
          const shot = yield* runtime.model.adapter.screenshot(page.value.id, png).pipe(
            Operation.apart("Trace.screenshot", Duration.millis(1000)),
            Effect.option
          )
          if (Option.isSome(shot)) {
            shots.push({ callId, page: page.value.id, at: Adapter.now(), png: shot.value })
          }
        })
    })
  }
  yield* Recorders.register(recorder).pipe(Scope.provide(own))

  // Console messages and uncaught exceptions
  const messages = yield* Events.recorded(target.entry.events.console, () => true).pipe(Scope.provide(own))
  yield* Effect.gen(function*() {
    while (true) consoles.push({ message: (yield* Queue.take(messages)).value })
  }).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))
  const thrown = yield* Events.recorded(target.entry.events.exception, () => true).pipe(Scope.provide(own))
  yield* Effect.gen(function*() {
    while (true) exceptions.push((yield* Queue.take(thrown)).value)
  }).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))

  // Screencast frames, from each page of the target as it appears
  const screencast = settings.screencast
  // Prefer video when the browser can write it; otherwise use native frames
  const video = screencast === "native" && (yield* Filters.supported(runtime, "capability.video"))
  if (screencast !== "off") {
    const seen = new Set<Target.NavigableId>()
    const record = Effect.fnUntraced(function*(page: Model.PageEntry) {
      const scope = yield* Scope.fork(own)
      const recording = yield* observeVideo(
        page.id,
        "acquisition",
        Capabilities.acquire(runtime, page, Capability.Video).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void))
        )
      )
      if (Option.isSome(recording)) {
        videos.push({
          page: page.id,
          at: Adapter.now(),
          scope,
          recording: recording.value,
          finished: false,
          read: Option.none()
        })
        pendingVideos.delete(page.id)
      }
    })
    const cast = (page: Model.PageEntry) =>
      video
        ? record(page).pipe(Effect.ensuring(Effect.sync(() => void pendingVideos.delete(page.id))))
        : screencast === "native"
        ? Capabilities.acquire(runtime, page, Capability.Screencast).pipe(
          Effect.flatMap((control) =>
            Stream.runForEach(control.frames, (frame) =>
              Effect.sync(() =>
                frames.push({
                  page: page.id,
                  at: frame.at,
                  width: frame.width,
                  height: frame.height,
                  image: frame.jpeg,
                  format: "jpeg"
                })
              ))
          ),
          Effect.scoped
        )
        : Effect.gen(function*() {
          // JPEG, or PNG where the backend's screenshots are PNG only (`screenshot.format`)
          const formats = (yield* SubscriptionRef.get(runtime.model.adapter.capabilities)).entries.find((entry) =>
            entry.name === "screenshot.format"
          )
          const format = formats === undefined || formats.status === "supported" ? "jpeg" : "png"
          const options: Adapter.ScreenshotOptions = format === "jpeg"
            ? { ...png, format: "jpeg", quality: Option.some(50) }
            : png
          while (true) {
            yield* BrowserClock.sleep(Duration.toMillis(Duration.fromInputUnsafe(screencast.polled)))
            const shot = yield* runtime.model.adapter.screenshot(page.id, options)
            const size = format === "jpeg" ? Adapter.jpegSize(shot) : Adapter.pngSize(shot)
            frames.push({ page: page.id, at: Adapter.now(), ...size, image: shot, format })
          }
        })
    const follow = (page: Model.PageEntry) =>
      Effect.suspend(() => {
        if (seen.has(page.id)) return Effect.void
        seen.add(page.id)
        if (video) pendingVideos.add(page.id)
        return cast(page).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own), Effect.asVoid)
      })
    if (target._tag === "Page") yield* follow(target.entry)
    else {
      yield* target.entry.state.changes.pipe(
        Stream.runForEach((state) => Effect.forEach(state.pages, follow, { discard: true })),
        Operation.detached,
        Effect.forkIn(own)
      )
    }
  }

  // Network entries, with their bodies, as a HAR records them
  const network = settings.network
    ? Option.some(
      (yield* HarImpl.start(runtime, target.entry, {
        content: "attach",
        requestBodies: false,
        matches: () => true,
        webSocketFrames: false,
        inFlightAtStop: "markIncomplete"
      }, own)).recorder
    )
    : Option.none()

  const exportTrace = Effect.fnUntraced(function*(path: FilePath.Local | string) {
    const preset = yield* Diagnostics.CurrentPreset
    const exported = Adapter.now()
    // Snapshot acquisition before yielding: an acquisition settling during export belongs to the next export.
    const pendingAtExport = new Set(pendingVideos)
    const videosAtExport = videos.slice()
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
          ...(step.stack.length > 0 ? { stack: step.stack } : {}),
          ...(Option.isSome(step.parentId) ? { parentId: step.parentId.value } : {})
        }
      })
      events.push({
        time: end,
        event: {
          type: "after",
          callId: step.callId,
          endTime: Recordings.millis(end as MonotonicInstant.MonotonicInstant),
          ...(Option.isSome(step.error)
            ? {
              error: Expect.isExpectationFailed(step.error.value)
                ? { name: step.error.value._tag, message: expectationMessage(step.error.value, preset) }
                : step.error.value
            }
            : {})
        }
      })
    }
    const files: Array<{ path: string; content: string | Uint8Array }> = []
    if (Option.isSome(runtime.fileSystem)) {
      const fs = runtime.fileSystem.value
      for (const file of new Set(steps.flatMap((step) => step.stack.map((frame) => frame.file)))) {
        // Only typed file-system failures are optional. Defects and interruption still fail the export.
        const content = yield* fs.readFile(file).pipe(Effect.option)
        if (Option.isNone(content)) continue
        const basename = file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1)
        const dot = basename.lastIndexOf(".")
        const extension = dot <= 0 ? "" : basename.slice(dot)
        files.push({ path: `src/${yield* digest(file)}${extension}`, content: content.value })
      }
    }
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
      const file = `screencast/${frame.page}-${index}.${frame.format}`
      files.push({ path: file, content: frame.image })
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
    // DOM snapshots, their changed stylesheets written once each, by their text's digest
    const written = new Set<string>()
    for (const shot of snapshots) {
      for (const { captured, frame, main } of shot.captures) {
        const overrides: Array<Record<string, unknown>> = []
        for (const override of captured.overrides) {
          if (typeof override.content === "number") {
            overrides.push({ url: override.url, ref: override.content })
            continue
          }
          const file = `resources/${yield* digest(override.content)}.css`
          if (!written.has(file)) {
            written.add(file)
            files.push({ path: file, content: override.content })
          }
          overrides.push({ url: override.url, file })
        }
        events.push({
          time: shot.at,
          event: {
            type: "frame-snapshot",
            snapshot: {
              callId: shot.callId,
              phase: shot.phase,
              pageId: shot.page,
              frameId: frame,
              frameUrl: captured.url,
              timestamp: Recordings.millis(shot.at),
              wallTime: captured.wallTime,
              collectionTime: captured.collectionTime,
              ...(captured.doctype === null ? {} : { doctype: captured.doctype }),
              html: redactSecrets(captured.html, preset),
              resourceOverrides: overrides,
              viewport: captured.viewport,
              isMainFrame: main
            }
          }
        })
      }
    }
    // Videos end here, the first time, and their files are read
    for (const video of videosAtExport) {
      if (!video.finished) {
        const file = yield* observeVideo(
          video.page,
          "stop",
          Scope.close(video.scope, Exit.void).pipe(
            Effect.andThen(video.recording.file)
          )
        )
        if (Option.isSome(file)) {
          const bytes = yield* observeVideo(
            video.page,
            "file-read",
            Option.match(runtime.fileSystem, {
              onNone: () => Effect.die(new Error("The browser's layer was built without Effect's FileSystem")),
              onSome: (fs) => fs.readFile(file.value)
            })
          )
          if (Option.isSome(bytes)) video.read = Option.some({ bytes: bytes.value, ...webmSize(bytes.value) })
        }
        video.finished = true
      }
      if (Option.isNone(video.read)) continue
      const read = video.read.value
      const file = `resources/${video.page}.webm`
      files.push({ path: file, content: read.bytes })
      events.push({
        time: video.at,
        event: {
          type: "video",
          pageId: video.page,
          file,
          width: read.width,
          height: read.height,
          timestamp: Recordings.millis(video.at)
        }
      })
    }
    for (const page of pendingAtExport) {
      const pendingEvent = pendingVideoEvent(page, exported)
      events.push({ time: exported, event: pendingEvent })
    }
    for (const failure of videoFailures) {
      if (failure.stage === "acquisition" && pendingAtExport.has(failure.page)) continue
      events.push({ time: failure.at, event: videoFailureEvent(failure, preset) })
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
      options: {},
      ...(test === undefined ? {} : { title: test.id, striderTest: test })
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
      const resources = yield* Effect.forEach(
        log.log.entries,
        (entry) => Schema.encodeEffect(ResourceSnapshot)({ type: "resource-snapshot", snapshot: entry })
      ).pipe(
        Effect.mapError((error): Recordings.WriteFailure => ({
          path: "",
          hint: `The network's entries couldn't be encoded: ${error.message}`
        }))
      )
      files.push({ path: "trace.network", content: resources.length === 0 ? "" : `${resources.join("\n")}\n` })
      files.push(...bodies)
    }
    const resolved = yield* Recordings.resolve(runtime, path)
    const bytes = yield* Recordings.zip(files)
    return yield* Recordings.write(runtime, resolved, bytes)
  })

  return { exportTrace, stop: Scope.close(own, Exit.void) }
})
