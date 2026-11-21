/**
 * The network pieces, without a browser: the intercept a `URLPattern` route declares, requests' bodies as
 * a HAR writes them, replay's reading and matching, and how a request shows in a log.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, it } from "@effect/vitest"
import { Diagnostics, Route } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Cookies from "effect/http/Cookies"
import * as Headers from "effect/http/Headers"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Har from "../src/internal/har.ts"
import * as HarLog from "../src/internal/harLog.ts"
import type * as Model from "../src/internal/model.ts"
import * as RouteDecision from "../src/internal/routeDecision.ts"
import * as Routes from "../src/internal/routes.ts"
import * as Version from "../src/internal/version.ts"
import * as NetworkRequest from "../src/NetworkRequest.ts"
import * as NetworkResponse from "../src/NetworkResponse.ts"

describe("A URLPattern route's intercept", () => {
  it("covers the pattern's fixed prefix, written as a URL has it", () => {
    for (
      const [pattern, glob] of [
        ["https://shop.example.com/api/:id", "https://shop.example.com/api/*"],
        ["https://Shop.Example.com:443/items/:id(\\d+)", "https://shop.example.com/items/*"],
        ["http://localhost:8080/a/:b", "http://localhost:8080/a/*"],
        ["https://example.com/a{/b}?/:c", "https://example.com/a*"],
        // A prefix that ends inside the origin keeps only the scheme
        ["https://:tenant.example.com/x/:y", "https://*"],
        [":scheme://example.com/:x", "*"],
        // One with a character a URL would encode is cut before it
        ["https://example.com/café/:id", "https://example.com/caf*"],
        // Globs and URLs are passed as they are
        ["https://example.com/**", "https://example.com/**"],
        ["https://example.com/exact", "https://example.com/exact"]
      ] as const
    ) assert.strictEqual(Routes.covering(pattern), glob, pattern)
  })
})

describe("An exact route's intercept", () => {
  it("covers the URL as the browser writes it", () => {
    for (
      const [pattern, url] of [
        ["http://h", "http://h/"],
        ["HTTP://H:80/a", "http://h/a"]
      ] as const
    ) assert.strictEqual(Routes.covering(pattern), url, pattern)
  })
})

const request = (method: NetworkRequest.NetworkRequest["method"], url: string, headers: Record<string, string> = {}) =>
  new NetworkRequest.NetworkRequest({
    hop: "Q1.0" as NetworkRequest.HopId,
    method,
    url: url as NetworkRequest.NetworkRequest["url"],
    headers: Headers.fromInput(headers),
    resourceType: "fetch",
    initiator: { _tag: "Unattributed" },
    at: 0 as NetworkRequest.NetworkRequest["at"]
  })

describe("A request in a log", () => {
  it.effect("shows its URL as the preset in context does, and keeps it whole as data", () =>
    Effect.gen(function*() {
      const sent = request("GET", "https://user:pw@shop.example.com/search?q=shoes#top")
      const urlOf = (json: unknown) => (json as { readonly url: string }).url
      assert.strictEqual(urlOf(Inspectable.toJson(sent)), "https://shop.example.com/search?q=REDACTED")
      const local = yield* Effect.sync(() => Inspectable.toJson(sent)).pipe(Diagnostics.withPreset("local"))
      assert.strictEqual(urlOf(local), "https://user:pw@shop.example.com/search?q=shoes#top")
      assert.strictEqual(urlOf(JSON.parse(JSON.stringify(sent))), sent.url)
    }))
})

const recorded = (sent: NetworkRequest.NetworkRequest, body: Uint8Array | undefined): Har.Recorded => ({
  request: sent,
  hop: Option.none(),
  end: Option.none(),
  body: Option.none(),
  requestBody: Option.some(Option.fromUndefinedOr(body)),
  frames: [],
  done: Deferred.makeUnsafe<void>()
})

const writing = (
  include: ReadonlyArray<"requestBodies">,
  bodies: Har.Writing["bodies"] = { _tag: "Embed" }
): Har.Writing => ({ detail: "full", include: new Set(include), bodies })

const requestOf = (entry: Record<string, unknown>) => entry.request as Record<string, unknown>

describe("A request's body in a HAR", () => {
  const form = request("POST", "https://shop.example.com/login", {
    "content-type": "application/x-www-form-urlencoded"
  })
  const clock = { wall: 0, monotonic: 0 as NetworkRequest.NetworkRequest["at"] }

  it("is left out unless the export includes requestBodies, though its size is written", () => {
    const { entry } = Har.entryOf(recorded(form, new TextEncoder().encode("user=ada&password=x")), clock, writing([]))
    assert.isUndefined(requestOf(entry).postData)
    assert.strictEqual(requestOf(entry).bodySize, 19)
  })

  it("is text, with a form's params", () => {
    const { entry } = Har.entryOf(
      recorded(form, new TextEncoder().encode("user=ada&password=x")),
      clock,
      writing(["requestBodies"])
    )
    assert.deepStrictEqual(requestOf(entry).postData, {
      mimeType: "application/x-www-form-urlencoded",
      text: "user=ada&password=x",
      params: [{ name: "user", value: "ada" }, { name: "password", value: "x" }]
    })
  })

  it("is base64 where it isn't text and bodies are embedded, and a file where they are attached", () => {
    const upload = request("PUT", "https://shop.example.com/avatar", { "content-type": "image/png" })
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const embedded = Har.entryOf(recorded(upload, bytes), clock, writing(["requestBodies"]))
    assert.deepStrictEqual(requestOf(embedded.entry).postData, {
      mimeType: "image/png",
      text: "iVBORw==",
      _encoding: "base64"
    })
    const attached = Har.entryOf(
      recorded(upload, bytes),
      clock,
      writing(["requestBodies"], { _tag: "File", prefix: "" })
    )
    assert.deepStrictEqual(requestOf(attached.entry).postData, {
      mimeType: "image/png",
      text: "",
      _file: "Q1.0-request.png"
    })
    assert.deepStrictEqual(attached.files, [{ path: "Q1.0-request.png", content: bytes }])
  })
})

const entry = (
  method: string,
  url: string,
  response: { readonly status: number; readonly text?: string; readonly headers?: ReadonlyArray<[string, string]> },
  postData?: string
) => ({
  startedDateTime: "2026-10-30T00:00:00.000Z",
  time: -1,
  request: {
    method,
    url,
    httpVersion: "",
    cookies: [],
    headers: [],
    queryString: [],
    ...(postData === undefined ? {} : { postData: { mimeType: "application/json", text: postData } }),
    headersSize: -1,
    bodySize: -1
  },
  response: {
    status: response.status,
    statusText: "",
    httpVersion: "",
    cookies: [],
    headers: (response.headers ?? []).map(([name, value]) => ({ name, value })),
    content: { size: -1, mimeType: "text/plain", ...(response.text === undefined ? {} : { text: response.text }) },
    redirectURL: "",
    headersSize: -1,
    bodySize: -1
  },
  cache: {},
  timings: { send: 0, wait: 0, receive: 0 }
})

const harOf = (entries: ReadonlyArray<unknown>) =>
  JSON.stringify({ log: { version: "1.2", creator: { name: "test", version: "0" }, entries } })

const paused = (method: NetworkRequest.NetworkRequest["method"], url: string, body?: string): Route.RequestPhase => ({
  phase: "request",
  request: request(method, url),
  requestBody: Effect.succeed(Option.fromUndefinedOr(body).pipe(Option.map((text) => new TextEncoder().encode(text))))
})

const decided = (decision: Route.Decision<"request">) => RouteDecision.data(decision)!

const fulfilled = (decision: Route.Decision<"request">) => {
  const data = decided(decision)
  assert.strictEqual(data._tag, "Fulfill")
  return (data as Extract<RouteDecision.Data, { _tag: "Fulfill" }>).response
}

const bodyText = (response: ReturnType<typeof fulfilled>) =>
  response.body._tag === "Uint8Array" ? new TextDecoder().decode(response.body.body) : ""

describe("Route.fromHar", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-replay-"))
  const write = (name: string, content: string | Uint8Array) => {
    const file = path.join(directory, name)
    fs.writeFileSync(file, content)
    return file
  }

  it.effect("answers with the latest entry matching method, URL and body", () =>
    Effect.gen(function*() {
      const file = write(
        "api.har",
        harOf([
          entry("GET", "https://shop.example.com/api/cart", { status: 200, text: "old" }),
          entry("GET", "https://shop.example.com/api/cart", {
            status: 200,
            text: "new",
            headers: [["content-type", "application/json"], ["content-length", "99"], [
              "set-cookie",
              "session=REDACTED; Path=/"
            ], ["x-kept", "1"]]
          }),
          entry("POST", "https://shop.example.com/api/search", { status: 200, text: "shoes" }, "{\"q\":\"shoes\"}"),
          entry("POST", "https://shop.example.com/api/search", { status: 200, text: "hats" }, "{\"q\":\"hats\"}")
        ])
      )
      const handler = yield* Route.fromHar(file)
      const cart = fulfilled(yield* handler(paused("GET", "https://shop.example.com/api/cart")))
      assert.strictEqual(bodyText(cart), "new")
      assert.strictEqual(cart.status, 200)
      assert.strictEqual(cart.headers["x-kept"], "1")
      // A decoded body's length is its own, and a redacted cookie isn't replayed
      assert.notStrictEqual(cart.headers["content-length"], "99")
      assert.isTrue(Cookies.isEmpty(cart.cookies))
      const shoes = fulfilled(
        yield* handler(paused("POST", "https://shop.example.com/api/search", "{\"q\":\"shoes\"}"))
      )
      assert.strictEqual(bodyText(shoes), "shoes")
      // No entry matches: aborted by default
      const missing = decided(yield* handler(paused("GET", "https://shop.example.com/api/user")))
      assert.deepStrictEqual(missing, { _tag: "Abort", reason: "failed" })
      const through = yield* Route.fromHar(file, { notFound: "fallthrough" })
      assert.deepStrictEqual(decided(yield* through(paused("GET", "https://shop.example.com/api/user"))), {
        _tag: "Fallthrough"
      })
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("reads the zip content: \"attach\" writes, with the files its entries name", () =>
    Effect.gen(function*() {
      const recordedEntry = entry("GET", "https://shop.example.com/logo.png", { status: 200 })
      const har = harOf([{
        ...recordedEntry,
        response: { ...recordedEntry.response, content: { size: 3, mimeType: "image/png", _file: "Q9.0.png" } }
      }])
      const zipped = yield* Stream.make(Zip.file("har.har", har), Zip.file("Q9.0.png", new Uint8Array([1, 2, 3])))
        .pipe(Stream.pipeThroughChannel(Zip.encode()), Stream.runCollect)
      const bytes = new Uint8Array(Array.from(zipped).flatMap((chunk) => Array.from(chunk)))
      // Its name doesn't say it is a zip: its signature does
      const handler = yield* Route.fromHar(write("recording.har", bytes))
      const logo = fulfilled(yield* handler(paused("GET", "https://shop.example.com/logo.png")))
      assert.deepStrictEqual(logo.body._tag === "Uint8Array" ? Array.from(logo.body.body) : [], [1, 2, 3])
    }).pipe(Effect.provide(NodeServices.layer)))

  it.effect("fails as it is made for a file that isn't a HAR", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(Route.fromHar(write("not.har", "{\"entries\": []}")))
      assert.strictEqual(error.reason._tag, "InvalidInput")
      const missing = yield* Effect.flip(Route.fromHar(path.join(directory, "missing.har")))
      assert.strictEqual(missing.reason._tag, "ReadFailed")
    }).pipe(Effect.provide(NodeServices.layer)))
})

describe("A HAR an export writes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-har-"))
  const clock = { wall: Date.UTC(2026, 9, 30), monotonic: 0 as NetworkRequest.NetworkRequest["at"] }
  const at = (millis: number) => (millis * 1e6) as NetworkRequest.NetworkRequest["at"]
  const sent = (method: NetworkRequest.NetworkRequest["method"], url: string, type: string, hop: string) =>
    new NetworkRequest.NetworkRequest({
      ...request(method, url, { "content-type": type }),
      hop: hop as NetworkRequest.HopId,
      at: at(1)
    })

  /** A hop that finished with a response, as the model holds it. */
  const answered = (
    request: NetworkRequest.NetworkRequest,
    response: { readonly status: number; readonly headers: Record<string, string> },
    bodies: { readonly request: Uint8Array; readonly response: Uint8Array }
  ): Har.Recorded => {
    const state: Model.HopState = {
      response: Option.some(
        new NetworkResponse.NetworkResponse({
          hop: request.hop,
          url: request.url,
          status: response.status as NetworkResponse.StatusCode,
          statusText: "OK",
          httpVersion: Option.some("http/1.1"),
          serverAddress: Option.none(),
          securityDetails: Option.none(),
          headers: Headers.fromInput(response.headers),
          servedBy: "network",
          at: at(2)
        })
      ),
      sent: Option.none(),
      received: Option.none()
    }
    const hop: Model.HopEntry = {
      request,
      state: { get: Effect.succeed(state), changes: Stream.make(state), getUnsafe: () => state },
      sentKnown: Deferred.makeUnsafe<void>(),
      end: Deferred.makeUnsafe<Model.HopEnd>(),
      page: Option.none(),
      context: Option.none()
    }
    return {
      request,
      hop: Option.some(hop),
      end: Option.some({
        _tag: "Finished",
        transferBytes: Option.none(),
        bodyBytes: Option.none(),
        at: at(3),
        httpVersion: Option.none(),
        serverAddress: Option.none(),
        securityProtocol: Option.none()
      }),
      body: Option.some(bodies.response),
      requestBody: Option.some(Option.some(bodies.request)),
      frames: [],
      done: Deferred.makeUnsafe<void>()
    }
  }

  it.effect("is read back by replay, which answers with the bodies the recording had", () =>
    Effect.gen(function*() {
      const json = (text: string) => new TextEncoder().encode(text)
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const search = "https://shop.example.com/api/search"
      const { log } = Har.logOf(
        [
          answered(sent("POST", search, "application/json", "Q1.0"), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": [
                "seen=1; Path=/; Domain=.example.com; Expires=Fri, 30 Oct 2026 12:00:00 GMT; HttpOnly",
                "flavor=oat; Path=/a=b; SameSite=Lax; Expires=someday"
              ].join("\n")
            }
          }, { request: json(`{"q":"shoes"}`), response: json(`["boots"]`) }),
          answered(sent("POST", search, "application/json", "Q2.0"), {
            status: 200,
            headers: { "content-type": "application/json" }
          }, { request: json(`{"q":"hats"}`), response: json(`["caps"]`) }),
          answered(sent("PUT", "https://shop.example.com/logo", "image/png", "Q3.0"), {
            status: 201,
            headers: { "content-type": "image/png" }
          }, { request: png, response: png })
        ],
        clock,
        {
          detail: "full",
          include: new Set(["requestBodies", "cookies"]),
          bodies: { _tag: "Embed" }
        },
        { name: "Chromium", version: "155" }
      )
      const text = yield* Schema.encodeEffect(HarLog.LogJson)(log)
      // The schema writes every field the entries hold, in the order they hold them
      assert.strictEqual(text, JSON.stringify(log, null, 2))
      const [shoesEntry, , logoEntry] = log.log.entries
      // A cookie as the response set it, its domain's dot kept, but its expiry in ISO 8601 as HAR has it, and
      // left out where it isn't a date
      assert.deepStrictEqual(shoesEntry!.response.cookies, [{
        name: "seen",
        value: "1",
        path: "/",
        domain: ".example.com",
        expires: "2026-10-30T12:00:00.000Z",
        httpOnly: true
      }, { name: "flavor", value: "oat", path: "/a=b", sameSite: "Lax" }])
      // A body that isn't text is base64: a response's says so in HAR's `encoding`, a request's in `_encoding`
      assert.strictEqual(logoEntry!.response.content.encoding, "base64")
      assert.strictEqual(logoEntry!.request.postData?._encoding, "base64")

      const file = path.join(directory, "written.har")
      fs.writeFileSync(file, text)
      const handler = yield* Route.fromHar(file)
      const hats = fulfilled(yield* handler(paused("POST", search, `{"q":"hats"}`)))
      assert.strictEqual(bodyText(hats), `["caps"]`)
      const shoes = fulfilled(yield* handler(paused("POST", search, `{"q":"shoes"}`)))
      assert.strictEqual(bodyText(shoes), `["boots"]`)
      assert.strictEqual(shoes.cookies.cookies.seen?.value, "1")
      const logo = fulfilled(
        yield* handler({
          phase: "request",
          request: request("PUT", "https://shop.example.com/logo"),
          requestBody: Effect.succeed(Option.some(png))
        })
      )
      assert.strictEqual(logo.status, 201)
      assert.deepStrictEqual(logo.body._tag === "Uint8Array" ? Array.from(logo.body.body) : [], Array.from(png))
    }).pipe(Effect.provide(NodeServices.layer)))

  const bytes = (text: string) => new TextEncoder().encode(text)
  const full = (include: ReadonlyArray<"requestBodies" | "cookies">): Har.Writing => ({
    detail: "full",
    include: new Set(include),
    bodies: { _tag: "Embed" }
  })
  const entryOf = (recorded: Har.Recorded, include: ReadonlyArray<"requestBodies" | "cookies"> = []) =>
    Har.entryOf(recorded, clock, full(include)).entry

  it("names the package's version as its creator, generated from its package.json", () => {
    const { version } = JSON.parse(
      fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")
    ) as { readonly version: string }
    assert.strictEqual(Version.version, version, "src/internal/version.ts is stale; run pnpm codegen")
    const { log } = Har.logOf([], clock, full([]), { name: "Chromium", version: "155" })
    assert.deepStrictEqual(log.log.creator, { name: "Strider", version })
  })

  it("writes 0 as the size of a request that sent no body, and -1 where its body wasn't read", () => {
    const get = sent("GET", "https://shop.example.com/", "text/plain", "Q1.0")
    const hop = answered(get, { status: 200, headers: {} }, { request: bytes(""), response: bytes("") })
    assert.strictEqual(entryOf({ ...hop, requestBody: Option.some(Option.none()) }).request.bodySize, 0)
    assert.isUndefined(
      entryOf({ ...hop, requestBody: Option.some(Option.none()) }, ["requestBodies"]).request.postData
    )
    assert.strictEqual(entryOf({ ...hop, requestBody: Option.none() }).request.bodySize, -1)
  })

  it("writes a response's body and transfer sizes as the hop's end counted them, and what decoding saved", () => {
    const get = sent("GET", "https://shop.example.com/", "text/plain", "Q1.0")
    const hop = answered(get, { status: 200, headers: { "content-type": "text/plain" } }, {
      request: bytes(""),
      response: bytes("x".repeat(100))
    })
    const counted = (transferBytes: Option.Option<number>, bodyBytes: Option.Option<number>) =>
      entryOf({
        ...hop,
        end: Option.some({
          _tag: "Finished",
          transferBytes,
          bodyBytes,
          at: at(3),
          httpVersion: Option.none(),
          serverAddress: Option.none(),
          securityProtocol: Option.none()
        })
      })
        .response
    const known = counted(Option.some(300), Option.some(40))
    assert.deepInclude(known, { bodySize: 40, _transferSize: 300 })
    assert.strictEqual(known.content.compression, 60)
    const unknown = counted(Option.some(300), Option.none())
    assert.deepInclude(unknown, { bodySize: -1, _transferSize: 300 })
    assert.isUndefined(unknown.content.compression)
  })

  it("keeps a MIME type's parameters, in a response's content and a request's postData", () => {
    const upload = sent("POST", "https://shop.example.com/upload", "multipart/form-data; boundary=x", "Q1.0")
    const written = entryOf(
      answered(upload, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }, {
        request: bytes("--x--"),
        response: bytes("<p>é</p>")
      }),
      ["requestBodies"]
    )
    assert.strictEqual(written.response.content.mimeType, "text/html; charset=utf-8")
    assert.strictEqual(written.response.content.text, "<p>é</p>")
    assert.strictEqual(written.request.postData?.mimeType, "multipart/form-data; boundary=x")
  })

  it("writes a body that isn't valid UTF-8 as base64, whatever its MIME type says", () => {
    const invalid = new Uint8Array([0x61, 0xff, 0xfe])
    const post = sent("POST", "https://shop.example.com/notes", "text/plain", "Q1.0")
    const written = entryOf(
      answered(post, { status: 200, headers: { "content-type": "text/plain" } }, {
        request: invalid,
        response: invalid
      }),
      ["requestBodies"]
    )
    assert.strictEqual(written.response.content.text, "Yf/+")
    assert.strictEqual(written.response.content.encoding, "base64")
    assert.deepStrictEqual(written.request.postData, { mimeType: "text/plain", text: "Yf/+", _encoding: "base64" })
  })

  it("preserves a leading UTF-8 BOM when exporting text bodies for replay", () => {
    const text = "\uFEFFhello"
    const post = sent("POST", "https://shop.example.com/notes", "text/plain", "Q1.0")
    const written = entryOf(
      answered(post, { status: 200, headers: { "content-type": "text/plain" } }, {
        request: bytes(text),
        response: bytes(text)
      }),
      ["requestBodies"]
    )
    assert.strictEqual(written.response.content.text, text)
    assert.strictEqual(written.request.postData?.text, text)
  })

  const withCookies = (headers: Record<string, string>, response: Record<string, string>) => {
    const get = new NetworkRequest.NetworkRequest({
      ...request("GET", "https://shop.example.com/", headers),
      at: at(1)
    })
    return answered(get, { status: 200, headers: response }, { request: bytes(""), response: bytes("") })
  }

  it("reads a Set-Cookie's Max-Age as its expiry from the response's time, before its Expires", () => {
    const written = entryOf(
      withCookies({}, {
        "set-cookie": [
          "a=1; Expires=Fri, 30 Oct 2026 12:00:00 GMT; Max-Age=60",
          "b=2; Max-Age=0",
          "c=3; Max-Age=soon; Expires=Fri, 30 Oct 2026 12:00:00 GMT"
        ].join("\n")
      }),
      ["cookies"]
    )
    assert.deepStrictEqual(written.response.cookies, [
      { name: "a", value: "1", expires: new Date(Date.UTC(2026, 9, 30) + 2 + 60_000).toISOString() },
      { name: "b", value: "2", expires: new Date(0).toISOString() },
      { name: "c", value: "3", expires: "2026-10-30T12:00:00.000Z" }
    ])
  })

  it("exports cookies whose numeric Max-Age exceeds the date range", () => {
    for (const maxAge of ["999999999999999", "9".repeat(400)]) {
      const written = entryOf(withCookies({}, { "set-cookie": `a=1; Max-Age=${maxAge}` }))
      assert.strictEqual(written.response.cookies.length, 1)
      assert.strictEqual(written.response.cookies[0]!.value, "REDACTED")
      assert.strictEqual(written.response.cookies[0]!.expires, new Date(8.64e15).toISOString())
    }
  })

  it("keeps a cookie with no name, in a request's Cookie and a response's Set-Cookie", () => {
    const written = entryOf(withCookies({ cookie: "a=1; token" }, { "set-cookie": "secret; Path=/" }), ["cookies"])
    assert.deepStrictEqual(written.request.cookies, [{ name: "a", value: "1" }, { name: "", value: "token" }])
    assert.deepStrictEqual(written.response.cookies, [{ name: "", value: "secret", path: "/" }])
  })

  it("redacts the value of a cookie with no name, in its headers and its cookies", () => {
    const written = entryOf(withCookies({ cookie: "a=1; token" }, { "set-cookie": "secret; Path=/" }))
    assert.deepStrictEqual(written.request.cookies, [{ name: "a", value: "REDACTED" }, {
      name: "",
      value: "REDACTED"
    }])
    assert.deepStrictEqual(written.request.headers, [{ name: "cookie", value: "a=REDACTED; REDACTED" }])
    assert.deepStrictEqual(written.response.cookies, [{ name: "", value: "REDACTED", path: "/" }])
    assert.deepStrictEqual(
      written.response.headers.filter((header) => header.name === "set-cookie"),
      [{ name: "set-cookie", value: "REDACTED; Path=/" }]
    )
  })
})
