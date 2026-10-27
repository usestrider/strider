/**
 * A record of what a program owns outside itself: the browsers it launched, and the directories it made for them.
 *
 * A program that ends normally removes what it made, and its record. One that dies leaves both, and `strider prune`
 * reads the records of programs that are gone and reclaims what they name.
 *
 * Nothing is recorded unless a program provides `Ledger.layer`. The CLI's sessions always provide it.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"

/**
 * Schema for one thing a program owns: a browser it launched, with the profile directory its command line names,
 * or a directory it made.
 *
 * @stability experimental
 * @category schemas
 * @since 0.1.0
 */
export const Item = Schema.Union([
  Schema.TaggedStruct("Browser", { pid: Schema.Number, executable: Schema.String, profile: Schema.String }),
  Schema.TaggedStruct("Directory", { path: Schema.String })
])

/**
 * One thing a program owns.
 *
 * **Details**
 *
 * A browser is identified by its profile directory, which its command line names and which only this program
 * uses, so another process that later gets the same id can't be mistaken for it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export type Item = typeof Item.Type

/**
 * A program's record: who it is, and what it owns.
 *
 * **Details**
 *
 * `startedAt` is when the program's process started, in milliseconds since the epoch, so a later process given
 * the same id isn't taken for the program.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export class Record extends Schema.Class<Record>("@usestrider/browser/Ledger/Record")({
  owner: Schema.Struct({ pid: Schema.Number, startedAt: Schema.Number }),
  items: Schema.Array(Item)
}) {}

/**
 * Records what the program owns, while it owns it.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Ledger {
  /**
   * Records an item the program now owns.
   *
   * **Example** (Recording a directory the program made)
   *
   * ```ts import.meta.vitest
   * import { Ledger } from "@usestrider/browser"
   * import { Effect, FileSystem } from "effect"
   *
   * const makeScratch = Effect.gen(function*() {
   *   const fs = yield* FileSystem.FileSystem
   *   const ledger = yield* Ledger.CurrentLedger
   *   const path = yield* fs.makeTempDirectory({ prefix: "shop-fixtures-" })
   *   yield* ledger.add({ _tag: "Directory", path })
   *   return path
   * })
   * ```
   */
  readonly add: (item: Item) => Effect.Effect<void>
  /**
   * Removes an item from the record once the program no longer owns it. An item the record doesn't have is
   * ignored.
   *
   * **Example** (Forgetting a directory once it's deleted)
   *
   * ```ts import.meta.vitest
   * import { Ledger } from "@usestrider/browser"
   * import { Effect, FileSystem } from "effect"
   *
   * const removeScratch = Effect.fn("removeScratch")(function*(path: string) {
   *   const fs = yield* FileSystem.FileSystem
   *   const ledger = yield* Ledger.CurrentLedger
   *   yield* fs.remove(path, { recursive: true })
   *   yield* ledger.remove({ _tag: "Directory", path })
   * })
   * ```
   */
  readonly remove: (item: Item) => Effect.Effect<void>
}

/**
 * The ledger in use: by default, one that records nothing. `layer` provides one that keeps a record.
 *
 * @stability experimental
 * @category references
 * @since 0.1.0
 */
export const CurrentLedger: Context.Reference<Ledger> = Context.Reference<Ledger>(
  "@usestrider/browser/Ledger/CurrentLedger",
  { defaultValue: () => ({ add: () => Effect.void, remove: () => Effect.void }) }
)

const host = globalThis as {
  readonly process?: { readonly pid: number }
  readonly performance?: { readonly timeOrigin: number }
}

/**
 * Provides a ledger that keeps the program's record in `directory`, one file per program, and removes the file when
 * the layer's scope closes.
 *
 * **Details**
 *
 * - The file is `<pid>-<startedAt>.json`, rewritten as items come and go.
 * - A write that fails is logged as a warning and fails nothing: the program goes on without its record.
 * - `strider prune` reads `$XDG_STATE_HOME/strider/ledger`, or `~/.local/state/strider/ledger` when that's unset.
 *   Give the layer that directory for `prune` to find the record.
 * - Strider reads the ledger when it launches a browser and when a context makes its temporary downloads
 *   directory, so provide the layer to the whole program, not only to the browser's layer.
 *
 * **Example** (Recording what a program launches)
 *
 * ```ts import.meta.vitest
 * import { NodeServices } from "@effect/platform-node"
 * import { Browser, Ledger } from "@usestrider/browser"
 * import { Chromium } from "@usestrider/browser/chromium"
 * import { Effect } from "effect"
 *
 * declare const program: Effect.Effect<void, never, Browser.Browser>
 *
 * const main = program.pipe(
 *   Effect.provide(Chromium.layer({ executablePath: "/usr/bin/chromium" })),
 *   Effect.provide(Ledger.layer("/home/ci/.local/state/strider/ledger")),
 *   Effect.provide(NodeServices.layer)
 * )
 * ```
 *
 * @stability experimental
 * @category layers
 * @since 0.1.0
 */
export const layer = (directory: string): Layer.Layer<never, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effectContext(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const owner = {
      pid: host.process?.pid ?? 0,
      startedAt: Math.round(host.performance?.timeOrigin ?? Date.now())
    }
    const file = path.join(directory, `${owner.pid}-${owner.startedAt}.json`)
    const items: Array<Item> = []
    const lock = yield* Semaphore.make(1)
    const write = lock.withPermit(Effect.suspend(() => {
      const record = new Record({ owner, items: [...items] })
      return Effect.flatMap(
        Schema.encodeEffect(Schema.toCodecJson(Record))(record),
        (encoded) =>
          Effect.andThen(
            fs.makeDirectory(directory, { recursive: true }),
            fs.writeFileString(file, JSON.stringify(encoded, null, 2))
          )
      ).pipe(Effect.catchCause((cause) => Effect.logWarning("Ledger: couldn't write the record", cause)))
    }))
    yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore))
    const same = (a: Item, b: Item) =>
      a._tag === "Browser" && b._tag === "Browser"
        ? a.pid === b.pid && a.profile === b.profile
        : a._tag === "Directory" && b._tag === "Directory" && a.path === b.path
    const ledger: Ledger = {
      add: (item) => Effect.suspend(() => (items.push(item), write)),
      remove: (item) =>
        Effect.suspend(() => {
          const index = items.findIndex((each) => same(each, item))
          if (index < 0) return Effect.void
          items.splice(index, 1)
          return write
        })
    }
    return Context.make(CurrentLedger, ledger)
  }))

/**
 * Reads the records in `directory`, one for each program that has one, ended or not. A file that isn't a record
 * is skipped.
 *
 * **Example** (Listing what each program owns)
 *
 * ```ts import.meta.vitest
 * import { Ledger } from "@usestrider/browser"
 * import { Console, Effect } from "effect"
 *
 * const listOwners = Effect.gen(function*() {
 *   for (const { record } of yield* Ledger.read("/home/ci/.local/state/strider/ledger")) {
 *     yield* Console.log(`process ${record.owner.pid} owns ${record.items.length} items`)
 *   }
 * })
 * ```
 *
 * @stability experimental
 * @category getters
 * @since 0.1.0
 */
export const read = (
  directory: string
): Effect.Effect<
  ReadonlyArray<{ readonly file: string; readonly record: Record }>,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const names = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []))
    const records: Array<{ readonly file: string; readonly record: Record }> = []
    for (const name of names.filter((each) => each.endsWith(".json")).sort()) {
      const file = path.join(directory, name)
      const decoded = yield* fs.readFileString(file).pipe(
        Effect.flatMap((text) => Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.toCodecJson(Record)))(text)),
        Effect.option
      )
      if (decoded._tag === "Some") records.push({ file, record: decoded.value })
    }
    return records
  })
