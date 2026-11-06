/**
 * Where trace recordings learn of operations: the span helper reports each one to the
 * recordings that cover its target, with the span it runs in. Ids are unique within the process,
 * so a recording matches an operation by the ids in its attributes.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as References from "effect/References"
import type * as Tracer from "effect/Tracer"
import type * as Engine from "./engine.ts"

/**
 * What an action acts on, for a recording's DOM snapshots: its locator's steps, and whether the value
 * it enters is a secret. A locator's actions provide it around their operation.
 */
export interface Subject {
  readonly steps: ReadonlyArray<Engine.Step>
  readonly secret: boolean
}

/** The subject of the operation starting, if it acts on one. */
export const CurrentSubject: Context.Reference<Option.Option<Subject>> = Context.Reference<Option.Option<Subject>>(
  "@usestrider/browser/internal/recorders/CurrentSubject",
  { defaultValue: () => Option.none() }
)

/** A viewer location, with one-based line and column numbers. */
export interface Location {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly function: string
}

// Frame identity distinguishes an operation's own caller from an enclosing span with the same name.
const operationFrames = new WeakSet<References.StackFrame>()

/** Adds an operation's caller frame to Effect's chain. */
export const frame = (
  name: string,
  stack: () => string | undefined,
  parent: References.StackFrame | undefined
): References.StackFrame => {
  const frame = { name, stack, parent }
  operationFrames.add(frame)
  return frame
}

/** Whether the frame belongs to a library operation rather than a caller's span. */
export const isFrame = (frame: References.StackFrame | undefined): boolean =>
  frame !== undefined && operationFrames.has(frame)

/** Available caller frames, without Effect.fn's definition frames. */
const locations = (frame: References.StackFrame | undefined, name: string) => {
  const result: Array<Location> = []
  let own = false
  for (; frame !== undefined; frame = frame.parent) {
    if (frame.name.endsWith(" (definition)")) continue
    // Stack capture is optional; a custom tracer may supply an unavailable or throwing lazy stack.
    try {
      const stack = frame.stack()
      const match = stack?.match(/(?:\(|at )((?:file:\/\/|\/|[A-Za-z]:[\\/]).*):(\d+):(\d+)\)?$/)
      if (match === undefined || match === null) continue
      let file = match[1]!
      if (file.startsWith("file://")) {
        const url = new URL(file)
        file = decodeURIComponent(url.pathname)
        if (/^\/[A-Za-z]:/.test(file)) file = file.slice(1)
        if (url.hostname !== "" && url.hostname !== "localhost") file = `//${url.hostname}${file}`
      }
      if (result.length === 0) own = isFrame(frame) && frame.name === name
      result.push({ file, line: Number(match[2]), column: Number(match[3]), function: frame.name })
    } catch {
      // A missing call site must not prevent the operation from running.
    }
  }
  return { stack: result, enclosingStack: own ? result.slice(1) : result }
}

/** One operation, as a recording sees it start. */
export interface Started {
  readonly name: string
  readonly stack: ReadonlyArray<Location>
  readonly enclosingStack: ReadonlyArray<Location>
  readonly attributes: Readonly<Record<string, unknown>>
  /** The operation's own span, or, when its span is suppressed, the span it runs in. */
  readonly span: Option.Option<Tracer.AnySpan>
  /** Whether `span` is the operation's own. */
  readonly own: boolean
  /** What it acts on, where it acts on an element. */
  readonly subject: Option.Option<Subject>
}

/** A live recording. */
export interface Recorder {
  readonly covers: (attributes: Readonly<Record<string, unknown>>) => boolean
  /**
   * The operation is about to begin, which waits for what this does first; what it returns runs as the operation
   * ends, before the caller sees its result.
   */
  readonly begin: (started: Started) => Effect.Effect<(exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>>
}

const recorders = new Set<Recorder>()

/** Adds a recording for the scope. */
export const register = (recorder: Recorder) =>
  Effect.acquireRelease(
    Effect.sync(() => void recorders.add(recorder)),
    () => Effect.sync(() => void recorders.delete(recorder))
  )

/** Runs an operation, reported to each recording that covers it; nothing is added when none does. */
export const observe = <A, E, R>(
  name: string,
  attributes: Readonly<Record<string, unknown>>,
  own: boolean,
  self: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    if (recorders.size === 0) return self
    const covering = [...recorders].filter((recorder) => recorder.covers(attributes))
    if (covering.length === 0) return self
    return Effect.gen(function*() {
      const span = yield* Effect.option(Effect.currentParentSpan)
      const subject = yield* CurrentSubject
      const locationsOf = locations(yield* References.CurrentStackFrame, name)
      const ends = yield* Effect.forEach(
        covering,
        (recorder) => recorder.begin({ name, attributes, span, own, subject, ...locationsOf })
      )
      const exit = yield* Effect.exit(self)
      for (const end of ends) yield* end(exit)
      return yield* exit
    })
  })
