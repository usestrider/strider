/**
 * Console messages' arguments, kept for the subscriptions to calls (`ConsoleMessage.nextCall`, `streamCalls`).
 *
 * A message's fact carries its arguments only while a subscription to calls declares them. As the message arrives,
 * each live subscription to calls whose channel and filter take it gets a claim on it; the fold keeps the arguments
 * in a table of their own, so the event log holds none. A subscription that delivers the message turns its claim
 * into one owner of each argument. One that passes on it drops its claim: its `where` rejects the message, its
 * `nextCall` has matched another, or it ends. An argument's browser object is freed once no claim on its message
 * and no owner of it remains, so a message no subscription takes is freed as soon as the last one passes.
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as ConsoleMessage from "../ConsoleMessage.ts"
import type * as Target from "../Target.ts"
import type * as Adapter from "./adapter.ts"

/** One argument, and how many subscribers own it. */
export interface Argument {
  readonly value: Adapter.RemoteValue
  owners: number
  freed: boolean
}

/** A message's arguments, in its realm, with the adapter's release of their handles and the claims on them. */
export interface Kept {
  readonly table: Table
  readonly realm: Target.RealmId
  readonly args: ReadonlyArray<Argument>
  readonly release: (handles: ReadonlyArray<Adapter.HandleId>) => Effect.Effect<void>
  claims: number
}

/** A subscription to calls: the channel it reads, what its filter takes, and the messages it has claims on. */
export interface Claimant {
  readonly channel: unknown
  readonly accepts: (message: ConsoleMessage.ConsoleMessage) => boolean
  /** Whether it takes no more messages: a `nextCall` that has matched. */
  done: boolean
  readonly claims: Map<ConsoleMessage.ConsoleMessage, Kept>
}

/** One browser's subscriptions to calls, and how many of its kept arguments are not yet freed. */
export interface Table {
  readonly claimants: Set<Claimant>
  unfreed: number
}

/** A browser's empty table, which its model holds. */
export const make = (): Table => ({ claimants: new Set(), unfreed: 0 })

/** How many of a browser's kept arguments are not yet freed. */
export const held = (table: Table): number => table.unfreed

const handleOf = (value: Adapter.RemoteValue): ReadonlyArray<Adapter.HandleId> =>
  "handle" in value && value.handle !== undefined ? [value.handle] : []

/** Marks the arguments no claim and no owner holds as freed, now, and gives the release of their objects. */
const free = (entry: Kept): Effect.Effect<void> => {
  if (entry.claims > 0) return Effect.void
  const handles = entry.args.flatMap((arg) => {
    if (arg.owners > 0 || arg.freed) return []
    arg.freed = true
    entry.table.unfreed--
    return handleOf(arg.value)
  })
  return handles.length === 0 ? Effect.void : entry.release(handles)
}

/** Frees the arguments no claim and no owner holds. */
const settle = (entry: Kept): Effect.Effect<void> => Effect.suspend(() => free(entry))

/**
 * Keeps a message's arguments for the subscriptions that could deliver it, as its fact carries them, from the
 * channels it is published to; gives the release of those no subscription claims.
 */
export const keep = (
  table: Table,
  message: ConsoleMessage.ConsoleMessage,
  realm: Target.RealmId,
  args: NonNullable<Extract<Adapter.Fact, { readonly _tag: "ConsoleMessage" }>["args"]>,
  channels: ReadonlyArray<unknown>
): Effect.Effect<void> => {
  const entry: Kept = {
    table,
    realm,
    args: args.values.map((value) => ({ value, owners: 0, freed: false })),
    release: args.release,
    claims: 0
  }
  table.unfreed += entry.args.length
  for (const claimant of table.claimants) {
    if (claimant.done || !channels.includes(claimant.channel) || !claimant.accepts(message)) continue
    claimant.claims.set(message, entry)
    entry.claims++
  }
  return free(entry)
}

/** A subscription to calls, for its scope; it drops its claims as it ends. */
export const claimant = (
  table: Table,
  channel: unknown,
  accepts: (message: ConsoleMessage.ConsoleMessage) => boolean
): Effect.Effect<Claimant, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const made: Claimant = { channel, accepts, done: false, claims: new Map() }
      table.claimants.add(made)
      return made
    }),
    (made) =>
      Effect.suspend(() => {
        made.done = true
        table.claimants.delete(made)
        const held = Array.from(made.claims.keys())
        return Effect.forEach(held, (message) => pass(made, message), { discard: true })
      })
  )

/** The message's arguments, owned once more by the subscription that delivers it; `undefined` where it has none. */
export const take = (claimant: Claimant, message: ConsoleMessage.ConsoleMessage): Kept | undefined => {
  const entry = claimant.claims.get(message)
  if (entry === undefined) return undefined
  claimant.claims.delete(message)
  entry.claims--
  for (const arg of entry.args) arg.owners++
  return entry
}

/** A subscription passes on a message: its claim drops, which may free the message's arguments. */
export const pass = (claimant: Claimant, message: ConsoleMessage.ConsoleMessage): Effect.Effect<void> =>
  Effect.suspend(() => {
    const entry = claimant.claims.get(message)
    if (entry === undefined) return Effect.void
    claimant.claims.delete(message)
    entry.claims--
    return settle(entry)
  })

/** A `nextCall` matched `message`: it takes no more, and passes on the others it has claims on. */
export const matched = (claimant: Claimant, message: ConsoleMessage.ConsoleMessage): Effect.Effect<void> =>
  Effect.suspend(() => {
    claimant.done = true
    const others = Array.from(claimant.claims.keys()).filter((each) => each !== message)
    return Effect.forEach(others, (each) => pass(claimant, each), { discard: true })
  })

/**
 * A subscription that ended before its scope did, as when its `where` failed, its wait timed out, its target ended or
 * it overflowed: it takes no more, and drops every claim it holds, apart from `keeping`, the message it was promised.
 */
export const abandoned = (
  claimant: Claimant,
  keeping?: ConsoleMessage.ConsoleMessage | undefined
): Effect.Effect<void> =>
  Effect.suspend(() => {
    claimant.done = true
    const held = Array.from(claimant.claims.keys()).filter((each) => each !== keeping)
    return Effect.forEach(held, (each) => pass(claimant, each), { discard: true })
  })

/** As `abandoned`, but its bookkeeping done now: gives only the release of what it freed, to run apart. */
export const abandonedNow = (claimant: Claimant): Effect.Effect<void> => {
  claimant.done = true
  const releases = Array.from(claimant.claims.values()).map((entry) => {
    entry.claims--
    return free(entry)
  })
  claimant.claims.clear()
  return Effect.all(releases, { discard: true })
}

/** One owner's release of an argument, which frees it once no owner and no claim remains. */
export const disown = (entry: Kept, arg: Argument): Effect.Effect<void> =>
  Effect.suspend(() => {
    arg.owners--
    return settle(entry)
  })
