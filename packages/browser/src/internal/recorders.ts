/**
 * Where trace recordings learn of operations (review 20, candidate 4): the span helper reports each one to the
 * recordings that cover its target, with the span it runs in. Ids are unique within the process (review 20),
 * so a recording matches an operation by the ids in its attributes.
 */
import * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import type * as Tracer from "effect/Tracer"

/** One operation, as a recording sees it start. */
export interface Started {
  readonly name: string
  readonly attributes: Readonly<Record<string, unknown>>
  /** The operation's own span, or, when its span is suppressed, the span it runs in. */
  readonly span: Option.Option<Tracer.AnySpan>
  /** Whether `span` is the operation's own. */
  readonly own: boolean
}

/** A live recording. */
export interface Recorder {
  readonly covers: (attributes: Readonly<Record<string, unknown>>) => boolean
  /** The operation began; what it returns runs as it ends, before the caller sees its result. */
  readonly begin: (started: Started) => (exit: Exit.Exit<unknown, unknown>) => Effect.Effect<void>
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
      const ends = covering.map((recorder) => recorder.begin({ name, attributes, span, own }))
      const exit = yield* Effect.exit(self)
      for (const end of ends) yield* end(exit)
      return yield* exit
    })
  })
