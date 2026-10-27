/**
 * HAR replay: a route handler that answers requests from a recorded HAR.
 *
 * - **Reading.** The file is read once, as the handler is made: a HAR, or the zip `content: "attach"` writes,
 *   told apart by the zip's signature, never by the file's extension. Bodies come from an entry's `text`, base64
 *   where its `encoding` (a response's) or `_encoding` (a request's) says so, or the zip file its `_file` names.
 * - **Matching.** An entry matches a request by method and URL, and by body where both have one; the latest
 *   matching entry wins, as a later recording of the same request is the newer answer.
 * - **Answering.** A matched entry's response is fulfilled as recorded: a redirect as a redirect, which the
 *   browser follows to the next request. A response's body is replayed decoded, so the headers that describe
 *   an encoding or a length go, and a `Set-Cookie` whose value an export redacted goes with them. An entry that
 *   failed without a response is replayed as a failure.
 */
import * as Effect from "effect/Effect"
import * as Encoding from "effect/encoding/Base64"
import * as Zip from "effect/encoding/Zip"
import * as FileSystem from "effect/FileSystem"
import * as Cookies from "effect/http/Cookies"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as Har from "../Har.ts"
import * as Reason from "../Reason.ts"
import type * as Route from "../Route.ts"
import * as Operation from "./operation.ts"
import * as RouteDecision from "./routeDecision.ts"

const Header = Schema.Struct({ name: Schema.String, value: Schema.String })

const Body = {
  text: Schema.optional(Schema.String),
  _file: Schema.optional(Schema.String)
}

/** What replay reads of a HAR: the rest of an entry is the recording's. */
const Log = Schema.Struct({
  log: Schema.Struct({
    entries: Schema.Array(Schema.Struct({
      request: Schema.Struct({
        method: Schema.String,
        url: Schema.String,
        postData: Schema.optional(Schema.Struct({ ...Body, _encoding: Schema.optional(Schema.String) }))
      }),
      response: Schema.Struct({
        status: Schema.Number,
        statusText: Schema.optional(Schema.String),
        headers: Schema.Array(Header),
        content: Schema.Struct({ ...Body, encoding: Schema.optional(Schema.String) })
      })
    }))
  })
})

type Entry = typeof Log.Type["log"]["entries"][number]

/** Settings for `Route.fromHar`. */
export interface Options {
  readonly notFound?: "abort" | "fallthrough" | undefined
}

const zipSignature = [0x50, 0x4b, 0x03, 0x04]

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, at) => byte === b[at])

/** The headers a decoded body can't be replayed with. */
const describesEncoding = new Set(["content-encoding", "content-length", "transfer-encoding"])

/** A HAR as replay reads it: its entries, and the files a zip holds beside it. */
const read = Effect.fnUntraced(function*(path: string) {
  const fs = yield* FileSystem.FileSystem
  const bytes = yield* fs.readFile(path)
  const files = new Map<string, Uint8Array>()
  let har = bytes
  if (zipSignature.every((byte, at) => bytes[at] === byte)) {
    yield* Stream.make(bytes).pipe(
      Stream.pipeThroughChannel(Zip.decode()),
      Stream.runForEach((entry) =>
        Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
          const all = Array.from(chunks)
          const content = new Uint8Array(all.reduce((size, chunk) => size + chunk.length, 0))
          let offset = 0
          for (const chunk of all) {
            content.set(chunk, offset)
            offset += chunk.length
          }
          files.set(entry.header.path, content)
        }))
      )
    )
    const found = files.get("har.har")
    if (found === undefined) {
      return yield* Effect.fail(
        new Reason.InvalidInput({ input: "path", expected: "a HAR, or a zip holding har.har", hint: path })
      )
    }
    har = found
  }
  const log = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Log))(new TextDecoder().decode(har)).pipe(
    Effect.mapError((error) =>
      new Reason.InvalidInput({ input: "path", expected: "a HAR 1.2 log", hint: `${path}: ${error.message}` })
    )
  )
  return { entries: log.log.entries, files }
})

/** A body as an entry holds it: its text, decoded where it says it is base64, or the file it names. */
const bodyOf = (
  body: { readonly text?: string | undefined; readonly _file?: string | undefined } | undefined,
  base64: boolean,
  files: ReadonlyMap<string, Uint8Array>
): Option.Option<Uint8Array> => {
  if (body === undefined) return Option.none()
  if (body._file !== undefined) return Option.fromUndefinedOr(files.get(body._file))
  if (body.text === undefined || body.text === "") return Option.none()
  if (!base64) return Option.some(new TextEncoder().encode(body.text))
  const decoded = Encoding.decode(body.text)
  return decoded._tag === "Success" ? Option.some(decoded.success) : Option.none()
}

/** An entry's response, as a route fulfills it. */
const responseOf = (entry: Entry, files: ReadonlyMap<string, Uint8Array>) => {
  const { response } = entry
  const headers: Array<[string, string]> = []
  const setCookies: Array<string> = []
  let contentType: string | undefined
  for (const { name, value } of response.headers) {
    const lower = name.toLowerCase()
    if (describesEncoding.has(lower)) continue
    if (lower === "content-type") contentType = value
    else if (lower === "set-cookie") {
      if (!/^[^=;]*=REDACTED(;|$)/.test(value)) setCookies.push(value)
    } else headers.push([name, value])
  }
  const body = bodyOf(response.content, response.content.encoding === "base64", files)
  return HttpServerResponse.uint8Array(Option.getOrElse(body, () => new Uint8Array()), {
    status: response.status,
    ...(response.statusText === undefined || response.statusText === "" ? {} : { statusText: response.statusText }),
    headers,
    ...(contentType === undefined ? {} : { contentType }),
    ...(setCookies.length === 0 ? {} : { cookies: Cookies.fromSetCookie(setCookies) })
  })
}

/** A route handler that answers from the HAR at `path`, read now. */
export const fromHar = (
  path: string,
  options?: Options | undefined
): Effect.Effect<Route.Handler<never, never, "request">, Har.HarError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const id = Operation.operationId()
    const { entries, files } = yield* read(path).pipe(
      Effect.mapError((error) =>
        new Har.HarError({
          reason: error._tag === "InvalidInput"
            ? error
            : new Har.ReadFailed({ path, hint: error.message, cause: error }),
          diagnostics: Operation.diagnostics(id)
        })
      )
    )
    const notFound = RouteDecision.make(
      options?.notFound === "fallthrough" ? { _tag: "Fallthrough" } : { _tag: "Abort", reason: "failed" }
    )
    return (intercepted) =>
      Effect.gen(function*() {
        const { method, url } = intercepted.request
        const candidates = entries.filter((entry) => entry.request.method === method && entry.request.url === url)
        let matching = candidates
        if (candidates.some((entry) => entry.request.postData !== undefined)) {
          const sent = yield* intercepted.requestBody.pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()))
          if (Option.isSome(sent)) {
            matching = candidates.filter((entry) =>
              Option.match(bodyOf(entry.request.postData, entry.request.postData?._encoding === "base64", files), {
                onNone: () => true,
                onSome: (recorded) => sameBytes(recorded, sent.value)
              })
            )
          }
        }
        const entry = matching.at(-1)
        if (entry === undefined) return notFound
        // A request that failed without a response is replayed as a failure
        if (entry.response.status <= 0) return RouteDecision.make({ _tag: "Abort", reason: "failed" })
        return RouteDecision.make({ _tag: "Fulfill", response: responseOf(entry, files) })
      })
  })
