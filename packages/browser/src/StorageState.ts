/**
 * A context's saved storage: cookies, `localStorage` and IndexedDB, per partition.
 *
 * Export a logged-in context's state with `context.exportStorageState`, persist it with the `Json` codec, and
 * start new contexts from it with `UserContext.Options.storageState`. It crosses a persistence boundary and
 * carries secrets: values are `Redacted` in memory, and encoding writes them out in full, because that is the
 * point of saving them.
 *
 * @stability unstable
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import * as CookieJar from "./CookieJar.ts"
import * as Url from "./Url.ts"

/**
 * Schema for one IndexedDB database's contents.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const IndexedDbDatabase = Schema.Struct({
  name: Schema.String,
  version: Schema.Int,
  stores: Schema.Array(Schema.Struct({
    name: Schema.String,
    /** The store's key path; `None` for out-of-line keys. */
    keyPath: Schema.Option(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    autoIncrement: Schema.Boolean,
    indexes: Schema.Array(Schema.Struct({
      name: Schema.String,
      keyPath: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
      unique: Schema.Boolean,
      multiEntry: Schema.Boolean
    })),
    /**
     * Each record's key and value in the library's JSON-safe encoding, which keeps a `Date`, `RegExp`, `Map`,
     * `Set`, `ArrayBuffer`, typed array, `bigint`, `undefined` and the numbers JSON can't write.
     */
    records: Schema.Array(Schema.Struct({
      key: Schema.Unknown,
      value: Schema.Redacted(Schema.Unknown)
    }))
  }))
})

/**
 * Schema for one origin's storage within one partition.
 *
 * **Details**
 *
 * `topLevelOrigin` is, for a partitioned origin, the origin of the top-level document it was read under (review 24):
 * stock WebKit keys a partition by that origin, port included, where Chromium and Firefox key it by `partition`'s
 * site. A restore writes the origin's storage under a page there; a state saved without it, under the site's
 * default port.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OriginState = Schema.Struct({
  origin: Url.Origin,
  partition: CookieJar.PartitionKey,
  topLevelOrigin: Schema.optionalKey(Url.Origin),
  localStorage: Schema.Array(Schema.Tuple([Schema.String, Schema.Redacted(Schema.String)])),
  indexedDb: Schema.Array(IndexedDbDatabase)
})

/**
 * A context's saved storage.
 *
 * @stability unstable
 * @category models
 * @since 0.1.0
 */
export class StorageState extends Schema.Class<StorageState>("@usestrider/browser/StorageState")({
  cookies: Schema.Array(CookieJar.Cookie),
  origins: Schema.Array(OriginState)
}) {}

/**
 * Codec between a `StorageState` and its JSON text, for saving to disk and reading back.
 *
 * **Details**
 *
 * It is built with `Schema.toCodecJson`, which writes each `Redacted` value in full. Effect's default JSON
 * encoding (`Schema.fromJsonString(StorageState)`) writes `"<redacted>"` instead, which is right for logs, CLI
 * output and agent results, and would lose every secret in a saved file.
 *
 * **Example** (Log in once, reuse the session)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect, Schema } from "effect"
 * import { Browser, Expect, StorageState } from "@usestrider/browser"
 *
 * const loginOnce = Effect.gen(function*() {
 *   const json = yield* Effect.scoped(Effect.gen(function*() {
 *     const page = yield* Browser.newPage()
 *     yield* page.goto("https://app.example.com/login")
 *     yield* page.getByLabel("Email").fill("me@example.com")
 *     yield* page.getByLabel("Password").fill(yield* Config.Redacted("PASSWORD"))
 *     yield* page.getByRole("button", { name: "Sign in" }).click()
 *     yield* page.getByText("Welcome").pipe(Expect.toBeVisible)
 *     const state = yield* page.context.exportStorageState
 *     return yield* Schema.encodeEffect(StorageState.Json)(state)
 *   }))
 *   const storageState = yield* Schema.decodeEffect(StorageState.Json)(json)
 *   return yield* Browser.newPage({ storageState })
 * })
 * ```
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const Json = Schema.fromJsonString(Schema.toCodecJson(StorageState))

/**
 * Reason for a storage state that the new context can't apply in full, such as partitions the backend
 * doesn't support.
 *
 * **Details**
 *
 * Nothing is applied partly: the context isn't created.
 *
 * @stability unstable
 * @category reasons
 * @since 0.1.0
 */
export class Incompatible extends Schema.Error<Incompatible>("@usestrider/browser/StorageState/Incompatible")({
  _tag: Schema.tag("Incompatible"),
  partitions: Schema.Array(Schema.String),
  hint: Schema.String
}) {
  override get message(): string {
    return `Can't apply ${this.partitions.length} partitions (${this.hint})`
  }
}
