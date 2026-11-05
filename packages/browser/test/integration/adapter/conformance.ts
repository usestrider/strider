/**
 * The adapter conformance suite: one set of tests, written against the adapter
 * contract and the facts, run against every backend with a local site. A behavior a backend lacks is asserted
 * as `Unsupported`, never skipped silently.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, layer } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Adapter from "../../../src/internal/adapter.ts"
import type * as PageNavigation from "../../../src/PageNavigation.ts"
import * as Target from "../../../src/Target.ts"
import { type Backend, json, makeRecorder, type Recorder, type Site, site, tlsSite } from "./harness.ts"

const timeout = 60_000

/** A connected adapter, its facts and the site. */
interface World {
  readonly adapter: Adapter.AdapterConnection
  readonly kill: Effect.Effect<void>
  readonly facts: Recorder
  readonly site: Site
}

const setup = Effect.fnUntraced(function*(backend: Backend) {
  const served = yield* site
  const facts = makeRecorder()
  const { adapter, kill } = yield* backend.connect(facts.sink)
  return { adapter, kill, facts, site: served } satisfies World
})

/** Whether the backend has a capability, in full or in part. One it lacks says so in its table. */
const supports = Effect.fnUntraced(function*(world: World, name: string) {
  const entry = (yield* SubscriptionRef.get(world.adapter.capabilities)).entries.find((each) => each.name === name)
  assert.isDefined(entry, `${name} is in the capability table`)
  return entry.status !== "unsupported"
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
  describe(`${backend.name} adapter`, () => {
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
            // The browser's own first tab is adopted into the default context, which exists before it
            const adopted = yield* world.facts.when("PageAdded", (fact) => fact.origin._tag === "Adopted")
            assert.strictEqual(adopted.context, world.adapter.defaultContext)
            assert.isFalse(world.facts.all("UserContextAdded").some((fact) => !fact.isDefault))
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
            if (!(yield* supports(world, "navigation.sameDocument"))) return
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
            assert(noContent.outcome._tag === "NoContent", String(noContent.outcome._tag))
            assert.strictEqual(noContent.outcome.status, 204)
            // The response's hop, which a goto that accepts no content returns
            assert(Option.isSome(noContent.outcome.response), "the 204's hop")
            const refused = yield* goto(world, page, "http://127.0.0.1:9/refused")
            assert.strictEqual(refused.outcome._tag, "Failed")
          }), timeout)

        it.effect("navigates again at once after a failure: the error page doesn't replace the next navigation", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const refused = yield* goto(world, page, "http://127.0.0.1:9/refused")
            assert.strictEqual(refused.outcome._tag, "Failed")
            const next = yield* goto(world, page, `${world.site.origin}/hello`)
            const navigations = world.facts.facts.filter((fact) =>
              fact._tag === "NavigationStarted" || fact._tag === "NavigationEnded" || fact._tag === "DocumentCommitted"
            )
            assert.strictEqual(next.outcome._tag, "Committed", JSON.stringify(navigations, null, 1))
            // An error page is the failed navigation's document, never a navigation of its own
            const started = world.facts.all("NavigationStarted").filter((fact) =>
              fact.navigable === page
            )
            assert.deepStrictEqual(
              started.map((fact) => fact.navigation),
              [refused.navigation, next.navigation],
              JSON.stringify(started)
            )
            for (const committed of world.facts.all("DocumentCommitted")) {
              if (committed.createdBy._tag === "ErrorPage") {
                assert.strictEqual(committed.createdBy.navigation, refused.navigation)
              }
            }
          }), timeout)

        it.effect("fails a navigation to a site whose certificate isn't trusted, at the URL it was going to", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const { origin } = yield* tlsSite
            const url = `${origin}/secure`
            const { navigation, outcome } = yield* goto(world, page, url)
            const started = world.facts.all("NavigationStarted").find((fact) =>
              fact.navigation === navigation
            )
            // Where it was going, never an error page's own URL (QUIRKS.md, Q2)
            assert.strictEqual(started?.url, url, JSON.stringify(started))
            assert.strictEqual(outcome._tag, "Failed", JSON.stringify(outcome))
          }), timeout)

        it.effect("reloads, and moves through history: back, forward, and nowhere past the end", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const first = yield* goto(world, page, `${world.site.origin}/hello`)
            assert(first.outcome._tag === "Committed")
            yield* goto(world, page, `${world.site.origin}/json`)
            const ended = Effect.fnUntraced(function*(navigation: PageNavigation.Id, initiatedAs: Adapter.InitiatedAs) {
              const started = yield* world.facts.when("NavigationStarted", (fact) =>
                fact.navigation === navigation)
              assert.strictEqual(started.initiatedAs, initiatedAs)
              return yield* world.facts.when("NavigationEnded", (fact) =>
                fact.navigation === navigation)
            })
            const urlOf = (outcome: Adapter.NavigationOutcome) => {
              assert(
                outcome._tag === "Committed" || outcome._tag === "Restored",
                `a history navigation commits or restores, not ${outcome._tag}`
              )
              return world.facts.all("DocumentCommitted").find((fact) =>
                fact.document === outcome.document
              )?.url
            }
            if (yield* supports(world, "navigation.traverse")) {
              const back = yield* world.adapter.traverse(page, -1)
              assert(Option.isSome(back), "there is an entry before")
              const backOutcome = (yield* ended(back.value, "traversal")).outcome
              assert.strictEqual(urlOf(backOutcome), `${world.site.origin}/hello`)
              const forward = yield* world.adapter.traverse(page, 1)
              assert(Option.isSome(forward), "there is an entry after")
              assert.strictEqual(
                urlOf((yield* ended(forward.value, "traversal")).outcome),
                `${world.site.origin}/json`
              )
              assert.isTrue(Option.isNone(yield* world.adapter.traverse(page, 1)), "nothing after the last entry")
            } else {
              const refused = yield* Effect.flip(world.adapter.traverse(page, -1))
              assert.deepInclude(refused.reason, { _tag: "Unsupported", capability: "navigation.traverse" })
            }
            const reload = yield* world.adapter.reload(page, { ignoreCache: false })
            const reloaded = (yield* ended(reload, "reload")).outcome
            assert(reloaded._tag === "Committed", `a reload commits, not ${reloaded._tag}`)
            assert.strictEqual(urlOf(reloaded), `${world.site.origin}/json`)
          }), timeout)

        it.effect("says what served each response: the network, the cache, a service worker, a route", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            // Where a cache and a service worker look alike, the capability says so
            const entry = capabilities.entries.find((entry) =>
              entry.name === "network.servedBy"
            )
            const precise = entry?.status === "supported"
            const { context, page } = yield* newPage(world)
            const script = `${world.site.origin}/cached.js`
            yield* goto(world, page, `${world.site.origin}/cache`)
            const fresh = yield* world.facts.when("ResponseReceived", (fact) =>
              fact.response.url === script)
            assert.strictEqual(fresh.response.servedBy, "network")
            yield* goto(world, page, `${world.site.origin}/cache?again`)
            const cached = yield* world.facts.when(
              "ResponseReceived",
              (fact) =>
                fact.response.url === script && fact.response.hop !== fresh.response.hop
            )
            assert.strictEqual(cached.response.servedBy, precise ? "cache" : "cacheOrServiceWorker")
            // A route first, on a page no worker controls: WebKit's intercepts don't see a controlled page's requests
            yield* world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "Intercept",
              patterns: [`${world.site.origin}/json`],
              phases: ["request"]
            })
            const routed = yield* evaluate(world, page, "() => fetch('/json').then((r) => r.text())").pipe(
              Effect.forkChild
            )
            const paused = yield* world.facts.when("ObligationOpened", (fact) =>
              fact.subject._tag === "PausedRequest")
            yield* world.adapter.resolve(paused.obligation, {
              _tag: "Fulfill",
              status: 200,
              headers: { "content-type": "text/plain" },
              body: new TextEncoder().encode("from the route")
            })
            assert.strictEqual(yield* Fiber.join(routed), "from the route")
            const fromRoute = yield* world.facts.when(
              "ResponseReceived",
              (fact) => fact.response.url === `${world.site.origin}/json`
            )
            assert.strictEqual(fromRoute.response.servedBy, "route")
            yield* goto(world, page, `${world.site.origin}/sw`)
            assert.isTrue(yield* evaluate(world, page, "() => window.controlled"), "the page is controlled")
            assert.strictEqual(
              yield* evaluate(world, page, "() => fetch('/from-sw').then((r) => r.text())"),
              "made by the worker"
            )
            const fromWorker = yield* world.facts.when(
              "ResponseReceived",
              (fact) => fact.response.url === `${world.site.origin}/from-sw`
            )
            assert.strictEqual(fromWorker.response.servedBy, precise ? "serviceWorker" : "cacheOrServiceWorker")
          }), timeout)

        it.effect("follows a redirect as hops of one request", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const { outcome } = yield* goto(world, page, `${world.site.origin}/redirect`)
            assert(outcome._tag === "Committed")
            const committed = yield* world.facts.when("DocumentCommitted", (fact) =>
              fact.document === outcome.document)
            assert.strictEqual(committed.url, `${world.site.origin}/landed`)
            const hop = Option.getOrThrow(outcome.response)
            assert.match(hop, /\.1$/, "the second hop")
            const first = yield* world.facts.when(
              "ResponseReceived",
              (fact) =>
                fact.response.hop === hop.replace(/\.1$/, ".0")
            )
            assert.strictEqual(first.response.status, 302)
            // The first hop's id is still the adapter's: asked for its body, it says it was a redirect (Q39)
            const refused = yield* world.adapter.responseBody(first.response.hop).pipe(Effect.flip)
            assert.deepInclude(refused.reason, { _tag: "Unsupported", capability: "body.redirect" })
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
                world.facts.all("FrameAdded").filter((other) =>
                    other.parent === page
                  ).indexOf(fact) === 1
              )
            ])
            for (const frame of frames) {
              yield* world.facts.when(
                "DocumentCommitted",
                (fact) => fact.navigable === frame.frame && fact.url.endsWith("/child")
              )
              yield* mainRealm(world, frame.frame)
            }
            const urls: Array<string> = frames.map((frame) =>
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
            assert.deepStrictEqual(removed.reason, new Target.FrameDetached({}))
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
              workers: false,
              timing: "beforeAuthorScript",
              after: []
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
            yield* world.facts.when("PageReady", (fact) => fact.page === popup.page)
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
            // Probe 20: activation during the call is what every backend grants; Chromium also keeps it sticky
            assert.isFalse(yield* evaluate(world, page, "() => navigator.userActivation.isActive"))
            assert.isTrue(yield* evaluate(world, page, "() => navigator.userActivation.isActive", true))
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
              {
                _tag: "Mouse",
                type: "move",
                x: box[0],
                y: box[1],
                button: "none",
                clickCount: 0,
                modifiers: none,
                buttons: 0
              },
              {
                _tag: "Mouse",
                type: "down",
                x: box[0],
                y: box[1],
                button: "left",
                clickCount: 1,
                modifiers: none,
                buttons: 1
              },
              {
                _tag: "Mouse",
                type: "up",
                x: box[0],
                y: box[1],
                button: "left",
                clickCount: 1,
                modifiers: none,
                buttons: 0
              }
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

        it.effect("carries the buttons held through a drag, and sends Enter as Enter", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/form`)
            yield* evaluate(
              world,
              page,
              "() => { window.seen = []; addEventListener('mousemove', (e) => seen.push('move ' + e.buttons)); addEventListener('keydown', (e) => seen.push(e.key + ' ' + e.code)) }"
            )
            const none = { alt: false, control: false, meta: false, shift: false }
            const mouse = (type: "move" | "down" | "up", x: number, buttons: number): Adapter.InputEvent => ({
              _tag: "Mouse",
              type,
              x,
              y: 5,
              button: type === "move" ? "none" : "left",
              clickCount: type === "move" ? 0 : 1,
              modifiers: none,
              buttons
            })
            // The buttons held are sent with each event, and kept between calls
            yield* world.adapter.dispatchInput(page, [mouse("move", 5, 0), mouse("down", 5, 1)])
            yield* world.adapter.dispatchInput(page, [mouse("move", 10, 1), mouse("move", 15, 1)])
            yield* world.adapter.dispatchInput(page, [mouse("up", 15, 0), mouse("move", 20, 0)])
            yield* evaluate(world, page, "() => document.querySelector('#t').focus()")
            // Enter is the main Enter key, not the numpad's
            yield* world.adapter.dispatchInput(page, [
              {
                _tag: "Key",
                type: "down",
                key: "Enter",
                code: "Enter",
                text: Option.some("\r"),
                modifiers: none,
                autoRepeat: false
              },
              {
                _tag: "Key",
                type: "up",
                key: "Enter",
                code: "Enter",
                text: Option.none(),
                modifiers: none,
                autoRepeat: false
              }
            ])
            assert.deepStrictEqual(yield* evaluate(world, page, "() => window.seen"), [
              "move 0",
              "move 1",
              "move 1",
              "move 0",
              "Enter Enter"
            ])
          }), timeout)

        it.effect("names an iframe's frame, passes a node across worlds, and sends input into a frame", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            const fixture = (origin: string, html: string) =>
              `${origin}/fixture?html=${encodeURIComponent(html)}`
            const child =
              `<body style="margin:0"><button style="position:absolute;left:10px;top:10px;width:60px;height:30px" onclick="parent.postMessage('clicked', '*')">x</button><script>parent.postMessage('loaded', '*')</script></body>`
            yield* goto(
              world,
              page,
              fixture(
                world.site.origin,
                `<body style="margin:0"><script>window.got = []; addEventListener('message', (e) => got.push(e.data))</script><iframe id="cross" src="${
                  fixture(world.site.crossSite, child)
                }" style="position:absolute;left:100px;top:50px;width:200px;height:100px;border:5px solid red;padding:3px"></iframe></body>`
              )
            )
            const added = yield* world.facts.when("FrameAdded")
            yield* world.facts.when("DocumentCommitted", (fact) =>
              fact.navigable === added.frame)
            const realm = yield* mainRealm(world, page)
            const loaded = Effect.flatMap(
              world.adapter.evaluate(realm, {
                functionDeclaration: "() => window.got.includes('loaded')",
                arguments: [],
                awaitPromise: false,
                result: "value",
                userActivation: false
              }),
              (result) => result._tag === "Value" && json(result.value) === true ? Effect.void : Effect.fail("not yet")
            )
            yield* loaded.pipe(Effect.retry({ times: 50, schedule: Schedule.spaced("100 millis") }))
            const iframe = yield* world.adapter.evaluate(realm, {
              functionDeclaration: "() => document.getElementById('cross')",
              arguments: [],
              awaitPromise: false,
              result: "value",
              userActivation: false
            })
            assert(iframe._tag === "Value" && iframe.value.type === "node" && iframe.value.node !== undefined)
            // Every backend names the frame an iframe element holds, or says it can't
            const contentFrame = world.adapter.contentFrame(iframe.value.node)
            if (yield* supports(world, "frames.contentFrame")) {
              assert.deepStrictEqual(yield* contentFrame, Option.some(added.frame))
            } else {
              assert.deepInclude((yield* Effect.flip(contentFrame)).reason, {
                _tag: "Unsupported",
                capability: "frames.contentFrame"
              })
            }
            // A node returned from one world is an argument in another
            if (yield* supports(world, "isolatedWorlds")) {
              const committed = world.facts.all("DocumentCommitted").filter((fact) => fact.navigable === page).at(-1)!
              const isolated = yield* world.adapter.realm(committed.document, {
                _tag: "Isolated",
                name: "conformance"
              })
              const id = yield* world.adapter.evaluate(isolated, {
                functionDeclaration: "(element) => element.id",
                arguments: [{ _tag: "Node", node: iframe.value.node }],
                awaitPromise: false,
                result: "value",
                userActivation: false
              })
              assert.deepStrictEqual(id, { _tag: "Value", value: { type: "string", value: "cross" } })
            }
            // Input aimed inside a cross-site frame reaches it, on every backend
            const none = { alt: false, control: false, meta: false, shift: false }
            const origin = { x: 100 + 5 + 3, y: 50 + 5 + 3 }
            const x = origin.x + 40
            const y = origin.y + 25
            yield* world.adapter.dispatchInput(page, [
              { _tag: "Mouse", type: "move", x, y, button: "none", clickCount: 0, modifiers: none, buttons: 0 },
              { _tag: "Mouse", type: "down", x, y, button: "left", clickCount: 1, modifiers: none, buttons: 1 },
              { _tag: "Mouse", type: "up", x, y, button: "left", clickCount: 1, modifiers: none, buttons: 0 }
            ], { frame: added.frame, origin })
            const clicked = Effect.flatMap(
              world.adapter.evaluate(realm, {
                functionDeclaration: "() => window.got.includes('clicked')",
                arguments: [],
                awaitPromise: false,
                result: "value",
                userActivation: false
              }),
              (result) => result._tag === "Value" && json(result.value) === true ? Effect.void : Effect.fail("not yet")
            )
            yield* clicked.pipe(Effect.retry({ times: 30, schedule: Schedule.spaced("100 millis") }))
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
            const opened = yield* world.facts.when("ObligationOpened", (fact) =>
              fact.subject._tag === "Prompt")
            // A backend that can't say a dialog's kind says it's unknown, with no default text
            assert.deepInclude(
              opened.subject,
              (yield* supports(world, "prompts.kind"))
                ? { kind: "prompt", message: "Name?", defaultValue: "anon", page }
                : { kind: "unknown", message: "Name?", defaultValue: "", page }
            )
            yield* world.adapter.resolve(opened.obligation, { _tag: "Accept", promptText: Option.some("Strider") })
            const result = yield* Fiber.join(answer)
            assert(result._tag === "Value")
            assert.deepStrictEqual(result.value, { type: "string", value: "Strider" })
            const closed = yield* world.facts.when("PromptClosed")
            assert.isTrue(closed.accepted)
            yield* world.facts.when("ObligationEnded", (fact) =>
              fact.obligation === opened.obligation)
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
            // Headers replace the request's own, on every backend: keep them, and add one
            assert(third.subject._tag === "PausedRequest")
            yield* world.adapter.resolve(third.obligation, {
              _tag: "Continue",
              overrides: Option.some({ headers: { ...third.subject.request.headers, "x-strider": "continued" } })
            })
            const headers = yield* Fiber.join(continued)
            assert.deepInclude(headers as object, { "x-strider": "continued" })
          }), timeout)

        it.effect("gives a paused request's body, a paused response's where it can, and asks about a challenge", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const origin = world.site.origin
            yield* goto(world, page, `${origin}/hello`)
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            const decode = (bytes: Uint8Array) =>
              new TextDecoder().decode(bytes)
            // Every backend has the body as it was sent; a new body sends its own length
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "Intercept",
                patterns: [`${origin}/echo*`],
                phases: ["request"]
              })
              const posted = yield* evaluate(
                world,
                page,
                "() => fetch('/echo', { method: 'POST', body: 'hello' }).then((r) => r.json()).then((j) => j.body)"
              ).pipe(Effect.forkChild)
              const opened = yield* world.facts.when("ObligationOpened", (fact) =>
                fact.subject._tag === "PausedRequest" && fact.subject.request.url.endsWith("/echo"))
              const body = yield* world.adapter.pausedRequestBody(opened.obligation)
              assert.strictEqual(Option.getOrUndefined(Option.map(body, decode)), "hello")
              yield* world.adapter.resolve(opened.obligation, {
                _tag: "Continue",
                overrides: Option.some({ body: new TextEncoder().encode("a longer body") })
              })
              assert.strictEqual(yield* Fiber.join(posted), "a longer body")
            }))
            // A response's body at the response phase is CDP's alone
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "Intercept",
                patterns: [`${origin}/json*`],
                phases: ["response"]
              })
              const fetched = yield* evaluate(world, page, "() => fetch('/json').then((r) => r.text())").pipe(
                Effect.forkChild
              )
              const opened = yield* world.facts.when("ObligationOpened", (fact) =>
                fact.subject._tag === "PausedRequest" && fact.subject.phase === "response")
              const body = yield* Effect.exit(world.adapter.pausedResponseBody(opened.obligation))
              if (capabilities.has("interception.responseBody")) {
                assert(Exit.isSuccess(body), String(body))
                assert.strictEqual(decode(body.value), `{"hello":"world"}`)
              } else {
                assert(Exit.isFailure(body))
                assert.deepInclude((Cause.squash(body.cause) as Adapter.AdapterError).reason, {
                  _tag: "Unsupported",
                  capability: "interception.responseBody"
                })
              }
              yield* world.adapter.resolve(opened.obligation, { _tag: "Continue", overrides: Option.none() })
              assert.strictEqual(yield* Fiber.join(fetched), `{"hello":"world"}`)
            }))
            if (!capabilities.has("interception.auth")) {
              return
            }
            // A challenge is asked about, once the request it came for is intercepted as it starts
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "Intercept",
                patterns: [`${origin}/auth*`],
                phases: ["auth"]
              })
              const navigating = yield* world.adapter.navigate(page, `${origin}/auth`, { referrer: Option.none() })
                .pipe(
                  Effect.forkChild
                )
              const opened = yield* world.facts.when("ObligationOpened", (fact) =>
                fact.subject._tag === "PausedRequest" && fact.subject.phase === "auth")
              assert(opened.subject._tag === "PausedRequest")
              assert.strictEqual(Option.getOrThrow(opened.subject.challenge).realm, "strider")
              yield* world.adapter.resolve(opened.obligation, {
                _tag: "ProvideCredentials",
                username: "strider",
                password: "secret"
              })
              const navigation = yield* Fiber.join(navigating)
              const ended = yield* world.facts.when("NavigationEnded", (fact) =>
                fact.navigation === navigation)
              assert.strictEqual(ended.outcome._tag, "Committed")
              assert.strictEqual(yield* evaluate(world, page, "() => document.body.innerText"), "signed in")
            }))
          }), timeout)

        it.effect("ends a navigation a route fails, and refuses what the backend can't do", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const origin = world.site.origin
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            // A navigation whose request is failed, or aborted where the backend can, still ends
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "Intercept",
                patterns: [`${origin}/blocked*`],
                phases: ["request"]
              })
              const navigating = yield* world.adapter.navigate(page, `${origin}/blocked`, { referrer: Option.none() })
                .pipe(
                  Effect.forkChild
                )
              const opened = yield* world.facts.when("ObligationOpened", (fact) =>
                fact.subject._tag === "PausedRequest" && fact.subject.request.url.endsWith("/blocked"))
              const reason = capabilities.has("interception.abortReason") ? "aborted" : "failed"
              yield* world.adapter.resolve(opened.obligation, { _tag: "Fail", error: reason })
              const navigation = yield* Fiber.join(navigating)
              const ended = yield* world.facts.when("NavigationEnded", (fact) =>
                fact.navigation === navigation)
              assert.strictEqual(ended.outcome._tag, "Failed")
            }))
            // Each override a backend can't apply is refused under the capability that says so, never ignored
            const overrides: ReadonlyArray<readonly [string, Adapter.Override]> = [
              ["emulation.touch", { _tag: "Touch", enabled: true, maxTouchPoints: 5 }],
              ["emulation.viewport.mobile", {
                _tag: "Viewport",
                width: 400,
                height: 700,
                deviceScaleFactor: 2,
                mobile: true
              }],
              ["emulation.geolocation.unavailable", { _tag: "Geolocation", position: Option.none() }],
              ["emulation.network.throttling", { _tag: "NetworkConditions", download: 1e6, upload: 1e6, latency: 10 }],
              ["emulation.cpuSlowdown", { _tag: "CpuThrottling", rate: 2 }]
            ]
            for (const [capability, override] of overrides) {
              const declared = yield* Effect.exit(Effect.scoped(
                world.adapter.declare({ _tag: "UserContext", context }, { _tag: "Override", override })
              ))
              const entry = capabilities.entries.find((each) =>
                each.name === capability
              )
              assert.isDefined(entry, capability)
              if (entry.status === "unsupported") {
                assert(Exit.isFailure(declared), capability)
                assert.deepInclude((Cause.squash(declared.cause) as Adapter.AdapterError).reason, {
                  _tag: "Unsupported",
                  capability
                })
              } else {
                assert(Exit.isSuccess(declared), `${capability}: ${String(declared)}`)
              }
            }
          }), timeout)

        it.effect("runs an init script only after what it comes after ran, and reports one that throws", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const script = (source: string, after: ReadonlyArray<Adapter.RegistrationId> = []) =>
              world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "InitScript",
                source,
                world: { _tag: "Main" },
                phase: "user",
                workers: false,
                timing: "beforeAuthorScript",
                after
              })
            const helper = yield* script("window.order = ['helper']")
            const broken = yield* script("throw new Error('init threw')")
            yield* script("window.order.push('after helper')", [helper])
            yield* script("window.order.push('after broken')", [broken])
            yield* goto(world, page, `${world.site.origin}/hello`)
            assert.deepStrictEqual(yield* evaluate(world, page, "() => window.order"), ["helper", "after helper"])
            const thrown = yield* world.facts.when("UncaughtException", (fact) =>
              fact.exception.message === "init threw")
            assert.strictEqual(thrown.exception.name, "Error")
          }), timeout)

        it.effect("restores the viewport when released immediately after applying it", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const width = yield* evaluate(world, page, "() => innerWidth")
            yield* Effect.scoped(world.adapter.declare(
              { _tag: "UserContext", context },
              {
                _tag: "Override",
                override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
              }
            ))
            assert.strictEqual(yield* evaluate(world, page, "() => innerWidth"), width, "the viewport it had before")
          }), timeout)

        it.effect("applies overrides to pages in scope, and restores them when released", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const scope = { _tag: "UserContext", context } as const
            // Each override takes effect, or fails with Unsupported naming what's missing; never silently
            const check = Effect.fnUntraced(function*(
              override: Adapter.Override,
              read: string,
              expected: unknown,
              where: Adapter.DeclarationScope = scope
            ) {
              const declared = yield* world.adapter.declare(where, { _tag: "Override", override }).pipe(
                Effect.as(true),
                Effect.catchIf(
                  (error) =>
                    error.reason._tag === "Unsupported",
                  () =>
                    Effect.succeed(false)
                )
              )
              if (declared) {
                assert.deepStrictEqual(yield* evaluate(world, page, read), expected, override._tag)
              }
              return declared
            })
            const width = yield* evaluate(world, page, "() => innerWidth")
            yield* Effect.scoped(Effect.gen(function*() {
              const viewport = yield* check(
                { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false },
                "() => innerWidth",
                640
              )
              assert.isTrue(viewport, "every backend sets the viewport")
              yield* check(
                { _tag: "TimeZone", timeZone: "Asia/Tokyo" },
                "() => Intl.DateTimeFormat().resolvedOptions().timeZone",
                "Asia/Tokyo"
              )
              yield* check(
                { _tag: "Locale", locale: "de-DE" },
                "() => new Intl.NumberFormat().resolvedOptions().locale",
                "de-DE"
              )
              yield* check(
                { _tag: "Media", media: Option.none(), features: { "prefers-color-scheme": "dark" } },
                "() => matchMedia('(prefers-color-scheme: dark)').matches",
                true
              )
              yield* check(
                { _tag: "ExtraHeaders", headers: { "x-extra": "1" } },
                "() => fetch('/headers').then((r) => r.json()).then((headers) => headers['x-extra'])",
                "1"
              )
              const offline = yield* check(
                { _tag: "Offline", offline: true },
                "() => fetch('/json').then(() => [navigator.onLine, 'ok'], () => [navigator.onLine, 'failed'])",
                [false, "failed"],
                { _tag: "Page", page }
              )
              if (offline) {
                yield* Effect.void
              }
            }))
            assert.strictEqual(yield* evaluate(world, page, "() => innerWidth"), width, "the viewport it had before")
            assert.isTrue(yield* evaluate(world, page, "() => navigator.onLine"))
          }), timeout)

        it.effect("reports console messages and uncaught exceptions", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/console`)
            const hello = yield* world.facts.when("ConsoleMessage", (fact) =>
              fact.message.text === "hello 42")
            assert.strictEqual(hello.message.level, "log")
            assert.deepStrictEqual(hello.message.origin, { _tag: "Page", page })
            // 1-based, as stack traces print it: the page is one line
            assert.strictEqual(Option.getOrThrow(hello.message.location).line, 1)
            const bad = yield* world.facts.when("ConsoleMessage", (fact) =>
              fact.message.text === "bad")
            assert.strictEqual(bad.message.level, "error")
            const thrown = yield* world.facts.when("UncaughtException")
            assert.strictEqual(thrown.exception.name, "TypeError")
            assert.strictEqual(thrown.exception.message, "thrown here")
            // A thrown value that isn't an Error reads as an Error whose message is the value
            yield* evaluate(world, page, "() => { setTimeout(() => { throw 'a string' }) }")
            const raw = yield* world.facts.when("UncaughtException", (fact) =>
              fact.exception.message === "a string")
            assert.strictEqual(raw.exception.name, "Error")
          }), timeout)

        it.effect("captures overridden viewports and full pages beyond the native view", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* evaluate(
              world,
              page,
              `() => {
              document.documentElement.style.overflow = 'hidden';
              document.body.style.cssText = 'margin:0;width:1400px;height:1200px;background:rgb(0,255,0)';
              document.body.innerHTML = '<div style="position:absolute;left:950px;top:650px;width:50px;height:50px;background:rgb(255,0,0)"></div><div style="position:absolute;left:1350px;top:1150px;width:50px;height:50px;background:rgb(0,0,255)"></div>';
            }`
            )
            for (const [width, height] of [[640, 480], [1000, 700]] as const) {
              yield* Effect.scoped(Effect.gen(function*() {
                yield* world.adapter.declare({ _tag: "Page", page }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width, height, deviceScaleFactor: 1, mobile: false }
                })
                for (const fullPage of [false, true]) {
                  const png = yield* world.adapter.screenshot(page, {
                    format: "png",
                    quality: Option.none(),
                    clip: Option.none(),
                    fullPage,
                    scale: "device",
                    omitBackground: false
                  })
                  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
                  assert.deepStrictEqual(
                    [view.getUint32(16), view.getUint32(20)],
                    fullPage ? [1400, 1200] : [width, height]
                  )
                  const x = fullPage ? 1375 : width - 25
                  const y = fullPage ? 1175 : height - 25
                  const pixel = yield* evaluate(
                    world,
                    page,
                    `async () => {
                    const image = new Image();
                    image.src = 'data:image/png;base64,${Buffer.from(png).toString("base64")}';
                    await image.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = image.width; canvas.height = image.height;
                    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
                    return Array.from(context.getImageData(${x}, ${y}, 1, 1).data);
                  }`
                  )
                  assert.deepStrictEqual(
                    pixel,
                    fullPage ?
                      [0, 0, 255, 255] :
                      width === 1000
                      ? [255, 0, 0, 255]
                      : [0, 255, 0, 255]
                  )
                }
              }))
            }
          }), timeout)

        it.effect("captures screencast frames at the overridden viewport's size", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            if (!(yield* supports(world, "capability.screencast"))) {
              return
            }
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* evaluate(
              world,
              page,
              `() => { document.documentElement.style.overflow = 'hidden'; let n = 0; setInterval(() => { document.body.style.background = 'rgb(' + (n++ % 255) + ',1,1)' }, 16) }`
            )
            const seen: Record<string, Array<ReadonlyArray<number>>> = {}
            for (const [width, height] of [[640, 480], [1000, 700]] as const) {
              const key = `${width}x${height}`
              seen[key] = []
              yield* Effect.scoped(Effect.gen(function*() {
                yield* world.adapter.declare({ _tag: "Page", page }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width, height, deviceScaleFactor: 1, mobile: false }
                })
                const frames = yield* world.adapter.screencast(page)
                yield* frames.pipe(
                  Stream.take(6),
                  Stream.runForEach((frame) =>
                    Effect.sync(() =>
                      seen[key]!.push([frame.width, frame.height])
                    )
                  ),
                  Effect.timeout("3 seconds"),
                  Effect.ignore
                )
              }))
              assert.deepStrictEqual(seen[key]!.at(-1), [width, height], "the last frame is the viewport's size")
            }
          }), timeout)

        it.effect("captures screenshots and PDFs, and reads response bodies", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* world.adapter.declare({ _tag: "Page", page }, {
              _tag: "BodyCollection",
              bodies: ["response"],
              maxBytes: 1024 * 1024
            })
            const { outcome } = yield* goto(world, page, `${world.site.origin}/json`)
            assert(outcome._tag === "Committed")
            const body = yield* world.adapter.responseBody(Option.getOrThrow(outcome.response))
            assert.strictEqual(new TextDecoder().decode(body), `{"hello":"world"}`)
            const png = yield* world.adapter.screenshot(page, {
              format: "png",
              quality: Option.none(),
              clip: Option.none(),
              fullPage: false,
              scale: "device",
              omitBackground: false
            })
            assert.deepStrictEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47])
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            if (!capabilities.has("pdf")) {
              return
            }
            const pdf = yield* world.adapter.pdf(page, {
              landscape: false,
              printBackground: false,
              scale: 1,
              paperWidth: 8.5,
              paperHeight: 11,
              margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
              pageRanges: Option.none(),
              header: Option.none(),
              footer: Option.none(),
              preferCssPageSize: false
            })
            assert.strictEqual(new TextDecoder().decode(pdf.subarray(0, 5)), "%PDF-")
          }), timeout)

        it.effect("reads, sets and clears cookies, and grants permissions, per context", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/cookie`)
            const cookies = yield* world.adapter.cookies(context)
            const flavor = cookies.find((cookie) =>
              cookie.name === "flavor"
            )
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
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            const granted = world.adapter.grantPermissions(context, Option.some(world.site.origin), ["geolocation"])
            if (!capabilities.has("permissions")) {
              const error = yield* Effect.flip(granted)
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "permissions" })
              return
            }
            yield* granted
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
            const declared = world.adapter.declare({ _tag: "Page", page }, { _tag: "FileChooser" })
            if (!(yield* supports(world, "fileChooser"))) {
              const error = yield* Effect.flip(declared)
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "fileChooser" })
              return
            }
            yield* declared
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
            const declared = world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "Downloads",
              behavior: { _tag: "Allow", directory }
            })
            if (!(yield* supports(world, "downloads"))) {
              const error = yield* Effect.flip(declared)
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "downloads" })
              return
            }
            yield* declared
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
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/worker`)
            const realm = yield* world.facts.when("RealmAdded", (fact) => fact.kind._tag === "Worker")
            assert(realm.kind._tag === "Worker")
            assert.strictEqual(realm.kind.worker._tag, "Dedicated")
            // A dedicated worker belongs to its page, and so to its context
            assert.deepStrictEqual([realm.kind.page, realm.kind.context], [Option.some(page), Option.some(context)])
            const message = yield* world.facts.when("ConsoleMessage", (fact) => fact.message.text === "from the worker")
            // Firefox 158 attributes a dedicated worker's console to its owner, the window realm (recorded 2026-10-20)
            const owner = realm.kind.worker._tag === "Dedicated"
              ? Option.getOrUndefined(realm.kind.worker.owner)
              : undefined
            assert.include([realm.realm, owner], message.realm)
          }), timeout)

        it.effect("reports a WebSocket's frames", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            if (!capabilities.has("webSocketFrames")) {
              const entry = capabilities.entries.find((entry) => entry.name === "webSocketFrames")
              assert.strictEqual(entry?.status, "unsupported", "a missing capability is said to be unsupported")
              return
            }
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/socket`)
            const opened = yield* world.facts.when("ConnectionOpened")
            assert.strictEqual(opened.kind, "webSocket")
            const sent = yield* world.facts.when("ConnectionFrame", (fact) => fact.frame.direction === "sent")
            assert.deepStrictEqual(sent.frame.payload, { _tag: "Text", text: "ping" })
            yield* world.facts.when("ConnectionFrame", (fact) => fact.frame.direction === "received")
            yield* world.facts.when("ConnectionClosed", (fact) => fact.connection === opened.connection)
            // The close handshake's control frames aren't messages
            const frames = world.facts.all("ConnectionFrame").filter((fact) => fact.connection === opened.connection)
            assert.deepStrictEqual(frames.map((fact) => fact.frame.payload._tag), ["Text", "Text"])
          }), timeout)

        it.effect("cancels a download in progress, where the protocol can", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            const directory = (yield* Effect.promise(() => import("node:os"))).tmpdir() +
              `/strider-canceled-${process.pid}`
            const declared = world.adapter.declare({ _tag: "UserContext", context }, {
              _tag: "Downloads",
              behavior: { _tag: "Allow", directory }
            })
            if (!(yield* supports(world, "downloads"))) {
              const error = yield* Effect.flip(declared)
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "downloads" })
              return
            }
            yield* declared
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* world.adapter.navigate(page, `${world.site.origin}/slow-download`, { referrer: Option.none() })
            const started = yield* world.facts.when("DownloadStarted")
            const canceled = world.adapter.cancelDownload(started.download)
            const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
            if (!capabilities.has("downloads.cancel")) {
              const error = yield* Effect.flip(canceled)
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "downloads.cancel" })
              return
            }
            yield* canceled
            const ended = yield* world.facts.when("DownloadEnded", (fact) => fact.download === started.download)
            assert.strictEqual(ended.outcome._tag, "Canceled")
          }), timeout)

        it.effect("closes pages and removes contexts, with the reason", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { context, page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            yield* world.adapter.closePage(page, { runBeforeUnload: false })
            const removed = yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === page)
            assert.deepStrictEqual(removed.reason, new Target.PageClosed({ by: "command" }))
            const second = yield* world.adapter.createPage(context)
            yield* world.adapter.removeUserContext(context)
            const gone = yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === second)
            assert.deepStrictEqual(gone.reason, new Target.PageClosed({ by: "userContextRemoved" }))
            yield* world.facts.when("UserContextRemoved", (fact) => fact.context === context)
          }), timeout)

        it.effect("asks before closing a page with a beforeunload handler, when told to", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/beforeunload`)
            if (!(yield* supports(world, "close.runBeforeUnload"))) {
              const error = yield* Effect.flip(world.adapter.closePage(page, { runBeforeUnload: true }))
              assert.deepInclude(error.reason, { _tag: "Unsupported", capability: "close.runBeforeUnload" })
              return
            }
            // A beforeunload prompt needs the page to have been interacted with: a real click, once the page has
            // rendered a frame, since a busy browser drops input that comes before one
            yield* evaluate(world, page, "() => new Promise((resolve) => requestAnimationFrame(() => resolve(true)))")
            const none = { alt: false, control: false, meta: false, shift: false }
            yield* world.adapter.dispatchInput(page, [
              { _tag: "Mouse", type: "down", x: 5, y: 5, button: "left", clickCount: 1, modifiers: none, buttons: 1 },
              { _tag: "Mouse", type: "up", x: 5, y: 5, button: "left", clickCount: 1, modifiers: none, buttons: 0 }
            ])
            assert.isTrue(
              yield* evaluate(world, page, "() => navigator.userActivation.hasBeenActive"),
              "the click activated the page"
            )
            yield* world.adapter.closePage(page, { runBeforeUnload: true })
            const opened = yield* world.facts.when("ObligationOpened", (fact) => fact.subject._tag === "Prompt")
            assert.deepInclude(opened.subject, { kind: "beforeunload" })
            yield* world.adapter.resolve(opened.obligation, { _tag: "Dismiss" })
            yield* world.facts.when("PromptClosed")
            // Dismissed, so the page stays
            assert.strictEqual(yield* evaluate(world, page, "() => document.title"), "beforeunload")
          }), timeout)

        it.effect("ends everything with ConnectionLost when the browser dies", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/frames`)
            const frame = yield* world.facts.when("FrameAdded", (fact) => fact.parent === page)
            yield* world.kill
            const lost = yield* world.adapter.closed
            assert.strictEqual(lost.initiator, "remote")
            for (const navigable of [page, frame.frame]) {
              const removed = yield* world.facts.when("NavigableRemoved", (fact) => fact.navigable === navigable)
              assert.deepStrictEqual(removed.reason, new Target.ConnectionLost({}))
            }
            const late = yield* world.adapter.createPage(world.adapter.defaultContext).pipe(Effect.flip)
            assert.strictEqual(late._tag, "AdapterError")
          }), timeout)
      }
    )
  })

export type { Backend }

/** Restoration across different scopes and release order. */
export const viewportRestoration = (backend: Backend, options: { readonly nested?: boolean } = {}) =>
  describe(`${backend.name} viewport restoration`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        ;(options.nested === false ? it.effect.skip : it.effect)(
          "restores nested viewport overrides",
          () =>
            Effect.gen(function*() {
              const world = yield* setup(backend)
              const { context, page } = yield* newPage(world)
              yield* goto(world, page, `${world.site.origin}/hello`)
              const original = yield* evaluate(world, page, "() => [innerWidth, innerHeight]")
              yield* Effect.scoped(Effect.gen(function*() {
                yield* world.adapter.declare({ _tag: "UserContext", context }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width: 1000, height: 700, deviceScaleFactor: 1, mobile: false }
                })
                yield* Effect.scoped(
                  world.adapter.declare({ _tag: "Page", page }, {
                    _tag: "Override",
                    override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
                  })
                )
                assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), [1000, 700])
              }))
              assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), original)
            }),
          timeout
        )

        it.effect(
          "preserves viewport precedence across broader replacements and creation",
          () =>
            Effect.gen(function*() {
              const world = yield* setup(backend)
              const { context, page } = yield* newPage(world)
              yield* goto(world, page, `${world.site.origin}/hello`)
              const measure = (target: Target.NavigableId) =>
                evaluate(world, target, "() => [innerWidth, innerHeight, devicePixelRatio]")
              const capabilities = yield* SubscriptionRef.get(world.adapter.capabilities)
              const viewport = capabilities.entries.find((entry) => entry.name === "emulation.viewport")
              assert.isDefined(viewport)
              const contextScale = viewport.status === "supported" ? 2 : 1
              const pageScale = viewport.status === "supported" ? 3 : 1
              if (viewport.status !== "supported") {
                const refused = yield* Effect.scoped(world.adapter.declare({ _tag: "Page", page }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width: 640, height: 600, deviceScaleFactor: 2, mobile: false }
                })).pipe(Effect.flip)
                assert.strictEqual(refused.reason._tag, "Unsupported")
              }
              const original = yield* measure(page)
              const browser = yield* Scope.make()
              const userContext = yield* Scope.make()
              const pageScope = yield* Scope.make()
              for (const scope of [browser, userContext, pageScope]) {
                yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
              }
              const declare = (scope: Adapter.DeclarationScope, width: number, ratio: number, lifetime: Scope.Scope) =>
                world.adapter.declare(scope, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width, height: 600, deviceScaleFactor: ratio, mobile: false }
                }).pipe(Effect.provideService(Scope.Scope, lifetime))
              yield* declare({ _tag: "Browser" }, 1100, 1, browser)
              yield* declare({ _tag: "UserContext", context }, 1000, contextScale, userContext)
              yield* declare({ _tag: "Page", page }, 640, pageScale, pageScope)
              yield* Effect.scoped(Effect.gen(function*() {
                yield* world.adapter.declare({ _tag: "UserContext", context }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width: 900, height: 600, deviceScaleFactor: 1, mobile: false }
                })
                assert.deepStrictEqual(yield* measure(page), [640, 600, pageScale])
                const sibling = yield* world.adapter.createPage(context)
                yield* goto(world, sibling, `${world.site.origin}/hello`)
                assert.deepStrictEqual(yield* measure(sibling), [900, 600, 1])
              }))
              const sibling = yield* world.adapter.createPage(context)
              yield* goto(world, sibling, `${world.site.origin}/hello`)
              assert.deepStrictEqual(yield* measure(sibling), [1000, 600, contextScale])
              const other = yield* newPage(world)
              yield* goto(world, other.page, `${world.site.origin}/hello`)
              assert.deepStrictEqual(yield* measure(other.page), [1100, 600, 1])
              assert.deepStrictEqual(yield* measure(page), [640, 600, pageScale])
              assert.deepStrictEqual(yield* measure(sibling), [1000, 600, contextScale])
              yield* Scope.close(browser, Exit.void)
              assert.deepStrictEqual(yield* measure(page), [640, 600, pageScale])
              assert.deepStrictEqual(yield* measure(sibling), [1000, 600, contextScale])
              yield* Scope.close(pageScope, Exit.void)
              assert.deepStrictEqual(yield* measure(page), [1000, 600, contextScale])
              yield* Scope.close(userContext, Exit.void)
              assert.deepStrictEqual(yield* measure(page), original)
              assert.deepStrictEqual(yield* measure(sibling), original)
            }),
          timeout
        )

        it.effect("restores replaced viewport overrides released out of order", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const original = yield* evaluate(world, page, "() => [innerWidth, innerHeight]")
            const first = yield* Scope.make()
            const second = yield* Scope.make()
            yield* Effect.addFinalizer(() => Scope.close(first, Exit.void))
            yield* Effect.addFinalizer(() => Scope.close(second, Exit.void))
            const declare = (width: number, height: number) =>
              world.adapter.declare({ _tag: "Page", page }, {
                _tag: "Override",
                override: { _tag: "Viewport", width, height, deviceScaleFactor: 1, mobile: false }
              })
            yield* declare(640, 480).pipe(Effect.provideService(Scope.Scope, first))
            yield* declare(1000, 700).pipe(Effect.provideService(Scope.Scope, second))
            yield* Scope.close(first, Exit.void)
            assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), [1000, 700])
            yield* Scope.close(second, Exit.void)
            assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), original)
          }), timeout)
      }
    )
  })

/** CDP measurement is isolated from author globals and also works during target setup. */
export const viewportMeasurement = (backend: Backend) =>
  describe(`${backend.name} viewport measurement`, () => {
    layer(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor), { excludeTestServices: true })(
      (it) => {
        for (const enabled of [true, false]) {
          it.effect(`restores a page created under a context viewport with JavaScript ${enabled ? "on" : "off"}`, () =>
            Effect.gen(function*() {
              const world = yield* setup(backend)
              const { context, page: control } = yield* newPage(world)
              yield* goto(world, control, `${world.site.origin}/hello`)
              const original = yield* evaluate(world, control, "() => [innerWidth, innerHeight]")
              yield* world.adapter.declare({ _tag: "UserContext", context }, {
                _tag: "Override",
                override: { _tag: "JavaScriptEnabled", enabled }
              })
              const page = yield* Effect.scoped(Effect.gen(function*() {
                yield* world.adapter.declare({ _tag: "UserContext", context }, {
                  _tag: "Override",
                  override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
                })
                const page = yield* world.adapter.createPage(context)
                yield* goto(world, page, `${world.site.origin}/hello`)
                assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), [640, 480])
                return page
              }))
              assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), original)
            }), timeout)
        }
        for (const shadow of ["\"wide\"", "123"]) {
          it.effect(`restores despite author dimension shadows ${shadow}`, () =>
            Effect.gen(function*() {
              const world = yield* setup(backend)
              const { page } = yield* newPage(world)
              const html = `<script>let innerWidth = ${shadow}; let innerHeight = 456;</script>`
              yield* goto(world, page, `${world.site.origin}/fixture?html=${encodeURIComponent(html)}`)
              const original = yield* evaluate(world, page, "() => [window.innerWidth, window.innerHeight]")
              yield* Effect.scoped(world.adapter.declare({ _tag: "Page", page }, {
                _tag: "Override",
                override: { _tag: "Viewport", width: 640, height: 480, deviceScaleFactor: 1, mobile: false }
              }))
              assert.deepStrictEqual(
                yield* evaluate(world, page, "() => [window.innerWidth, window.innerHeight]"),
                original
              )
            }), timeout)
        }
        it.effect("restores a mobile viewport", () =>
          Effect.gen(function*() {
            const world = yield* setup(backend)
            const { page } = yield* newPage(world)
            yield* goto(world, page, `${world.site.origin}/hello`)
            const original = yield* evaluate(world, page, "() => [innerWidth, innerHeight]")
            yield* Effect.scoped(Effect.gen(function*() {
              yield* world.adapter.declare({ _tag: "Page", page }, {
                _tag: "Override",
                override: { _tag: "Viewport", width: 375, height: 667, deviceScaleFactor: 2, mobile: true }
              })
              assert.strictEqual(yield* evaluate(world, page, "() => devicePixelRatio"), 2)
            }))
            assert.deepStrictEqual(yield* evaluate(world, page, "() => [innerWidth, innerHeight]"), original)
          }), timeout)
      }
    )
  })
