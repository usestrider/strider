/**
 * Playwright's `tests/library/browsercontext-device.spec.ts`: a context emulating a phone (`devices['iPhone 6']` and
 * `devices['iPhone 12']`), and clicking, scrolling, and the viewport and screen size of those devices.
 *
 * What the port changes:
 * - Each test makes its own context and page (`page: false`), as the original does through its `browser` and
 *   `contextFactory` fixtures. A context closes with the test's scope.
 * - Playwright's `devices['iPhone 6']` is written out, as the values its device table holds: Strider has no device table
 *   (`property-playwright-devices`). The emulation is the one `browsercontext-viewport-mobile.test.ts` writes out, with
 *   the same viewport, pixel ratio, mobile and touch flags, and user agent.
 * - `browser.newContext({ ...iPhone })` is `Browser.newContext({ emulation })`, and `contextFactory(device)` is the same.
 * - `page.$("button")` and `button.click()` are `page.locator("button").click()`, which resolves the element when it
 *   clicks, as the element handle did once it was found.
 * - DV-002 and DV-003 change the page's own button and scroll through `page.evaluateInMainWorld`, as Playwright's
 *   `page.evaluate` runs in the main world. DV-002's `page.evaluate('result')` reads the page's global with
 *   `page.evaluateInMainWorld`.
 * - `textContent()` is `readText`.
 * - DV-005 and DV-006 are `it.skip(browserName === 'webkit')` upstream. Those skips are Playwright's frozen WebKit builds,
 *   not the stock browser Strider drives, so the port runs them everywhere.
 * - DV-001 through DV-006 need a mobile viewport, which Firefox and stock WebKit don't emulate, so they're ledgered for
 *   those browsers (see the ledger). DV-007 sets a screen size apart from its viewport (844 against 664 high), and Strider
 *   has no screen option, so it isn't ported. DV-008 expects the screen to equal the viewport, so it's ported and
 *   asserts that.
 */
import { assert } from "@effect/vitest"
import { Browser, Emulation } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import { upstream } from "../../harness/upstream.ts"

/** Playwright's `devices['iPhone 6']`, the emulation of Playwright's device table (see the header). */
const iPhone6: Emulation.Emulation = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 11_0 like Mac OS X) AppleWebKit/604.1.38 (KHTML, like Gecko) Version/26.4 Mobile/15A372 Safari/604.1",
  viewport: { width: 375, height: 667, deviceScaleFactor: 2, mobile: true },
  touch: true
}

upstream(import.meta.filename, {}, (test) => {
  test("DV-001", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/mobile.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.innerWidth), 375)
      assert.include(yield* page.evaluateInMainWorld(() => navigator.userAgent), "iPhone")
    }))

  test("DV-002", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/button.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => {
        const button = document.querySelector("button")
        if (button) button.style.marginTop = "200px"
      })
      yield* page.locator("button").click()
      assert.strictEqual(yield* page.evaluateInMainWorld(() => Reflect.get(window, "result")), "Clicked")
    }))

  test("DV-003", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({
        emulation: { viewport: { width: 400, height: 400, deviceScaleFactor: 1, mobile: true } }
      })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.locator("#button-91").click()
      assert.strictEqual(yield* page.locator("#button-91").readText, "clicked")
    }))

  test("DV-004", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.setContent(`
          <meta name="viewport" content="width=device-width, user-scalable=no" />
          Lorem ipsum dolor sit amet consectetur adipiscing elit proin, integer curabitur imperdiet rhoncus cursus tincidunt bibendum, consequat sed magnis laoreet luctus mollis tellus. Nisl parturient mus accumsan feugiat sem laoreet magnis nisi, aptent per sollicitudin gravida orci ac blandit, viverra eros praesent auctor vivamus semper bibendum. Consequat sed habitasse luctus dictumst gravida platea semper phasellus, nascetur ridiculus purus est varius quisque et scelerisque, id vehicula eleifend montes sollicitudin dis velit. Pellentesque ridiculus per natoque et eleifend taciti nunc, laoreet auctor at condimentum imperdiet ante, conubia mi cubilia scelerisque sociosqu sem.</p> <p>Curabitur magna per felis primis mauris non dapibus luctus ultricies eros, quis et egestas condimentum lobortis eget semper montes litora purus, ridiculus elementum sollicitudin imperdiet dictum lacinia parturient cras eu. Risus cum varius rhoncus eros torquent pretium taciti id erat dis egestas, nibh tristique montes convallis metus lacus phasellus blandit ut auctor bibendum semper, facilisis mi integer eget ultrices lobortis odio viverra duis dui. Risus ullamcorper lacinia in venenatis sodales fusce tortor potenti volutpat quis, dictum vulputate suspendisse velit mollis torquent sociis aptent morbi, senectus nascetur justo maecenas conubia magnis viverra gravida fames. Phasellus sed nec gravida nibh class augue lectus, blandit quis turpis orci diam nam pellentesque, ultricies metus imperdiet hendrerit lacinia lacus.</p> <p>Inceptos facilisi montes cum hendrerit, pulvinar ut tellus eget velit, arcu nulla aenean. Phasellus augue urna nostra molestie interdum vehicula, posuere fames cum euismod massa curabitur donec, inceptos cubilia tellus facilisis fermentum. Lacus laoreet facilisis ultrices cursus quisque at ad porta vestibulum massa inceptos, curae class aliquet maecenas cum ullamcorper pulvinar erat mus vitae. Cum in aenean convallis dis quam tincidunt justo sed quisque, imperdiet faucibus hendrerit felis commodo scelerisque magnis vehicula etiam leo, eros varius platea lobortis maecenas condimentum nisi phasellus. Turpis vulputate mus himenaeos sociosqu facilisis dignissim leo quam, ultricies habitasse commodo molestie est tortor vitae et, porttitor risus erat cursus phasellus facilisi litora.</p> <p>Nostra habitasse egestas magnis velit pellentesque parturient cum lectus viverra, vestibulum sociosqu nunc vel urna consequat lacinia phasellus at sapien, aenean pretium dictum sed montes interdum imperdiet iaculis. Leo hac eros arcu senectus maecenas, tortor pulvinar venenatis lacinia volutpat, mattis platea ut facilisi. Aenean condimentum at et donec sociosqu fermentum luctus potenti semper vulputate, sapien justo non est auctor gravida ultricies fames per commodo, sed habitasse facilisi nulla quisque hendrerit aliquet viverra bibendum.</p> <p>Interdum nisl quam etiam montes porttitor laoreet nullam senectus velit, mauris proin tellus imperdiet litora venenatis fames massa quis, sollicitudin justo vivamus curae in sociis suscipit facilisi. Platea inceptos lacus elementum pellentesque quam euismod dictumst sociis tincidunt vulputate porttitor eros, turpis netus ut ad tempor sapien aliquet sodales molestie consequat nostra. Cum augue in quisque primis ut nunc sodales, sem orci tempus posuere cubilia suspendisse lacinia ligula, magna sed ridiculus at maecenas habitant.</p> <p>Natoque magna ac feugiat tellus bibendum diam, metus lobortis nisl ornare varius praesent, dictumst gravida lacus parturient semper. Pellentesque faucibus congue fusce posuere placerat dictum vitae, dui vestibulum eu sociis tempus aliquam ultricies malesuada, potenti laoreet lacus sem gravida nisi. Nostra platea sagittis hendrerit congue conubia senectus bibendum quis sapien pharetra, scelerisque nam imperdiet fermentum feugiat suspendisse viverra luctus at, semper ac consequat vitae mi gravida parturient mollis nascetur. Vel taciti justo consequat primis et blandit convallis sed, felis purus fusce a venenatis etiam aenean scelerisque, fringilla volutpat sagittis egestas rutrum id dis.</p> <p>Feugiat fermentum tortor ante ac iaculis sollicitudin ut interdum, cras orci ullamcorper potenti tristique vehicula. Molestie tortor ullamcorper rutrum turpis malesuada phasellus sem ultricies praesent mattis lobortis porta, senectus venenatis diam nostra laoreet volutpat per aptent justo elementum cum. Urna cursus vel felis cras eleifend arcu enim magnis, duis rutrum nibh nascetur cubilia interdum ultrices curae, id lacus aliquam dictumst diam fringilla lacinia.</p> <p>Luctus diam morbi eget tellus libero taciti faucibus inceptos, natoque facilisis lectus maecenas risus dapibus suscipit nibh, vel curae conubia orci imperdiet metus fusce. Condimentum massa donec luctus pharetra cum, in viverra placerat nisl litora facilisis, neque nascetur sociis dictumst. Suscipit accumsan eget rhoncus pharetra justo malesuada aliquet, suspendisse metus eleifend tincidunt varius ridiculus, convallis primis vitae curabitur quis mus.</p> <p>Gravida donec lacus molestie tortor aenean ultricies blandit per tempor, nostra penatibus orci vestibulum semper lectus vel a, montes potenti cum dapibus natoque eu volutpat nulla. Himenaeos purus nam malesuada habitasse nisl pharetra laoreet feugiat mi non, ultrices ultricies a cras ante eu venenatis ligula. Suscipit ut mus habitasse at aliquet sodales commodo justo, feugiat platea sagittis phasellus eleifend pellentesque interdum iaculis, integer cubilia montes metus hendrerit tincidunt purus.</p> <p>Vel posuere tellus dapibus eget duis cubilia, nec class vehicula libero gravida ligula, tempus urna taciti donec congue. Facilisis ridiculus congue cum dui per augue natoque, molestie hac etiam pellentesque dignissim urna class, feugiat aenean massa himenaeos penatibus ut eu, convallis purus et fusce tempus mattis. At mattis suscipit porta nostra nec facilisis sodales turpis, integer et lectus conubia justo nam congue taciti odio, fermentum semper cubilia fusce nunc purus velit.
          <button>hi</button>
  `)
      yield* page.evaluateInMainWorld(() => window.scroll(0, 100))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollY), 100)

      yield* page.evaluateInMainWorld(() => window.scroll(0, 200))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollY), 200)
    }))

  test("DV-005", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      yield* page.evaluateInMainWorld(() => window.scroll(0, 100))

      yield* page.goto(server.PREFIX + "/input/scrollable2.html", { waitUntil: "load" })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollY), 0)
    }))

  test("DV-006", { page: false }, ({ server }) =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.goto(server.PREFIX + "/input/scrollable.html", { waitUntil: "load" })
      assert.isAbove(yield* page.evaluateInMainWorld(() => document.body.scrollHeight), 1000)
      yield* page.evaluateInMainWorld(() => window.scroll(0, 100))
      assert.strictEqual(yield* page.evaluateInMainWorld(() => window.scrollY), 100)
    }))

  test("DV-008", { page: false }, () =>
    Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: iPhone6 })
      const page = yield* context.newPage
      yield* page.setContent(`<meta name="viewport" content="width=device-width, user-scalable=no" />`)

      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => ({ width: window.screen.width, height: window.screen.height })),
        { width: 375, height: 667 }
      )
      assert.deepStrictEqual(
        yield* page.evaluateInMainWorld(() => ({ width: window.innerWidth, height: window.innerHeight })),
        { width: 375, height: 667 }
      )
    }))
})
