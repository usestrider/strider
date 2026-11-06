/**
 * The adapter kit: what every adapter does the same way. An id a connection minted that ended is `Gone`, one it
 * didn't `Foreign`; facts reach the sink in order, a pending realm's after it; what waits on the model is woken by
 * the flush that satisfies it; commands the fold can't wait for die with the connection; a navigation that never
 * started can't race the event that announces it; and nothing is sent or returned for what didn't resolve.
 */
import { assert, describe, it } from "@effect/vitest"
import { Protocol } from "@usestrider/browser/protocol"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Base64 from "effect/encoding/Base64"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import { vi } from "vitest"
import * as Network from "../src/cdp/Network.ts"
import * as Page from "../src/cdp/Page.ts"
import type * as Adapter from "../src/internal/adapter.ts"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Declarations from "../src/internal/declarations.ts"
import * as Operation from "../src/internal/operation.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Target from "../src/Target.ts"

/** A client's control whose `run` runs `before` first, as events received ahead of it would be folded. */
const control = (before: () => void = () => {}): ProtocolClient.FoldControl => ({
  sync: () => {},
  session: () => undefined,
  run: (effect) =>
    Effect.suspend(() => {
      before()
      return effect
    })
})

/** A fact buffer whose sink keeps what it was given. */
const recording = Effect.fnUntraced(function*(before?: () => void) {
  const facts: Array<Adapter.Fact> = []
  const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact)))
  buffer.connect(control(before))
  return { buffer, facts }
})

const reasonOf = (error: Adapter.AdapterError) => error.reason._tag

describe("AdapterKit", () => {
  describe("ids", () => {
    it("knows what its connection minted, and not another's, across interleaved connections", () => {
      const ours = Kit.makeIds()
      const theirs = Kit.makeIds()
      const first = ours.navigable()
      const other = theirs.navigable()
      const second = ours.navigable()
      const request = ours.request()
      assert.isTrue(ours.owns(first))
      assert.isTrue(ours.owns(second))
      assert.isFalse(ours.owns(other))
      assert.isTrue(theirs.owns(other))
      assert.isTrue(ours.owns(ours.hop(request, 2)))
      assert.isFalse(theirs.owns(ours.hop(request, 0)))
      assert.isFalse(ours.owns("not an id"))
    })

    it.effect("fails an ended id this connection minted as Gone, and another connection's as Foreign", () =>
      Effect.gen(function*() {
        const ours = Kit.makeIds()
        const theirs = Kit.makeIds()
        const ended = ours.document()
        const table = new Map<Target.DocumentId, string>()
        const gone = () => Kit.gone({ _tag: "Document", id: ended }, new Target.DocumentReplaced({}))
        const own = yield* Kit.lookup(ours, table, ended, gone).pipe(Effect.flip)
        assert.strictEqual(reasonOf(own), "Gone")
        const foreign = yield* Kit.lookup(ours, table, theirs.document(), gone).pipe(Effect.flip)
        assert.strictEqual(reasonOf(foreign), "Foreign")
        // L1 maps a Gone to the target's end; only a Foreign is a defect
        assert.strictEqual(Operation.fromAdapter(own, "op" as never, "cdp")._tag, "Gone")
        assert.throws(() => Operation.fromAdapter(foreign, "op" as never, "cdp"))
      }))

    it.effect("fails an entry that is still in its table but has ended as Gone", () =>
      Effect.gen(function*() {
        const ids = Kit.makeIds()
        const page = ids.navigable()
        const table = new Map([[page, { ended: true }]])
        const error = yield* Kit.lookup(
          ids,
          table,
          page,
          () => Kit.gone({ _tag: "Page", id: page }, new Target.PageClosed({ by: "command" })),
          (entry) => !entry.ended
        ).pipe(Effect.flip)
        assert.strictEqual(reasonOf(error), "Gone")
      }))

    it("gives an ended obligation, download or hop the reason of its kind, and any other target none seen", () => {
      const reasonTag = (target: Target.Description) => {
        const error = Kit.ended(target)
        assert.strictEqual(error.reason._tag, "Gone")
        return error.reason._tag === "Gone" ? error.reason.reason._tag : undefined
      }
      assert.strictEqual(reasonTag({ _tag: "Obligation", id: "o" }), "ObligationEnded")
      assert.strictEqual(reasonTag({ _tag: "Download", id: "d" }), "DownloadEnded")
      assert.strictEqual(reasonTag({ _tag: "Hop", id: "h" }), "HopEnded")
      assert.strictEqual(reasonTag({ _tag: "Browser" }), "Vanished")
    })
  })

  describe("facts", () => {
    it.effect("delivers facts at the flush, a pending realm's after the realm, and none for one never announced", () =>
      Effect.gen(function*() {
        const { buffer, facts } = yield* recording()
        const ids = Kit.makeIds()
        const realm: Kit.RealmNode = { id: ids.realm(), ended: false, pending: true, held: [] }
        const logged: Adapter.Fact = { _tag: "PageReady", page: ids.navigable() }
        buffer.emitFrom(realm, logged)
        yield* buffer.flush
        assert.deepStrictEqual(facts, [])
        const added: Adapter.Fact = { _tag: "RealmDocumentAdded", realm: realm.id, document: ids.document() }
        buffer.announce(realm, added)
        yield* buffer.flush
        assert.deepStrictEqual(facts, [added, logged])
        // Created and ended before its document committed: it never reached the model
        const unannounced: Kit.RealmNode = { id: ids.realm(), ended: false, pending: true, held: [] }
        buffer.emitFrom(unannounced, logged)
        let removed = 0
        Kit.removeRealm(buffer, unannounced, new Target.RealmDestroyed({}), () => removed++)
        Kit.removeRealm(buffer, unannounced, new Target.RealmDestroyed({}), () => removed++)
        yield* buffer.flush
        assert.strictEqual(removed, 1)
        assert.strictEqual(facts.length, 2)
      }))

    it.effect("wakes a wait after the flush that satisfies it, with what it found", () =>
      Effect.gen(function*() {
        const { buffer, facts } = yield* recording()
        let found: string | undefined
        const waiting = yield* Effect.forkChild(buffer.waitFor(() => found))
        yield* buffer.flush
        assert.isUndefined(waiting.pollUnsafe())
        found = "R1"
        buffer.emit({ _tag: "PageReady", page: "N1" as Target.NavigableId })
        yield* buffer.flush
        assert.strictEqual(yield* Fiber.join(waiting), "R1")
        // The fact that satisfied it was delivered first
        assert.strictEqual(facts.length, 1)
      }))

    it.effect("starts what the fold can't wait for after its flush, and interrupts it when the connection ends", () =>
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const facts: Array<Adapter.Fact> = []
        const buffer = yield* Kit.makeFactBuffer((fact) => Effect.sync(() => void facts.push(fact))).pipe(
          Scope.provide(scope)
        )
        const started = yield* Ref.make(0)
        const interrupted = yield* Deferred.make<void>()
        buffer.later(
          Ref.update(started, (n) => n + 1).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
          )
        )
        // A failure is ignored
        buffer.later(Effect.fail("refused"))
        yield* Effect.yieldNow
        assert.strictEqual(yield* Ref.get(started), 0)
        yield* buffer.flush
        yield* Effect.yieldNow
        assert.strictEqual(yield* Ref.get(started), 1)
        yield* Scope.close(scope, Exit.void)
        yield* Deferred.await(interrupted)
      }))
  })

  describe("expectations", () => {
    it("matches a navigation the browser announced to the command's, by URL, oldest first", () => {
      const ids = Kit.makeIds()
      const expectations = Kit.makeExpectations()
      const a = Kit.expect(ids, expectations, "http://a")
      const b = Kit.expect(ids, expectations, "http://b/")
      assert.strictEqual(Kit.take(expectations, "http://b")?.id, b)
      assert.strictEqual(Kit.take(expectations, "http://elsewhere/")?.id, a)
      assert.isUndefined(Kit.take(expectations, "http://a/"))
    })

    it.effect("reports a navigation that never started once, even when its event slips in before the report", () =>
      Effect.gen(function*() {
        const ids = Kit.makeIds()
        const navigable = ids.navigable()
        const expectations = Kit.makeExpectations()
        const url = "http://a/"
        // The browser announces the navigation after its error reply, in the events folded before `run`'s step:
        // the event finds the expectation, and the report then finds it taken (Q233)
        let announced: Kit.Expected | undefined
        const { buffer, facts } = yield* recording(() => {
          announced = Kit.take(expectations, url)
        })
        const navigation = Kit.expect(ids, expectations, url)
        yield* Kit.neverStarted(buffer, {
          drained: Effect.void,
          expectations,
          navigable,
          navigation,
          url,
          error: "net::ERR_ABORTED",
          evidence: "test"
        })
        assert.strictEqual(announced?.id, navigation)
        assert.deepStrictEqual(facts, [])
      }))

    it.effect("reports a navigation that never started as started and failed, when no event announced it", () =>
      Effect.gen(function*() {
        const ids = Kit.makeIds()
        const { buffer, facts } = yield* recording()
        const expectations = Kit.makeExpectations()
        const navigation = Kit.expect(ids, expectations, "http://a/")
        yield* Kit.neverStarted(buffer, {
          drained: Effect.void,
          expectations,
          navigable: ids.navigable(),
          navigation,
          url: "http://a/",
          error: "net::ERR_NAME_NOT_RESOLVED",
          evidence: "test"
        })
        assert.deepStrictEqual(facts.map((fact) => fact._tag), ["NavigationStarted", "NavigationEnded"])
        assert.deepStrictEqual(expectations.list, [])
      }))
  })

  describe("handlers", () => {
    it("gives each handler its event's params, and the fold the events they need", () => {
      const seen: Array<string> = []
      const handlers = Kit.handlers<string>()
        .on(Page.frameDetached, (params, context) => seen.push(`${context}:${params.frameId}`))
        .on(Network.loadingFinished, (params) => seen.push(String(params.encodedDataLength)))
      assert.deepStrictEqual([...handlers.events.keys()], ["Page.frameDetached", "Network.loadingFinished"])
      handlers.apply("Page.frameDetached", { frameId: "F1" }, "page")
      handlers.apply("Page.frameNavigated", {}, "page")
      assert.deepStrictEqual(seen, ["page:F1"])
      assert.throws(() => handlers.on(Page.frameDetached, () => {}), /handled twice/)
    })
  })

  describe("values", () => {
    it.effect("preserves exact base64 bytes, accepted padding and CR/LF with or without native support", () =>
      Effect.gen(function*() {
        const bytes = Uint8Array.from({ length: 1025 }, (_, i) => i % 256)
        const inputs = ["", "AQ==", "AQI=", "AQID", "AR==", "AQJ=", "\rA\nQI=\r\n", Base64.encode(bytes)]
        try {
          for (const native of [true, false]) {
            if (!native) vi.stubGlobal("Buffer", undefined)
            for (const input of inputs) {
              const expected = Base64.decode(input)
              assert.strictEqual(expected._tag, "Success")
              if (expected._tag !== "Success") continue
              const decoded = yield* Kit.decodeBase64(input, "capture")
              assert.instanceOf(decoded, Uint8Array)
              assert.strictEqual(Object.getPrototypeOf(decoded), Uint8Array.prototype)
              assert.deepStrictEqual(decoded, expected.success)
              assert.deepStrictEqual(Kit.tryDecodeBase64(input), expected.success)
              assert.deepStrictEqual(yield* Kit.bodyBytes(input, true, "body"), expected.success)
            }
          }
        } finally {
          vi.unstubAllGlobals()
        }
        assert.deepStrictEqual(yield* Kit.bodyBytes("é", false, "body"), new TextEncoder().encode("é"))
      }))

    it.effect("retains malformed alphabet, padding and whitespace failures including exact error details", () =>
      Effect.gen(function*() {
        for (
          const input of [
            "A",
            "AAA",
            "A===",
            "====",
            "AA=A",
            "=AAA",
            "A?==",
            "AA-_",
            "AA =",
            "AA\t=",
            "AAA\u2028",
            "AAA\u2029",
            "AAé=",
            "AA\0=",
            "\rA?==\n"
          ]
        ) {
          const expected = Base64.decode(input)
          assert.strictEqual(expected._tag, "Failure")
          if (expected._tag !== "Failure") continue
          const error = yield* Kit.decodeBase64(input, "capture").pipe(Effect.flip)
          const reference = Kit.undecodable("capture", `its base64 didn't decode: ${expected.failure.message}`)
          assert.deepStrictEqual(error.reason, reference.reason)
          assert.strictEqual(error.message, reference.message)
          assert.isUndefined(Kit.tryDecodeBase64(input))
        }
      }))

    it.effect("fails base64 that doesn't decode, rather than giving empty bytes", () =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* Kit.decodeBase64("AQI=", "Page.captureScreenshot"), new Uint8Array([1, 2]))
        const error = yield* Kit.decodeBase64("not base64!", "Page.captureScreenshot").pipe(Effect.flip)
        assert.strictEqual(error.reason._tag, "Protocol")
        assert.include(error.message, "Page.captureScreenshot")
        assert.isUndefined(Kit.tryDecodeBase64("not base64!"))
      }))

    it.effect("fails a handle or node argument it can't resolve as Gone, and sends no empty reference", () =>
      Effect.gen(function*() {
        const ids = Kit.makeIds()
        const theirs = Kit.makeIds()
        const realm = ids.realm()
        const resolve = (local: Adapter.LocalValue) =>
          Kit.argument(local, {
            ids,
            realm,
            value: () => "value",
            handle: () => undefined,
            node: () => undefined
          })
        const released = yield* resolve({ _tag: "Handle", handle: ids.handle() }).pipe(Effect.flip)
        assert.deepStrictEqual(released.reason, {
          _tag: "Gone",
          target: { _tag: "Realm", id: realm },
          reason: new Target.RealmDestroyed({})
        })
        const foreign = yield* resolve({ _tag: "Handle", handle: theirs.handle() }).pipe(Effect.flip)
        assert.strictEqual(foreign.reason._tag, "Foreign")
        const document = ids.document()
        const node = yield* resolve({ _tag: "Node", node: { document, binding: "12" } }).pipe(Effect.flip)
        assert.deepStrictEqual(node.reason, {
          _tag: "Gone",
          target: { _tag: "Document", id: document },
          reason: new Target.DocumentReplaced({})
        })
        assert.strictEqual(yield* resolve({ _tag: "Value", value: { type: "null" } }), "value")
      }))

    it("matches an intercept's glob over the whole URL, `/` included, and gives its source escaped as text", () => {
      const pattern = "https://*.example.com/api/*?q=(1)"
      assert.isTrue(Declarations.glob(pattern).test("https://a.example.com/api/v1/users?q=(1)"))
      assert.isFalse(Declarations.glob(pattern).test("https://a.example.com/api/v1/users?q=1"))
      assert.isFalse(Declarations.glob(pattern).test("http://a.example.com/api/v1?q=(1)"))
      assert.strictEqual(Declarations.globSource("a/b*"), "^a\\/b.*$")
    })

    it("gives Gone for a call whose realm or session ended, and the protocol's error otherwise", () => {
      const realm = "R1" as Target.RealmId
      const ended = new Protocol.ProtocolError({
        reason: new Protocol.SessionEnded({ why: "targetDestroyed" })
      })
      const refused = new Protocol.ProtocolError({
        reason: new Protocol.Unsupported({ method: "Runtime.callFunctionOn" })
      })
      assert.strictEqual(Kit.realmFailure(realm, () => false)(ended).reason._tag, "Gone")
      assert.strictEqual(Kit.realmFailure(realm, () => true)(refused).reason._tag, "Gone")
      assert.strictEqual(Kit.realmFailure(realm, () => false)(refused).reason._tag, "Unsupported")
    })
  })
})
