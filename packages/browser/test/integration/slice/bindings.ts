/** Host bindings through the public API, one case per rule, on every backend. */
import { assert, describe, layer } from "@effect/vitest"
import { Binding, Browser, Expect, Popup } from "@usestrider/browser"
import type { Page } from "@usestrider/browser"
import { Reason } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import type * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { site } from "../adapter/harness.ts"
import { supports } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`
const numbers = { arguments: Schema.Tuple([Schema.Number, Schema.Number]), result: Schema.Number }
/** A document that calls `name` as it parses and shows what it got in `#out`. */
const calling = (name: string) =>
  `<pre id="out">pending</pre><script>document.getElementById("out").textContent = typeof window.${name}; ` +
  `window.${name}?.(2, 3).then((v) => { document.getElementById("out").textContent = "resolved " + v }, ` +
  `(e) => { document.getElementById("out").textContent = "rejected " + e.message })</script>`
/** What a call settles as, read in the page. */
const outcome = (page: Page.Page, name: string, args: ReadonlyArray<unknown>) =>
  page.evaluateInMainWorld(
    ([name, args]) =>
      (window as any)[name](...args).then(
        (value: unknown) => `resolved ${JSON.stringify(value)}`,
        (error: unknown) => error instanceof Error ? `rejected ${error.message}` : "rejected without an Error"
      ) as Promise<string>,
    [name, args] as const
  )
const timeout = 60_000

export const bindings = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} bindings`, () => {
    layer(SharedContext.layer(backend), { excludeTestServices: true, timeout })((suite) => {
      const it = SharedContext.guard(suite)

      it.effect("decodes a page's arguments, encodes the result and names the calling page and frame", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const sources: Array<Binding.Source> = []
          yield* page.exposeBinding("add", numbers, ([a, b], source) =>
            Effect.sync(() => {
              sources.push(source)
              return a + b
            }))
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          assert.strictEqual(yield* outcome(page, "add", [2, 3]), "resolved 5")
          assert.deepStrictEqual(sources, [{ page: page.id, frame: page.id }])
        }).pipe(Effect.scoped))

      it.effect("rejects with an Error carrying the decoding failure's or the handler failure's message", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.exposeBinding("add", numbers, ([a, b]) => Effect.succeed(a + b))
          yield* page.exposeBinding(
            "refuse",
            numbers,
            () =>
              Effect.fail(
                new Reason.InvalidInput({
                  input: "add",
                  expected: "a request the host accepts",
                  hint: "refused by the host"
                })
              )
          )
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          const undecoded = yield* outcome(page, "add", ["two", 3])
          assert.match(undecoded, /^rejected .*Expected number/)
          assert.strictEqual(
            yield* outcome(page, "refuse", [2, 3]),
            "rejected Invalid add: expected a request the host accepts (refused by the host)"
          )
        }).pipe(Effect.scoped))

      it.effect("carries NaN, -0, and undefined both ways and rejects a value that can't cross", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const values = Schema.Tuple([Schema.Number, Schema.Number, Schema.Undefined])
          const received: Array<ReadonlyArray<unknown>> = []
          yield* page.exposeBinding("echo", { arguments: values, result: values }, (args) =>
            Effect.sync(() => {
              received.push(args)
              return [NaN, -0, undefined] as const
            }))
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          const back = yield* page.evaluateInMainWorld(() =>
            (window as any).echo(NaN, -0, undefined).then((result: ReadonlyArray<unknown>) => [
              Number.isNaN(result[0]),
              Object.is(result[1], -0),
              result.length === 3 && result[2] === undefined
            ]) as Promise<ReadonlyArray<boolean>>
          )
          assert.deepStrictEqual(back, [true, true, true])
          assert.strictEqual(received.length, 1)
          assert.isTrue(Number.isNaN(received[0]![0]))
          assert.isTrue(Object.is(received[0]![1], -0))
          assert.strictEqual(received[0]!.length, 3)
          assert.strictEqual(received[0]![2], undefined)
          const refused = yield* page.evaluateInMainWorld(() =>
            (window as any).echo(() => 1).then(
              () => "resolved",
              (error: Error) => `rejected ${error.message}`
            ) as Promise<string>
          )
          assert.match(refused, /^rejected Not serializable at args\[0\] \(/)
          assert.strictEqual(received.length, 1)
        }).pipe(Effect.scoped))

      it.effect("rejects a call past the 4096 a document may have waiting", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const gate = yield* Deferred.make<void>()
          yield* page.exposeBinding("wait", numbers, () => Deferred.await(gate).pipe(Effect.as(0)))
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          const next = yield* page.evaluateInMainWorld(() => {
            for (let i = 0; i < 4096; i++) (window as any).wait(1, 2).catch(() => {})
            return (window as any).wait(1, 2).then(
              () => "resolved",
              (error: Error) => `rejected ${error.message}`
            ) as Promise<string>
          })
          assert.strictEqual(
            next,
            "rejected Binding \"wait\" has 4096 calls waiting for their answer; await some first"
          )
        }).pipe(Effect.scoped))

      it.effect("rejects with a fixed message when the handler dies", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.exposeBinding("crash", numbers, () => Effect.die("a secret the page must not see"))
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          assert.strictEqual(yield* outcome(page, "crash", [2, 3]), "rejected Binding \"crash\" handler failed")
        }).pipe(Effect.scoped))

      it.effect("covers a page's frames and survives navigation", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const frames: Array<string> = []
          yield* page.exposeBinding("add", numbers, ([a, b], source) =>
            Effect.sync(() => {
              frames.push(source.frame)
              return a + b
            }))
          yield* page.goto(fixtureUrl(served.origin, "<p>first</p>"))
          yield* page.goto(
            fixtureUrl(served.origin, `<iframe src="${fixtureUrl(served.origin, calling("add"))}"></iframe>`)
          )
          yield* Expect.toHaveText(page.frame(page.locator("iframe")).locator("#out"), "resolved 5")
          assert.strictEqual(frames.length, 1)
          assert.notStrictEqual(frames[0], page.id)
          assert.strictEqual(yield* outcome(page, "add", [1, 1]), "resolved 2")
        }).pipe(Effect.scoped))

      it.effect("reaches a document that was already open", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          yield* page.exposeBinding("add", numbers, ([a, b]) => Effect.succeed(a + b))
          assert.strictEqual(yield* outcome(page, "add", [4, 5]), "resolved 9")
        }).pipe(Effect.scoped))

      it.effect("lives in the main world only, not in workers", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          yield* page.exposeBinding("add", numbers, ([a, b]) => Effect.succeed(a + b))
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          const inWorker = yield* page.evaluateInMainWorld(() =>
            new Promise<string>((resolve) => {
              const worker = new Worker(
                URL.createObjectURL(new Blob(["postMessage(typeof self.add)"], { type: "text/javascript" }))
              )
              worker.onmessage = (event) => {
                worker.terminate()
                resolve(String(event.data))
              }
            })
          )
          assert.strictEqual(inWorker, "undefined")
        }).pipe(Effect.scoped))

      it.effect("remove deletes it from open documents and rejects the calls still waiting", () =>
        Effect.gen(function*() {
          const served = yield* site
          const page = yield* newPage
          const started = yield* Deferred.make<void>()
          const registration = yield* page.exposeBinding(
            "wait",
            numbers,
            () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          )
          yield* page.goto(fixtureUrl(served.origin, "<p>ready</p>"))
          const waiting = yield* outcome(page, "wait", [1, 2]).pipe(Effect.forkScoped)
          yield* Deferred.await(started)
          yield* registration.remove
          assert.strictEqual(yield* Fiber.join(waiting), "rejected Binding \"wait\" was removed")
          assert.strictEqual(yield* page.evaluateInMainWorld(() => typeof (window as any).wait), "undefined")
          yield* registration.remove
        }).pipe(Effect.scoped))
    })

    layer(backend, { excludeTestServices: true, timeout })((it) => {
      it.effect("a context binding is there before the page's scripts, in popups and in cross-site frames", () =>
        Effect.scoped(Effect.gen(function*() {
          const { crossSite, origin } = yield* site
          const context = yield* Browser.newContext()
          yield* context.exposeBinding("add", numbers, ([a, b]) => Effect.succeed(a + b))
          const page = yield* context.newPage
          yield* page.goto(fixtureUrl(
            origin,
            `${calling("add")}<a target="_blank" href="${fixtureUrl(origin, calling("add"))}">Open popup</a>` +
              `<iframe src="${fixtureUrl(crossSite, calling("add"))}"></iframe>`
          ))
          yield* Expect.toHaveText(page.locator("#out"), "resolved 5")
          yield* Expect.toHaveText(page.frame(page.locator("iframe")).locator("#out"), "resolved 5")
          // Stock WebKit reports a popup as the browser's page, not its opener's, so there is no popup to read.
          if (!(yield* supports("popups.opener"))) return
          const opened = yield* Popup.next(page)
          yield* page.getByRole("link", { name: "Open popup" }).click()
          const popup = yield* opened
          yield* Expect.toHaveText(popup.locator("#out"), "resolved 5")
        })))

      it.effect("refuses a name the page or its context already exposes", () =>
        Effect.scoped(Effect.gen(function*() {
          const context = yield* Browser.newContext()
          const page = yield* context.newPage
          yield* context.exposeBinding("shared", numbers, ([a, b]) => Effect.succeed(a + b))
          yield* page.exposeBinding("own", numbers, ([a, b]) => Effect.succeed(a + b))
          const byContext = yield* page.exposeBinding("shared", numbers, ([a]) => Effect.succeed(a)).pipe(Effect.flip)
          assert(Binding.isBindingError(byContext) && byContext.reason._tag === "NameTaken")
          assert.strictEqual(byContext.reason.by, "context")
          const byPage = yield* page.exposeBinding("own", numbers, ([a]) => Effect.succeed(a)).pipe(Effect.flip)
          assert(Binding.isBindingError(byPage) && byPage.reason._tag === "NameTaken")
          assert.strictEqual(byPage.reason.by, "page")
          const fromContext = yield* context.exposeBinding("own", numbers, ([a]) => Effect.succeed(a)).pipe(
            Effect.flip
          )
          assert(Binding.isBindingError(fromContext) && fromContext.reason._tag === "NameTaken")
        })))

      it.effect("a context without bindings gets no binding in its pages", () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* site
          const exposing = yield* Browser.newContext()
          yield* exposing.exposeBinding("add", numbers, ([a, b]) => Effect.succeed(a + b))
          const plain = yield* Browser.newContext()
          const page = yield* plain.newPage
          yield* page.goto(fixtureUrl(origin, calling("add")))
          yield* Expect.toHaveText(page.locator("#out"), "undefined")
          const globals = yield* page.evaluateInMainWorld(() =>
            Object.getOwnPropertyNames(window).filter((key) => key.startsWith("__strider"))
          )
          assert.deepStrictEqual(globals, [])
        })))
    })
  })
