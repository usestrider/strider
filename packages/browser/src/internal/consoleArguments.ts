/**
 * Console messages' arguments, kept for the subscriptions to calls (`ConsoleMessage.nextCall`, `streamCalls`).
 *
 * The fold keeps a message's arguments, which its fact carries only while a subscription to calls declares them, in
 * a table of their own, so the event log holds none. Each subscriber that takes a message owns each argument once;
 * the release of an argument's last owner frees its browser object. A message no subscriber takes keeps its
 * arguments until the last subscription to calls ends, which frees them.
 */
import * as Effect from "effect/Effect"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"

/** One argument, and how many subscribers own it. */
export interface Argument {
  readonly value: Adapter.RemoteValue
  owners: number
  freed: boolean
}

/** A message's arguments, in its realm, with the adapter's release of their handles. */
export interface Kept {
  readonly realm: Target.RealmId
  readonly args: ReadonlyArray<Argument>
  readonly release: (handles: ReadonlyArray<Adapter.HandleId>) => Effect.Effect<void>
}

const kept = new WeakMap<ConsoleMessage.ConsoleMessage, Kept>()
const untaken = new Set<Kept>()
let subscriptions = 0

const handleOf = (value: Adapter.RemoteValue): ReadonlyArray<Adapter.HandleId> =>
  "handle" in value && value.handle !== undefined ? [value.handle] : []

/** Keeps a message's arguments, as its fact carries them. */
export const keep = (
  message: ConsoleMessage.ConsoleMessage,
  realm: Target.RealmId,
  args: NonNullable<Extract<Adapter.Fact, { readonly _tag: "ConsoleMessage" }>["args"]>
): void => {
  const entry: Kept = {
    realm,
    args: args.values.map((value) => ({ value, owners: 0, freed: false })),
    release: args.release
  }
  kept.set(message, entry)
  untaken.add(entry)
}

/** A message's arguments, owned once more by a subscriber that takes it; `undefined` where it has none. */
export const take = (message: ConsoleMessage.ConsoleMessage): Kept | undefined => {
  const entry = kept.get(message)
  if (entry === undefined) return undefined
  untaken.delete(entry)
  for (const arg of entry.args) arg.owners++
  return entry
}

/** One owner's release of an argument, which frees it once it has no owner left. */
export const disown = (entry: Kept, arg: Argument): Effect.Effect<void> =>
  Effect.suspend(() => {
    arg.owners--
    if (arg.owners > 0 || arg.freed) return Effect.void
    arg.freed = true
    const handles = handleOf(arg.value)
    return handles.length === 0 ? Effect.void : entry.release(handles)
  })

/** A subscription to calls, for its scope: the last to end frees the arguments no subscriber took. */
export const subscribed: Effect.Effect<void, never, import("effect/Scope").Scope> = Effect.acquireRelease(
  Effect.sync(() => {
    subscriptions++
  }),
  () =>
    Effect.suspend(() => {
      subscriptions--
      if (subscriptions > 0) return Effect.void
      const entries = Array.from(untaken)
      untaken.clear()
      return Effect.forEach(entries, (entry) => {
        const handles = entry.args.flatMap((arg) => {
          if (arg.freed) return []
          arg.freed = true
          return handleOf(arg.value)
        })
        return handles.length === 0 ? Effect.void : entry.release(handles)
      }, { discard: true })
    })
)
