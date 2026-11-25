/** Which cookies `CookieJar.listFor` says a request to a URL sends, and which `CookieJar.remove` removes. */
import { assert, describe, it } from "@effect/vitest"
import { Browser, CookieJar, Url } from "@usestrider/browser"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as TestClock from "effect/testing/TestClock"

const sentOver = (host: string) =>
  Effect.scoped(Effect.gen(function*() {
    const context = yield* Browser.newContext()
    const jar = context.cookies
    yield* jar.set({ name: "secure", value: "1", scope: { url: `https://${host}/` }, secure: true })
    yield* jar.set({ name: "plain", value: "1", scope: { url: `https://${host}/` } })
    const sent = yield* jar.listFor(`http://${host}:8080/`)
    return sent.map((cookie) => cookie.name).sort()
  })).pipe(Effect.provide(Browser.layerTest("")))

describe("CookieJar.listFor", () => {
  // Browsers treat these hosts as secure contexts, and send Secure cookies to them over http
  for (
    const host of ["localhost", "app.localhost", "localhost.", "app.localhost.", "127.0.0.1", "127.1.2.3", "[::1]"]
  ) {
    it.effect(`includes a Secure cookie over http on ${host}`, () =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* sentOver(host), ["plain", "secure"])
      }))
  }

  for (const host of ["example.com", "localhost.example.com", "128.0.0.1"]) {
    it.effect(`leaves out a Secure cookie over http on ${host}`, () =>
      Effect.gen(function*() {
        assert.deepStrictEqual(yield* sentOver(host), ["plain"])
      }))
  }
})

/**
 * Moves the test clock, which starts at the epoch, to 2026: `remove` expires a cookie at the epoch's first second,
 * which the test backend, on the test clock, would otherwise read as the future.
 */
const afterEpoch = TestClock.setTime(Date.UTC(2026, 0, 1))

/** The names left after `remove(match)`, from a jar of cookies on two hosts, two paths and two partitions. */
const leftAfter = (match: CookieJar.Match) =>
  Effect.scoped(Effect.gen(function*() {
    yield* afterEpoch
    const context = yield* Browser.newContext()
    const jar = context.cookies
    yield* jar.set({ name: "session", value: "1", scope: { url: "https://app.example.com/" } })
    yield* jar.set({ name: "session_id", value: "1", scope: { domain: ".example.com", path: "/" } })
    yield* jar.set({ name: "theme", value: "1", scope: { url: "https://app.example.com/admin/x" } })
    yield* jar.set({ name: "other", value: "1", scope: { url: "https://other.test/" } })
    yield* jar.set({
      name: "chip",
      value: "1",
      scope: { url: "https://widget.test/" },
      partitionKey: {
        _tag: "Partitioned",
        topLevelSite: Url.Site.make("https://news.test"),
        crossSiteAncestor: Option.none()
      }
    })
    yield* jar.set({ name: "chip", value: "2", scope: { url: "https://widget.test/" } })
    yield* jar.remove(match)
    return (yield* jar.list).map((cookie) => `${cookie.name}@${cookie.partitionKey._tag}`).sort()
  })).pipe(Effect.provide(Browser.layerTest("")))

const everyCookie = [
  "chip@Partitioned",
  "chip@Unpartitioned",
  "other@Unpartitioned",
  "session@Unpartitioned",
  "session_id@Unpartitioned",
  "theme@Unpartitioned"
]
const without = (...removed: ReadonlyArray<string>) => everyCookie.filter((each) => !removed.includes(each))

describe("CookieJar.remove", () => {
  it.effect("removes the cookies an exact name names, in every partition", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* leftAfter({ name: "chip" }), without("chip@Partitioned", "chip@Unpartitioned"))
    }))

  it.effect("removes the cookies whose name a pattern matches", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(
        yield* leftAfter({ name: /^session/ }),
        without("session@Unpartitioned", "session_id@Unpartitioned")
      )
    }))

  it.effect("matches every cookie with a global pattern, which keeps no state between cookies", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(
        yield* leftAfter({ name: /e/g }),
        without(
          "other@Unpartitioned",
          "session@Unpartitioned",
          "session_id@Unpartitioned",
          "theme@Unpartitioned"
        )
      )
      assert.deepStrictEqual(yield* leftAfter({ name: /e/y }), [...everyCookie])
    }))

  it.effect("removes a domain's cookies, whatever their name, by string or pattern", () =>
    Effect.gen(function*() {
      // A string names the domain with or without its leading dot
      assert.deepStrictEqual(yield* leftAfter({ domain: "example.com" }), without("session_id@Unpartitioned"))
      assert.deepStrictEqual(
        yield* leftAfter({ domain: "app.example.com" }),
        without("session@Unpartitioned", "theme@Unpartitioned")
      )
      // A pattern is tested against the domain as stored
      assert.deepStrictEqual(
        yield* leftAfter({ domain: /example\.com$/ }),
        without(
          "session@Unpartitioned",
          "session_id@Unpartitioned",
          "theme@Unpartitioned"
        )
      )
    }))

  it.effect("removes a path's cookies, by string or pattern", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* leftAfter({ path: "/admin" }), without("theme@Unpartitioned"))
      assert.deepStrictEqual(yield* leftAfter({ path: /^\/$/ }), ["theme@Unpartitioned"])
    }))

  it.effect("removes only the cookies in a partition when given its key", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(
        yield* leftAfter({
          name: "chip",
          partitionKey: {
            _tag: "Partitioned",
            topLevelSite: Url.Site.make("https://news.test"),
            crossSiteAncestor: Option.none()
          }
        }),
        without("chip@Partitioned")
      )
      assert.deepStrictEqual(
        yield* leftAfter({
          partitionKey: {
            _tag: "Partitioned",
            topLevelSite: Url.Site.make("https://elsewhere.test"),
            crossSiteAncestor: Option.none()
          }
        }),
        [...everyCookie]
      )
      assert.deepStrictEqual(
        yield* leftAfter({ name: "chip", partitionKey: { _tag: "Unpartitioned" } }),
        without(
          "chip@Unpartitioned"
        )
      )
    }))

  it.effect("removes every cookie when the match names nothing", () =>
    Effect.gen(function*() {
      assert.deepStrictEqual(yield* leftAfter({}), [])
    }))
})

describe("CookieJar filter isolation", () => {
  it.effect("preserves the caller's pattern position", () =>
    Effect.gen(function*() {
      const pattern = /session/g
      pattern.lastIndex = 3
      yield* leftAfter({ name: pattern })
      assert.strictEqual(pattern.lastIndex, 3)
    }))

  it.effect("keeps cookies in partitions with different ancestor bits", () =>
    Effect.scoped(Effect.gen(function*() {
      yield* afterEpoch
      const { cookies } = yield* Browser.newContext()
      for (const ancestor of [false, true]) {
        yield* cookies.set({
          name: "chip",
          value: "1",
          scope: { url: "https://widget.test/" },
          partitionKey: {
            _tag: "Partitioned",
            topLevelSite: Url.Site.make("https://news.test"),
            crossSiteAncestor: Option.some(ancestor)
          }
        })
      }
      assert.strictEqual((yield* cookies.list).length, 2)
      yield* cookies.remove({
        partitionKey: {
          _tag: "Partitioned",
          topLevelSite: Url.Site.make("https://news.test"),
          crossSiteAncestor: Option.some(false)
        }
      })
      assert.strictEqual((yield* cookies.list).length, 1)
    })).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("uses the same absent ancestor bit for setting and removing a partition", () =>
    Effect.scoped(Effect.gen(function*() {
      const { cookies } = yield* Browser.newContext()
      yield* cookies.set({
        name: "cross_site",
        value: "1",
        scope: { url: "https://widget.test/" },
        partitionKey: {
          _tag: "Partitioned",
          topLevelSite: Url.Site.make("https://news.test"),
          crossSiteAncestor: Option.some(true)
        }
      })
      yield* cookies.remove({
        partitionKey: {
          _tag: "Partitioned",
          topLevelSite: Url.Site.make("https://news.test"),
          crossSiteAncestor: Option.none()
        }
      })
      assert.strictEqual((yield* cookies.list).length, 1)
    })).pipe(Effect.provide(Browser.layerTest(""))))

  it.effect("uses the test clock for cookie expiry", () =>
    Effect.scoped(Effect.gen(function*() {
      const { cookies } = yield* Browser.newContext()
      const now = yield* Clock.currentTimeMillis
      yield* cookies.set({
        name: "future",
        value: "1",
        scope: { url: "https://example.test/" },
        expires: new Date(now + 60_000)
      })
      assert.strictEqual((yield* cookies.list).length, 1)
    })).pipe(Effect.provide(Browser.layerTest(""))))
})
