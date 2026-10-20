/**
 * Builds a backend's model from its committed inputs: the vendored source, then corrections, then
 * annotations. Reading and writing go through Effect's `FileSystem`; the transforms are pure.
 */
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Schema from "effect/Schema"
import * as Cddl from "./Cddl.ts"
import type { CdpProtocol } from "./Cdp.ts"
import * as Cdp from "./Cdp.ts"
import { fromThrown } from "./CodegenError.ts"
import { applyCorrections, applyOverlays, Correction, Overlay } from "./Corrections.ts"
import type { ProtocolModel } from "./Model.ts"

export const Backend = Schema.Literals(["cdp", "bidi"])
export type Backend = typeof Backend.Type

/** The revision each vendored source is pinned to; see `protocols/<backend>/source/SOURCE.md`. */
export const revisions: Record<Backend, string> = {
  cdp: "0.0.1696802",
  bidi: "f922e6af669ead51496db85f37813f39438ef171"
}

/** Where each backend's modules are written, under `packages/browser/src`. */
export const outputs: Record<Backend, string> = { cdp: "cdp", bidi: "bidi-protocol" }

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
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* protocolDirectory(root, backend)
  const parse = backend === "cdp"
    ? yield* Effect.forEach(
      ["browser_protocol.json", "js_protocol.json"],
      (name) => readJson(path.join(directory, "source", name), Schema.Unknown)
    ).pipe(Effect.map((sources) => () => Cdp.parse(revisions.cdp, sources as ReadonlyArray<CdpProtocol>)))
    : yield* Effect.forEach(
      [
        { file: "remote.cddl", side: "remote" },
        { file: "local.cddl", side: "local" },
        // The Permissions spec's module, whose commands have no return type
        { file: "permissions.cddl", side: "remote", emptyResults: true }
      ] as const,
      (source) =>
        fs.readFileString(path.join(directory, "source", source.file)).pipe(
          Effect.map((text): Cddl.CddlSource => ({ ...source, text }))
        )
    ).pipe(Effect.map((sources) => () => Cddl.parse(revisions.bidi, sources)))
  const corrections = yield* readDirectory(path.join(directory, "patches"), Correction)
  const overlays = yield* readDirectory(path.join(directory, "overlay"), Overlay)
  return yield* Effect.try({
    try: () => applyOverlays(applyCorrections(parse(), corrections), overlays),
    catch: fromThrown
  })
})

/** The committed form of a model: sorted, two-space JSON, with a trailing newline. */
export const serialize = (model: ProtocolModel): string => JSON.stringify(model, null, 2) + "\n"
