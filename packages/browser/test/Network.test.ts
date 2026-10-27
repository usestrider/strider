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
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Har from "../src/internal/har.ts"
import * as RouteDecision from "../src/internal/routeDecision.ts"
import * as Routes from "../src/internal/routes.ts"
import * as NetworkRequest from "../src/NetworkRequest.ts"

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
  requestBody: Option.fromUndefinedOr(body),
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

const harOf = (entries: ReadonlyArray<unknown>) => JSON.stringify({ log: { version: "1.2", entries } })

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
