/**
 * Members the public interfaces declare that aren't built yet (review 12, candidate 6). Each fails as a defect
 * that names it: a gap in the library, not a condition of the browser a caller could handle, and never a
 * silent no-op. PROTOCOL.md lists what is built.
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type * as Watchable from "../Watchable.ts"

/** A member that isn't built yet was used. */
export class NotBuilt extends Data.TaggedError("NotBuilt")<{ readonly member: string }> {
  override get message() {
    return `${this.member} isn't built yet (PROTOCOL.md, Not built)`
  }
}

/** An effect member that isn't built. */
export const effect = (member: string): Effect.Effect<never> => Effect.die(new NotBuilt({ member }))

/** A function member that isn't built, returning an effect. */
export const fn = (member: string) => (): Effect.Effect<never> => effect(member)

/** A function member that isn't built and returns a value: it throws, the synchronous defect. */
export const sync = (member: string) => (): never => {
  throw new NotBuilt({ member })
}

/** A watchable member that isn't built: reading, watching or waiting on it dies. */
export const watchable = (member: string): Watchable.Watchable<never> =>
  Object.assign(effect(member), {
    "~@usestrider/browser/Watchable": "~@usestrider/browser/Watchable" as const,
    changes: Stream.die(new NotBuilt({ member })),
    waitFor: fn(member),
    map: () => watchable(member)
  }) as unknown as Watchable.Watchable<never>
