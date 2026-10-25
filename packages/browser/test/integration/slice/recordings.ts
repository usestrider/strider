/**
 * Review 20's recordings on every backend's layer: a HAR with its timings, bodies, statuses and redactions, as
 * one file or a zip with the bodies beside it; and a trace whose steps nest in the program's spans, with
 * screenshots, console messages, exceptions, network entries and screencast frames.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Capability, Har, NetworkResponse, Page, Trace } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import type * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { site } from "../adapter/harness.ts"

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
              yield* page.goto(`${served.origin}/cookie`)
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
        "records screencast frames, the browser's own where it has them, or polled",
        () =>
          Effect.gen(function*() {
            const { info } = yield* Browser.Browser
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
              if (screencast === "native" && info.protocol === "bidi") {
                const error = yield* Effect.flip(recorded)
                assert(Trace.isTraceError(error), String(error))
                assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "capability.screencast" })
                continue
              }
              assert(recorded._tag === "Success", String(recorded))
              const files = yield* unzip(out)
              const frames = lines(files.get("trace.trace")).filter((event) => event.type === "screencast-frame")
              assert.isAtLeast(frames.length, 2, JSON.stringify(screencast))
              assert.deepStrictEqual(Array.from(files.get(frames[0].file)!.slice(0, 2)), [0xff, 0xd8])
              assert.isAbove(frames[0].width, 0)
            }
            assert.isDefined(Capability.Screencast)
          }),
        timeout
      )
    })
  })
