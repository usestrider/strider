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
    records: Schema.Array(Schema.Struct({
      key: Schema.Unknown,
      value: Schema.Redacted(Schema.Unknown)
    }))
  }))
})

/**
 * Schema for one origin's storage within one partition.
 *
 * @stability unstable
 * @category schemas
 * @since 0.1.0
 */
export const OriginState = Schema.Struct({
  origin: Url.Origin,
  partition: CookieJar.PartitionKey,
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
export class StorageState extends Schema.Class<StorageState>("effect-browser/StorageState")({
  cookies: Schema.Array(CookieJar.Cookie),
  origins: Schema.Array(OriginState)
}) {}

/**
 * Codec between a `StorageState` and its JSON text, for saving to disk and reading back.
 *
 * **Example** (Log in once, reuse the session)
 *
 * ```ts import.meta.vitest
 * import { Config, Effect, Schema } from "effect"
 * import { Browser, Expect, StorageState } from "effect-browser"
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
export const Json = Schema.fromJsonString(StorageState)

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
export class Incompatible extends Schema.Error<Incompatible>("effect-browser/StorageState/Incompatible")({
  _tag: Schema.tag("Incompatible"),
  partitions: Schema.Array(Schema.String),
  hint: Schema.String
}) {
  override get message(): string {
    return `Can't apply ${this.partitions.length} partitions (${this.hint})`
  }
}
