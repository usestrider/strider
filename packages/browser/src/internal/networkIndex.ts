/**
 * The fold's bounded indexes (CONCEPTS.md §2, The fold): what it remembers of requests and navigations, by id, and
 * how it forgets. A page that never stops requesting must not grow the model without end, so each index keeps at
 * most a fixed number of entries, and drops the oldest past it. Only the fold writes them.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as NetworkRequest from "../NetworkRequest.ts"

/** A map that keeps at most `max` entries, dropping the oldest past it. */
export interface Bounded<K, V> {
  readonly get: (key: K) => Option.Option<V>
  readonly set: (key: K, value: V) => void
  readonly delete: (key: K) => boolean
  readonly has: (key: K) => boolean
  readonly values: () => ReadonlyArray<V>
  readonly size: () => number
}

export const bounded = <K, V>(max: number): Bounded<K, V> => {
  const map = new Map<K, V>()
  return {
    get: (key) => Option.fromUndefinedOr(map.get(key)),
    set: (key, value) => {
      map.set(key, value)
      if (map.size > max) map.delete(map.keys().next().value!)
    },
    delete: (key) => map.delete(key),
    has: (key) => map.has(key),
    values: () => Array.from(map.values()),
    size: () => map.size
  }
}

/** What a hop index keeps of each hop: how it ends, which forgetting a hop in flight decides. */
export interface Ending<End> {
  readonly end: Deferred.Deferred<End>
}

/** Request hops, kept until they end and then while there is room: finished hops are dropped first, oldest first. */
export interface Hops<H extends Ending<End>, End> {
  readonly get: (id: NetworkRequest.HopId) => Option.Option<H>
  /** Keeps a hop; past the bound, drops the oldest finished one, or else the oldest, ending it with `forgotten`. */
  readonly keep: (id: NetworkRequest.HopId, hop: H) => void
  readonly values: () => ReadonlyArray<H>
}

export const hops = <H extends Ending<End>, End>(max: number, forgotten: End): Hops<H, End> => {
  const map = new Map<NetworkRequest.HopId, H>()
  return {
    get: (id) => Option.fromUndefinedOr(map.get(id)),
    keep: (id, hop) => {
      map.set(id, hop)
      if (map.size <= max) return
      for (const [each, entry] of map) {
        if (Deferred.isDoneUnsafe(entry.end)) {
          map.delete(each)
          return
        }
      }
      const [oldest, entry] = map.entries().next().value!
      map.delete(oldest)
      Deferred.doneUnsafe(entry.end, Effect.succeed(forgotten))
    },
    values: () => Array.from(map.values())
  }
}
