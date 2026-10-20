/**
 * The Playwright WebKit build the WebKit adapter is generated from, and how to tell whether a build is that one:
 * by the `protocol.json` every build ships beside its executable. The launcher refuses another build, and
 * `strider browsers` says which builds it finds are this one.
 */
import * as Effect from "effect/Effect"
import * as Hex from "effect/encoding/Hex"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"

/** The Playwright WebKit build the adapter was generated from, and the SHA-256 of its `protocol.json`. */
export const build = {
  revision: "2359",
  protocolSha256: "5962bc790bde7750ce127029962a6c1bd93aed884cbcf832da8393c2a12c106c"
} as const

const sha256 = (bytes: Uint8Array) =>
  Effect.promise(() => globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)).pipe(
    Effect.map((digest) => Hex.encode(new Uint8Array(digest)))
  )

/** The `protocol.json` beside an executable, as its SHA-256; `None` if there is none. */
export const protocolDigest = Effect.fnUntraced(function*(executable: string) {
  const fs = yield* FileSystem.FileSystem
  const directory = executable.slice(0, Math.max(executable.lastIndexOf("/"), executable.lastIndexOf("\\")))
  const bytes = yield* fs.readFile(`${directory}/protocol.json`).pipe(Effect.option)
  return Option.isNone(bytes) ? Option.none<string>() : Option.some(yield* sha256(bytes.value))
})
