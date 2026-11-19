/**
 * What a document can still reach of its origin's storage once a case is over, for the shared-context checks of the
 * engine fixture (`adapter/engineConnection.ts`) and the slice suite (`slice/sharedContext.ts`): `localStorage`,
 * IndexedDB and service-worker registrations, read in the document's realm. Registrations are found by asking the
 * origin, since Firefox and stock WebKit don't say which context a service worker belongs to.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Adapter from "../../src/internal/adapter.ts"
import type * as Target from "../../src/Target.ts"

/** An origin's storage as a document under a top-level origin reads it: frames' storage is partitioned by the top. */
export interface Partition {
  readonly origin: string
  readonly top: string
}

export const keyOf = (partition: Partition) => `${partition.origin} under ${partition.top}`

/** Whether an origin can hold storage a later case would read: an http(s) one; an opaque origin has none. */
export const holdsStorage = (origin: string) => /^https?:/.test(origin)

/** The read, run in the realm: the realm's origin and how much of each kind of storage it reaches. */
const storageRead = `async () => {
  const count = async (read) => { try { return await read() } catch { return 0 } }
  return JSON.stringify({
    origin: location.origin,
    localStorage: await count(() => localStorage.length),
    databases: await count(async () => typeof indexedDB.databases === "function" ? (await indexedDB.databases()).length : 0),
    registrations: await count(async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0)
  })
}`

/** One realm's storage, named; `undefined` when the realm has gone or didn't answer. */
export interface Read {
  readonly origin: string
  readonly found: ReadonlyArray<string>
}

/** Reads one realm's storage, naming what it holds, through an adapter's (or a bounded adapter's) `evaluate`. */
export const readRealm = <E, R>(
  evaluate: (realm: Target.RealmId, call: Adapter.EvaluationCall) => Effect.Effect<Adapter.RemoteResult, E, R>,
  realm: Target.RealmId
): Effect.Effect<Read | undefined, never, R> =>
  Effect.map(
    Effect.exit(evaluate(realm, {
      functionDeclaration: storageRead,
      arguments: [],
      awaitPromise: true,
      result: "value",
      userActivation: false
    })),
    (read) => {
      if (Exit.isFailure(read) || read.value._tag !== "Value" || read.value.value.type !== "string") return undefined
      const held = JSON.parse(read.value.value.value) as {
        readonly origin: string
        readonly localStorage: number
        readonly databases: number
        readonly registrations: number
      }
      const found: Array<string> = []
      if (held.localStorage > 0) found.push(`${held.localStorage} localStorage item(s) on ${held.origin}`)
      if (held.databases > 0) found.push(`${held.databases} IndexedDB database(s) on ${held.origin}`)
      if (held.registrations > 0) found.push(`${held.registrations} service worker registration(s) on ${held.origin}`)
      return { origin: held.origin, found }
    }
  )

/**
 * Reads what the committed partitions hold: first from the live realms, each with whether it is a frame's (whose
 * partition is the page's top), then each top-level origin none of them read by navigating the page back to it
 * (`navigateBack`, which returns the realm of the document it committed, or `undefined`). A frame's origin under
 * another top that no live realm reads can't be read that way, and is returned as unread, as is a top-level origin
 * the page couldn't go back to.
 */
export const storageLeft = Effect.fnUntraced(function*<R1, R2>(options: {
  readonly committed: ReadonlyArray<Partition>
  readonly realms: ReadonlyArray<{ readonly realm: Target.RealmId; readonly frame: boolean }>
  readonly top: string | undefined
  readonly read: (realm: Target.RealmId) => Effect.Effect<Read | undefined, never, R1>
  readonly navigateBack: (origin: string) => Effect.Effect<Target.RealmId | undefined, unknown, R2>
}) {
  const found: Array<string> = []
  const read = new Set<string>()
  for (const { realm, frame } of options.realms) {
    const result = yield* options.read(realm)
    if (result === undefined || options.top === undefined) continue
    found.push(...result.found)
    read.add(keyOf({ origin: result.origin, top: frame ? options.top : result.origin }))
  }
  const unread: Array<Partition> = []
  for (const partition of options.committed) {
    if (read.has(keyOf(partition))) continue
    if (partition.origin !== partition.top) {
      unread.push(partition)
      continue
    }
    const realm = yield* Effect.orElseSucceed(options.navigateBack(partition.origin), () => undefined)
    const result = realm === undefined ? undefined : yield* options.read(realm)
    if (result === undefined) unread.push(partition)
    else {
      found.push(...result.found)
      read.add(keyOf(partition))
    }
  }
  return { found: [...new Set(found)], unread }
})
