/**
 * The package's version, read from its `package.json`: what the `strider` command reports, and what a HAR names
 * as its creator's.
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"

/** The package's `package.json`, as far as the version is read from it. */
const Manifest = Schema.fromJsonString(Schema.Struct({ version: Schema.String }))

/** The package's version, from its `package.json`. */
export const read = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  // This module is two directories below the package's root, in src/ and in dist/ alike
  const manifest = yield* path.fromFileUrl(new URL("../../package.json", import.meta.url))
  return (yield* Schema.decodeEffect(Manifest)(yield* fs.readFileString(manifest))).version
}).pipe(Effect.orDie)
