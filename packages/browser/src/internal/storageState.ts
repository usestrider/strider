/**
 * Storage state: a context's cookies, and the `localStorage` and IndexedDB of every origin
 * of a document open in its pages and frames, exported; and the same written into a new context before its first
 * page.
 *
 * - **Export** reads each origin's storage in one of its documents, from the isolated world. A cross-site frame's
 *   storage is its page's top-level site's partition, and says so.
 * - **IndexedDB records** cross in an encoding of ours (`readOrigin`), so what JSON can't write survives. Firefox
 *   gives the isolated world the page's objects, so types are told by their tag, not `instanceof`. A value
 *   that can't be encoded fails the export with `Unsupported`, naming its database and store.
 * - **Import** sets the cookies, then writes each origin's storage from a page of the new context whose document a
 *   route of ours fulfills, from a frame of a page at the partition's top-level site where it is partitioned.
 *   The page and the routes are gone when the context is returned.
 */
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as CookieJar from "../CookieJar.ts"
import * as Deadline from "../Deadline.ts"
import type * as Diagnostics from "../Diagnostics.ts"
import type * as Page from "../Page.ts"
import * as Reason from "../Reason.ts"
import * as Route from "../Route.ts"
import * as StorageState from "../StorageState.ts"
import * as Target from "../Target.ts"
import * as Url from "../Url.ts"
import * as UserContext from "../UserContext.ts"
import type * as Adapter from "./adapter.ts"
import type * as Engine from "./engine.ts"
import * as Evaluation from "./evaluation.ts"
import * as Handles from "./handles.ts"
import type * as Model from "./model.ts"
import * as Operation from "./operation.ts"
import * as Runtime from "./runtime.ts"
import * as Storage from "./storage.ts"
import * as WebAuthn from "./webauthn.ts"

// ── In the page ───────────────────────────────────────────────────────────────────────────────────────────

const KeyPath = Schema.Union([Schema.String, Schema.Array(Schema.String)])

/** One origin's storage as the page gives it: entries, and databases with encoded records. */
const Read = Schema.Struct({
  local: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  indexedDb: Schema.Array(Schema.Struct({
    name: Schema.String,
    version: Schema.Number,
    stores: Schema.Array(Schema.Struct({
      name: Schema.String,
      keyPath: Schema.NullOr(KeyPath),
      autoIncrement: Schema.Boolean,
      indexes: Schema.Array(Schema.Struct({
        name: Schema.String,
        keyPath: KeyPath,
        unique: Schema.Boolean,
        multiEntry: Schema.Boolean
      })),
      records: Schema.Array(Schema.Struct({ key: Schema.Unknown, value: Schema.Unknown }))
    }))
  }))
})

type Read = typeof Read.Type

/** What `readOrigin` answers, as JSON text: the storage, or what it couldn't encode, and where. */
const ReadAnswer = Schema.fromJsonString(Schema.Union([
  Schema.TaggedStruct("Read", { read: Read }),
  Schema.TaggedStruct("Unencodable", { database: Schema.String, store: Schema.String, what: Schema.String })
]))

type ReadAnswer = typeof ReadAnswer.Type

/**
 * Reads the document's origin storage, as JSON text. Self-contained: its source is evaluated in the page.
 *
 * The encoding: JSON's own values as themselves; anything else a single-key object whose key starts with `$`
 * (`$date`, `$regexp`, `$map`, `$set`, `$bigint`, `$number`, `$undefined`, `$bytes`); and a plain object with a key
 * that starts with `$` wrapped as `$object`, so nothing is read back as something else.
 */
export async function readOrigin(): Promise<string> {
  class Unencodable {
    readonly what: string
    constructor(what: string) {
      this.what = what
    }
  }
  const base64 = (bytes: Uint8Array) => {
    let text = ""
    for (let at = 0; at < bytes.length; at += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
    }
    return btoa(text)
  }
  // A view of the page's own bytes is made with the page's `Uint8Array`, and copied: Firefox forbids reading typed
  // arrays across compartments (QUIRKS.md)
  const pageGlobal = (globalThis as { window?: { wrappedJSObject?: typeof globalThis } }).window?.wrappedJSObject ??
    globalThis
  const bytesOf = (buffer: ArrayBuffer, offset: number, length: number) => {
    const view = new pageGlobal.Uint8Array(buffer, offset, length)
    const copy = new Uint8Array(length)
    for (let index = 0; index < length; index++) copy[index] = view[index]!
    return copy
  }
  const TYPED = [
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float16Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "DataView"
  ]
  const encode = (value: unknown, seen: Set<object>): unknown => {
    switch (typeof value) {
      case "string":
      case "boolean":
        return value
      case "number":
        return Number.isFinite(value) && !Object.is(value, -0) ? value : { $number: String(value) }
      case "bigint":
        return { $bigint: String(value) }
      case "undefined":
        return { $undefined: true }
      case "object":
        break
      default:
        throw new Unencodable(`a ${typeof value}`)
    }
    if (value === null) return null
    const object = value as object
    if (seen.has(object)) throw new Unencodable("a value that refers to itself")
    seen.add(object)
    try {
      // By tag, not `instanceof`: Firefox gives the isolated world the page's objects
      const tag = Object.prototype.toString.call(object).slice(8, -1)
      if (tag === "Date") {
        const time = (object as Date).getTime()
        return { $date: Number.isNaN(time) ? null : time }
      }
      if (tag === "RegExp") return { $regexp: [(object as RegExp).source, (object as RegExp).flags] }
      if (tag === "Array") return Array.from(object as ArrayLike<unknown>, (item) => encode(item, seen))
      if (tag === "Map") {
        return {
          $map: Array.from(object as Map<unknown, unknown>, ([key, item]) => [encode(key, seen), encode(item, seen)])
        }
      }
      if (tag === "Set") return { $set: Array.from(object as Set<unknown>, (item) => encode(item, seen)) }
      if (tag === "ArrayBuffer") {
        const buffer = object as ArrayBuffer
        return { $bytes: ["ArrayBuffer", base64(bytesOf(buffer, 0, buffer.byteLength))] }
      }
      if (TYPED.includes(tag)) {
        const view = object as ArrayBufferView
        return { $bytes: [tag, base64(bytesOf(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength))] }
      }
      if (tag !== "Object") throw new Unencodable(`a ${tag}`)
      const entries = Object.entries(object).map(([key, item]) => [key, encode(item, seen)] as const)
      return entries.some(([key]) => key.startsWith("$")) ? { $object: entries } : Object.fromEntries(entries)
    } finally {
      seen.delete(object)
    }
  }
  // Firefox gives the isolated world the page's objects behind Xrays, which a `Map` or `Set` can't be iterated
  // through (QUIRKS.md): the records are the page's own clones, so the Xrays are waived to read them
  const waived = (value: unknown): unknown =>
    value !== null && typeof value === "object" && "wrappedJSObject" in value
      ? (value as { readonly wrappedJSObject: unknown }).wrappedJSObject
      : value
  const request = <A>(made: IDBRequest<A>) =>
    new Promise<A>((resolve, reject) => {
      made.onsuccess = () => resolve(made.result)
      made.onerror = () => reject(made.error)
    })
  const local: Array<readonly [string, string]> = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!
    local.push([key, localStorage.getItem(key)!])
  }
  const databases: Array<Read["indexedDb"][number]> = []
  for (const info of await indexedDB.databases()) {
    if (info.name === undefined) continue
    const opening = indexedDB.open(info.name)
    const db = await request(opening)
    try {
      const names = Array.from(db.objectStoreNames)
      const stores: Array<Read["indexedDb"][number]["stores"][number]> = []
      if (names.length > 0) {
        const transaction = db.transaction(names, "readonly")
        // Every request is made at once, in one task, so the transaction stays active for all of them
        const reads = names.map((name) => {
          const store = transaction.objectStore(name)
          return {
            store,
            keys: request(store.getAllKeys()),
            values: request(store.getAll())
          }
        })
        for (const { keys, store, values } of reads) {
          const [allKeys, allValues] = await Promise.all([keys, values])
          const records: Array<{ key: unknown; value: unknown }> = []
          for (let index = 0; index < allKeys.length; index++) {
            try {
              records.push({
                key: encode(waived(allKeys[index]), new Set()),
                value: encode(waived(allValues[index]), new Set())
              })
            } catch (error) {
              if (!(error instanceof Unencodable)) throw error
              return JSON.stringify(
                { _tag: "Unencodable", database: db.name, store: store.name, what: error.what } satisfies ReadAnswer
              )
            }
          }
          stores.push({
            name: store.name,
            keyPath: store.keyPath,
            autoIncrement: store.autoIncrement,
            indexes: Array.from(store.indexNames, (name) => {
              const index = store.index(name)
              return { name: index.name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }
            }),
            records
          })
        }
      }
      databases.push({ name: db.name, version: db.version, stores })
    } finally {
      db.close()
    }
  }
  return JSON.stringify({ _tag: "Read", read: { local, indexedDb: databases } } satisfies ReadAnswer)
}

/** Writes an origin's storage, from JSON text as `readOrigin` gave it. Self-contained, as `readOrigin` is. */
export async function writeOrigin(text: string): Promise<void> {
  const state = JSON.parse(text) as Read
  const bytes = (data: string) => Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
  const TYPED: Record<string, new(buffer: ArrayBuffer) => unknown> = {
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView
  }
  const Float16 = (globalThis as { Float16Array?: new(buffer: ArrayBuffer) => unknown }).Float16Array
  if (Float16 !== undefined) TYPED["Float16Array"] = Float16
  const decode = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value
    if (Array.isArray(value)) return value.map(decode)
    const entries = Object.entries(value)
    if (entries.length === 1 && entries[0]![0].startsWith("$")) {
      const [tag, data] = entries[0] as [string, any]
      switch (tag) {
        case "$number":
          return Number(data)
        case "$bigint":
          return BigInt(data)
        case "$undefined":
          return undefined
        case "$date":
          return new Date(data === null ? NaN : data)
        case "$regexp":
          return new RegExp(data[0], data[1])
        case "$map":
          return new Map(data.map(([key, item]: [unknown, unknown]) => [decode(key), decode(item)]))
        case "$set":
          return new Set(data.map(decode))
        case "$bytes": {
          const buffer = bytes(data[1]).buffer
          return data[0] === "ArrayBuffer" ? buffer : new TYPED[data[0]]!(buffer)
        }
        case "$object":
          return Object.fromEntries(data.map(([key, item]: [string, unknown]) => [key, decode(item)]))
      }
    }
    return Object.fromEntries(entries.map(([key, item]) => [key, decode(item)]))
  }
  for (const [key, value] of state.local) localStorage.setItem(key, value)
  for (const database of state.indexedDb) {
    const opening = indexedDB.open(database.name, database.version)
    opening.onupgradeneeded = () => {
      const db = opening.result
      for (const store of database.stores) {
        const made = db.createObjectStore(store.name, {
          keyPath: store.keyPath === null ? null : store.keyPath as string | Array<string>,
          autoIncrement: store.autoIncrement
        })
        for (const index of store.indexes) {
          made.createIndex(index.name, index.keyPath as string | Array<string>, {
            unique: index.unique,
            multiEntry: index.multiEntry
          })
        }
      }
    }
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      const names = database.stores.map((store) => store.name)
      if (names.length === 0) continue
      const transaction = db.transaction(names, "readwrite")
      for (const store of database.stores) {
        const target = transaction.objectStore(store.name)
        for (const record of store.records) {
          if (store.keyPath === null) target.put(decode(record.value), decode(record.key) as IDBValidKey)
          else target.put(decode(record.value))
        }
      }
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      db.close()
    }
  }
}

// ── Sites and partitions ──────────────────────────────────────────────────────────────────────────────────

/**
 * A URL's site: its scheme and registrable domain. Without the public suffix list, a domain's last two labels
 * stand for it; an IP address or a one-label host is its own (QUIRKS.md).
 */
export const siteOf = (url: URL): string => {
  const host = url.hostname
  const ip = /^[\d.]+$/.test(host) || host.startsWith("[")
  const labels = host.split(".")
  return `${url.protocol}//${ip || labels.length <= 2 ? host : labels.slice(-2).join(".")}`
}

const contextError = (reason: UserContext.UserContextErrorReason, id: Diagnostics.OperationId, operation: string) =>
  new UserContext.UserContextError({ operation, reason, diagnostics: Operation.diagnostics(id) })

/** An evaluation's failure, as a context's. */
const evaluationFailure = (operation: string, id: Diagnostics.OperationId) => (failure: Evaluation.Failure) =>
  contextError(
    failure._tag === "Gone"
      ? new Reason.BackendFailure({ kind: "Rejected", method: operation, hint: failure.error.message })
      : failure._tag === "Deadline"
      ? new Reason.BackendFailure({
        kind: "Rejected",
        method: operation,
        hint: "The page didn't answer before the deadline"
      })
      : failure.reason._tag === "Unsupported" || failure.reason._tag === "BackendFailure"
      ? failure.reason
      : new Reason.BackendFailure({ kind: "Rejected", method: operation, hint: failure.reason.message }),
    id,
    operation
  )

// ── Export ────────────────────────────────────────────────────────────────────────────────────────────────

/** A document whose origin's storage is exported, and the partition it is in. */
interface Source {
  readonly document: Target.DocumentId
  readonly origin: string
  readonly partition: CookieJar.PartitionKey
  /** The origin of the page it was found under. */
  readonly topLevelOrigin: string
}

/**
 * Whether a cookie's domain and a host are one, or one is a subdomain of the other, so the host is sent the cookie.
 * A saved state is narrowed by hosts rather than `siteOf`, whose last two labels would make `shop.co.uk` every
 * `.co.uk` cookie.
 */
export const related = (domain: string, host: string): boolean => {
  const bare = domain.replace(/^\./, "")
  return bare === host || bare.endsWith(`.${host}`) || host.endsWith(`.${bare}`)
}

/** One document per origin and partition, of the documents open in the context's pages and frames. */
const sourcesOf = Effect.fnUntraced(function*(
  runtime: Runtime.Runtime,
  context: UserContext.Id,
  hosts: ReadonlyArray<string> | undefined
) {
  const sources = new Map<string, Source>()
  for (const page of yield* runtime.model.pages.get) {
    if (page.context !== context) continue
    const { frames, status: state } = yield* page.state.get
    if (state._tag !== "Open") continue
    const top = URL.parse(state.url)
    if (top === null) continue
    if (hosts !== undefined && !hosts.some((host) => related(top.hostname, host))) continue
    // A page that isn't on a site, such as about:blank, has no site to key a frame's partition by
    const topSite = Schema.decodeUnknownOption(Url.Site)(siteOf(top))
    if (Option.isNone(topSite)) continue
    const documents = [
      state.document.id,
      ...frames.flatMap((frame) => Option.toArray(frame.document))
    ]
    for (const document of documents) {
      const entry = runtime.model.document(document)
      if (Option.isNone(entry)) continue
      const url = URL.parse((yield* entry.value.state.get).url)
      if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) continue
      const partition: CookieJar.PartitionKey = siteOf(url) === topSite.value
        ? { _tag: "Unpartitioned" }
        : { _tag: "Partitioned", topLevelSite: topSite.value, crossSiteAncestor: Option.some(true) }
      const key = `${url.origin} ${partition._tag === "Partitioned" ? partition.topLevelSite : ""}`
      if (!sources.has(key)) sources.set(key, { document, origin: url.origin, partition, topLevelOrigin: top.origin })
    }
  }
  return [...sources.values()]
})

/** `context.exportStorageState`, narrowed to the state of `hosts` when given (`related`). */
export const exportState = (runtime: Runtime.Runtime, context: UserContext.Id, hosts?: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const operation = "UserContext.exportStorageState"
    const { id } = yield* Operation.record
    const budget = yield* Operation.budget
    const cookies = yield* runtime.model.adapter.cookies(context).pipe(
      Effect.mapError((error) => {
        const mapped = Operation.fromAdapter(error, id, runtime.backend)
        return contextError(
          mapped._tag === "Reason"
            ? mapped.reason
            : new Reason.BackendFailure({
              kind: "Rejected",
              method: operation,
              hint: mapped.error.message
            }),
          id,
          operation
        )
      })
    )
    const origins: Array<typeof StorageState.OriginState.Type> = []
    for (const source of yield* sourcesOf(runtime, context, hosts)) {
      const text = yield* Effect.gen(function*() {
        const realm = yield* Evaluation.documentRealm(
          runtime,
          source.document,
          yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
          id
        )
        const value = yield* Evaluation.call(runtime, {
          realm,
          functionDeclaration: readOrigin.toString(),
          arguments: [],
          result: "value",
          userActivation: false,
          page: Option.none(),
          at: budget.at,
          id
        })
        return yield* Evaluation.fromRemote(value)
      }).pipe(
        Effect.map(Option.some),
        // A document that ended since it was listed has nothing to read: its origin is read elsewhere or not at all
        Effect.catchIf((failure) => failure._tag === "Gone", () => Effect.succeedNone),
        Effect.mapError(evaluationFailure(operation, id))
      )
      if (Option.isNone(text)) continue
      const answer = yield* Schema.decodeUnknownEffect(ReadAnswer)(text.value).pipe(
        Effect.mapError((error) =>
          contextError(
            new Reason.BackendFailure({
              kind: "IncompatibleResponse",
              method: operation,
              hint: `${source.origin}: the page's storage didn't read as expected (${error.message})`
            }),
            id,
            operation
          )
        )
      )
      if (answer._tag === "Unencodable") {
        return yield* Effect.fail(contextError(
          new Reason.Unsupported({
            capability: "storageState.indexedDbValue",
            backend: runtime.backend,
            hint: `${source.origin}, database ${JSON.stringify(answer.database)}, store ${
              JSON.stringify(answer.store)
            }: ${answer.what} can't be saved`
          }),
          id,
          operation
        ))
      }
      origins.push({
        origin: Url.Origin.make(source.origin),
        partition: source.partition,
        // Where the partition's key is an origin, as stock WebKit's is, the restore needs it
        ...(source.partition._tag === "Partitioned" ? { topLevelOrigin: Url.Origin.make(source.topLevelOrigin) } : {}),
        localStorage: answer.read.local.map(([key, value]) => [key, Redacted.make(value)] as const),
        indexedDb: answer.read.indexedDb.map((database) => ({
          name: database.name,
          version: database.version,
          stores: database.stores.map((store) => ({
            name: store.name,
            keyPath: Option.fromNullishOr(store.keyPath),
            autoIncrement: store.autoIncrement,
            indexes: store.indexes,
            records: store.records.map((record) => ({ key: record.key, value: Redacted.make(record.value) }))
          }))
        }))
      })
    }
    const kept = cookies.map(Storage.fromAdapter).filter((cookie) =>
      hosts === undefined || hosts.some((host) =>
        related(cookie.domain, host) ||
        (cookie.partitionKey._tag === "Partitioned" &&
          related(new URL(cookie.partitionKey.topLevelSite).hostname, host))
      )
    )
    return new StorageState.StorageState({ cookies: kept, origins })
  }).pipe(Operation.named("UserContext.exportStorageState", { attributes: { "browser.context.id": context } }))

// ── Import ────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a context's storage state is written from: a document the route fulfills. */
const seedPath = "/__strider_storage_state__"

/**
 * The partitions a backend can't set: those of partitioned cookies where `cookies.partitioned` is unsupported.
 * Checked before the context is created, so nothing is applied partly.
 */
export const unsupportedPartitions = (runtime: Runtime.Runtime, state: StorageState.StorageState) =>
  Effect.map(SubscriptionRef.get(runtime.model.adapter.capabilities), (capabilities) => {
    const entry = capabilities.entries.find((each) => each.name === "cookies.partitioned")
    if (entry === undefined || entry.status !== "unsupported") return []
    return [
      ...new Set(
        state.cookies.flatMap((cookie) =>
          cookie.partitionKey._tag === "Partitioned" ? [cookie.partitionKey.topLevelSite] : []
        )
      )
    ]
  })

/** The data `writeOrigin` takes, from a saved origin. */
const toRead = (origin: typeof StorageState.OriginState.Type): Read => ({
  local: origin.localStorage.map(([key, value]) => [key, Redacted.value(value)] as const),
  indexedDb: origin.indexedDb.map((database) => ({
    name: database.name,
    version: database.version,
    stores: database.stores.map((store) => ({
      name: store.name,
      keyPath: Option.getOrNull(store.keyPath),
      autoIncrement: store.autoIncrement,
      indexes: store.indexes,
      records: store.records.map((record) => ({ key: record.key, value: Redacted.value(record.value) }))
    }))
  }))
})

/**
 * Writes a storage state into a new context, before its first page: the cookies, then each origin's storage from
 * a page of the context whose documents a route fulfills.
 */
export const applyState = (
  runtime: Runtime.Runtime,
  context: UserContext.UserContext,
  state: StorageState.StorageState,
  id: Diagnostics.OperationId,
  replacement?: { readonly chains: ReadonlyArray<ReadonlyArray<string>>; readonly phase: "clear" | "write" } | undefined
) =>
  Effect.gen(function*() {
    const operation = replacement === undefined ? "Browser.newContext" : "UserContext.setStorageState"
    const record = yield* Operation.record
    const budget = record.budget
    const adapterFailure = (error: Parameters<typeof Operation.fromAdapter>[0]) => {
      const mapped = Operation.fromAdapter(error, id, runtime.backend)
      if (mapped._tag === "Timeout") return mapped.error
      return contextError(
        mapped._tag === "Reason"
          ? mapped.reason
          : new Reason.BackendFailure({
            kind: "Rejected",
            method: operation,
            hint: mapped.error.message
          }),
        id,
        operation
      )
    }
    if (state.cookies.length > 0) {
      yield* runtime.model.adapter.setCookies(context.id, state.cookies.map(Storage.toAdapter)).pipe(
        Effect.mapError(adapterFailure)
      )
    }
    const origins = replacement === undefined
      ? state.origins.filter((origin) => origin.localStorage.length > 0 || origin.indexedDb.length > 0)
      : state.origins
    if (origins.length === 0) return
    yield* Effect.acquireUseRelease(Scope.make(), (scope) =>
      Effect.gen(function*() {
        // The context's own setup: a target that went fails it, as BackendFailure
        const reasonOf = (error: Route.RouteError | Page.PageError | Target.TargetGone) =>
          Target.isTargetGone(error) ? error : error.reason
        const routeFailure = (error: Route.RouteError | Target.TargetGone | Deadline.Timeout) =>
          Deadline.isTimeout(error) ? error : contextError(asReason(reasonOf(error), operation), id, operation)
        const page = yield* context.newPage.pipe(
          Effect.mapError((error) =>
            Deadline.isTimeout(error) ? error : contextError(asReason(reasonOf(error), operation), id, operation)
          )
        )
        const { entry } = Handles.page(page)
        const html = (body: string) => Route.fulfill(HttpServerResponse.text(body, { contentType: "text/html" }))
        for (const [index, origin] of origins.entries()) {
          const seed = `${origin.origin}${seedPath}/${index}`
          yield* page.route(seed, () => html("<!DOCTYPE html><title>storage state</title>")).pipe(
            Effect.mapError(routeFailure)
          )
          // The deadline is the operation's Timeout; anything else fails the write
          const write = (failure: unknown) =>
            Deadline.isTimeout(failure)
              ? failure
              : Predicate.isTagged(failure, "Deadline")
              ? record.timeout(Option.some(`The page didn't write ${origin.origin}'s storage before the deadline`))
              : contextError(
                new Reason.BackendFailure({
                  kind: "Rejected",
                  method: operation,
                  hint: `Writing ${origin.origin}'s storage failed: ${
                    String((failure as { message?: string }).message ?? failure)
                  }`
                }),
                id,
                operation
              )
          const data = JSON.stringify(toRead(origin))
          let document: Target.DocumentId
          const chain = replacement?.chains[index]
          if (chain !== undefined && chain.length > 1) {
            const urls = chain.map((origin, depth) => `${origin}${seedPath}/${index}/ancestor/${depth}`)
            for (let depth = 0; depth < urls.length; depth++) {
              const child = urls[depth + 1]
              yield* page.route(urls[depth]!, () =>
                html(
                  child === undefined
                    ? "<!DOCTYPE html><title>storage state</title>"
                    : `<!DOCTYPE html><iframe src="${child}"></iframe>`
                )).pipe(Effect.mapError(routeFailure))
            }
            yield* page.goto(urls[0]!, { waitUntil: "load" }).pipe(Effect.mapError(write))
            const steps: Array<Engine.Step> = []
            for (let depth = 1; depth < urls.length; depth++) {
              steps.push({ _tag: "Css", selector: "iframe" }, { _tag: "Frame" })
            }
            steps.push({ _tag: "Css", selector: "html" })
            const found = yield* Runtime.element(runtime, entry, steps, id, budget.at).pipe(Effect.mapError(write))
            if (found._tag !== "Found") return yield* Effect.fail(write(new Error("the frame has no document")))
            document = found.routed.document
          } else if (origin.partition._tag === "Unpartitioned") {
            yield* page.goto(seed, { waitUntil: "load" }).pipe(Effect.mapError(write))
            const state = (yield* entry.state.get).status
            if (state._tag !== "Open") return yield* Effect.fail(write(new Error("the page closed")))
            document = state.document.id
          } else {
            // A partition is written from a frame of a page at its top-level site
            // At the top-level origin it was read under, or, saved without one, its site's default port
            const top = `${origin.topLevelOrigin ?? origin.partition.topLevelSite}${seedPath}/${index}/top`
            yield* page.route(
              top,
              () => html(`<!DOCTYPE html><title>storage state</title><iframe src="${seed}"></iframe>`)
            ).pipe(
              Effect.mapError(routeFailure)
            )
            yield* page.goto(top, { waitUntil: "load" }).pipe(Effect.mapError(write))
            const found = yield* Runtime.element(
              runtime,
              entry,
              [
                { _tag: "Css", selector: "iframe" },
                { _tag: "Frame" },
                { _tag: "Css", selector: "html" }
              ],
              id,
              budget.at
            ).pipe(Effect.mapError(write))
            if (found._tag !== "Found") return yield* Effect.fail(write(new Error("the frame has no document")))
            document = found.routed.document
          }
          yield* Effect.gen(function*() {
            const realm = yield* Evaluation.documentRealm(
              runtime,
              document,
              yield* Runtime.ownWorld(runtime, Evaluation.isolatedWorld),
              id
            )
            if (replacement?.phase === "clear") {
              yield* Evaluation.call(runtime, {
                dispatch: record,
                realm,
                functionDeclaration: clearOrigin.toString(),
                arguments: [],
                result: "value",
                userActivation: false,
                page: Option.some(entry),
                at: budget.at,
                id
              })
            }
            if (replacement?.phase !== "clear") {
              yield* Evaluation.call(runtime, {
                dispatch: record,
                realm,
                functionDeclaration: writeOrigin.toString(),
                arguments: [{ _tag: "Value", value: { type: "string", value: data } }],
                result: "value",
                userActivation: false,
                page: Option.some(entry),
                at: budget.at,
                id
              })
            }
          }).pipe(Effect.mapError((failure) => write(failure._tag === "Reason" ? failure.reason : failure)))
          yield* Effect.annotateCurrentSpan(`browser.storage_state.origin.${index}`, origin.origin)
        }
        // Closed and confirmed before the context is returned: Firefox fails a tab created while one closes (QUIRKS.md)
        yield* page.close().pipe(
          Effect.mapError((error) =>
            Deadline.isTimeout(error) ? error : contextError(asReason(error, operation), id, operation)
          )
        )
      }).pipe(Scope.provide(scope)), (scope) => Scope.close(scope, Exit.void).pipe(Operation.detached))
  }).pipe(Operation.named("StorageState.apply", { attributes: { "browser.context.id": context.id } }))

/** A page's or route's failure reason, as a context's. */
const asReason = (reason: { readonly _tag: string; readonly message: string }, operation: string) =>
  reason._tag === "InvalidInput" || reason._tag === "NotPermitted" || reason._tag === "Unsupported" ||
    reason._tag === "BackendFailure"
    ? reason as UserContext.UserContextErrorReason
    : new Reason.BackendFailure({ kind: "Rejected", method: operation, hint: reason.message })

/** Deletes origin data without silently leaving blocked databases behind. Evaluated in the browser. */
export async function clearOrigin(): Promise<void> {
  for (const database of await indexedDB.databases()) {
    if (database.name === undefined) continue
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase(database.name!)
      deletion.onsuccess = () => resolve()
      deletion.onerror = () => reject(deletion.error)
      deletion.onblocked = () =>
        reject(new Error("IndexedDB deletion is blocked by an open connection; it may complete later"))
    })
  }
  localStorage.clear()
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
  if (isSecureContext && storage?.getDirectory !== undefined) {
    const directory = await storage.getDirectory()
    // Firefox Xrays do not expose Symbol.asyncIterator; drive the WebIDL iterator directly.
    const iterator = (directory as FileSystemDirectoryHandle & { keys: () => AsyncIterator<string> }).keys()
    while (true) {
      const entry = await iterator.next()
      if (entry.done) break
      await directory.removeEntry(entry.value, { recursive: true })
    }
  }
}

interface History {
  readonly origins: Map<string, ReadonlyArray<string>>
  readonly cookieOrigins: Set<string>
  unsupportedHistory: boolean
}
const histories = new WeakMap<Model.ContextEntry, History>()

/** A native partition is reproduced by its ancestor origins, including their ports and cross-site ancestors. */
const remember = (history: History, chain: ReadonlyArray<string>) => {
  const leaf = chain[chain.length - 1]
  if (leaf === undefined || URL.parse(leaf) === null) return
  if (!chain.every((origin) => /^https?:\/\//.test(origin))) {
    history.unsupportedHistory = true
    return
  }
  history.origins.set(JSON.stringify(chain), chain)
  // Storage-access grants can expose the first-party area from a partitioned frame.
  const firstParty = [chain[chain.length - 1]!]
  history.origins.set(JSON.stringify(firstParty), firstParty)
}

const rememberCookie = (history: History, domain: string) => {
  const raw = domain.replace(/^\./, "")
  let host = URL.parse(`https://${raw}`)?.hostname ?? raw.toLowerCase()
  while (host !== "") {
    history.cookieOrigins.add(`https://${host}`)
    // Domain cookies can be set on parent domains. IP addresses have no parent domain.
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) break
    const dot = host.indexOf(".")
    if (dot < 0) break
    host = host.slice(dot + 1)
  }
}
const rememberCookieUrl = (history: History, origin: string) => {
  const url = URL.parse(origin)
  if (url !== null && (url.protocol === "http:" || url.protocol === "https:")) {
    rememberCookie(history, url.hostname)
  }
}

/** Cookie domains set explicitly need no document or network request to create their cookies. */
export const cookieRecorder = (entry: Model.ContextEntry): ((cookie: Adapter.Cookie) => void) | undefined => {
  const history = histories.get(entry)
  return history === undefined ? undefined : (cookie) => rememberCookie(history, cookie.domain)
}

const chainOf = (origin: typeof StorageState.OriginState.Type): ReadonlyArray<string> =>
  origin.partition._tag === "Unpartitioned"
    ? [origin.origin]
    : [origin.topLevelOrigin ?? origin.partition.topLevelSite, origin.origin]

/** Installs history only for a context that requested it, before import or the first user page. */
export const track = Effect.fnUntraced(
  function*(runtime: Runtime.Runtime, entry: Model.ContextEntry, state?: StorageState.StorageState) {
    const history: History = {
      origins: new Map(),
      cookieOrigins: new Set(),
      unsupportedHistory: false
    }
    for (const origin of state?.origins ?? []) remember(history, chainOf(origin))
    for (const cookie of state?.cookies ?? []) rememberCookie(history, cookie.domain)
    histories.set(entry, history)
    yield* Effect.addFinalizer(() => Effect.sync(() => histories.delete(entry)))
    yield* runtime.model.observeStorageSources(entry, (origins, cookieOnly) => {
      for (const origin of origins) rememberCookieUrl(history, origin)
      if (!cookieOnly) remember(history, origins)
    })
  }
)

export const replaceState = (
  runtime: Runtime.Runtime,
  context: UserContext.UserContext,
  entry: Model.ContextEntry,
  state: StorageState.StorageState,
  options?: { readonly recovered?: boolean | undefined }
) =>
  Effect.gen(function*() {
    const operation = "UserContext.setStorageState"
    const { id } = yield* Operation.record
    const history = histories.get(entry)
    const refuse = (hint: string) => contextError(new Reason.NotPermitted({ required: "control", hint }), id, operation)
    if (Option.isSome((yield* entry.state.get).closed)) {
      return yield* Effect.fail(refuse("The context is closed"))
    }
    if (history === undefined || options?.recovered === true) {
      return yield* Effect.fail(
        refuse(
          options?.recovered === true
            ? "Recovered or reclaimed contexts cannot track prior storage history for replacement"
            : "Create the context with storageStateTracking: true before replacing its storage"
        )
      )
    }
    yield* Effect.acquireUseRelease(
      Effect.suspend(() => {
        if (entry.storageReplacing) return Effect.fail(refuse("Another storage replacement is in progress"))
        entry.storageReplacing = true
        return Effect.void
      }),
      () =>
        Effect.gen(function*() {
          if ((yield* entry.state.get).pages.some(WebAuthn.isHeld)) {
            return yield* Effect.fail(
              refuse("Release acquired virtual authenticators before replacing storage")
            )
          }
          if (history.unsupportedHistory) {
            return yield* Effect.fail(contextError(
              new Reason.Unsupported({
                capability: "storageState.history",
                backend: runtime.backend,
                hint: "Visited non-HTTP(S) storage or an opaque ancestor partition cannot be reproduced"
              }),
              id,
              operation
            ))
          }
          const partitions = yield* unsupportedPartitions(runtime, state)
          if (partitions.length > 0) {
            return yield* Effect.fail(
              contextError(
                new StorageState.Incompatible({
                  partitions,
                  hint: "The backend cannot restore these cookie partitions"
                }),
                id,
                operation
              )
            )
          }
          for (const origin of state.origins) {
            if (!chainOf(origin).every((part) => /^https?:\/\//.test(part))) {
              return yield* Effect.fail(contextError(
                new Reason.Unsupported({
                  capability: "storageState.origin",
                  backend: runtime.backend,
                  hint: "Replacement requires HTTP(S) origins and partition ancestors"
                }),
                id,
                operation
              ))
            }
            if (origin.partition._tag === "Partitioned") {
              const site = new URL(origin.partition.topLevelSite)
              const top = new URL(origin.topLevelOrigin ?? origin.partition.topLevelSite)
              const child = new URL(origin.origin)
              const within = (host: string) => host === site.hostname || host.endsWith(`.${site.hostname}`)
              if (
                top.protocol !== site.protocol || !within(top.hostname) ||
                (child.protocol === site.protocol && within(child.hostname))
              ) {
                return yield* Effect.fail(contextError(
                  new Reason.Unsupported({
                    capability: "storageState.partition",
                    backend: runtime.backend,
                    hint:
                      "The top-level origin must match its declared site, and a same-site partition needs an ancestor chain the saved format does not carry"
                  }),
                  id,
                  operation
                ))
              }
            }
            if (
              origin.partition._tag === "Partitioned" && Option.isSome(origin.partition.crossSiteAncestor) &&
              !origin.partition.crossSiteAncestor.value
            ) {
              return yield* Effect.fail(
                contextError(
                  new Reason.Unsupported({
                    capability: "storageState.partition",
                    backend: runtime.backend,
                    hint: "A partition with crossSiteAncestor: false cannot be reproduced by a cross-site seed frame"
                  }),
                  id,
                  operation
                )
              )
            }
          }
          for (const cookie of state.cookies) rememberCookie(history, cookie.domain)
          const incoming = new Map(state.origins.map((origin) => [JSON.stringify(chainOf(origin)), origin]))
          for (const origin of state.origins) remember(history, chainOf(origin))
          const chains = [...history.origins.values()]
          const origins = chains.map((chain): typeof StorageState.OriginState.Type =>
            incoming.get(JSON.stringify(chain)) ?? {
              origin: Url.Origin.make(chain[chain.length - 1]!),
              partition: { _tag: "Unpartitioned" },
              localStorage: [],
              indexedDb: []
            }
          )
          yield* Effect.gen(function*() {
            yield* applyState(runtime, context, new StorageState.StorageState({ cookies: [], origins }), id, {
              chains,
              phase: "clear"
            })
            const capabilities = yield* SubscriptionRef.get(runtime.model.adapter.capabilities)
            const partialCookies = capabilities.entries.some((entry) =>
              entry.name === "cookies" && entry.status === "partial"
            )
            yield* Effect.acquireUseRelease(Scope.make(), (scope) =>
              Effect.gen(function*() {
                const page = partialCookies
                  ? yield* context.newPage.pipe(Effect.mapError((error) =>
                    Deadline.isTimeout(error)
                      ? error
                      : contextError(
                        asReason(Target.isTargetGone(error) ? error : error.reason, operation),
                        id,
                        operation
                      )
                  ))
                  : undefined
                const clear = () =>
                  runtime.model.adapter.clearCookies(entry.id, page === undefined ? undefined : { page: page.id })
                    .pipe(Effect.mapError((error) => {
                      const mapped = Operation.fromAdapter(error, id, runtime.backend)
                      return mapped._tag === "Timeout" ? mapped.error : contextError(
                        new Reason.BackendFailure({
                          kind: "Rejected",
                          method: operation,
                          hint: `Storage replacement may be partial: clearing cookies failed (${error.message})`
                        }),
                        id,
                        operation
                      )
                    }))
                if (page === undefined) yield* clear()
                else {
                  // Stock WebKit deletes all paths for a hostname through Automation; visit every possible cookie host.
                  for (const [index, origin] of [...history.cookieOrigins].entries()) {
                    const url = `${origin}${seedPath}/cookies/${index}`
                    yield* page.route(
                      url,
                      () => Route.fulfill(HttpServerResponse.text("<!DOCTYPE html>", { contentType: "text/html" }))
                    ).pipe(
                      Effect.mapError((error) =>
                        Deadline.isTimeout(error)
                          ? error
                          : contextError(
                            asReason(Target.isTargetGone(error) ? error : error.reason, operation),
                            id,
                            operation
                          )
                      )
                    )
                    yield* page.goto(url, { waitUntil: "load" }).pipe(Effect.mapError((error) =>
                      Deadline.isTimeout(error)
                        ? error
                        : contextError(
                          asReason(Target.isTargetGone(error) ? error : error.reason, operation),
                          id,
                          operation
                        )
                    ))
                    yield* clear()
                  }
                }
              }).pipe(Scope.provide(scope)), (scope) => Scope.close(scope, Exit.void).pipe(Operation.detached))
            yield* applyState(runtime, context, state, id, { chains: state.origins.map(chainOf), phase: "write" })
          }).pipe(Effect.mapError((error) =>
            Deadline.isTimeout(error)
              ? error
              : contextError(new StorageState.PartiallyApplied({ hint: error.message }), id, operation)
          ))
        }),
      () =>
        Effect.sync(() => {
          entry.storageReplacing = false
        })
    )
  }).pipe(Operation.named("UserContext.setStorageState", { attributes: { "browser.context.id": entry.id } }))
