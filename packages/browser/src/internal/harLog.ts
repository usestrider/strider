/**
 * HAR 1.2 as a schema: what a recording writes and what replay reads, so the two can't drift apart.
 *
 * - **HAR 1.2's fields**, required where the format requires them, in the order the format lists them, which is the
 *   order an export writes them in. A field neither side uses, such as `comment`, isn't declared: decoding drops it.
 * - **Extensions** start with `_`, as the format asks, and are optional, so a HAR another tool wrote still decodes.
 *   Playwright's, which its trace viewer reads: `_monotonicTime`, `_resourceType`, `_frameref`, `_transferSize`,
 *   `_failureText`, `_file` and `_webSocketMessages`. Ours: `_servedBy`, `_incomplete`, and a request body's
 *   `_encoding`, as HAR's `postData` has no `encoding` of its own for a body that isn't text.
 */
import * as Schema from "effect/Schema"

/** A header or a query parameter. */
export const NameValue = Schema.Struct({ name: Schema.String, value: Schema.String })

/** A cookie a request sent or a response set. `sameSite` is an extension browsers' HARs share. */
export const Cookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  path: Schema.optionalKey(Schema.String),
  domain: Schema.optionalKey(Schema.String),
  expires: Schema.optionalKey(Schema.String),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  secure: Schema.optionalKey(Schema.Boolean),
  sameSite: Schema.optionalKey(Schema.String)
})

/** One parameter of a form a request posted. */
export const Param = Schema.Struct({
  name: Schema.String,
  value: Schema.optionalKey(Schema.String),
  fileName: Schema.optionalKey(Schema.String),
  contentType: Schema.optionalKey(Schema.String)
})

/** A request's body: its text, or its bytes as base64 (`_encoding`), or a file beside the HAR (`_file`). */
export const PostData = Schema.Struct({
  mimeType: Schema.String,
  // HAR 1.2 has `text` and `params` exclude each other, so another tool's form may have `params` alone
  text: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Array(Param)),
  _encoding: Schema.optionalKey(Schema.String),
  _file: Schema.optionalKey(Schema.String)
})

/** A response's body: its text, base64 where `encoding` says so, or a file beside the HAR (`_file`). */
export const Content = Schema.Struct({
  size: Schema.Number,
  mimeType: Schema.String,
  text: Schema.optionalKey(Schema.String),
  encoding: Schema.optionalKey(Schema.String),
  _file: Schema.optionalKey(Schema.String)
})

export const Request = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  httpVersion: Schema.String,
  cookies: Schema.Array(Cookie),
  headers: Schema.Array(NameValue),
  queryString: Schema.Array(NameValue),
  postData: Schema.optionalKey(PostData),
  headersSize: Schema.Number,
  bodySize: Schema.Number
})

export const Response = Schema.Struct({
  status: Schema.Number,
  statusText: Schema.String,
  httpVersion: Schema.String,
  cookies: Schema.Array(Cookie),
  headers: Schema.Array(NameValue),
  content: Content,
  redirectURL: Schema.String,
  headersSize: Schema.Number,
  bodySize: Schema.Number,
  _transferSize: Schema.optionalKey(Schema.Number),
  _failureText: Schema.optionalKey(Schema.String)
})

/** The phases of a request, in milliseconds; -1 for one that doesn't apply or wasn't measured. */
export const Timings = Schema.Struct({
  blocked: Schema.optionalKey(Schema.Number),
  dns: Schema.optionalKey(Schema.Number),
  connect: Schema.optionalKey(Schema.Number),
  ssl: Schema.optionalKey(Schema.Number),
  send: Schema.Number,
  wait: Schema.Number,
  receive: Schema.Number
})

/** One frame of a WebSocket, on its handshake's entry: `opcode` 1 for text, 2 for binary, as base64. */
export const WebSocketMessage = Schema.Struct({
  type: Schema.Literals(["send", "receive"]),
  time: Schema.Number,
  opcode: Schema.Number,
  data: Schema.String
})

export const Entry = Schema.Struct({
  pageref: Schema.optionalKey(Schema.String),
  startedDateTime: Schema.String,
  time: Schema.Number,
  request: Request,
  response: Response,
  // Its fields are optional, and an export writes none
  cache: Schema.Struct({}),
  timings: Timings,
  _monotonicTime: Schema.optionalKey(Schema.Number),
  _resourceType: Schema.optionalKey(Schema.String),
  _frameref: Schema.optionalKey(Schema.String),
  _servedBy: Schema.optionalKey(Schema.String),
  _incomplete: Schema.optionalKey(Schema.Boolean),
  _webSocketMessages: Schema.optionalKey(Schema.Array(WebSocketMessage))
})

export type Entry = typeof Entry.Type

export const Page = Schema.Struct({
  startedDateTime: Schema.String,
  id: Schema.String,
  title: Schema.String,
  pageTimings: Schema.Struct({
    onContentLoad: Schema.optionalKey(Schema.Number),
    onLoad: Schema.optionalKey(Schema.Number)
  })
})

const Software = Schema.Struct({ name: Schema.String, version: Schema.String })

/** A HAR file's top level. */
export const Log = Schema.Struct({
  log: Schema.Struct({
    version: Schema.String,
    creator: Software,
    browser: Schema.optionalKey(Software),
    pages: Schema.optionalKey(Schema.Array(Page)),
    entries: Schema.Array(Entry)
  })
})

export type Log = typeof Log.Type

/** A HAR file's text, indented by two spaces as an export writes it. */
export const LogJson = Schema.fromJsonString(Log, { space: 2 })
