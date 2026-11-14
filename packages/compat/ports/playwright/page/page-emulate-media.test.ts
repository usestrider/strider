/**
 * Playwright's `tests/page/page-emulate-media.spec.ts`: the media a page reports (its type, colour scheme, reduced
 * motion, forced colours, and contrast), and what the page's own CSS does with them.
 *
 * What the port changes:
 * - Playwright's `emulateMedia` sets the fields it is given, leaves the others as they were, and resets a `null` one to
 *   the browser's own value. Strider's `page.emulate` is a registration per call: closing its scope removes every field
 *   it set and restores the values before it. `withMediaEmulation` translates the first into the second: each call
 *   closes the registration before it and opens one that holds every field still set, so a `null` removes a field from
 *   it and an absent field keeps its value. The registration is closed when the test's body ends.
 * - Strider names its values in camel case (`no-preference` is `noPreference`), and the media type is `type`, not `media`.
 * - `page.evaluate(() => matchMedia(…).matches)` is `page.evaluateInMainWorld`. EM-011 and EM-012's `toMatchMedia`
 *   matcher reads the query the same way, and a read that fails counts as no match, as the original's `.catch(() => false)`.
 * - EM-002 and EM-005 pass a string Playwright checks at run time. Strider's `Emulation.Media` is typed, so a bad value
 *   doesn't compile and the run has no such error to check; they are in the ledger as `notApplicable`.
 * - EM-006's 1 ms timer runs beside each `emulateMedia` call, as the original's `Promise.all` runs it, and the
 *   navigation starts before the loop, as the original's does.
 * - EM-009's `it.info` annotation names an upstream issue, which the port doesn't repeat. Its route sets
 *   `Cross-Origin-Opener-Policy` on `/empty.html`, so the navigation replaces the browsing context, as the original's does.
 * - Firefox can't emulate `media` (`Emulation`'s table), so every test that emulates is in the ledger for Firefox as
 *   `needsFeature`, against matrix row `option-page-emulatemedia-media`. EM-012 emulates nothing and runs there.
 */
import { assert } from "@effect/vitest"
import { type Emulation, type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Scope from "effect/Scope"
import { startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

type Media = Emulation.Media

/** Playwright's `emulateMedia` options: a field is set, `null` resets it, and an absent field keeps its value. */
type MediaOptions = { readonly [K in keyof Media]?: Media[K] | null | undefined }

/** Playwright's `emulateMedia`, over Strider's registrations. */
type EmulateMedia = (options: MediaOptions) => Effect.Effect<void, unknown>

/**
 * Runs `body` with an `emulateMedia` that keeps the page's media the way Playwright's `emulateMedia` does, and closes
 * the page's last registration when the body ends.
 */
const withMediaEmulation = Effect.fnUntraced(function*<A, E, R>(
  page: Page.Page,
  body: (emulateMedia: EmulateMedia) => Effect.Effect<A, E, R>
) {
  const media = yield* Ref.make<Media>({})
  const registration = yield* Ref.make<Option.Option<Scope.Closeable>>(Option.none())
  const closeRegistration = Effect.gen(function*() {
    const current = yield* Ref.getAndSet(registration, Option.none())
    if (Option.isSome(current)) yield* Scope.close(current.value, Exit.void)
  })
  const emulateMedia: EmulateMedia = Effect.fnUntraced(function*(options: MediaOptions) {
    const next: Record<string, unknown> = { ...(yield* Ref.get(media)) }
    for (const [key, value] of Object.entries(options)) {
      if (value === null) delete next[key]
      else if (value !== undefined) next[key] = value
    }
    // Close the old registration first: its restoration would otherwise replace the new one's fields
    yield* closeRegistration
    yield* Ref.set(media, next as Media)
    if (Object.keys(next).length === 0) return
    const scope = yield* Scope.make()
    yield* page.emulate({ media: next as Media }).pipe(Scope.provide(scope))
    yield* Ref.set(registration, Option.some(scope))
  })
  return yield* body(emulateMedia).pipe(Effect.ensuring(closeRegistration))
})

/** `matchMedia(query).matches` in the page's main world. */
const matches = (page: Page.Page, query: string) =>
  page.evaluateInMainWorld((query) => matchMedia(query).matches, query)

/** The original's `toMatchMedia` matcher: a query that fails to evaluate counts as not matching. */
const toMatch = (page: Page.Page, query: string) => matches(page, query).pipe(Effect.catch(() => Effect.succeed(false)))

/** The background colour of the page's first `div`, in the main world. */
const divBackground = (page: Page.Page) =>
  page.evaluateInMainWorld(() => window.getComputedStyle(document.querySelector("div")!).backgroundColor)

upstream(import.meta.filename, {}, (test) => {
  test("EM-001", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        assert.isTrue(yield* matches(page, "screen"))
        assert.isFalse(yield* matches(page, "print"))
        yield* emulateMedia({ type: "print" })
        assert.isFalse(yield* matches(page, "screen"))
        assert.isTrue(yield* matches(page, "print"))
        // An empty options object changes nothing
        yield* emulateMedia({})
        assert.isFalse(yield* matches(page, "screen"))
        assert.isTrue(yield* matches(page, "print"))
        yield* emulateMedia({ type: null })
        assert.isTrue(yield* matches(page, "screen"))
        assert.isFalse(yield* matches(page, "print"))
      })))

  test("EM-003", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        yield* emulateMedia({ colorScheme: "light" })
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: light)"))
        assert.isFalse(yield* matches(page, "(prefers-color-scheme: dark)"))
        yield* emulateMedia({ colorScheme: "dark" })
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: dark)"))
        assert.isFalse(yield* matches(page, "(prefers-color-scheme: light)"))
      })))

  test("EM-004", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: light)"))
        assert.isFalse(yield* matches(page, "(prefers-color-scheme: dark)"))
        yield* emulateMedia({ colorScheme: "dark" })
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: dark)"))
        assert.isFalse(yield* matches(page, "(prefers-color-scheme: light)"))
        yield* emulateMedia({ colorScheme: null })
        assert.isFalse(yield* matches(page, "(prefers-color-scheme: dark)"))
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: light)"))
      })))

  test("EM-006", ({ page, server }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        yield* emulateMedia({ colorScheme: "light" })
        const navigated = yield* startWaiting(page.goto(server.EMPTY_PAGE))
        for (let i = 0; i < 9; i++) {
          // The original's 1 ms timer runs beside each call, a fixed wait it makes itself
          yield* Effect.all(
            [emulateMedia({ colorScheme: (["dark", "light"] as const)[i & 1] }), Effect.sleep("1 millis")],
            { concurrency: "unbounded" }
          )
        }
        yield* Fiber.join(navigated.fiber)
        assert.isTrue(yield* matches(page, "(prefers-color-scheme: dark)"))
      })))

  test("EM-007", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        yield* page.setContent(`
    <style>
      @media (prefers-color-scheme: dark) {
        div {
          background: black;
          color: white;
        }
      }
      @media (prefers-color-scheme: light) {
        div {
          background: white;
          color: black;
        }
      }

    </style>
    <div>Hello</div>
  `)

        yield* emulateMedia({ colorScheme: "light" })
        assert.strictEqual(yield* divBackground(page), "rgb(255, 255, 255)")

        yield* emulateMedia({ colorScheme: "dark" })
        assert.strictEqual(yield* divBackground(page), "rgb(0, 0, 0)")

        yield* emulateMedia({ colorScheme: "light" })
        assert.strictEqual(yield* divBackground(page), "rgb(255, 255, 255)")
      })))

  test("EM-008", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        assert.isTrue(yield* matches(page, "(prefers-reduced-motion: no-preference)"))
        yield* emulateMedia({ reducedMotion: "reduce" })
        assert.isTrue(yield* matches(page, "(prefers-reduced-motion: reduce)"))
        assert.isFalse(yield* matches(page, "(prefers-reduced-motion: no-preference)"))
        yield* emulateMedia({ reducedMotion: "noPreference" })
        assert.isFalse(yield* matches(page, "(prefers-reduced-motion: reduce)"))
        assert.isTrue(yield* matches(page, "(prefers-reduced-motion: no-preference)"))
        yield* emulateMedia({ reducedMotion: null })
      })))

  test("EM-009", ({ page, server }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        // Pre-conditions
        assert.isFalse(yield* matches(page, "(prefers-reduced-motion: reduce)"))
        assert.isFalse(yield* matches(page, "(forced-colors: active)"))

        // Emulation
        yield* emulateMedia({ forcedColors: "active", reducedMotion: "reduce" })
        assert.isTrue(yield* matches(page, "(prefers-reduced-motion: reduce)"))
        assert.isTrue(yield* matches(page, "(forced-colors: active)"))

        // Force CanonicalBrowsingContext replacement in Firefox.
        server.setRoute("/empty.html", (_req, res) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
          // Note: without 'onload', Firefox sometimes does not fire the load event over the protocol. The reason is unclear.
          res.end(`
      <div>Hello there!</div>
      <script>window.onload = () => console.log('onload')</script>
    `)
        })
        yield* page.goto(server.EMPTY_PAGE)

        assert.isTrue(yield* matches(page, "(prefers-reduced-motion: reduce)"))
        assert.isTrue(yield* matches(page, "(forced-colors: active)"))
      })))

  test("EM-010", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        assert.isTrue(yield* matches(page, "(forced-colors: none)"))
        yield* emulateMedia({ forcedColors: "none" })
        assert.isTrue(yield* matches(page, "(forced-colors: none)"))
        assert.isFalse(yield* matches(page, "(forced-colors: active)"))
        yield* emulateMedia({ forcedColors: "active" })
        assert.isFalse(yield* matches(page, "(forced-colors: none)"))
        assert.isTrue(yield* matches(page, "(forced-colors: active)"))
        yield* emulateMedia({ forcedColors: null })
        assert.isTrue(yield* matches(page, "(forced-colors: none)"))
      })))

  test("EM-011", ({ page }) =>
    withMediaEmulation(page, (emulateMedia) =>
      Effect.gen(function*() {
        assert.isTrue(yield* toMatch(page, "(prefers-contrast: no-preference)"))
        yield* emulateMedia({ contrast: "noPreference" })
        assert.isTrue(yield* toMatch(page, "(prefers-contrast: no-preference)"))
        assert.isFalse(yield* toMatch(page, "(prefers-contrast: more)"))
        yield* emulateMedia({ contrast: "more" })
        assert.isFalse(yield* toMatch(page, "(prefers-contrast: no-preference)"))
        assert.isTrue(yield* toMatch(page, "(prefers-contrast: more)"))
        yield* emulateMedia({ contrast: null })
        assert.isTrue(yield* toMatch(page, "(prefers-contrast: no-preference)"))
      })))

  test("EM-012", ({ page }) =>
    Effect.gen(function*() {
      assert.isTrue(yield* toMatch(page, "(hover: hover)"))
      assert.isTrue(yield* toMatch(page, "(pointer: fine)"))
    }))
})
