/**
 * The adapter conformance suite (review 08, candidate 13): one set of tests, written against the adapter
 * contract and the facts, run against every backend with a local site. A behavior a backend lacks is asserted
 * as `Unsupported`, never skipped silently.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import type * as Target from "../../../src/Target.ts"
import { type Backend, json, makeRecorder, type Recorder, type Site, site } from "./harness.ts"

const timeout = 60_000

/** A connected adapter, its facts and the site. */
interface World {
  readonly adapter: Adapter.AdapterConnection
  readonly facts: Recorder
  readonly site: Site
}

const setup = Effect.fnUntraced(function*(backend: Backend) {
  const served = yield* site
  const facts = makeRecorder()
  const adapter = yield* backend.connect(facts.sink)
  return { adapter, facts, site: served } satisfies World
})

/** The realm of a page's current document in a world, waiting for it if it isn't there yet. */
const mainRealm = Effect.fnUntraced(function*(world: World, navigable: Target.NavigableId) {
  const committed = world.facts.all("DocumentCommitted").filter((fact) => fact.navigable === navigable).at(-1)
  assert.isDefined(committed, `no document committed in ${navigable}`)
  // A main-world realm created for the document, or the initial about:blank's, which it reused (probe 2)
  const isMain = (realm: Target.RealmId) =>
    world.facts.all("RealmAdded").some((fact) =>
      fact.realm === realm && fact.kind._tag === "Window" && fact.kind.world._tag === "Main"
    )
  const found = yield* world.facts.next((
    fact
  ): fact is Extract<Adapter.Fact, { _tag: "RealmAdded" | "RealmDocumentAdded" }> =>
    (fact._tag === "RealmAdded" && fact.kind._tag === "Window" && fact.kind.document === committed.document &&
      fact.kind.world._tag === "Main") ||
    (fact._tag === "RealmDocumentAdded" && fact.document === committed.document && isMain(fact.realm))
  )
  return found.realm
})

/** Evaluates a function in a page's main world and returns its result as JSON. */
const evaluate = Effect.fnUntraced(function*(
  world: World,
  navigable: Target.NavigableId,
  functionDeclaration: string,
  userActivation = false
) {
  const realm = yield* mainRealm(world, navigable)
  const result = yield* world.adapter.evaluate(realm, {
    functionDeclaration,
    arguments: [],
    awaitPromise: true,
    result: "value",
    userActivation
  })
  assert(result._tag === "Value", `evaluation threw: ${result._tag === "Exception" ? result.text : ""}`)
  return json(result.value)
})

/** Navigates and waits for the navigation's outcome. */
const goto = Effect.fnUntraced(function*(world: World, navigable: Target.NavigableId, url: string) {
  const navigation = yield* world.adapter.navigate(navigable, url, { referrer: Option.none() })
  const ended = yield* world.facts.when("NavigationEnded", (fact) => fact.navigation === navigation)
  return { navigation, outcome: ended.outcome }
})

const newPage = Effect.fnUntraced(function*(world: World) {
  const context = yield* world.adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
  const page = yield* world.adapter.createPage(context)
  return { context, page }
})

/** Registers the conformance suite for a backend. */
export const conformance = (backend: Backend) =>
  describe.skipIf(backend.skip)(`${backend.name} adapter`, () => {
    // The real clock: these tests wait on a real browser.
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        it.effect("connects: the browser, its default context and its capabilities", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            assert.include(["cdp", "bidi", "webkit"], world.adapter.info.protocol)
            const added = yield* world.facts.when("UserContextAdded", (fact) => fact.isDefault)
            assert.strictEqual(added.context, world.adapter.defaultContext)
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            assert.isTrue(capabilities.has("userContexts"))
          }), timeout)

        it.effect("creates a page: added, its initial document, then ready", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const added = yield* world.facts.when("PageAdded", (fact) => fact.page === page)
            assert.strictEqual(added.context, context)
            assert.deepStrictEqual(added.origin, { _tag: "Created" })
            const initial = yield* world.facts.when("DocumentCommitted", (fact) => fact.navigable === page)
            assert.strictEqual(initial.url, "about:blank")
            assert.strictEqual(initial.createdBy._tag, "InitialBlank")
            yield* world.facts.when("PageReady", (fact) => fact.page === page)
          }), timeout)

        it.effect("navigates: started, request and response, committed, realm, readiness", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const url = `${world.site.origin}/hello`
            const { navigation, outcome } = yield* goto(world, page, url)
            const started = yield* world.facts.when("NavigationStarted", (fact) => fact.navigation === navigation)
            assert.strictEqual(started.navigable, page)
            assert.strictEqual(started.initiatedAs, "crossDocument")
            assert(outcome._tag === "Committed", `outcome ${outcome._tag}`)
            const committed = yield* world.facts.when("DocumentCommitted", (fact) => fact.document === outcome.document)
            assert.strictEqual(committed.url, url)
            assert.deepStrictEqual(committed.createdBy, { _tag: "Navigation", navigation })
            assert(Option.isSome(outcome.response), "the document's response")
            const response = yield* world.facts.when(
              "ResponseReceived",
              (fact) => fact.response.hop === outcome.response.pipe(Option.getOrThrow)
            )
            assert.strictEqual(response.response.status, 200)
            const request = yield* world.facts.when("RequestSent", (fact) => fact.request.hop === response.response.hop)
            assert.strictEqual(request.request.resourceType, "document")
            assert.deepInclude(request.request.initiator, { _tag: "Document", navigable: page })
            yield* world.facts.when(
              "DocumentReadiness",
              (fact) => fact.document === outcome.document && fact.readiness === "complete"
            )
            assert.strictEqual(yield* evaluate(world, page, "() => document.title"), "/hello")
          }), timeout)

        it.effect("reports same-document navigations with the document they changed", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const { outcome } = yield* goto(world, page, `${world.site.origin}/hello`)
            assert(outcome._tag === "Committed")
            yield* evaluate(world, page, "() => { location.hash = 'there' }")
            const changed = yield* world.facts.when("DocumentUrlChanged", (fact) => fact.document === outcome.document)
            assert.strictEqual(changed.url, `${world.site.origin}/hello#there`)
            assert.strictEqual(changed.via, "fragment")
            const ended = yield* world.facts.when("NavigationEnded", (fact) => fact.navigation === changed.navigation)
            assert.deepStrictEqual(ended.outcome, { _tag: "SameDocument", document: outcome.document, via: "fragment" })
            yield* evaluate(world, page, "() => history.pushState({}, '', '/pushed')")
            const pushed = yield* world.facts.when("DocumentUrlChanged", (fact) => fact.via === "historyApi")
            assert.strictEqual(pushed.url, `${world.site.origin}/pushed`)
          }), timeout)

        it.effect("reports navigations that keep the old document: no content, failure", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const noContent = yield* goto(world, page, `${world.site.origin}/204`)
            assert.deepStrictEqual(noContent.outcome, { _tag: "NoContent", status: 204 })
            const refused = yield* goto(world, page, "http://127.0.0.1:9/refused")
            assert.strictEqual(refused.outcome._tag, "Failed")
          }), timeout)

        it.effect("follows a redirect as hops of one request", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const { outcome } = yield* goto(world, page, `${world.site.origin}/redirect`)
            assert(outcome._tag === "Committed")
            const committed = yield* world.facts.when("DocumentCommitted", (fact) => fact.document === outcome.document)
            assert.strictEqual(committed.url, `${world.site.origin}/landed`)
            const hop = Option.getOrThrow(outcome.response)
            assert.match(hop, /\.1$/, "the second hop")
            const first = yield* world.facts.when(
              "ResponseReceived",
              (fact) => fact.response.hop === hop.replace(/\.1$/, ".0")
            )
            assert.strictEqual(first.response.status, 302)
          }), timeout)

        it.effect("tracks frames, in process and out, and ends the children of a replaced document", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/frames`)
            const frames = yield* Effect.all([
              world.facts.when("FrameAdded", (fact) =>
                fact.parent === page),
              world.facts.next((fact): fact is Extract<Adapter.Fact, { _tag: "FrameAdded" }> =>
                fact._tag === "FrameAdded" && fact.parent === page &&
                world.facts.all("FrameAdded").filter((other) => other.parent === page).indexOf(fact) === 1
              )
            ])
            for (const frame of frames) {
              const committed = yield* world.facts.when(
                "DocumentCommitted",
                (fact) => fact.navigable === frame.frame && fact.url.endsWith("/child")
              )
              yield* world.facts.when(
                "RealmAdded",
                (fact) => fact.kind._tag === "Window" && fact.kind.document === committed.document
              )
            }
            const urls = frames.map((frame) =>
              world.facts.all("DocumentCommitted").filter((fact) => fact.navigable === frame.frame).at(-1)!.url
            )
            assert.sameMembers(urls, [`${world.site.origin}/child`, `${world.site.crossSite}/child`])
            // The cross-site frame is evaluated in its own process
            const crossSite = frames[urls.indexOf(`${world.site.crossSite}/child`)]!.frame
            assert.strictEqual(
              yield* evaluate(world, crossSite, "() => location.host"),
              new URL(world.site.crossSite).host
            )
            yield* evaluate(world, page, "() => document.querySelector('iframe').remove()")
            const removed = yield* world.facts.when(
              "NavigableRemoved",
              (fact) => frames.some((frame) => frame.frame === fact.navigable)
            )
            assert.deepStrictEqual(removed.reason, { _tag: "FrameDetached" })
            yield* goto(world, page, `${world.site.origin}/hello`)
            for (const frame of frames) {
              yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === frame.frame)
            }
          }), timeout)

        it.effect("runs init scripts before author scripts, in pages and their popups", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "InitScript",
              source: "window.fromInit = 'yes'",
              world: { _tag: "Main" },
              phase: "user",
              timing: "beforeAuthorScript"
            })
            yield* goto(world, page, `${world.site.origin}/init`)
            assert.strictEqual(yield* evaluate(world, page, "() => window.seenByAuthor"), "string")
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            if (!capabilities.has("pauseOnStart.popups")) {
              return
            }
            yield* evaluate(world, page, `() => { window.open("/init") }`, true)
            const popup = yield* world.facts.when("PageAdded", (fact) =>
              fact.origin._tag === "Opened")
            assert.deepStrictEqual(popup.origin, { _tag: "Opened", opener: Option.some(page) })
            assert.strictEqual(popup.kind, "popup")
            yield* world.facts.when("PageReady", (fact) =>
              fact.page === popup.page)
            yield* world.facts.when("DocumentCommitted", (fact) =>
              fact.navigable === popup.page && fact.url.endsWith("/init"))
            yield* world.facts.when("DocumentReadiness", (fact) =>
              world.facts.all("DocumentCommitted").some((committed) =>
                committed.document === fact.document && committed.navigable === popup.page &&
                committed.url.endsWith("/init")
              ) && fact.readiness === "complete")
            assert.strictEqual(yield* evaluate(world, popup.page, "() => window.seenByAuthor"), "string")
          }), timeout)

        it.effect("evaluates: values, exceptions, handles and nodes", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/form`)
            assert.deepStrictEqual(
              yield* evaluate(
                world,
                page,
                "() => [1, 'two', NaN, null, undefined, true, { a: [1, 2] }, new Map([['k', 3]])]"
              ),
              [1, "two", NaN, null, undefined, true, { a: [1, 2] }, { k: 3 }]
            )
            assert.strictEqual(yield* evaluate(world, page, "async () => { await null; return 7 }"), 7)
            const realm = yield* mainRealm(world, page)
            const thrown = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "() => { throw new RangeError('out of range') }",
              arguments: [],
              awaitPromise: true,
              result: "value",
              userActivation: false
            })
            assert(thrown._tag === "Exception")
            assert.include(thrown.text, "out of range")
            const node = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "() => document.querySelector('#f')",
              arguments: [],
              awaitPromise: false,
              result: "value",
              userActivation: false
            })
            assert(node._tag === "Value" && node.value.type === "node")
            assert.isDefined(node.value.node, "a node binding")
            const handle = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "() => ({ count: 41 })",
              arguments: [],
              awaitPromise: false,
              result: "handle",
              userActivation: false
            })
            assert(handle._tag === "Value" && handle.value.type === "object" && handle.value.handle !== undefined)
            const incremented = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "(object, by) => object.count + by",
              arguments: [{ _tag: "Handle", handle: handle.value.handle }, {
                _tag: "Value",
                value: { type: "number", value: 1 }
              }],
              awaitPromise: false,
              result: "value",
              userActivation: false
            })
            assert.deepStrictEqual(incremented, { _tag: "Value", value: { type: "number", value: 42 } })
            yield* world.adapter.releaseHandles([handle.value.handle])
            assert.isFalse(yield* evaluate(world, page, "() => navigator.userActivation.hasBeenActive"))
            yield* evaluate(world, page, "() => 1", true)
            assert.isTrue(yield* evaluate(world, page, "() => navigator.userActivation.hasBeenActive"))
          }), timeout)

        it.effect("dispatches input: a click and typing", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/form`)
            const box = (yield* evaluate(
              world,
              page,
              "() => { const r = document.querySelector('#b').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }"
            )) as [number, number]
            const none = { alt: false, control: false, meta: false, shift: false }
            yield* world.adapter.dispatchInput(page, [
              { _tag: "Mouse", type: "move", x: box[0], y: box[1], button: "none", clickCount: 0, modifiers: none },
              { _tag: "Mouse", type: "down", x: box[0], y: box[1], button: "left", clickCount: 1, modifiers: none },
              { _tag: "Mouse", type: "up", x: box[0], y: box[1], button: "left", clickCount: 1, modifiers: none }
            ])
            assert.strictEqual(yield* evaluate(world, page, "() => window.clicked"), 1)
            yield* evaluate(world, page, "() => document.querySelector('#t').focus()")
            yield* world.adapter.dispatchInput(page, [
              {
                _tag: "Key",
                type: "down",
                key: "h",
                code: "KeyH",
                text: Option.some("h"),
                modifiers: none,
                autoRepeat: false
              },
              {
                _tag: "Key",
                type: "up",
                key: "h",
                code: "KeyH",
                text: Option.none(),
                modifiers: none,
                autoRepeat: false
              },
              { _tag: "InsertText", text: "éllo" }
            ])
            assert.strictEqual(yield* evaluate(world, page, "() => document.querySelector('#t').value"), "héllo")
          }), timeout)

        it.effect("delivers a prompt as an obligation that takes one decision", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const realm = yield* mainRealm(world, page)
            const answer = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "() => prompt('Name?', 'anon')",
              arguments: [],
              awaitPromise: true,
              result: "value",
              userActivation: false
            }).pipe(Effect.forkChild)
            const opened = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "Prompt")
            assert.deepInclude(opened.subject, { kind: "prompt", message: "Name?", defaultValue: "anon", page })
            yield* world.adapter.resolve(opened.obligation, { _tag: "Accept", promptText: Option.some("Strider") })
            const result = yield* Fiber.join(answer)
            assert(result._tag === "Value")
            assert.deepStrictEqual(result.value, { type: "string", value: "Strider" })
            const closed = yield* world.facts.when("PromptClosed")
            assert.isTrue(closed.accepted)
            yield* world.facts.when("ObligationEnded", (fact) => fact.obligation === opened.obligation)
          }), timeout)

        it.effect("intercepts requests: fulfill, fail, continue with new headers", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "Intercept",
              patterns: [`${world.site.origin}/json*`, `${world.site.origin}/headers*`],
              phases: ["request"]
            })
            const fulfilled = yield* evaluate(world, page, "() => fetch('/json').then((r) => r.text())").pipe(
              Effect.forkChild
            )
            const first = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "PausedRequest")
            assert(first.subject._tag === "PausedRequest")
            assert.strictEqual(first.subject.request.url, `${world.site.origin}/json`)
            yield* world.adapter.resolve(first.obligation, {
              _tag: "Fulfill",
              status: 200,
              headers: { "content-type": "text/plain" },
              body: new TextEncoder().encode("from the route")
            })
            assert.strictEqual(yield* Fiber.join(fulfilled), "from the route")
            const failed = yield* evaluate(world, page, "() => fetch('/json').then(() => 'ok', () => 'failed')").pipe(
              Effect.forkChild
            )
            const second = yield* world.facts.when("ObligationOpened", (fact) =>
              fact.subject._tag === "PausedRequest" && fact.obligation !== first.obligation)
            yield* world.adapter.resolve(second.obligation, { _tag: "Fail", error: "failed" })
            assert.strictEqual(yield* Fiber.join(failed), "failed")
            const continued = yield* evaluate(world, page, "() => fetch('/headers').then((r) => r.json())").pipe(
              Effect.forkChild
            )
            const third = yield* world.facts.when("ObligationOpened", (fact) =>
              fact.subject._tag === "PausedRequest" && fact.subject.request.url.endsWith("/headers"))
            yield* world.adapter.resolve(third.obligation, {
              _tag: "Continue",
              overrides: Option.some({ headers: { "x-strider": "continued" } })
            })
            const headers = yield* Fiber.join(continued)
            assert.deepInclude(headers as object, { "x-strider": "continued" })
          }), timeout)

        it.effect("applies overrides to pages in scope, and restores them when released", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const scope = { _tag: "UserContext", context } as const
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare(scope, {
                _tag: "Override",
                override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
              })
              yield* world.adapter.declare(scope, {
                _tag: "Override",
                override: { _tag: "TimeZone", timeZone: "Asia/Tokyo" }
              })
              yield* world.adapter.declare(scope, { _tag: "Override", override: { _tag: "Locale", locale: "de-DE" } })
              yield* world.adapter.declare(scope, {
                _tag: "Override",
                override: { _tag: "Media", media: Option.none(), features: { "prefers-color-scheme": "dark" } }
              })
              yield* world.adapter.declare(scope, {
                _tag: "Override",
                override: { _tag: "ExtraHeaders", headers: { "x-extra": "1" } }
              })
              assert.deepStrictEqual(
                yield* evaluate(
                  world,
                  page,
                  "() => [innerWidth, Intl.DateTimeFormat().resolvedOptions().timeZone, new Intl.NumberFormat().resolvedOptions().locale, matchMedia('(prefers-color-scheme: dark)').matches]"
                ),
                [640, "Asia/Tokyo", "de-DE", true]
              )
              const headers = yield* evaluate(world, page, "() => fetch('/headers').then((r) => r.json())")
              assert.deepInclude(headers as object, { "x-extra": "1" })
              yield* world.adapter.declare({ _tag: "Page", page }, {
                _tag: "Override",
                override: { _tag: "Offline", offline: true }
              })
              assert.deepStrictEqual(
                yield* evaluate(
                  world,
                  page,
                  "() => fetch('/json').then(() => [navigator.onLine, 'ok'], () => [navigator.onLine, 'failed'])"
                ),
                [false, "failed"]
              )
            }))
            assert.notStrictEqual(yield* evaluate(world, page, "() => innerWidth"), 640)
            assert.isTrue(yield* evaluate(world, page, "() => navigator.onLine"))
          }), timeout)

        it.effect("reports console messages and uncaught exceptions", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/console`)
            const hello = yield* world.facts.when("ConsoleMessage", (fact) => fact.message.text === "hello 42")
            assert.strictEqual(hello.message.level, "log")
            assert.deepStrictEqual(hello.message.origin, { _tag: "Page", page })
            const bad = yield* world.facts.when("ConsoleMessage", (fact) => fact.message.text === "bad")
            assert.strictEqual(bad.message.level, "error")
            const thrown = yield* world.facts.when("UncaughtException")
            assert.strictEqual(thrown.exception.name, "TypeError")
            assert.strictEqual(thrown.exception.message, "thrown here")
          }), timeout)

        it.effect("captures screenshots and PDFs, and reads response bodies", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const { outcome } = yield* goto(world, page, `${world.site.origin}/json`)
            assert(outcome._tag === "Committed")
            const body = yield* world.adapter.responseBody(Option.getOrThrow(outcome.response))
            assert.strictEqual(new TextDecoder().decode(body), `{"hello":"world"}`)
            const png = yield* world.adapter.screenshot(page, {
              format: "png",
              quality: Option.none(),
              clip: Option.none(),
              fullPage: false
            })
            assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47])
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            if (!capabilities.has("pdf")) return
            const pdf = yield* world.adapter.pdf(page, {
              landscape: false,
              printBackground: false,
              scale: 1,
              paperWidth: 8.5,
              paperHeight: 11,
              margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
              pageRanges: Option.none()
            })
            assert.strictEqual(new TextDecoder().decode(pdf.subarray(0, 5)), "%PDF-")
          }), timeout)

        it.effect("reads, sets and clears cookies, and grants permissions, per context", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/cookie`)
            const cookies = yield* world.adapter.cookies(context)
            const flavor = cookies.find((cookie) => cookie.name === "flavor")
            assert.isDefined(flavor)
            assert.strictEqual(Redacted.value(flavor.value), "oat")
            yield* world.adapter.setCookies(context, [{
              ...flavor,
              name: "set",
              value: Redacted.make("by-strider")
            }])
            assert.include(yield* evaluate(world, page, "() => document.cookie"), "set=by-strider")
            const other = yield* world.adapter.createUserContext({ proxy: Option.none(), acceptInsecureCerts: false })
            assert.isEmpty(yield* world.adapter.cookies(other))
            yield* world.adapter.clearCookies(context)
            assert.isEmpty(yield* world.adapter.cookies(context))
            yield* world.adapter.grantPermissions(context, Option.some(world.site.origin), ["geolocation"])
            assert.strictEqual(
              yield* evaluate(
                world,
                page,
                "() => navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)"
              ),
              "granted"
            )
          }), timeout)

        it.effect("delivers a file chooser as an obligation, and sets its files", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* world.adapter.declare({ _tag: "Page", page }, { _tag: "FileChooser" })
            yield* goto(world, page, `${world.site.origin}/form`)
            yield* evaluate(world, page, "() => document.querySelector('#f').click()", true)
            const opened = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "FileChooser")
            assert(opened.subject._tag === "FileChooser")
            assert.isTrue(opened.subject.multiple)
            yield* world.adapter.resolve(opened.obligation, { _tag: "SetFiles", files: [import.meta.filename] })
            assert.strictEqual(
              yield* evaluate(world, page, "() => document.querySelector('#f').files[0].name"),
              "conformance.ts"
            )
          }), timeout)

        it.effect("allows downloads to a directory and reports them", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const directory = (yield* Effect.promise(() => import("node:os"))).tmpdir() +
              `/strider-downloads-${process.pid}`
            yield* world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "Downloads",
              behavior: { _tag: "Allow", directory }
            })
            yield* goto(world, page, `${world.site.origin}/hello`)
            const { outcome } = yield* goto(world, page, `${world.site.origin}/download`)
            assert.strictEqual(outcome._tag, "Download")
            const started = yield* world.facts.when("DownloadStarted")
            assert.strictEqual(started.suggestedFilename, "hello.txt")
            const ended = yield* world.facts.when("DownloadEnded", (fact) => fact.download === started.download)
            assert(ended.outcome._tag === "Completed")
            const path = Option.getOrThrow(ended.outcome.path)
            const fs = yield* Effect.promise(() => import("node:fs/promises"))
            assert.strictEqual(yield* Effect.promise(() => fs.readFile(path, "utf8")), "hello, download")
          }), timeout)

        it.effect("reports workers as realms, with their console", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/worker`)
            const realm = yield* world.facts.when("RealmAdded", (fact) => fact.kind._tag === "Worker")
            assert(realm.kind._tag === "Worker")
            assert.deepStrictEqual(realm.kind.worker, { _tag: "Dedicated", owner: Option.none() })
            const message = yield* world.facts.when("ConsoleMessage", (fact) => fact.message.text === "from the worker")
            assert.strictEqual(message.realm, realm.realm)
          }), timeout)

        it.effect("reports a WebSocket's frames", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/socket`)
            const opened = yield* world.facts.when("ConnectionOpened")
            assert.strictEqual(opened.kind, "webSocket")
            const sent = yield* world.facts.when("ConnectionFrame", (fact) => fact.frame.direction === "sent")
            assert.deepStrictEqual(sent.frame.payload, { _tag: "Text", text: "ping" })
            yield* world.facts.when("ConnectionFrame", (fact) => fact.frame.direction === "received")
            yield* world.facts.when("ConnectionClosed", (fact) => fact.connection === opened.connection)
          }), timeout)

        it.effect("closes pages and removes contexts, with the reason", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* world.adapter.closePage(page, { runBeforeUnload: false })
            const removed = yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            assert.deepStrictEqual(removed.reason, { _tag: "PageClosed", by: "command" })
            const second = yield* world.adapter.createPage(context)
            yield* world.adapter.removeUserContext(context)
            const gone = yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === second)
            assert.deepStrictEqual(gone.reason, { _tag: "PageClosed", by: "userContextRemoved" })
            yield* world.facts.when("UserContextRemoved", (fact) => fact.context === context)
          }), timeout)

        it.effect("asks before closing a page with a beforeunload handler, when told to", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/beforeunload`)
            yield* evaluate(world, page, "() => 1", true)
            yield* world.adapter.closePage(page, { runBeforeUnload: true })
            const opened = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "Prompt")
            assert.deepInclude(opened.subject, { kind: "beforeunload" })
            yield* world.adapter.resolve(opened.obligation, { _tag: "Dismiss" })
            yield* world.facts.when("PromptClosed")
            // Dismissed, so the page stays
            assert.strictEqual(yield* evaluate(world, page, "() => document.title"), "beforeunload")
          }), timeout)
      }
    )
  })

export type { Backend }
