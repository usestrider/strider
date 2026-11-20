/** Console calls with their arguments as handles (`ConsoleMessage.nextCall`, `streamCalls`), on every backend. */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Tracer from "effect/Tracer"
import * as ConsoleArguments from "../../../src/internal/consoleArguments.ts"
import { site } from "../adapter/harness.ts"
import { fullySupports, status } from "./capabilities.ts"
import * as SharedContext from "./sharedContext.ts"
import { newPage } from "./sharedContext.ts"

const fixtureUrl = (origin: string, html: string) => `${origin}/fixture?html=${encodeURIComponent(html)}`

const opened = Effect.fnUntraced(function*(html = "<p>console</p>") {
  const { origin } = yield* site
  const page = yield* newPage
  yield* page.goto(fixtureUrl(origin, html))
  return page
})

/** The protocol commands `effect` sends, by method. */
const commandsOf = Effect.fnUntraced(function*<A, E, R>(effect: Effect.Effect<A, E, R>) {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  const result = yield* effect.pipe(
    Effect.withTracer(tracer),
    Effect.provideService(Browser.TraceProtocolCommands, true)
  )
  const methods = spans.flatMap((span) => {
    const method = span.attributes.get("browser.protocol.method")
    return typeof method === "string" ? [method] : []
  })
  return { result, methods }
})

const releases = (methods: ReadonlyArray<string>) =>
  methods.filter((method) => /^Runtime\.releaseObject|^script\.disown/.test(method))

/** The console call cases, registered in a suite whose shared context they leave as they found it. */
export const consoleCalls = (
  name: "Chromium" | "Firefox" | "WebKit",
  it: ReturnType<typeof SharedContext.guard<Browser.Browser>>
) => {
  it.effect("says how each backend holds console arguments", () =>
    Effect.gen(function*() {
      // Firefox sends console arguments by value, and as it applied the call's format
      assert.strictEqual(yield* status("console.arguments"), name === "Firefox" ? "partial" : "supported")
    }))

  it.effect("gives a call's arguments, in order, with their values", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const logged = yield* ConsoleMessage.nextCall(page, { text: "values" })
      yield* page.evaluateInMainWorld(() => {
        console.log("values", { a: 1, b: [2, "c"] }, 3, null)
      })
      const call = yield* logged
      assert.strictEqual(call.message.text, "values {a: 1, b: Array(2)} 3 null")
      assert.strictEqual(call.args.length, 4)
      const values: ReadonlyArray<unknown> = yield* Effect.forEach(call.args, (arg) => arg.read)
      assert.deepStrictEqual(values, [
        "values",
        { a: 1, b: [2, "c"] },
        3,
        null
      ])
    }).pipe(Effect.scoped))

  it.effect("evaluates with an argument, and refers to a node the page logged", () =>
    Effect.gen(function*() {
      const page = yield* opened(`<p id="logged">here</p>`)
      const logged = yield* ConsoleMessage.nextCall(page)
      yield* page.evaluateInMainWorld(() => console.log({ a: 1 }, document.getElementById("logged")))
      const call = yield* logged
      assert.strictEqual(yield* call.args[0]!.evaluate((value) => (value as { a: number }).a + 1), 2)
      // A node is the page's own, on every backend
      assert.isTrue(
        yield* call.args[1]!.evaluate((node) => node === document.getElementById("logged"))
      )
    }).pipe(Effect.scoped))

  it.effect("ends a call's handles when released, and when the subscription's scope closes", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const scope = yield* Scope.make()
      const calls = yield* ConsoleMessage.streamCalls(page).pipe(Scope.provide(scope))
      const first = yield* calls.pipe(Stream.runHead, Effect.forkScoped)
      yield* page.evaluateInMainWorld(() => console.log({ a: 1 }, { b: 2 }))
      const call = Option.getOrThrow(yield* Fiber.join(first))
      yield* call.args[0]!.release
      assert.isTrue(Exit.isFailure(yield* Effect.exit(call.args[0]!.read)), "a released handle")
      assert.deepStrictEqual(yield* call.args[1]!.read, { b: 2 })
      yield* Scope.close(scope, Exit.void)
      assert.isTrue(Exit.isFailure(yield* Effect.exit(call.args[1]!.read)), "a handle whose subscription ended")
    }).pipe(Effect.scoped))

  it.effect("gives a worker's call its arguments", () =>
    Effect.gen(function*() {
      const logged = yield* Effect.gen(function*() {
        const { origin } = yield* site
        const page = yield* newPage
        const call = yield* ConsoleMessage.nextCall(page, { text: "from worker" })
        yield* page.goto(fixtureUrl(
          origin,
          `<script>new Worker(URL.createObjectURL(new Blob(['console.log("from worker", {a: 1})'])))</script>`
        ))
        return yield* call
      })
      assert.strictEqual(logged.args.length, 2)
      assert.deepStrictEqual(yield* logged.args[1]!.read, { a: 1 })
    }).pipe(Effect.scoped))

  it.effect("delivers no call from before the subscription, and none of the browser's own messages", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      yield* page.evaluateInMainWorld(() => console.log("early", { a: 1 }))
      const calls = yield* ConsoleMessage.streamCalls(page)
      const taken = yield* calls.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped)
      // A missing image is the browser's own message where the backend reports its source
      yield* page.evaluateInMainWorld(() => {
        const image = new Image()
        image.src = "/missing-image.png"
        document.body.append(image)
        return new Promise<void>((resolve) => {
          image.onerror = () => resolve()
        })
      })
      yield* page.evaluateInMainWorld(() => console.log("late", { b: 2 }))
      yield* page.evaluateInMainWorld(() => console.log("last"))
      const all = Array.from(yield* Fiber.join(taken))
      const fromPage = all.filter((call) => call.message.source._tag === "Page")
      assert.deepStrictEqual(fromPage.map((call) => call.message.text).slice(0, 1), ["late {b: 2}"])
      for (const call of all) {
        if (call.message.source._tag === "Browser") assert.deepStrictEqual(call.args, [])
      }
    }).pipe(Effect.scoped))

  it.effect("keeps a second subscriber's handles when the first releases its own, freeing the object last", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const one = yield* ConsoleMessage.nextCall(page, { text: "shared" })
      const two = yield* ConsoleMessage.nextCall(page, { text: "shared" })
      yield* page.evaluateInMainWorld(() => console.log("shared", { a: 1 }))
      const [first, second] = [yield* one, yield* two]
      assert.notStrictEqual(first.args[1], second.args[1])
      const { methods: afterFirst } = yield* commandsOf(first.args[1]!.release)
      assert.deepStrictEqual(yield* second.args[1]!.read, { a: 1 })
      const { methods: afterSecond } = yield* commandsOf(second.args[1]!.release)
      if (!(yield* fullySupports("console.arguments"))) return
      // The browser's object is freed by the release of its last owner
      assert.deepStrictEqual([releases(afterFirst).length, releases(afterSecond).length], [0, 1])
    }).pipe(Effect.scoped))

  it.effect("sends nothing new for a page's console messages while it has no calls subscriber", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const messages = yield* ConsoleMessage.next(page, { text: "plain" })
      const logs = (page: Page.Page) => page.evaluateInMainWorld(() => console.log("plain", { a: 1 }, [2]))
      const quiet = (page: Page.Page) => page.evaluateInMainWorld(() => 1)
      // The first evaluation in a document can send commands of its own, such as WebKit's to find its realm
      yield* quiet(page)
      const { methods: logging } = yield* commandsOf(logs(page))
      yield* messages
      const { methods: baseline } = yield* commandsOf(quiet(page))
      assert.deepStrictEqual(logging, baseline)
    }).pipe(Effect.scoped))

  it.effect("frees a message's arguments a live subscription's filter rejects", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const wanted = yield* ConsoleMessage.streamCalls(page, { text: "wanted" })
      assert.isDefined(wanted)
      const before = ConsoleArguments.held()
      yield* page.evaluateInMainWorld(() => {
        console.log("ignored", { a: 1 })
      })
      // The arguments are freed as the message arrives, while the subscription lives on. The release runs apart
      // from this fiber, so its command isn't among this case's spans: the kept arguments are counted instead
      assert.strictEqual(ConsoleArguments.held(), before)
    }).pipe(Effect.scoped))

  it.effect("frees a page's untaken arguments when its own subscription ends, while another page's lives on", () =>
    Effect.gen(function*() {
      const other = yield* opened()
      const living = yield* ConsoleMessage.streamCalls(other)
      assert.isDefined(living)
      const page = yield* opened()
      const scope = yield* Scope.make()
      const ending = yield* ConsoleMessage.streamCalls(page).pipe(Scope.provide(scope))
      assert.isDefined(ending)
      yield* page.evaluateInMainWorld(() => {
        console.log("untaken", { a: 1 })
      })
      const { methods } = yield* commandsOf(Scope.close(scope, Exit.void))
      if (!(yield* fullySupports("console.arguments"))) return
      assert.strictEqual(releases(methods).length, 1)
    }).pipe(Effect.scoped))

  it.effect("keeps a message for a second stream after the first takes and releases it", () =>
    Effect.gen(function*() {
      const page = yield* opened()
      const first = yield* ConsoleMessage.streamCalls(page)
      const second = yield* ConsoleMessage.streamCalls(page)
      const taking = yield* first.pipe(Stream.runHead, Effect.forkScoped)
      yield* page.evaluateInMainWorld(() => {
        console.log({ a: 1 })
      })
      const taken = Option.getOrThrow(yield* Fiber.join(taking))
      yield* taken.args[0]!.release
      const late = Option.getOrThrow(yield* second.pipe(Stream.runHead))
      assert.deepStrictEqual(yield* late.args[0]!.read, { a: 1 })
    }).pipe(Effect.scoped))
}
