/**
 * Playwright's `tests/page/page-localstorage.spec.ts`: a page's `localStorage` and `sessionStorage`, read and written
 * through the page, for the origin it's on.
 *
 * What the port changes:
 * - `page.localStorage.items()` is `page.localStorage.entries`, which gives `[key, value]` pairs in storage order. The
 *   original compares sets of `{ name, value }` objects, which ignore order, so the port sorts the pairs by key before
 *   comparing them with the sorted expectation.
 * - `getItem` returning `null` is `get`, which gives `Option.none()` for an absent key.
 * - `setItem`, `removeItem`, and `clear` are `set`, `remove`, and `clear`; `clear` is a value, not a call.
 * - `page.evaluate` reads the page's own `localStorage` in the main world, with `page.evaluateInMainWorld`.
 * - ST-031 checks that storage is scoped to the origin, on the two origins the fixture server serves.
 * - ST-023's `it.skip` is Electron's, so it's not a skip here.
 */
import { assert } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { upstream } from "../../harness/upstream.ts"

/** The `[key, value]` pairs of a storage area, sorted by key, which the original's order-insensitive sets compare. */
const sortedEntries = (entries: ReadonlyArray<readonly [string, string]>) =>
  [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

upstream(import.meta.filename, {}, (test) => {
  test("ST-023", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.localStorage.entries, [])
    }))

  test("ST-024", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.localStorage.get("absent"), Option.none())
    }))

  test("ST-025", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.localStorage.set("alpha", "1")
      yield* page.localStorage.set("beta", "2")

      assert.deepStrictEqual(sortedEntries(yield* page.localStorage.entries), [["alpha", "1"], ["beta", "2"]])
      assert.deepStrictEqual(yield* page.localStorage.get("alpha"), Option.some("1"))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => localStorage.getItem("alpha")), "1")
    }))

  test("ST-026", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.localStorage.set("k", "first")
      yield* page.localStorage.set("k", "second")
      assert.deepStrictEqual(yield* page.localStorage.get("k"), Option.some("second"))
    }))

  test("ST-027", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.localStorage.set("a", "1")
      yield* page.localStorage.set("b", "2")

      yield* page.localStorage.remove("a")
      assert.deepStrictEqual(yield* page.localStorage.entries, [["b", "2"]])
    }))

  test("ST-028", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.localStorage.set("a", "1")
      yield* page.localStorage.set("b", "2")

      yield* page.localStorage.clear
      assert.deepStrictEqual(yield* page.localStorage.entries, [])
    }))

  test("ST-029", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.sessionStorage.entries, [])

      yield* page.sessionStorage.set("s1", "v1")
      yield* page.sessionStorage.set("s2", "v2")
      assert.deepStrictEqual(sortedEntries(yield* page.sessionStorage.entries), [["s1", "v1"], ["s2", "v2"]])
      assert.deepStrictEqual(yield* page.sessionStorage.get("s1"), Option.some("v1"))

      yield* page.sessionStorage.remove("s1")
      assert.deepStrictEqual(yield* page.sessionStorage.entries, [["s2", "v2"]])

      yield* page.sessionStorage.clear
      assert.deepStrictEqual(yield* page.sessionStorage.entries, [])
    }))

  test("ST-030", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.localStorage.set("shared", "local")
      yield* page.sessionStorage.set("shared", "session")

      assert.deepStrictEqual(yield* page.localStorage.get("shared"), Option.some("local"))
      assert.deepStrictEqual(yield* page.sessionStorage.get("shared"), Option.some("session"))

      yield* page.localStorage.clear
      assert.deepStrictEqual(yield* page.localStorage.entries, [])
      assert.deepStrictEqual(yield* page.sessionStorage.get("shared"), Option.some("session"))
    }))

  test("ST-031", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      yield* page.localStorage.set("k", "origin-1")

      yield* page.goto(server.CROSS_PROCESS_PREFIX + "/empty.html", { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.localStorage.entries, [])
      yield* page.localStorage.set("k", "origin-2")

      yield* page.goto(server.PREFIX + "/empty.html", { waitUntil: "load" })
      assert.deepStrictEqual(yield* page.localStorage.get("k"), Option.some("origin-1"))
    }))
})
