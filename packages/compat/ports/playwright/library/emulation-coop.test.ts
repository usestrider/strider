/**
 * Playwright's `tests/library/emulation-coop.spec.ts`: an emulated context's and page's settings hold on a page served
 * with a Cross-Origin-Opener-Policy header, as they do on a plain one.
 *
 * What the port changes:
 * - `browser.newContext(options)` is `Browser.newContext`, whose `emulation` holds the settings for the context's life.
 *   `colorScheme`, `reducedMotion`, and `contrast` are its `media`; `deviceScaleFactor` is the viewport's; `hasTouch` is
 *   `touch`. Each probe closes its context at the end, as the original's does.
 * - `page.emulateMedia(media)` is `page.emulate({ media })`, whose `type` is Playwright's `media`.
 * - `page.evaluate` runs in the main world, so the probe reads with `page.evaluateInMainWorld`.
 * - The original's `screen` in EM-027 isn't in Strider's emulation (the matrix row for the option is missing), so that
 *   test is `needsFeature` in the ledger rather than ported without its setup.
 * - `setupRoutes` is `server.setRoute`, answering with the header the original sets.
 */
import { assert } from "@effect/vitest"
import { Browser, Emulation, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type { ServerShape } from "../../harness/server.ts"
import { upstream } from "../../harness/upstream.ts"

const plainPath = "/plain.html"
const coopPath = "/coop.html"

/** The settings a probe reads back from the page, in its main world. */
const readSettings = () => ({
  dark: matchMedia("(prefers-color-scheme: dark)").matches,
  dpr: devicePixelRatio,
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  forcedColors: matchMedia("(forced-colors: active)").matches,
  contrast: matchMedia("(prefers-contrast: more)").matches,
  print: matchMedia("print").matches,
  lang: navigator.language,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ua: navigator.userAgent,
  touch: "ontouchstart" in window,
  coarse: matchMedia("(pointer: coarse)").matches,
  viewport: [innerWidth, innerHeight],
  screen: [screen.width, screen.height],
  orientation: screen.orientation.type
})

type Settings = ReturnType<typeof readSettings>

/** Playwright's `expect(actual).toEqual(expect.objectContaining(expected))`: each expected field equals the actual one. */
const assertContains = (actual: Partial<Settings>, expected: Partial<Settings>) => {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key as keyof Settings], value, key)
  }
}

/** The page at `path`, in a context made with `options`, with `media` emulated on the page when given. */
const probe = Effect.fnUntraced(function*(
  options: UserContext.Options,
  path: string,
  emulation?: Emulation.Emulation
) {
  const context = yield* Browser.newContext(options)
  const page = yield* context.newPage
  if (emulation !== undefined) yield* page.emulate(emulation)
  yield* page.goto(path, { waitUntil: "load" })
  return yield* page.evaluateInMainWorld(readSettings)
}, Effect.scoped)

/** Serves `/plain.html` and `/coop.html`, the second with the COOP header. */
const setupRoutes = (server: ServerShape) => {
  for (const [path, coop] of [[plainPath, false], [coopPath, true]] as const) {
    server.setRoute(path, (_req, res) => {
      if (coop) res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
      res.setHeader("Content-Type", "text/html")
      res.end("<title>t</title><p>hello</p>")
    })
  }
}

upstream(import.meta.filename, {}, (test) => {
  test("EM-025", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      setupRoutes(server)
      const options: UserContext.Options = {
        emulation: {
          media: { colorScheme: "dark", reducedMotion: "reduce", contrast: "more" },
          viewport: { width: 500, height: 600, deviceScaleFactor: 2 },
          locale: "de-DE",
          timezone: "Asia/Tokyo",
          userAgent: "MyUA",
          touch: true
        }
      }
      const plain = yield* probe(options, server.PREFIX + plainPath)
      assertContains(plain, {
        dark: true,
        dpr: 2,
        reducedMotion: true,
        contrast: true,
        lang: "de-DE",
        tz: "Asia/Tokyo",
        ua: "MyUA",
        touch: true,
        viewport: [500, 600]
      })
      const coop = yield* probe(options, server.PREFIX + coopPath)
      assert.deepEqual(coop, plain)
    }))

  test("EM-026", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      setupRoutes(server)
      const emulation: Emulation.Emulation = {
        media: { type: "print", colorScheme: "dark", reducedMotion: "reduce", contrast: "more", forcedColors: "active" }
      }
      const plain = yield* probe({}, server.PREFIX + plainPath, emulation)
      assertContains(plain, {
        print: true,
        reducedMotion: true,
        contrast: true,
        forcedColors: true
      })
      const coop = yield* probe({}, server.PREFIX + coopPath, emulation)
      assert.deepEqual(coop, plain)
    }))
})
