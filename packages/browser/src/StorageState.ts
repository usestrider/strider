/**
 * A context's saved storage: cookies, `localStorage` and IndexedDB, for each origin and partition.
 *
 * Export a signed-in context's state with `context.exportStorageState`, save it with the `Json` codec, and start
 * new contexts from it with `UserContext.Options.storageState`. It carries secrets: values are `Redacted` in
 * memory, and `Json` writes them out in full.
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
     * Each record's key and value in Strider's JSON-safe encoding, which keeps a `Date`, `RegExp`, `Map`,
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
 * A partitioned origin also has `topLevelOrigin`: the origin of the page it was read under. A restore writes its
 * storage from a frame in a page at that origin, or, in a state saved without one, at `partition`'s site on its
 * default port. WebKit needs it, because it keys a partition by the top-level origin, port included; Chromium
 * and Firefox key it by site.
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
 * It writes each `Redacted` value in full, through `Schema.toCodecJson`. Effect's default JSON encoding
 * (`Schema.fromJsonString(StorageState)`) writes `"<redacted>"` instead, which suits logs but loses every secret
 * in a saved file.
 *
 * **Example** (Logging in once and reusing the session)
 *
 * ```ts import.meta.vitest
 * import { Browser, Expect, StorageState } from "@usestrider/browser"
 * import { Config, Effect, Schema } from "effect"
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
 * Reason for a storage state the new context can't apply in full, such as partitioned cookies on a backend that
 * can't set them.
 *
 * **Details**
 *
 * The context isn't created, so nothing is applied.
 *
 * **Example** (Starting signed out when the state doesn't apply)
 *
 * ```ts import.meta.vitest
 * import { Browser, StorageState } from "@usestrider/browser"
 * import { Effect } from "effect"
 *
 * const signedIn = Effect.fn("signedIn")(
 *   function*(storageState: StorageState.StorageState) {
 *     return yield* Browser.newContext({ storageState }).pipe(
 *       Effect.catchReason(
 *         "UserContextError",
 *         "Incompatible",
 *         (reason) =>
 *           Effect.logWarning(`Starting signed out: ${reason.hint}`).pipe(
 *             Effect.andThen(Browser.newContext())
 *           )
 *       )
 *     )
 *   }
 * )
 * ```
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
