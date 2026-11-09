/**
 * Recordings on every backend's layer: a HAR with its timings, bodies, statuses and redactions, as
 * one file or a zip with the bodies beside it; and a trace whose steps nest in the program's spans, with
 * screenshots, console messages, exceptions, network entries and screencast frames; the bodies
 * requests sent and the headers they were sent with; and a HAR replayed as a route.
 */
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  Capability,
  Condition,
  Deadline,
  Diagnostics,
  Expect,
  Har,
  NetworkRequest,
  NetworkResponse,
  Operation,
  Page,
  Route,
  Trace
} from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stream from "effect/Stream"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "../adapter/harness.ts"
import { fullySupports, supports } from "./capabilities.ts"
import { navigationFailure } from "./navigationFailure.ts"

const timeout = 60_000

/** A page on the local site, showing `html`. */
const fixture = Effect.fnUntraced(function*(html: string) {
  const served = yield* site
  return `${served.origin}/fixture?html=${encodeURIComponent(html)}`
})

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), "strider-recordings-"))

/** A zip's entries, as bytes. */
const unzip = (file: string) =>
  Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
    Stream.pipeThroughChannel(Zip.decode()),
    Stream.mapEffect((entry) =>
      Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
        const all = Array.from(chunks)
        const bytes = new Uint8Array(all.reduce((size, chunk) => size + chunk.length, 0))
        let at = 0
        for (const chunk of all) {
          bytes.set(chunk, at)
          at += chunk.length
        }
        return [entry.header.path, bytes] as const
      }))
    ),
    Stream.runCollect,
    Effect.map((entries) => new Map(entries))
  )

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

// A frame's snapshots, expanded as the trace viewer reads them: a reference `[[capturesAgo, index]]` is the node at
// `index`, counting text and elements in post-order, of the frame's snapshot that many before, read in that one
const nodesOf = (snapshot: Record<string, any>): Array<unknown> => {
  const nodes: Array<unknown> = []
  const visit = (node: unknown) => {
    if (typeof node === "string") nodes.push(node)
    else if (Array.isArray(node) && typeof node[0] === "string") {
      for (const child of node.slice(2)) visit(child)
      nodes.push(node)
    }
  }
  visit(snapshot.html)
  return nodes
}
const expand = (all: ReadonlyArray<Record<string, any>>, snapshot: Record<string, any>): any => {
  const frames = all.filter((each) => each.frameId === snapshot.frameId)
  const visit = (node: unknown, index: number): any => {
    if (typeof node === "string") return node
    const array = node as Array<any>
    if (Array.isArray(array[0])) {
      const [ago, at] = array[0] as [number, number]
      return visit(nodesOf(frames[index - ago]!)[at], index - ago)
    }
    const [name, attributes, ...children] = array
    return [name, attributes ?? {}, ...children.map((child) => visit(child, index))]
  }
  return visit(snapshot.html, frames.indexOf(snapshot))
}
const find = (node: any, matches: (node: any) => boolean): any => {
  if (!Array.isArray(node)) return undefined
  if (matches(node)) return node
  for (const child of node.slice(2)) {
    const found = find(child, matches)
    if (found !== undefined) return found
  }
  return undefined
}
const textOf = (node: any): string =>
  typeof node === "string" ? node : Array.isArray(node) ? node.slice(2).map(textOf).join("") : ""

const lines = (bytes: Uint8Array | undefined) =>
  text(bytes).trim().split("\n").filter((line) => line !== "").map((line) => JSON.parse(line))

// A button that fetches JSON with credentials of its own, and writes what came back
const fetcher = `<button>Fetch</button><p id="out">waiting</p>
<script>
  document.querySelector("button").onclick = () =>
    fetch("/json", { headers: { authorization: "Bearer secret-token" } })
      .then((r) => r.text())
      .then((t) => { document.getElementById("out").textContent = t })
</script>`

interface HarEntry {
  readonly request: { readonly url: string; readonly headers: ReadonlyArray<{ name: string; value: string }> }
  readonly response: {
    readonly status: number
    readonly statusText: string
    readonly httpVersion: string
    readonly cookies: ReadonlyArray<{ name: string; value: string; path?: string }>
    readonly headers: ReadonlyArray<{ name: string; value: string }>
    readonly content: {
      readonly mimeType: string
      readonly text?: string
      readonly _file?: string
      readonly size: number
    }
  }
  readonly timings: Record<string, number>
  readonly _incomplete?: boolean
}

export const recordings = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} recordings`, () => {
    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("reads a protocol request failure with honest cancellation evidence", () =>
        Effect.scoped(Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const failedSite = yield* navigationFailure
          const sent = yield* NetworkRequest.next(page, { url: `${failedSite.origin}/failure` })
          yield* page.goto(`${failedSite.origin}/failure`).pipe(Effect.exit)
          const request = yield* sent
          const failure = Option.getOrThrow(yield* NetworkRequest.failure(page, request))
          assert.isAbove(failure.errorText.length, 0)
          assert.deepStrictEqual(
            failure.canceled,
            (yield* fullySupports("network.failure")) ? Option.some(false) : Option.none()
          )
          assert.deepStrictEqual(yield* NetworkRequest.failure(page.context, request), Option.some(failure))
        })))

      it.effect("keeps HTTP errors successful and refuses failure lookup after owner closure", () =>
        Effect.scoped(Effect.gen(function*() {
          const { page, request } = yield* Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const served = yield* site
            const sent = yield* NetworkRequest.next(page, { url: `${served.origin}/missing` })
            yield* page.goto(`${served.origin}/missing`)
            const request = yield* sent
            assert.isTrue(Option.isNone(yield* NetworkRequest.failure(page, request)))
            return { page, request }
          }))
          const error = yield* NetworkRequest.failure(page, request).pipe(Effect.flip)
          assert.strictEqual(error.reason._tag, "RequestUnavailable")
          assert.strictEqual(error.reason.why, "ownerLost")
        })))

      it.effect("associates an observed request with its response before and after arrival", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/hello`)
          const release = yield* Deferred.make<void>()
          yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined))
          yield* page.route(`${origin}/json`, () => Deferred.await(release).pipe(Effect.andThen(Route.continue)))
          const next = yield* NetworkRequest.next(page, { url: `${origin}/json` })
          yield* page.evaluateInMainWorld(() => {
            void fetch("/json")
            return true
          })
          const request = yield* next
          const response = yield* NetworkRequest.response(page, request)
          const waiting = yield* response.pipe(Effect.forkScoped)
          yield* Effect.yieldNow
          assert.isUndefined(waiting.pollUnsafe())
          yield* Deferred.succeed(release, undefined)
          const arrived = Option.getOrThrow(yield* Fiber.join(waiting))
          assert.strictEqual(arrived.status, 200)
          assert.strictEqual(arrived.hop, request.hop)
          assert.deepStrictEqual(yield* (yield* NetworkRequest.response(page.context, request)), Option.some(arrived))
          const foreign = yield* Browser.newContext()
          const error = yield* NetworkRequest.response(foreign, request).pipe(Effect.asVoid, Effect.flip)
          assert.strictEqual(error.reason.why, "foreignTarget")
        })))

      it.effect("returns no response for a request aborted before receiving headers", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/hello`)
          yield* page.route(`${origin}/json`, () => Route.abort())
          const next = yield* NetworkRequest.next(page, { url: `${origin}/json` })
          yield* page.evaluateInMainWorld(async () => {
            await fetch("/json").catch(() => {})
            return true
          })
          const wait = yield* NetworkRequest.response(page, yield* next)
          assert.deepStrictEqual(yield* wait, Option.none())
        })))

      it.effect("associates each redirect hop with its own response", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          const redirect = yield* NetworkRequest.next(page, { url: `${origin}/redirect` })
          const landed = yield* NetworkRequest.next(page, { url: `${origin}/landed` })
          yield* page.goto(`${origin}/redirect`, { waitUntil: "load" })
          const first = yield* redirect
          const last = yield* landed
          const firstResponse = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, first)))
          const lastResponse = Option.getOrThrow(yield* (yield* NetworkRequest.response(page, last)))
          assert.notStrictEqual(first.hop, last.hop)
          assert.strictEqual(firstResponse.hop, first.hop)
          assert.strictEqual(firstResponse.status, 302)
          assert.strictEqual(lastResponse.hop, last.hop)
          assert.strictEqual(lastResponse.status, 200)
        })))

      it.effect(
        "records URL expectation evidence with export-time redaction",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const served = yield* site
            const requested = `${served.origin}/json?token=observed-token-secret#observed-fragment-secret`
            const expected = `${served.origin}/done?token=expected-token-secret#expected-fragment-secret`
            yield* page.goto(requested)
            const actual = yield* page.url
            assert.include(actual, "observed-token-secret")
            const trace = yield* Trace.record(page)
            const error = yield* page.pipe(
              Expect.toHaveURL(expected),
              Deadline.within("300 millis"),
              Operation.named("checkout", { attributes: { "browser.page.id": page.id } }),
              Effect.flip
            )
            assert(Expect.isExpectationFailed(error), String(error))
            assert.isAbove(error.history.length, 0)
            const rethrown = yield* Effect.fail(error).pipe(
              Operation.named("retry checkout", { attributes: { "browser.page.id": page.id } }),
              Effect.flip
            )
            assert.strictEqual(rethrown, error)
            for (const preset of ["strict", "local", "strict"] as const) {
              const out = path.join(directory(), `${preset}.zip`)
              yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
              const content = text((yield* unzip(out)).get("trace.trace"))
              const failures = lines(new TextEncoder().encode(content)).filter((event) =>
                event.type === "after" && event.error
              )
                .map((event) => event.error)
              assert.strictEqual(failures.length, 3)
              assert.isTrue(failures.every((failure) => failure.message === failures[0].message))
              const failure = failures[0]
              assert.strictEqual(failure.name, "ExpectationFailed")
              assert.include(failure.message, "Last observed:")
              if (preset === "local") {
                assert.include(failure.message, actual)
                assert.include(failure.message, expected)
              } else {
                assert.include(failure.message, `${served.origin}/json?token=REDACTED`)
                assert.include(failure.message, `${served.origin}/done?token=REDACTED`)
                for (
                  const secret of [
                    "observed-token-secret",
                    "observed-fragment-secret",
                    "expected-token-secret",
                    "expected-fragment-secret"
                  ]
                ) {
                  assert.notInclude(content, secret)
                }
              }
            }
            assert.include(error.message, expected)
            assert.include(JSON.stringify(error.history), actual)
          })),
        timeout
      )

      for (
        const [source, boundary] of [
          ["url", "direct"],
          ["title", "direct"],
          ["title", "guarded"],
          ["url", "watchable map"],
          ["url", "effect map"],
          ["title", "effect map"],
          ["url", "reconstruction"],
          ["title", "reconstruction"],
          ["url", "live"],
          ["title", "live"]
        ] as const
      ) {
        it.effect(
          `redacts generic ${source} expectation evidence with ${boundary} boundary`,
          () =>
            Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const title = "generic-title-secret"
              const requested = `${yield* fixture(
                `<title>${title}</title>`
              )}&token=generic-url-secret#generic-fragment-secret`
              yield* page.goto(requested)
              const actual = yield* page[source]
              assert.include(actual, source === "url" ? "generic-url-secret" : title)
              assert.notStrictEqual(page.title, page.title)
              const live = boundary === "live" ? yield* Trace.record(page) : undefined
              const direct = boundary === "guarded" ? (yield* page.inspect)[source] : page[source]
              const subject = boundary === "watchable map" ?
                page.url.map((value) => value)
                : boundary === "effect map" ?
                Effect.map(page[source], (value: string) => value)
                : direct
              const error = yield* Expect.that(
                subject,
                Condition.make<string>("to satisfy an always-false condition", () => false)
              ).pipe(
                Deadline.within("300 millis"),
                Operation.named(`generic ${source} check`, { attributes: { "browser.page.id": page.id } }),
                Effect.flip
              )
              assert(Expect.isExpectationFailed(error), String(error))
              assert.include(JSON.stringify(error.history), actual)
              const trace = live ?? (yield* Trace.record(page))
              const exported = boundary === "reconstruction" ? new Expect.ExpectationFailed({ ...error }) : error
              const rethrown = yield* Effect.fail(exported).pipe(
                Operation.named(`rethrow generic ${source}`, { attributes: { "browser.page.id": page.id } }),
                Effect.flip
              )
              assert.strictEqual(rethrown, exported)
              const evidence = path.resolve(".data/expect-source-evidence")
              fs.mkdirSync(evidence, { recursive: true })
              for (const preset of ["strict", "local", "strict"] as const) {
                const out = path.join(evidence, `${name}-${source}-${boundary}-${preset}.zip`)
                yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
                const content = text((yield* unzip(out)).get("trace.trace"))
                fs.writeFileSync(out.replace(/\.zip$/, ".trace"), content)
                const failures = lines(new TextEncoder().encode(content)).filter((event) =>
                  event.type === "after" && event.error?.name === "ExpectationFailed"
                )
                if (live === undefined) assert.strictEqual(failures.length, 1)
                else assert.isAtLeast(failures.length, 2)
                for (const event of failures) {
                  assert.include(event.error.message, "to satisfy an always-false condition")
                  assert.notInclude(event.error.message, "to have the URL")
                  assert.notInclude(event.error.message, "to have the title")
                  assert.include(event.error.message, "Last observed:")
                  assert.include(event.error.message, "History:")
                  for (const secret of source === "url" ? ["generic-url-secret", "generic-fragment-secret"] : [title]) {
                    if (
                      (boundary === "direct" || boundary === "guarded" || boundary === "live") && preset === "strict"
                    ) {
                      assert.notInclude(event.error.message, secret)
                    } else assert.include(event.error.message, secret)
                  }
                }
              }
            })),
          timeout
        )
      }

      it.effect(
        "keeps password expectation values out of trace errors under both presets",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<input type=\"password\" aria-label=\"Password\">"))
            yield* page.getByLabel("Password").fill(Redacted.make("typed-password-secret"))
            const trace = yield* Trace.record(page)
            const error = yield* page.getByLabel("Password").pipe(
              Expect.toHaveValue("expected-password-secret"),
              Deadline.within("300 millis"),
              Effect.flip
            )
            assert(Expect.isExpectationFailed(error), String(error))
            for (const preset of ["strict", "local"] as const) {
              const out = path.join(directory(), `${preset}.zip`)
              yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
              const content = text((yield* unzip(out)).get("trace.trace"))
              const failure = lines(new TextEncoder().encode(content)).find((event) =>
                event.type === "after" && event.error
              )?.error
              assert.strictEqual(failure.name, "ExpectationFailed")
              if (error.history.length === 0) assert.notInclude(failure.message, "Last observed:")
              else assert.include(failure.message, "Last observed: REDACTED")
              assert.notInclude(content, "typed-password-secret")
              assert.notInclude(content, "expected-password-secret")
            }
            assert.include(error.message, "expected-password-secret")
            assert.isTrue(error.history.every((entry) => entry.value === "typed-password-secret"))
          })),
        timeout
      )

      it.effect(
        "keeps real title failures classified through enclosing operations and rethrows",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<title>observed-title-secret</title>"))
            const trace = yield* Trace.record(page)
            const error = yield* page.pipe(
              Expect.toHaveTitle("expected-title-secret"),
              Deadline.within("300 millis"),
              Operation.named("checkout", { attributes: { "browser.page.id": page.id } }),
              Effect.flip
            )
            assert(Expect.isExpectationFailed(error), String(error))
            const rethrown = yield* Effect.fail(error).pipe(
              Operation.named("retry checkout", { attributes: { "browser.page.id": page.id } }),
              Effect.flip
            )
            assert.strictEqual(rethrown, error)
            for (const preset of ["strict", "local", "strict"] as const) {
              const out = path.join(directory(), `${preset}.zip`)
              yield* trace.exportTrace(out).pipe(Diagnostics.withPreset(preset))
              const content = text((yield* unzip(out)).get("trace.trace"))
              const failures = lines(new TextEncoder().encode(content)).filter((event) =>
                event.type === "after" && event.error
              )
                .map((event) => event.error)
              assert.strictEqual(failures.length, 3)
              assert.isTrue(failures.every((failure) => failure.message === failures[0].message))
              for (const secret of ["observed-title-secret", "expected-title-secret"]) {
                if (preset === "strict") assert.notInclude(content, secret)
                else if (secret === "expected-title-secret" || error.history.length > 0) {
                  assert.include(failures[0].message, secret)
                }
              }
            }
            assert.include(error.message, "expected-title-secret")
          })),
        timeout
      )

      it.effect(
        "records a HAR with statuses, protocols, bodies and the library's timings, redacted",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const url = `${served.origin}/fixture?html=${encodeURIComponent(fetcher)}`
            const out = path.join(directory(), "session.har")
            const full = path.join(directory(), "full.har")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const har = yield* Har.record(page, { content: "embed" })
              const cookieResponse = yield* NetworkResponse.next(page, { url: `${served.origin}/cookie` })
              yield* page.goto(`${served.origin}/cookie`)
              // The response carries the cookie it sets on every backend: Chromium's in an ExtraInfo (QUIRKS.md, Q158)
              assert.include((yield* cookieResponse).headers["set-cookie"], "flavor=oat")
              yield* page.goto(url)
              // The response's body, read once its hop has finished: an export then has it
              const fetched = yield* NetworkResponse.next(page, { url: "**/json", body: (message) => message.text })
              yield* page.getByRole("button", { name: "Fetch" }).click()
              assert.strictEqual((yield* fetched).body, `{"hello":"world"}`)
              yield* har.entries.waitFor((count) => count >= 3)
              yield* har.exportHar(out)
              yield* har.exportHar(full, { include: ["cookies", "authorizationHeaders"] })
            }))
            const entries: ReadonlyArray<HarEntry> = JSON.parse(fs.readFileSync(out, "utf8")).log.entries
            const json = entries.find((entry) => entry.request.url === `${served.origin}/json`)!
            assert.isDefined(json, entries.map((entry) => entry.request.url).join(", "))
            assert.deepInclude(json.response, { status: 200, statusText: "OK", httpVersion: "http/1.1" })
            assert.strictEqual(json.response.content.text, `{"hello":"world"}`)
            assert.strictEqual(json.response.content.mimeType, "application/json")
            assert.deepInclude(json.response.headers, { name: "x-test", value: "yes" })
            assert.deepInclude(json.timings, { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0 })
            assert.isAtLeast(json.timings.wait!, 0)
            assert.isAtLeast(json.timings.receive!, 0)
            assert.isUndefined(json._incomplete)
            // Secrets are redacted unless their class is included
            assert.deepInclude(json.request.headers, { name: "authorization", value: "REDACTED" })
            const cookie = entries.find((entry) => entry.request.url === `${served.origin}/cookie`)!
            assert.deepInclude(cookie.response.cookies, { name: "flavor", value: "REDACTED", path: "/" })
            // The document the page left at once still has its body: Chromium keeps it for a recording (Q160), and
            // the WebKit adapter reads it as its load finishes (Q179)
            assert.strictEqual(cookie.response.content.text, "<title>cookie</title>")
            // The page's URL, and the Referer that repeats it, hold the fixture's script, so the secrets' own
            // headers are checked rather than the whole file
            for (const entry of entries) {
              for (const header of [...entry.request.headers, ...entry.response.headers]) {
                if (!["authorization", "cookie", "set-cookie"].includes(header.name)) continue
                assert.notInclude(header.value, "secret-token")
                assert.notInclude(header.value, "oat")
              }
            }
            const included: ReadonlyArray<HarEntry> = JSON.parse(fs.readFileSync(full, "utf8")).log.entries
            assert.deepInclude(
              included.find((entry) => entry.request.url === `${served.origin}/json`)!.request.headers,
              { name: "authorization", value: "Bearer secret-token" }
            )
            assert.deepInclude(
              included.find((entry) => entry.request.url === `${served.origin}/cookie`)!.response.cookies,
              { name: "flavor", value: "oat", path: "/" }
            )
          }),
        timeout
      )

      it.effect(
        "writes the bodies beside a minimal HAR in one zip, for the URLs asked for",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const out = path.join(directory(), "json.zip")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const har = yield* Har.record(page, {
                content: "attach",
                url: "**/json",
                detail: "minimal",
                inFlightAtStop: "wait"
              })
              yield* page.goto(`${served.origin}/fetching`)
              yield* page.evaluateInMainWorld(() => (window as unknown as { fetched: Promise<string> }).fetched)
              yield* har.entries.waitFor((count) => count === 1)
              yield* har.exportHar(out)
            }))
            const files = yield* unzip(out)
            const entries: ReadonlyArray<HarEntry> = JSON.parse(text(files.get("har.har"))).log.entries
            assert.strictEqual(entries.length, 1)
            const [entry] = entries
            assert.deepStrictEqual(entry!.request.headers, [])
            assert.deepStrictEqual(entry!.timings, { send: -1, wait: -1, receive: -1 })
            const file = entry!.response.content._file!
            assert.isString(file)
            assert.strictEqual(text(files.get(file)), `{"hello":"world"}`)
          }),
        timeout
      )

      it.effect(
        "records the bodies requests sent, written only when included, and the headers they were sent with",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const out = path.join(directory(), "bodies.har")
            const redacted = path.join(directory(), "redacted.har")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const har = yield* Har.record(page, { content: "embed", url: "**/*echo", inFlightAtStop: "wait" })
              yield* page.goto(`${served.origin}/cookie`)
              const form = yield* NetworkRequest.next(page, { url: `${served.origin}/echo`, method: "POST" })
              yield* page.evaluateInMainWorld(async () => {
                await fetch("/echo", {
                  method: "POST",
                  body: "q=shoes&size=9",
                  headers: { "content-type": "application/x-www-form-urlencoded" }
                })
                // A 307 sends the body again, to the next hop
                await fetch("/to-echo", {
                  method: "POST",
                  body: JSON.stringify({ q: "hats" }),
                  headers: { "content-type": "application/json" }
                })
                // A file's bytes, which Chromium's event doesn't carry
                const data = new FormData()
                data.append("file", new Blob(["file body"], { type: "text/plain" }), "note.txt")
                await fetch("/echo", { method: "POST", body: data })
                return true
              })
              // The headers as sent have the cookie the page set, which Chromium's event leaves out (Q158), and
              // stock WebKit's network process doesn't report (Q226)
              const sent = yield* NetworkRequest.headersSent(page, yield* form)
              if (yield* fullySupports("network.headersSent")) assert.include(sent.cookie, "flavor=oat")
              yield* har.entries.waitFor((count) => count >= 4)
              yield* har.exportHar(out, { include: ["requestBodies"] })
              yield* har.exportHar(redacted)
            }))
            interface Sent {
              readonly request: {
                readonly url: string
                readonly bodySize: number
                readonly postData?: { readonly mimeType: string; readonly text: string; readonly _encoding?: string }
              }
              readonly response: { readonly status: number }
            }
            const entries: ReadonlyArray<Sent> = JSON.parse(fs.readFileSync(out, "utf8")).log.entries
            assert.deepStrictEqual(
              entries.map((entry) => `${entry.request.url.replace(served.origin, "")} ${entry.response.status}`),
              ["/echo 200", "/to-echo 307", "/echo 200", "/echo 200"]
            )
            const [form, redirect, redirected, upload] = entries
            assert.deepStrictEqual(form!.request.postData, {
              mimeType: "application/x-www-form-urlencoded",
              text: "q=shoes&size=9",
              params: [{ name: "q", value: "shoes" }, { name: "size", value: "9" }]
            } as never)
            for (const hop of [redirect!, redirected!]) {
              assert.deepStrictEqual(hop.request.postData, { mimeType: "application/json", text: `{"q":"hats"}` })
            }
            assert.strictEqual(upload!.request.postData?._encoding, "base64")
            const uploaded = Buffer.from(upload!.request.postData!.text, "base64").toString("utf8")
            assert.include(uploaded, `filename="note.txt"`)
            // WebKit leaves a file's bytes out of the body it reports (QUIRKS.md, Q184)
            if (name === "WebKit") assert.notInclude(uploaded, "file body")
            else assert.include(uploaded, "file body")
            // Left out unless included, though their sizes are written
            const plain: ReadonlyArray<Sent> = JSON.parse(fs.readFileSync(redacted, "utf8")).log.entries
            assert.deepStrictEqual(plain.map((entry) => entry.request.postData), [
              undefined,
              undefined,
              undefined,
              undefined
            ])
            assert.strictEqual(plain[0]!.request.bodySize, 14)
          }),
        timeout
      )

      it.effect(
        "replays a recorded HAR as a route, matching requests by body and following its redirects",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const file = path.join(directory(), "replay.har")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const har = yield* Har.record(page, { content: "embed", url: "**/*echo", inFlightAtStop: "wait" })
              yield* page.goto(`${served.origin}/cookie`)
              yield* page.evaluateInMainWorld(async () => {
                await fetch("/echo", { method: "POST", body: "shoes" })
                await fetch("/echo", { method: "POST", body: "hats" })
                await fetch("/to-echo", { method: "POST", body: "boots" })
                return true
              })
              yield* har.entries.waitFor((count) => count >= 4)
              yield* har.exportHar(file, { include: ["requestBodies"] })
            }))
            // The recording's answers, told apart from the site's
            const log = JSON.parse(fs.readFileSync(file, "utf8"))
            for (const entry of log.log.entries) {
              if (entry.response.status === 200) entry.response.content.text = `recorded ${entry.request.postData.text}`
            }
            fs.writeFileSync(file, JSON.stringify(log))
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              yield* page.goto(`${served.origin}/cookie`)
              yield* page.route("**/*echo", yield* Route.fromHar(file).pipe(Effect.provide(NodeFileSystem.layer)))
              const answers = yield* page.evaluateInMainWorld(async () => {
                const post = (url: string, body: string) =>
                  fetch(url, { method: "POST", body }).then((response) => response.text(), () => "failed")
                return [await post("/echo", "hats"), await post("/echo", "shoes"), await post("/echo", "socks")]
              })
              // The latest entry with the request's body answers it; none matches the last, which is aborted
              assert.deepStrictEqual(answers, ["recorded hats", "recorded shoes", "failed"])
              // WebKit doesn't follow a redirect a route fulfills (QUIRKS.md, Q90)
              if (name !== "WebKit") {
                const redirected = yield* page.evaluateInMainWorld(() =>
                  fetch("/to-echo", { method: "POST", body: "boots" }).then((response) => response.text())
                )
                assert.strictEqual(redirected, "recorded boots")
              }
            }))
          }),
        timeout
      )

      it.effect("replays a form navigation through a 303 HAR redirect", () =>
        Effect.gen(function*() {
          if (!(yield* fullySupports("interception.redirects"))) return
          const origin = "https://login.example.test"
          const body = "username=tomsmith&password=SuperSecretPassword%21"
          const entry = (
            method: string,
            pathname: string,
            status: number,
            text: string,
            headers: Array<{ name: string; value: string }> = []
          ) => ({
            startedDateTime: "2026-11-08T00:00:00.000Z",
            time: 0,
            request: {
              method,
              url: origin + pathname,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: method === "POST" ? body.length : 0,
              ...(method === "POST" ? { postData: { mimeType: "application/x-www-form-urlencoded", text: body } } : {})
            },
            response: {
              status,
              statusText: "",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "content-type", value: "text/html;charset=utf-8" }, ...headers],
              content: { size: text.length, mimeType: "text/html", text },
              redirectURL: status === 303 ? origin + "/secure" : "",
              headersSize: -1,
              bodySize: text.length
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 }
          })
          const file = path.join(directory(), "form-redirect.har")
          fs.writeFileSync(
            file,
            JSON.stringify({
              log: {
                version: "1.2",
                creator: { name: "local regression", version: "1" },
                entries: [
                  entry(
                    "GET",
                    "/login",
                    200,
                    "<form action=\"/authenticate\" method=\"post\"><label>Username<input name=\"username\"></label><label>Password<input name=\"password\" type=\"password\"></label><button>Login</button></form>"
                  ),
                  entry("POST", "/authenticate", 303, "", [{ name: "location", value: origin + "/secure" }]),
                  entry("GET", "/secure", 200, "<p>You logged into a secure area!</p>")
                ]
              }
            })
          )
          const page = yield* Browser.newPage()
          yield* page.route("**/*", yield* Route.fromHar(file).pipe(Effect.provide(NodeFileSystem.layer)))
          yield* page.goto(origin + "/login")
          yield* page.getByLabel("Username").fill("tomsmith")
          yield* page.getByLabel("Password").fill("SuperSecretPassword!")
          yield* page.getByRole("button", { name: "Login" }).click()
          yield* page.getByText("You logged into a secure area!").pipe(Expect.toBeVisible)
        }), timeout)

      it.effect(
        "records a trace that nests in the program's spans, with screenshots, console, errors and network",
        () =>
          Effect.gen(function*() {
            const url = yield* fixture(
              `<button onclick="console.log('bought'); setTimeout(() => { throw new Error('boom') })">Buy</button>`
            )
            const out = path.join(directory(), "trace.zip")
            const buy = Effect.fn("buy")(function*(page: Page.Page) {
              yield* page.goto(url)
              yield* page.getByRole("button", { name: "Buy" }).click()
              yield* page.title
            })
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const trace = yield* Trace.record(page, { screenshots: "perAction", network: true })
              yield* buy(page)
              yield* Effect.sleep("300 millis")
              yield* trace.exportTrace(out)
            }))
            const files = yield* unzip(out)
            const events = lines(files.get("trace.trace"))
            assert.deepInclude(events[0], { version: 9, type: "context-options", origin: "library" })
            const group = events.find((event) => event.type === "before" && event.title === "buy")
            const click = events.find((event) => event.type === "before" && event.title === "Locator.click")
            assert.isDefined(group)
            assert.deepInclude(click, { class: "Locator", method: "click", parentId: group.callId })
            const source = new URL(import.meta.url).pathname
            const sourceLines = fs.readFileSync(source, "utf8").split("\n")
            for (
              const [step, expression] of [[click, "page.getByRole(\"button\", { name: \"Buy\" }).click()"], [
                events.find((event) => event.type === "before" && event.title === "Page.title"),
                "page.title"
              ]] as const
            ) {
              const line = sourceLines.findIndex((line) => line.trim() === `yield* ${expression}`)
              const column = expression === "page.title"
                ? sourceLines[line]!.indexOf("title") + 1
                : sourceLines[line]!.indexOf(".click()") + 2
              assert.deepInclude(step.stack[0], { file: source, line: line + 1, column })
            }
            assert.strictEqual(group.stack[0].file, source)
            const archivedSource = `src/${createHash("sha1").update(source).digest("hex")}.ts`
            assert.strictEqual(text(files.get(archivedSource)), fs.readFileSync(source, "utf8"))
            const shot = events.find((event) => event.type === "screenshot" && event.callId === click.callId)
            assert.isDefined(shot)
            assert.deepStrictEqual(Array.from(files.get(shot.file)!.slice(1, 4)), [0x50, 0x4e, 0x47])
            assert.isDefined(events.find((event) => event.type === "console" && event.text === "bought"))
            const thrown = events.find((event) => event.type === "event" && event.method === "pageError")
            assert.include(thrown.params.error.error.message, "boom")
            const network = lines(files.get("trace.network"))
            // Firefox writes the URL with its quotes escaped
            assert.isDefined(network.find((line) =>
              line.type === "resource-snapshot" && new URL(line.snapshot.request.url).pathname === "/fixture" &&
              line.snapshot.response.status === 200
            ))
          }),
        timeout
      )

      it.effect(
        "captures completed locator expectations, including their final state after failure",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<p>initial</p>"))
            const trace = yield* Trace.record(page, { screenshots: "perAction", domSnapshots: true, network: true })
            yield* page.locator("p").pipe(Expect.toHaveText("initial"))
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                document.querySelector("p")!.textContent = "final"
              }, 50)
            })
            const failure = yield* page.locator("p").pipe(
              Expect.toHaveText("missing"),
              Operation.named("check final state"),
              Deadline.within("300 millis"),
              Effect.flip
            )
            assert.isTrue(Expect.isExpectationFailed(failure))
            const final = yield* page.screenshot()
            const out = path.join(directory(), "expectations.zip")
            yield* trace.exportTrace(out)
            const files = yield* unzip(out)
            const events = lines(files.get("trace.trace"))
            const checks = events.filter((event) => event.type === "before" && event.title === "Expect.toHaveText")
            assert.lengthOf(checks, 2)
            const shots = checks.map((check) => {
              const matching = events.filter((event) => event.type === "screenshot" && event.callId === check.callId)
              assert.lengthOf(matching, 1)
              assert.isFalse(
                events.some((event) => event.type === "frame-snapshot" && event.snapshot.callId === check.callId)
              )
              return files.get(matching[0].file)!
            })
            assert.deepStrictEqual(shots[1], final)
            assert.notDeepEqual(shots[0], final)
            const failed = events.find((event) => event.type === "after" && event.callId === checks[1].callId)
            assert.include(JSON.stringify(failed.error), "ExpectationFailed")
          })),
        timeout
      )

      it.effect(
        "returns an expired expectation when its completion screenshot cannot finish",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<p>busy</p>"))
            const trace = yield* Trace.record(page, { screenshots: "perAction" })
            // The page's main thread never yields again, so neither the check nor a screenshot can finish
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                while (true) {
                  // busy
                }
              }, 0)
            })
            const settled = yield* page.locator("p").pipe(
              Expect.toHaveText("missing"),
              Deadline.within("300 millis"),
              Effect.flip,
              Effect.asSome,
              Effect.raceFirst(
                Effect.promise(() =>
                  new Promise<Option.Option<unknown>>((resolve) => setTimeout(() => resolve(Option.none()), 10_000))
                )
              )
            )
            assert.isTrue(Option.isSome(settled), "the expectation did not return within 10 s of its 300 ms deadline")
            if (Option.isSome(settled)) assert.isTrue(Expect.isExpectationFailed(settled.value))
            const out = path.join(directory(), "hung-expectation.zip")
            yield* trace.exportTrace(out)
            const events = lines((yield* unzip(out)).get("trace.trace"))
            assert.isFalse(events.some((event) => event.type === "screenshot"))
            const check = events.find((event) => event.type === "before" && event.title === "Expect.toHaveText")
            assert.include(
              JSON.stringify(events.find((event) => event.type === "after" && event.callId === check.callId).error),
              "ExpectationFailed"
            )
          })),
        timeout
      )

      it.effect(
        "returns an expired action when its completion screenshot cannot finish",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<button>busy</button>"))
            const trace = yield* Trace.record(page, { screenshots: "perAction" })
            // The page's main thread never yields again, so neither the action nor a screenshot can finish
            yield* page.evaluateInMainWorld(() => {
              setTimeout(() => {
                while (true) {
                  // busy
                }
              }, 0)
            })
            const settled = yield* page.locator("button").click().pipe(
              Deadline.within("300 millis"),
              Effect.flip,
              Effect.asSome,
              Effect.raceFirst(
                Effect.promise(() =>
                  new Promise<Option.Option<unknown>>((resolve) => setTimeout(() => resolve(Option.none()), 10_000))
                )
              )
            )
            assert.isTrue(Option.isSome(settled), "the action did not return within 10 s of its 300 ms deadline")
            if (Option.isSome(settled)) {
              assert.isTrue(Deadline.isTimeout(settled.value))
              if (Deadline.isTimeout(settled.value)) assert.strictEqual(settled.value.operation, "Locator.click")
            }
            const out = path.join(directory(), "hung-action.zip")
            yield* trace.exportTrace(out)
            const events = lines((yield* unzip(out)).get("trace.trace"))
            assert.isFalse(events.some((event) => event.type === "screenshot"))
            const check = events.find((event) => event.type === "before" && event.title === "Locator.click")
            assert.include(
              JSON.stringify(events.find((event) => event.type === "after" && event.callId === check.callId).error),
              "Timeout"
            )
          })),
        timeout
      )

      it.effect(
        "keeps expectation screenshots off by default and when explicitly disabled",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const page = yield* Browser.newPage()
            yield* page.goto(yield* fixture("<p>ready</p>"))
            for (const options of [undefined, { screenshots: "off" as const }]) {
              const trace = yield* Trace.record(page, options)
              yield* page.locator("p").pipe(Expect.toHaveText("ready"))
              const failure = yield* page.locator("p").pipe(
                Expect.toHaveText("missing"),
                Deadline.within("100 millis"),
                Effect.flip
              )
              assert.isTrue(Expect.isExpectationFailed(failure))
              const out = path.join(directory(), "off.zip")
              yield* trace.exportTrace(out)
              const events = lines((yield* unzip(out)).get("trace.trace"))
              assert.isFalse(events.some((event) => event.type === "screenshot"))
            }
          })),
        timeout
      )

      it.effect(
        "records DOM snapshots of every frame before and after each action, its target marked and its secrets redacted",
        () =>
          Effect.gen(function*() {
            const served = yield* site
            const inner = `${served.origin}/fixture?html=${encodeURIComponent(`<p id="inner">inner</p>`)}`
            const url = yield* fixture(
              `<style>p { color: red }</style><p>hello</p><input id="name"><input id="secret" type="password"><iframe src="${inner}"></iframe><div id="host"></div><button onclick="this.textContent = 'Done'">Go</button><script>
                const sheet = new CSSStyleSheet()
                sheet.replaceSync("button { font-weight: bold }")
                document.adoptedStyleSheets = [sheet]
                document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = "<span>shadow</span>"
              </script>`
            )
            const strict = path.join(directory(), "strict.zip")
            const local = path.join(directory(), "local.zip")
            yield* Effect.scoped(Effect.gen(function*() {
              const page = yield* Browser.newPage()
              const trace = yield* Trace.record(page, { domSnapshots: true, network: true })
              yield* page.goto(url, { waitUntil: "load" })
              yield* page.locator("#name").fill("Ada")
              yield* page.locator("#secret").fill(Redacted.make("hunter2"))
              yield* page.getByRole("button", { name: "Go" }).click()
              yield* page.setContent("<h1>Replacement fixture</h1>")
              yield* trace.exportTrace(strict)
              yield* trace.exportTrace(local).pipe(Diagnostics.withPreset("local"))
            }))
            const events = lines((yield* unzip(strict)).get("trace.trace"))
            const snapshots = events.filter((event) => event.type === "frame-snapshot").map((event) => event.snapshot)
            const replacement = events.find((event) => event.type === "before" && event.title === "Page.setContent")!
            assert.isDefined(replacement)
            const replaced = snapshots.filter((each) => each.callId === replacement.callId && each.isMainFrame)
            assert.isDefined(replaced.find((each) => each.phase === "before"))
            const replacedAfter = replaced.find((each) => each.phase === "after")
            assert.isDefined(replacedAfter)
            assert.isDefined(
              find(
                expand(snapshots, replacedAfter),
                (node) => node[0] === "H1" && textOf(node) === "Replacement fixture"
              )
            )
            const click = events.find((event) => event.type === "before" && event.title === "Locator.click")!
            const main = (phase: string) =>
              snapshots.find((each) => each.callId === click.callId && each.phase === phase && each.isMainFrame)
            const before = main("before")
            const after = main("after")
            const seen = JSON.stringify(
              snapshots.map((each) => [each.callId, each.phase, each.isMainFrame, each.frameUrl])
            )
            assert.isDefined(before, seen)
            assert.isDefined(after, seen)
            const tree = (snapshot: Record<string, any>) => expand(snapshots, snapshot)
            const button = (snapshot: Record<string, any>) => find(tree(snapshot), (node) => node[0] === "BUTTON")!
            assert.strictEqual(textOf(button(before)), "Go")
            assert.strictEqual(textOf(button(after)), "Done")
            assert.strictEqual(button(after)[1]["__playwright_target__"], "")
            assert.isUndefined(button(before)[1]["__playwright_target__"])
            // Live state, in the viewer's attributes
            const input = (id: string) => find(tree(after), (node) => node[0] === "INPUT" && node[1].id === id)!
            assert.strictEqual(input("name")[1]["__playwright_value_"], "Ada")
            assert.strictEqual(input("secret")[1]["__playwright_value_"], "REDACTED")
            assert.notInclude(JSON.stringify(snapshots), "__strider_secret__")
            assert.notInclude(JSON.stringify(snapshots), "hunter2")
            assert.isDefined(
              find(tree(after), (node) =>
                node[0] === "template" && node[1]["__playwright_shadow_root_"] === "open" && textOf(node) === "shadow")
            )
            assert.isDefined(
              find(tree(after), (node) =>
                node[0] === "template" && String(node[1]["__playwright_style_sheet_"]).includes("font-weight"))
            )
            assert.include(
              textOf(
                find(tree(after), (node) =>
                  node[0] === "STYLE")!
              ),
              "color"
            )
            // The iframe points at its frame's own snapshot, for the same call and phase
            const iframe = find(tree(after), (node) =>
              node[0] === "IFRAME")!
            const frameId = String(iframe[1].src).replace("/snapshot/", "")
            const framed = snapshots.find((each) =>
              each.callId === click.callId && each.phase === "after" && each.frameId === frameId
            )
            assert.isDefined(framed, String(iframe[1].src))
            assert.isDefined(find(expand(snapshots, framed), (node) =>
              node[0] === "P" && node[1].id === "inner"))
            // What didn't change since the frame's last capture is a reference to it
            assert.include(JSON.stringify(after.html), "[[")
            // A local export keeps the secret
            const kept = lines((yield* unzip(local)).get("trace.trace"))
              .filter((event) =>
                event.type === "frame-snapshot"
              ).map((event) => event.snapshot)
            assert.include(JSON.stringify(kept), "hunter2")
          }),
        timeout
      )

      it.effect(
        "records screencast frames, the browser's own where it has them, or polled",
        () =>
          Effect.gen(function*() {
            const url = yield* fixture(
              `<p id="t"></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>`
            )
            for (const screencast of ["native", { polled: "100 millis" }] as const) {
              const out = path.join(directory(), "frames.zip")
              const recorded = yield* Effect.scoped(Effect.gen(function*() {
                const page = yield* Browser.newPage()
                const trace = yield* Trace.record(page, { screencast })
                yield* page.goto(url)
                yield* Effect.sleep("1 second")
                return yield* trace.exportTrace(out)
              })).pipe(Effect.exit)
              if (
                screencast === "native" && !(yield* supports("capability.screencast")) &&
                !(yield* supports("capability.video"))
              ) {
                // A browser with neither its own frames nor a video says so; polling is every backend's
                assert(recorded._tag === "Failure", String(recorded))
                continue
              }
              assert(recorded._tag === "Success", String(recorded))
              const files = yield* unzip(out)
              if (screencast === "native" && (yield* supports("capability.video"))) {
                // Firefox's own video of the page, WebM, with its size read from the file
                const videos = lines(files.get("trace.trace")).filter((event) => event.type === "video")
                assert.strictEqual(videos.length, 1)
                assert.deepStrictEqual(Array.from(files.get(videos[0].file)!.slice(0, 4)), [0x1a, 0x45, 0xdf, 0xa3])
                assert.isAbove(videos[0].width, 0)
                assert.isAbove(videos[0].height, 0)
                continue
              }
              const frames = lines(files.get("trace.trace")).filter((event) => event.type === "screencast-frame")
              assert.isAtLeast(frames.length, 2, JSON.stringify(screencast))
              // JPEG, or PNG where the backend's screenshots are PNG only
              const jpeg = screencast === "native" || (yield* fullySupports("screenshot.format"))
              assert.deepStrictEqual(
                Array.from(files.get(frames[0].file)!.slice(0, 2)),
                jpeg ? [0xff, 0xd8] : [0x89, 0x50]
              )
              assert.isAbove(frames[0].width, 0)
            }
            assert.isDefined(Capability.Screencast)
          }),
        timeout
      )
    })
  })
