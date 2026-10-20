/**
 * Builds a backend's model from its committed inputs: the vendored source, then corrections, then
 * annotations. Reading and writing go through Effect's `FileSystem`; the transforms are pure.
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import type { CdpProtocol } from "./Cdp.ts"
import { parse } from "./Cdp.ts"
import { fromThrown } from "./CodegenError.ts"
import { applyCorrections, applyOverlays, Correction, Overlay } from "./Corrections.ts"
import type { ProtocolModel } from "./Model.ts"

export const Backend = Schema.Literals(["cdp"])
export type Backend = typeof Backend.Type

/** The CDP revision the vendored source is pinned to; see `protocols/cdp/source/SOURCE.md`. */
const revisions: Record<Backend, string> = { cdp: "0.0.1696802" }

const readJson = Effect.fnUntraced(function*<S extends Schema.Top>(path: string, schema: S) {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(path)
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text)
})

const readDirectory = Effect.fnUntraced(function*<S extends Schema.Top>(directory: string, schema: S) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const names = (yield* fs.readDirectory(directory)).filter((name) => name.endsWith(".json")).sort()
  return yield* Effect.forEach(
    names,
    (name) => readJson(path.join(directory, name), schema).pipe(Effect.map((value) => [name, value] as const))
  )
})

/** The directory holding a backend's inputs and committed model. */
export const protocolDirectory = Effect.fnUntraced(function*(root: string, backend: Backend) {
  const path = yield* Path.Path
  return path.join(root, "packages/tools/codegen/protocols", backend)
})

/** Builds the model: parse the source, apply corrections, apply annotations. */
export const build = Effect.fnUntraced(function*(root: string, backend: Backend) {
  const path = yield* Path.Path
  const directory = yield* protocolDirectory(root, backend)
  const sources = yield* Effect.forEach(
    ["browser_protocol.json", "js_protocol.json"],
    (name) => readJson(path.join(directory, "source", name), Schema.Unknown)
  )
  const corrections = yield* readDirectory(path.join(directory, "patches"), Correction)
  const overlays = yield* readDirectory(path.join(directory, "overlay"), Overlay)
  return yield* Effect.try({
    try: () =>
      applyOverlays(
        applyCorrections(parse(revisions[backend], sources as ReadonlyArray<CdpProtocol>), corrections),
        overlays
      ),
    catch: fromThrown
  })
})

/** The committed form of a model: sorted, two-space JSON, with a trailing newline. */
export const serialize = (model: ProtocolModel): string => JSON.stringify(model, null, 2) + "\n"
