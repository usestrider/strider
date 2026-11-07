/** A prerender must activate through the public Chromium layer, without an external target client. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import {
  Browser,
  Capability,
  ConsoleMessage,
  Deadline,
  Dialog,
  NetworkResponse,
  PageNavigation,
  Route,
  Target,
  VideoWriter
} from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import { createServer, type ServerResponse } from "node:http"
import * as Handles from "../../../src/internal/handles.ts"
import * as Operation from "../../../src/internal/operation.ts"
import { assertPinned, chromium } from "../browsers.ts"

const serve = Effect.acquireRelease(
  Effect.promise(async () => {
    const streams = new Map<string, ServerResponse>()
    const requests: Array<
      { url: string | undefined; purpose: string | undefined; header: string | undefined; extra: string | undefined }
    > = []
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        purpose: typeof request.headers["sec-purpose"] === "string" ? request.headers["sec-purpose"] : undefined,
        header: typeof request.headers["x-speculative"] === "string" ? request.headers["x-speculative"] : undefined,
        extra: typeof request.headers["x-extra"] === "string" ? request.headers["x-extra"] : undefined
      })
      if (request.url === "/old-stream" || request.url === "/kept-stream") {
        streams.set(request.url, response)
        response.setHeader("Content-Type", "text/plain")
        response.write("before-")
        return
      }
      if (request.url === "/failure") response.statusCode = 500
      response.setHeader("Content-Type", "text/html")
      response.end(
        request.url === "/start"
          ? `<script>
            const rules = document.createElement('script'); rules.type = 'speculationrules';
            rules.textContent = JSON.stringify({prerender:[{source:'list',urls:['/prerendered']}]});
            document.head.append(rules);
            setTimeout(() => { location.href = '/prerendered' }, 1500);
          </script>`
          : request.url === "/transfer"
          ? `<script>window.authorSaw = [window.seed, new Intl.NumberFormat().resolvedOptions().locale, innerWidth, innerHeight]; window.token = crypto.randomUUID();</script><iframe src="/child"></iframe>`
          : "<title>prerendered</title>"
      )
    })
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve))
    return {
      server,
      requests,
      finish: (path: string) => streams.get(path)!.end("after"),
      origin: `http://localhost:${(server.address() as { port: number }).port}`
    }
  }),
  ({ server }) =>
    Effect.promise(() =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
    )
)

const backend = Chromium.layer({ executablePath: chromium.executable }).pipe(
  Layer.provide(VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })),
  Layer.provide(NodeServices.layer)
)

describe("Chromium public prerender activation", () => {
  layer(backend, { excludeTestServices: true, timeout: 60_000 })((it) => {
    it.effect(
      "routes the speculative document and sends its configured headers before navigation",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin, requests } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/idle`)
          // ExtraHeaders is an L1 declaration; the public launch and routes use the same supported adapter.
          yield* Handles.page(page).runtime.model.adapter.declare(
            { _tag: "UserContext", context: page.context.id },
            { _tag: "Override", override: { _tag: "ExtraHeaders", headers: { "x-extra": "configured" } } }
          ).pipe(Operation.named("Test.speculativeHeaders"))
          const intercepted = yield* Deferred.make<void>()
          const tabIntercepted = yield* Deferred.make<void>()
          yield* page.route(`${origin}/speculative`, () =>
            Deferred.succeed(tabIntercepted, undefined).pipe(Effect.andThen(Route.fallthrough)))
          yield* page.context.route(
            `${origin}/speculative`,
            () =>
              Deferred.succeed(intercepted, undefined).pipe(
                Effect.andThen(Route.continueWith(HttpClientRequest.setHeader("x-speculative", "declared")))
              )
          )
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/speculative"] }] })
            document.head.append(rules)
          })
          yield* Deferred.await(intercepted).pipe(Deadline.within("10 seconds"))
          assert.isTrue(yield* Deferred.isDone(tabIntercepted))
          for (let attempt = 0; attempt < 200; attempt++) {
            const speculative = requests.find((request) =>
              request.url === "/speculative"
            )
            if (speculative !== undefined) {
              assert.include(speculative.purpose, "prerender")
              assert.strictEqual(speculative.header, "declared")
              assert.strictEqual(speculative.extra, "configured")
              assert.strictEqual(yield* page.url, `${origin}/idle`, "no activating navigation has been issued")
              return
            }
            yield* Effect.sleep("50 millis")
          }
          assert.fail("the speculative request did not reach the server within 10 seconds")
        })),
      60_000
    )

    it.effect(
      "keeps the tab and its document when a prerender is cancelled",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/idle`, { waitUntil: "load" })
          const initial = yield* page.status
          assert(initial._tag === "Open")
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.id = "speculation"
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/cancelled"] }] })
            document.head.append(rules)
          })
          const pages = yield* page.context.pages.waitFor((pages) =>
            pages.some((candidate) => candidate.pageKind === "prerender")
          ).pipe(Deadline.within("10 seconds"))
          const speculative = pages.find((candidate) => candidate.pageKind === "prerender")!
          yield* speculative.status.waitFor((status) =>
            status._tag === "Open" && status.document.readiness === "complete"
          ).pipe(Deadline.within("10 seconds"))
          yield* page.evaluateInMainWorld(() => document.getElementById("speculation")!.remove())
          assert.notStrictEqual(
            (yield* speculative.closed.pipe(Deadline.within("10 seconds")))._tag,
            "PrerenderActivated"
          )
          const current = yield* page.status
          assert(current._tag === "Open")
          assert.strictEqual(current.document.id, initial.document.id)
          assert.strictEqual((yield* page.goto(`${origin}/ordinary`))._tag, "Committed")
        })),
      60_000
    )

    it.effect(
      "reports an HTTP-failed prerender's later navigation as an ordinary commit",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin, requests } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/idle`)
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/failure"] }] })
            document.head.append(rules)
          })
          for (let attempt = 0; attempt < 200; attempt++) {
            if (requests.some((request) => request.url === "/failure")) break
            if (attempt === 199) assert.fail("the failed speculative request was not issued")
            yield* Effect.sleep("50 millis")
          }
          assert.strictEqual((yield* page.goto(`${origin}/failure`, { waitUntil: "load" }))._tag, "Committed")
          assert.strictEqual(
            yield* page.evaluateInMainWorld(() =>
              (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & {
                activationStart: number
              }).activationStart
            ),
            0
          )
        })),
      60_000
    )

    it.effect(
      "keeps session-bound response IO and ends the replaced session's recording and IO",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin, requests, finish } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/idle`, { waitUntil: "load" })
          const oldBody = yield* NetworkResponse.next(page.context, {
            url: `${origin}/old-stream`,
            body: (message) => message.text
          })
          const oldWaiting = yield* oldBody.pipe(Effect.exit, Effect.forkScoped)
          yield* page.evaluateInMainWorld(() => {
            void fetch("/old-stream")
            return true
          })
          const video = yield* page.capability(Capability.Video)
          const recording = yield* page.capability(Capability.Screencast)
          const started = yield* Deferred.make<void>()
          const stopped = yield* recording.frames.pipe(
            Stream.tap(() => Deferred.succeed(started, undefined)),
            Stream.runDrain,
            Effect.exit,
            Effect.forkScoped
          )
          yield* Deferred.await(started).pipe(Deadline.within("5 seconds"))
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/transfer"] }] })
            document.head.append(rules)
          })
          const pages = yield* page.context.pages.waitFor((pages) =>
            pages.some((candidate) => candidate.pageKind === "prerender")
          ).pipe(Deadline.within("10 seconds"))
          const speculative = yield* pages.find((candidate) => candidate.pageKind === "prerender")!.control
          yield* speculative.status.waitFor((status) =>
            status._tag === "Open" && status.document.readiness === "complete"
          ).pipe(Deadline.within("10 seconds"))
          const keptBody = yield* NetworkResponse.next(page.context, {
            url: `${origin}/kept-stream`,
            body: (message) => message.text
          })
          const keptWaiting = yield* keptBody.pipe(Effect.forkScoped)
          yield* speculative.evaluateInMainWorld(() => {
            void fetch("/kept-stream")
            return true
          })
          for (let attempt = 0; attempt < 200; attempt++) {
            if (requests.some((request) => request.url === "/kept-stream")) break
            if (attempt === 199) assert.fail("the retained IO did not start")
            yield* Effect.sleep("50 millis")
          }
          const navigation = yield* PageNavigation.next(page)
          yield* page.evaluateInMainWorld(() => {
            location.href = "/transfer"
          })
          assert.strictEqual((yield* navigation)._tag, "Activated")
          finish("/kept-stream")
          assert.strictEqual((yield* Fiber.join(keptWaiting).pipe(Deadline.within("2 seconds"))).body, "before-after")
          assert.isTrue(Exit.isFailure(yield* Fiber.join(oldWaiting).pipe(Deadline.within("2 seconds"))))
          assert.isTrue(Exit.isSuccess(yield* Fiber.join(stopped).pipe(Deadline.within("2 seconds"))))
          const file = yield* video.file.pipe(Deadline.within("10 seconds"))
          const probe = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
            "-v",
            "error",
            "-count_frames",
            "-show_streams",
            "-of",
            "json",
            file
          ], { encoding: "utf8", timeout: 8000 }))
          assert.strictEqual(probe.streams[0].codec_name, "vp8")
          assert.isAtLeast(Number(probe.streams[0].nb_read_frames), 1)
          execFileSync(process.env["STRIDER_FFMPEG"]!, ["-v", "error", "-i", file, "-f", "null", "-"], {
            timeout: 8000
          })
          assert.strictEqual((yield* page.status)._tag, "Open")
        })),
      60_000
    )

    it.effect(
      "retains realm authority without turning a released speculative-page grant into tab control",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* serve
          const browser = yield* Browser.Browser
          const context = yield* browser.defaultContext.control
          const page = yield* context.newPage
          yield* page.goto(`${origin}/idle`)
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/transfer"] }] })
            document.head.append(rules)
          })
          const observed = yield* browser.pages.waitFor((pages) =>
            pages.some((candidate) => candidate.pageKind === "prerender")
          ).pipe(Deadline.within("10 seconds"))
          const speculative = observed.find((candidate) => candidate.pageKind === "prerender")!
          yield* speculative.status.waitFor((status) =>
            status._tag === "Open" && status.document.readiness === "complete"
          ).pipe(Deadline.within("10 seconds"))
          const lease = yield* Scope.make()
          yield* Effect.addFinalizer((exit) => Scope.close(lease, exit))
          const granted = yield* speculative.control.pipe(Effect.provideService(Scope.Scope, lease))
          const refused = yield* Effect.flip(granted.emulate({ locale: "fr-FR" }))
          assert.strictEqual(refused._tag, "DeclarationError")
          assert(refused._tag === "DeclarationError")
          assert.strictEqual(refused.reason._tag, "Unsupported")
          const recording = yield* Effect.flip(granted.capability(Capability.Screencast))
          assert(recording._tag === "CapabilityError")
          assert.strictEqual(recording.reason._tag, "Unsupported")
          const retained = yield* granted.evaluateHandle(() => ({ value: 7 }))
          const navigation = yield* PageNavigation.next(page)
          yield* page.evaluateInMainWorld(() => {
            location.href = "/transfer"
          })
          assert.strictEqual((yield* navigation)._tag, "Activated")
          assert.strictEqual(yield* retained.evaluate((object) => object.value), 7)
          const ended = yield* Effect.flip(granted.goto(`${origin}/wrong`))
          assert(Target.isTargetGone(ended))
          assert.strictEqual(ended.reason._tag, "PrerenderActivated")
          assert.strictEqual(yield* page.url, `${origin}/transfer`)
          yield* Scope.close(lease, Exit.void)
          const released = yield* Effect.flip(retained.read)
          assert(Target.isTargetGone(released))
          assert.strictEqual(released.reason._tag, "AccessReleased")
          assert.strictEqual((yield* page.status)._tag, "Open")
        })),
      60_000
    )

    it.effect(
      "transfers its document, frame subtree, realms and running evaluation without closing the tab",
      () =>
        Effect.scoped(Effect.gen(function*() {
          const { origin } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.context.emulate({ locale: "de-DE", viewport: { width: 777, height: 555 } })
          yield* page.context.addInitScript({ source: "window.contextSeed=123" })
          yield* page.addInitScript({ source: "window.seed=window.contextSeed" })
          yield* page.goto(`${origin}/idle`, { waitUntil: "load" })
          const previous = yield* page.status
          assert(previous._tag === "Open")
          const previousDocument = Option.getOrThrow(Handles.page(page).runtime.model.document(previous.document.id))
          const oldHandle = yield* page.evaluateHandle(() => ({ old: true }))
          const oldRunning = yield* page.evaluateInMainWorld(() => new Promise<void>(() => {})).pipe(
            Effect.exit,
            Effect.forkScoped
          )
          const tabEnd = yield* page.closed.pipe(Effect.forkScoped)
          const decided = yield* Deferred.make<void>()
          yield* Dialog.handle(page, (dialog) =>
            Dialog.acceptAll(dialog).pipe(
              Effect.tap(() => Deferred.succeed(decided, undefined))
            ))
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/transfer"] }] })
            document.head.append(rules)
          })
          const pages = yield* page.context.pages.waitFor((pages) =>
            pages.some((candidate) => candidate.pageKind === "prerender")
          ).pipe(Deadline.within("10 seconds"))
          const speculative = yield* pages.find((candidate) => candidate.pageKind === "prerender")!.control
          const before = yield* speculative.status.waitFor((status) =>
            status._tag === "Open" && status.document.readiness === "complete"
          ).pipe(Deadline.within("10 seconds"))
          assert(before._tag === "Open")
          assert.deepStrictEqual(
            yield* speculative.evaluateInMainWorld(() =>
              (window as unknown as { authorSaw: Array<unknown> }).authorSaw
            ),
            [123, "de-DE", 777, 555]
          )
          assert.isTrue(
            yield* speculative.evaluateInMainWorld(() =>
              (document as Document & { prerendering: boolean }).prerendering
            )
          )
          const subtree = yield* speculative.frames
          assert.lengthOf(subtree.children, 1)
          const speculativeHandler = yield* Dialog.handle(speculative, Dialog.dismissAll)
          const handle = yield* speculative.evaluateHandle(() => ({ identity: 42 }))
          const realm = handle.realm
          const consoleStream = yield* ConsoleMessage.stream(speculative)
          const streamEnd = yield* Stream.runCollect(consoleStream).pipe(Effect.exit, Effect.forkScoped)
          const running = yield* speculative.evaluateInMainWorld(() =>
            new Promise<string>((resolve) => {
              ;(window as unknown as { waiting: boolean }).waiting = true
              document.addEventListener(
                "prerenderingchange",
                () => resolve((window as unknown as { token: string }).token),
                { once: true }
              )
            })
          ).pipe(Effect.forkScoped)
          for (let attempt = 0; attempt < 200; attempt++) {
            if (
              yield* speculative.evaluateInMainWorld(() =>
                (window as unknown as { waiting?: boolean }).waiting === true
              )
            ) break
            if (attempt === 199) assert.fail("the evaluation did not subscribe before activation")
            yield* Effect.sleep("50 millis")
          }
          const navigation = yield* PageNavigation.next(page)
          yield* page.evaluateInMainWorld(() => {
            location.href = "/transfer"
          })
          const activation = yield* navigation
          assert.strictEqual(activation._tag, "Activated")
          const after = yield* page.status
          assert(after._tag === "Open")
          assert.strictEqual(after.document.id, before.document.id)
          const transferred = Option.getOrThrow(Handles.page(page).runtime.model.document(before.document.id))
          assert.strictEqual(transferred.navigable, page.id)
          assert.strictEqual(transferred.state.getUnsafe().navigable, page.id)
          assert.strictEqual(Option.getOrThrow(Handles.page(page).runtime.model.realmPage(realm)).id, page.id)
          assert.isAbove(
            yield* page.evaluateInMainWorld(() =>
              (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & {
                activationStart: number
              }).activationStart
            ),
            0
          )
          assert.strictEqual(handle.realm, realm)
          assert.strictEqual(yield* handle.evaluate((object) => object.identity), 42)
          assert.strictEqual(
            yield* Fiber.join(running),
            yield* page.evaluateInMainWorld(() => (window as unknown as { token: string }).token)
          )
          assert.strictEqual((yield* page.frames).children[0]!.id, subtree.children[0]!.id)
          assert.strictEqual((yield* speculative.closed)._tag, "PrerenderActivated")
          assert.strictEqual((yield* Deferred.await(previousDocument.ended))._tag, "DocumentReplaced")
          assert.isTrue(Option.isNone(Handles.page(page).runtime.model.document(previous.document.id)))
          const gone = yield* Effect.flip(oldHandle.read)
          assert(Target.isTargetGone(gone))
          assert.isTrue(Exit.isFailure(yield* Fiber.join(oldRunning).pipe(Deadline.within("1 second"))))
          assert.isUndefined(tabEnd.pollUnsafe())
          yield* Fiber.join(streamEnd).pipe(Deadline.within("1 second"))
          const output = yield* ConsoleMessage.next(page)
          yield* handle.evaluate(() => {
            console.log("transferred realm")
          })
          assert.strictEqual((yield* output).text, "transferred realm")
          assert.isTrue(yield* handle.evaluate(() => confirm("the original tab handler survives")))
          assert.isTrue(yield* Deferred.isDone(decided))
          assert.strictEqual(yield* speculativeHandler.handled, 0)
          assert.strictEqual(page.pageKind, "tab")
          assert.strictEqual(speculative.pageKind, "prerender")
          yield* page.goto(`${origin}/after`, { waitUntil: "load" })
          assert.strictEqual(yield* page.evaluateInMainWorld(() => (window as unknown as { seed: number }).seed), 123)
          assert(Target.isTargetGone(yield* Effect.flip(handle.read)))
        })),
      60_000
    )

    it.effect("does not relabel a command navigation that replaces an available prerender", () =>
      Effect.scoped(Effect.gen(function*() {
        const { origin } = yield* serve
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/idle`, { waitUntil: "load" })
        yield* page.evaluateInMainWorld(() => {
          const rules = document.createElement("script")
          rules.type = "speculationrules"
          rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/transfer"] }] })
          document.head.append(rules)
        })
        const pages = yield* page.context.pages.waitFor((pages) => pages.some((page) => page.pageKind === "prerender"))
          .pipe(Deadline.within("10 seconds"))
        const speculative = pages.find((page) => page.pageKind === "prerender")!
        const before = yield* speculative.status.waitFor((status) =>
          status._tag === "Open" && status.document.readiness === "complete"
        )
          .pipe(Deadline.within("10 seconds"))
        assert(before._tag === "Open")
        const navigation = yield* page.goto(`${origin}/transfer`, { waitUntil: "load" })
        assert.strictEqual(navigation._tag, "Committed")
        assert(navigation._tag === "Committed")
        assert.notStrictEqual(navigation.document, before.document.id)
        assert.strictEqual(
          yield* page.evaluateInMainWorld(() =>
            (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & { activationStart: number })
              .activationStart
          ),
          0
        )
      })))

    it.effect("correlates identical prerender URLs through their own tab parents", () =>
      Effect.scoped(Effect.gen(function*() {
        const { origin } = yield* serve
        const context = yield* Browser.newContext()
        const first = yield* context.newPage
        const second = yield* context.newPage
        const prepare = Effect.fnUntraced(function*(tab: typeof first) {
          yield* tab.goto(`${origin}/idle`, { waitUntil: "load" })
          const known = (yield* context.pages).map((page) => page.id)
          yield* tab.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/transfer"] }] })
            document.head.append(rules)
          })
          const pages = yield* context.pages.waitFor((pages) =>
            pages.some((page) => page.pageKind === "prerender" && !known.includes(page.id))
          )
            .pipe(Deadline.within("10 seconds"))
          const speculative = yield* pages.find((page) => page.pageKind === "prerender" && !known.includes(page.id))!
            .control
          const before = yield* speculative.status.waitFor((status) =>
            status._tag === "Open" && status.document.readiness === "complete"
          )
            .pipe(Deadline.within("10 seconds"))
          assert(before._tag === "Open")
          const handle = yield* speculative.evaluateHandle(() => ({ value: crypto.randomUUID() }))
          return { speculative, document: before.document.id, handle }
        })
        const a = yield* prepare(first)
        const b = yield* prepare(second)
        const secondBefore = yield* second.status
        assert(secondBefore._tag === "Open")
        const navigationA = yield* PageNavigation.next(first)
        yield* first.evaluateInMainWorld(() => {
          location.href = "/transfer"
        })
        const outcomeA = yield* navigationA
        assert(outcomeA._tag === "Activated")
        assert.strictEqual(outcomeA.document, a.document)
        const unchanged = yield* second.status
        assert(unchanged._tag === "Open")
        assert.strictEqual(unchanged.document.id, secondBefore.document.id)
        assert.isTrue(
          yield* b.speculative.evaluateInMainWorld(() =>
            (document as Document & { prerendering: boolean }).prerendering
          )
        )
        const navigationB = yield* PageNavigation.next(second)
        yield* second.evaluateInMainWorld(() => {
          location.href = "/transfer"
        })
        const outcomeB = yield* navigationB
        assert(outcomeB._tag === "Activated")
        assert.strictEqual(outcomeB.document, b.document)
        assert.notStrictEqual(a.document, b.document)
        assert.isString(yield* a.handle.evaluate((object) => object.value))
        assert.isString(yield* b.handle.evaluate((object) => object.value))
        const stillFirst = yield* first.status
        assert(stillFirst._tag === "Open")
        assert.strictEqual(stillFirst.document.id, a.document)
      })))

    it.effect("activates in the original public tab", () =>
      Effect.scoped(Effect.gen(function*() {
        assertPinned("Chromium", (yield* Browser.Browser).info.version, chromium.version)
        const { origin } = yield* serve
        const page = yield* Browser.newPage()
        yield* page.goto(`${origin}/start`)
        yield* page.status.waitFor((status) =>
          status._tag === "Open" && status.url === `${origin}/prerendered` && status.document.readiness === "complete"
        ).pipe(Deadline.within("10 seconds"))
        const activationStart = yield* page.evaluateInMainWorld(() =>
          (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming & { activationStart: number })
            .activationStart
        )
        assert.isAbove(activationStart, 0, "the public path must activate its prerender")
      })))
  })

  for (const featureSwitch of ["--disable-features=Other", "--disable-features"]) {
    const replacedFeatures = Chromium.layer({
      executablePath: chromium.executable,
      args: [featureSwitch]
    }).pipe(Layer.provide(NodeServices.layer))
    layer(replacedFeatures, { excludeTestServices: true, timeout: 60_000 })((it) => {
      it.effect(`keeps the caller's ${featureSwitch} replacement and refuses transfer support`, () =>
        Effect.scoped(Effect.gen(function*() {
          assert.isFalse((yield* (yield* Browser.Browser).capabilities).has("prerender.activation"))
          const { origin, requests } = yield* serve
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/idle`)
          const intercepted = yield* Deferred.make<void>()
          yield* page.context.route(`${origin}/speculative`, () =>
            Deferred.succeed(intercepted, undefined).pipe(
              Effect.andThen(Route.continueWith(HttpClientRequest.setHeader("x-speculative", "declared")))
            ))
          yield* Handles.page(page).runtime.model.adapter.declare(
            { _tag: "UserContext", context: page.context.id },
            { _tag: "Override", override: { _tag: "ExtraHeaders", headers: { "x-extra": "configured" } } }
          ).pipe(Operation.named("Test.replacedSpeculativeHeaders"))
          yield* page.evaluateInMainWorld(() => {
            const rules = document.createElement("script")
            rules.type = "speculationrules"
            rules.textContent = JSON.stringify({ prerender: [{ source: "list", urls: ["/speculative"] }] })
            document.head.append(rules)
          })
          for (let attempt = 0; attempt < 200; attempt++) {
            const request = requests.find((request) => request.url === "/speculative")
            if (request !== undefined) {
              assert.include(request.purpose, "prerender")
              assert.isUndefined(request.extra, "the caller restored Chromium's uncovered prefetch path")
              assert.isUndefined(request.header)
              assert.isFalse(yield* Deferred.isDone(intercepted))
              assert.strictEqual(yield* page.url, `${origin}/idle`)
              return
            }
            yield* Effect.sleep("50 millis")
          }
          assert.fail("the speculative control request did not reach the server")
        })))
    })
  }
})
