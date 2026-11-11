/**
 * Typed programs run in a live CLI session, with arguments decoded before their callback runs.
 *
 * Export a segment as a file's default export, then pass its arguments with `strider run file.ts --arg key=value`.
 * Ordinary values are strings; `--arg payload=@payload.json` reads a JSON value from a file.
 *
 * @stability experimental
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as Schema from "effect/Schema"

const TypeId = "~@usestrider/browser/cli/Segment"

/**
 * A segment's argument schema and callback, whose argument is the schema's decoded type.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Segment<S extends Schema.Constraint, A, E = never, R = never> {
  readonly [TypeId]: typeof TypeId
  readonly schema: S
  readonly run: (args: S["Type"]) => Effect.Effect<A, E, R>
}

/**
 * Makes a segment that validates all arguments before running its callback.
 *
 * **Details**
 *
 * Define the callback with `Effect.fnUntraced`; its arguments are inferred from the schema's decoded type.
 *
 * Use `Schema.Record(Schema.String, Schema.Never)` to reject all arguments; `Schema.Struct({})` is permissive.
 * String flags can use codecs such as `Schema.NumberFromString`; JSON files supply their parsed values.
 * Missing, invalid, and unexpected arguments fail before the callback runs. The callback runs with
 * `CurrentSession`, a scope, and the daemon's platform
 * services. A schema that needs services uses those same services when decoding.
 *
 * **Example** (Reading a page named by an argument)
 *
 * ```ts import.meta.vitest
 * import { CurrentSession, Segment } from "@usestrider/browser/cli"
 * import { Effect, Schema } from "effect"
 *
 * // strider -s shop run title.ts --arg page=main
 * export default Segment.make(
 *   Schema.Struct({ page: Schema.String }),
 *   Effect.fnUntraced(function*(args) {
 *     const session = yield* CurrentSession.CurrentSession
 *     const page = yield* session.page(args.page)
 *     return yield* page.title
 *   })
 * )
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const make = <S extends Schema.Constraint, A, E, R>(
  schema: S,
  run: (args: S["Type"]) => Effect.Effect<A, E, R>
): Segment<S, A, E, R> => ({ [TypeId]: TypeId, schema, run })

/**
 * Checks whether a value is a segment.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isSegment = (value: unknown): value is Segment<Schema.Constraint, unknown, unknown, unknown> =>
  Predicate.hasProperty(value, TypeId)
