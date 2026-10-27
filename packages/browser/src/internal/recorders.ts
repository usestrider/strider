/**
 * Where trace recordings learn of operations: the span helper reports each one to the
 * recordings that cover its target, with the span it runs in. Ids are unique within the process,
 * so a recording matches an operation by the ids in its attributes.
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
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

/** One operation, as a recording sees it start. */
export interface Started {
  readonly name: string
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
      const ends = yield* Effect.forEach(
        covering,
        (recorder) => recorder.begin({ name, attributes, span, own, subject })
      )
      const exit = yield* Effect.exit(self)
      for (const end of ends) yield* end(exit)
      return yield* exit
    })
  })
