/**
 * Playwright's `tests/library/page-clock.spec.ts`: the clock a page's scripts read, which replaces `Date`,
 * `performance.now`, and its timers and frames, and how `runFor`, `fastForward`, `pauseAt`, `setSystemTime`,
 * `setFixedTime` and `resume` move it.
 *
 * What the port changes:
 * - Strider's clock is `page.clock.install(mode)` with `adjust`, `setTime` and `resume`; it has no `pauseAt`,
 *   `setSystemTime`, `setFixedTime`, `runFor` or `fastForward`. A controlled clock starts paused at its `at`, so
 *   Playwright's `install({ time: 0 })` then `pauseAt(t)` is `install({ mode: "controlled", at: 0 })` then
 *   `setTime(t)`. `setSystemTime(t)` is `setTime(t)`, `setFixedTime(t)` is `install({ mode: "fixed", at: t })`, and
 *   `runFor(ms)` is `adjust(ms)`. `fastForward(ms)` is a jump to the page's `Date.now()` plus `ms` (`fastForward`
 *   below), which fires each timer due in the gap once, as Playwright's does.
 * - Playwright's `install()` with no time runs in real time: `install({ mode: "offset", by: 0 })`. A clock that
 *   starts at `time` and runs in real time is a controlled clock at `time`, then `resume` (CK-035).
 * - Playwright's `page.clock` is its context's clock (`client/page.ts`: `this.clock = this._browserContext.clock`), so
 *   a popup shares it. Strider's page clock covers only its own page, so the popup tests use `context.clock`, which
 *   covers the context's pages and their popups.
 * - Playwright's `calls` fixture exposes `stub` through a binding, whose calls arrive asynchronously. The port
 *   defines `window.stub` in the page's main world, recording each call there, and reads the record with
 *   `page.evaluateInMainWorld` after each step (`recordCalls`, `callsOf`). The page's own timers call it as they do
 *   in the original.
 * - Playwright's duration strings (`"08"`, `"01:00"`, `"02:34:10"`, `"01:50"`) are Strider's Duration strings
 *   (`"8 seconds"`, `"1 minute"`, `"9250 seconds"`, `"110 seconds"`). The port asserts the same clock behavior for the
 *   same duration. CK-012's malformed string is passed as a string, which Strider rejects as an invalid input.
 * - `page.evaluate` runs in the page's main world, so it's `page.evaluateInMainWorld`. `page.waitForTimeout(ms)` is
 *   `Effect.sleep`, a fixed wait the original makes itself.
 * - A script that opens a popup runs as a user gesture under Strider's popup blocking (`Page.withUserGesture`).
 * - A popup is read once its first navigation has committed, and once its document has parsed or loaded, as
 *   popup.test.ts does (`committed`, `parsed`, `loaded`).
 * - CK-049 to CK-052 are Playwright's `Temporal.Now` shim. Strider's clock doesn't replace `Temporal`; the tests run
 *   as written and are expected to fail there. CK-053 is `AbortSignal.timeout` under the clock, and CK-026 is
 *   `performance.timeOrigin`; Strider's clock covers `Date` and `performance.now` with timers and frames, so those
 *   run as written too.
 * - CK-033 and CK-034 (`fastForward` and `runFor` on a fixed clock, which Strider's adjust refuses) aren't ported; see
 *   the ledger. Neither are CK-036 to CK-038, which move or pause a clock that is running in real time (`runFor`,
 *   `fastForward` and `pauseAt` after a flowing `install`): Strider's `adjust` and `setTime` refuse a clock that runs
 *   in real time (`WrongMode`), and nothing returns a resumed clock to a controlled one, so a controlled clock from
 *   0 would pass them without the running time that is their point.
 * - CK-055 and CK-056 are in `page-clock.frozen.spec.ts`, which runs only under Playwright's `PW_CLOCK` modes; they're
 *   in the ledger.
 */
import { assert } from "@effect/vitest"
import { Browser, ConsoleMessage, Page, PageClock, Popup } from "@usestrider/browser"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { failureOf, startWaiting } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

/**
 * The clock error of a call the original expects to be refused: `failureOf`, narrowed to a `PageClockError`, so its
 * `reason` is read as Strider's typed one.
 */
const clockRefusal = Effect.fnUntraced(function*<A, E>(effect: Effect.Effect<A, E>, what: string) {
  const failure = yield* failureOf(effect, what)
  assert(PageClock.isPageClockError(failure), `${what} failed, but not with a clock error`)
  return failure as Extract<E, PageClock.PageClockError>
})

/** Playwright's `page.evaluate(() => Date.now())`. */
const nowOf = (page: Page.Page) => page.evaluateInMainWorld(() => Date.now())

/** Playwright's `install({ time: 0 })` then `pauseAt(at)`: a controlled clock that starts at 0, then jumps to `at`. */
const pausedAt = Effect.fnUntraced(function*(clock: PageClock.PageClock, at: number) {
  yield* clock.install({ mode: "controlled", at: 0 })
  yield* clock.setTime(at)
})

/**
 * Playwright's `fastForward(ms)`: a jump to the time `by` after the page's now, firing each timer due in the gap once.
 * Strider's `setTime` is that jump on a controlled or fixed clock.
 */
const fastForward = Effect.fnUntraced(function*(page: Page.Page, clock: PageClock.PageClock, by: Duration.Input) {
  const now = yield* nowOf(page)
  yield* clock.setTime(now + Duration.toMillis(Duration.fromInputUnsafe(by)))
})

interface Call {
  readonly params: ReadonlyArray<unknown>
}

/** Playwright's `calls` fixture: `window.stub` records each call it's given, in the page's main world. */
const recordCalls = (page: Page.Page) =>
  page.evaluateInMainWorld(() => {
    const record = window as any
    record.calls = []
    record.stub = (...params: Array<unknown>) => {
      record.calls.push({ params })
    }
  })

/** The calls `window.stub` has recorded, read from the page. */
const callsOf = (page: Page.Page) => page.evaluateInMainWorld(() => (window as any).calls as Array<Call>)

/** Playwright's `beforeEach` of the `runFor`, `fastForward` and `stubTimers` groups: a clock paused at 1000, with `calls`. */
const armed = Effect.fnUntraced(function*(page: Page.Page) {
  yield* pausedAt(page.clock, 1000)
  yield* recordCalls(page)
})

/** Playwright's `waitForEvent("popup")` readiness: the popup's first navigation has committed to `url`. */
const committed = (popup: Page.Page, url: string) => popup.url.waitFor((current) => current === url)

/** Playwright's `waitForLoadState("domcontentloaded")`: the document has parsed. */
const parsed = (status: Page.Status) => status._tag === "Open" && status.document.readiness !== "loading"

/** Playwright's `waitForLoadState()`: the document has finished loading. */
const loaded = (status: Page.Status) => status._tag === "Open" && status.document.readiness === "complete"

upstream(import.meta.filename, {}, (test) => {
  test("CK-001", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub)
      })
      yield* page.clock.adjust(0)
      assert.lengthOf(yield* callsOf(page), 1)
    }))

  test("CK-002", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 100)
      })
      yield* page.clock.adjust(10)
      assert.deepStrictEqual(yield* callsOf(page), [])
    }))

  test("CK-003", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 100)
      })
      yield* page.clock.adjust(100)
      assert.lengthOf(yield* callsOf(page), 1)
    }))

  test("CK-004", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 100)
        setTimeout((window as any).stub, 100)
      })
      yield* page.clock.adjust(100)
      assert.lengthOf(yield* callsOf(page), 2)
    }))

  test("CK-005", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 100)
        setTimeout((window as any).stub, 100)
        setTimeout((window as any).stub, 99)
        setTimeout((window as any).stub, 100)
      })
      yield* page.clock.adjust(100)
      assert.strictEqual((yield* callsOf(page)).length, 4)
    }))

  test("CK-006", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 150)
      })
      yield* page.clock.adjust(50)
      assert.deepStrictEqual(yield* callsOf(page), [])
      yield* page.clock.adjust(100)
      assert.lengthOf(yield* callsOf(page), 1)
    }))

  test("CK-007", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          throw new Error()
        }, 100)
        setTimeout((window as any).stub, 120)
      })
      // Playwright's `runFor` rejects when a timer throws; Strider reports the error to the page and goes on
      yield* failureOf(page.clock.adjust(120), "runFor")
      assert.lengthOf(yield* callsOf(page), 1)
    }))

  test("CK-008", ({ page }) =>
    Effect.gen(function*() {
      // The group's `beforeEach` (paused at 1000), then Playwright's `setSystemTime(0)`
      yield* armed(page)
      yield* page.clock.setTime(0)
      yield* page.evaluateInMainWorld(() => {
        setInterval(() => {
          ;(window as any).stub(new Date().getTime())
        }, 10)
      })
      yield* page.clock.adjust(100)
      assert.deepStrictEqual(yield* callsOf(page), [
        { params: [10] },
        { params: [20] },
        { params: [30] },
        { params: [40] },
        { params: [50] },
        { params: [60] },
        { params: [70] },
        { params: [80] },
        { params: [90] },
        { params: [100] }
      ])
    }))

  test("CK-009", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setInterval((window as any).stub, 4000)
      })
      // Playwright's `runFor("08")`: eight seconds
      yield* page.clock.adjust("8 seconds")
      assert.strictEqual((yield* callsOf(page)).length, 2)
    }))

  test("CK-010", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setInterval((window as any).stub, 6000)
      })
      // Playwright's `runFor("01:00")`: one minute
      yield* page.clock.adjust("1 minute")
      assert.strictEqual((yield* callsOf(page)).length, 10)
    }))

  test("CK-011", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setInterval((window as any).stub, 10000)
      })
      // Playwright's `runFor("02:34:10")`: two hours, 34 minutes and 10 seconds
      yield* page.clock.adjust("9250 seconds")
      assert.strictEqual((yield* callsOf(page)).length, 925)
    }))

  test("CK-012", ({ page, server }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setInterval((window as any).stub, 10000)
      })
      // A string that isn't a duration (Playwright's `"12:02:34:10"`) is an invalid input
      const malformed: string = "12:02:34:10"
      const invalid = yield* clockRefusal(page.clock.adjust(malformed as Duration.Input), "runFor")
      assert.strictEqual(invalid.reason._tag, "InvalidInput")
      assert.include(invalid.message, "Invalid duration")
      // Playwright's `runFor(NaN)` rejects with `clock.runFor: Invalid ticks: NaN`
      const nan = yield* clockRefusal(page.clock.adjust(NaN), "runFor(NaN)")
      assert.strictEqual(nan.reason._tag, "InvalidInput")
      assert.include(nan.message, "NaN")
      // Playwright's `fastForward(Infinity)` rejects with `clock.fastForward: Invalid ticks: Infinity`; a jump to
      // Infinity is `setTime(Infinity)`
      const infinite = yield* clockRefusal(page.clock.setTime(Infinity), "fastForward(Infinity)")
      assert.strictEqual(infinite.reason._tag, "InvalidInput")
      assert.include(infinite.message, "Infinity")
      assert.deepStrictEqual(yield* callsOf(page), [])
      yield* page.goto(server.EMPTY_PAGE)
      assert.strictEqual(yield* nowOf(page), 1000)
    }))

  test("CK-013", ({ page }) =>
    Effect.gen(function*() {
      // The group's `beforeEach` (paused at 1000), then Playwright's `setSystemTime(0)`
      yield* pausedAt(page.clock, 1000)
      yield* page.clock.setTime(0)
      const value = 200
      yield* page.clock.adjust(value)
      assert.strictEqual(yield* nowOf(page), value)
    }))

  test("CK-014", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub("should not be logged")
        }, 1000)
      })
      yield* fastForward(page, page.clock, 500)
      assert.deepStrictEqual(yield* callsOf(page), [])
    }))

  test("CK-015", ({ page, server }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.goto(server.EMPTY_PAGE)
      yield* recordCalls(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub(Date.now())
        }, 1000)
      })
      const fiftyDays = 50 * 24 * 60 * 60 * 1000
      yield* fastForward(page, page.clock, fiftyDays)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: [1000 + fiftyDays] }])
      assert.strictEqual(yield* nowOf(page), 1000 + fiftyDays)
      yield* page.reload()
      assert.strictEqual(yield* nowOf(page), 1000 + fiftyDays)
    }))

  test("CK-016", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* recordCalls(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub(Date.now())
        }, 100000) // 100000 = 1:40
      })
      // Playwright's `fastForward("01:50")`: one minute and fifty seconds
      yield* fastForward(page, page.clock, "110 seconds")
      assert.deepStrictEqual(yield* callsOf(page), [{ params: [1000 + 110000] }])
    }))

  test("CK-017", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.clock.setTime(1400)
      assert.strictEqual(yield* nowOf(page), 1400)
    }))

  test("CK-018", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      const invalidDate = yield* clockRefusal(page.clock.setTime(new Date("invalid")), "setSystemTime(Invalid Date)")
      assert.strictEqual(invalidDate.reason._tag, "InvalidInput")
      assert.include(invalidDate.message, "Invalid")
      const invalidString = yield* clockRefusal(page.clock.setTime("invalid"), "setSystemTime(\"invalid\")")
      assert.strictEqual(invalidString.reason._tag, "InvalidInput")
      assert.include(invalidString.message, "invalid")
    }))

  test("CK-019", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout((window as any).stub, 1000)
      })
      yield* page.clock.adjust(1000)
      assert.lengthOf(yield* callsOf(page), 1)
    }))

  test("CK-020", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      const to = yield* page.evaluateInMainWorld(() => setTimeout((window as any).stub, 1000))
      assert.strictEqual(typeof to, "number")
    }))

  test("CK-021", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        const to = setTimeout((window as any).stub, 1000)
        clearTimeout(to)
      })
      yield* page.clock.adjust(1000)
      assert.deepStrictEqual(yield* callsOf(page), [])
    }))

  test("CK-022", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        setInterval((window as any).stub, 500)
      })
      yield* page.clock.adjust(1000)
      assert.strictEqual((yield* callsOf(page)).length, 2)
    }))

  test("CK-023", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      yield* page.evaluateInMainWorld(() => {
        const to = setInterval((window as any).stub, 500)
        clearInterval(to)
      })
      yield* page.clock.adjust(1000)
      assert.deepStrictEqual(yield* callsOf(page), [])
    }))

  test("CK-024", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      const promise = yield* startWaiting(
        page.evaluateInMainWorld(async () => {
          const prev = performance.now()
          await new Promise((f) => setTimeout(f, 1000))
          const next = performance.now()
          return { prev, next }
        })
      )
      yield* page.clock.adjust(1000)
      assert.deepStrictEqual(yield* Fiber.join(promise.fiber), { prev: 1000, next: 2000 })
    }))

  test("CK-025", ({ page }) =>
    Effect.gen(function*() {
      yield* armed(page)
      const now = yield* page.evaluateInMainWorld(() => new Date().getTime())
      assert.strictEqual(now, 1000)
    }))

  test("CK-026", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `install({ time: 1000 })` then `pauseAt(2000)`: the clock starts at 1000
      yield* page.clock.install({ mode: "controlled", at: 1000 })
      yield* page.clock.setTime(2000)
      const promise = yield* startWaiting(
        page.evaluateInMainWorld(async () => {
          const prev = performance.now()
          await new Promise((f) => setTimeout(f, 1000))
          const next = performance.now()
          return { prev, next }
        })
      )
      yield* page.clock.adjust(1000)
      assert.strictEqual(yield* page.evaluateInMainWorld(() => performance.timeOrigin), 1000)
      assert.deepStrictEqual(yield* Fiber.join(promise.fiber), { prev: 1000, next: 2000 })
    }))

  test("CK-027", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      // Playwright's `page.clock` is its context's, so the popup shares it: the port's `context.clock` is that clock
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const now = new Date("2015-09-25")
      yield* pausedAt(context.clock, 0)
      yield* context.clock.setTime(now)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      const popupTime = yield* popup.evaluateInMainWorld(() => Date.now())
      assert.strictEqual(popupTime, now.getTime())
      yield* context.clock.adjust(1000)
      const popupTimeAfter = yield* popup.evaluateInMainWorld(() => Date.now())
      assert.strictEqual(popupTimeAfter, now.getTime() + 1000)
    })))

  test("CK-028", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      const now = new Date("2015-09-25")
      yield* pausedAt(context.clock, 0)
      yield* context.clock.setTime(now)
      yield* context.clock.adjust(1000)
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld(() => {
        window.open("about:blank")
      }).pipe(Page.withUserGesture)
      const popup = yield* opened
      const popupTime = yield* popup.evaluateInMainWorld(() => Date.now())
      assert.strictEqual(popupTime, now.getTime() + 1000)
    })))

  test("CK-029", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/popup.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<script>window.time = Date.now()</script>`)
      })
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* page.goto(server.EMPTY_PAGE)
      // Wait for 2 second in real life to check that it is past in popup.
      yield* Effect.sleep("2 seconds")
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url: string) => {
        window.open(url)
      }, server.PREFIX + "/popup.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/popup.html")
      yield* popup.status.waitFor(parsed)
      const popupTime = yield* popup.evaluateInMainWorld(() => (window as any).time)
      assert.isAtLeast(popupTime, 2000)
    })))

  test("CK-030", { page: false }, ({ server }) =>
    Effect.scoped(Effect.gen(function*() {
      server.setRoute("/popup.html", (_req, res) => {
        res.setHeader("Content-Type", "text/html")
        res.end(`<script>window.time = Date.now()</script>`)
      })
      const context = yield* Browser.newContext()
      const page = yield* context.newPage
      yield* pausedAt(context.clock, 1000)
      yield* page.goto(server.EMPTY_PAGE)
      // Wait for 2 second in real life to check that it is past in popup.
      yield* Effect.sleep("2 seconds")
      const opened = yield* Popup.next(page)
      yield* page.evaluateInMainWorld((url: string) => {
        window.open(url)
      }, server.PREFIX + "/popup.html").pipe(Page.withUserGesture)
      const popup = yield* opened
      yield* committed(popup, server.PREFIX + "/popup.html")
      yield* popup.status.waitFor(loaded)
      const popupTime = yield* popup.evaluateInMainWorld(() => (window as any).time)
      assert.strictEqual(popupTime, 1000)
    })))

  test("CK-031", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "fixed", at: 0 })
      // Should not stall: a fixed clock's timers still run.
      yield* page.evaluateInMainWorld(() => new Promise((f) => setTimeout(f, 1)))
    }))

  test("CK-032", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "fixed", at: 100 })
      assert.strictEqual(yield* nowOf(page), 100)
      yield* page.clock.setTime(200)
      assert.strictEqual(yield* nowOf(page), 200)
    }))

  test("CK-035", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `install({ time: 0 })` runs in real time from 0: a controlled clock at 0, resumed
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.clock.resume
      const startRealTime = Date.now()
      yield* page.goto("data:text/html,")
      // Playwright's `waitForTimeout(1000)`
      yield* Effect.sleep("1 second")
      const now = yield* nowOf(page)
      const realElapsed = Date.now() - startRealTime
      assert.isAtLeast(now, 1000)
      assert.isAtMost(now, realElapsed + 1000)
    }))

  test("CK-039", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `install()` starts at the real time
      yield* page.clock.install({ mode: "controlled", at: Date.now() })
      yield* page.setContent(
        `<script>function tick() { requestAnimationFrame(tick); } requestAnimationFrame(tick);</script>`
      )
      const invalidTime = (yield* nowOf(page)) * 1_000_000
      const failure = yield* clockRefusal(page.clock.setTime(invalidTime), "pauseAt(invalid)")
      assert.strictEqual(failure.reason._tag, "InvalidInput")
      assert.include(failure.message, `${invalidTime}`)
    }))

  test("CK-040", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      yield* page.clock.setTime(60000)
      yield* fastForward(page, page.clock, 1000)
      assert.strictEqual(yield* nowOf(page), 61000)
    }))

  test("CK-041", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      yield* page.clock.setTime(60000)
      assert.strictEqual(yield* nowOf(page), 60000)
    }))

  test("CK-042", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      yield* page.clock.setTime(1000)
      yield* recordCalls(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub("outer")
          setTimeout(() => (window as any).stub("inner"), 0)
        }, 1000)
      })
      yield* fastForward(page, page.clock, 1000)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }])
      yield* fastForward(page, page.clock, 1)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }, { params: ["inner"] }])
    }))

  test("CK-043", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      yield* page.clock.setTime(1000)
      yield* recordCalls(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub("outer")
          setTimeout(() => (window as any).stub("inner"), 0)
        }, 1000)
      })
      yield* page.clock.adjust(1000)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }])
      yield* page.clock.adjust(1)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }, { params: ["inner"] }])
    }))

  test("CK-044", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      yield* page.clock.setTime(1000)
      yield* recordCalls(page)
      yield* page.evaluateInMainWorld(() => {
        setTimeout(() => {
          ;(window as any).stub("outer")
          void Promise.resolve().then(() => setTimeout(() => (window as any).stub("inner"), 0))
        }, 1000)
      })
      yield* page.clock.adjust(1000)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }])
      yield* page.clock.adjust(1)
      assert.deepStrictEqual(yield* callsOf(page), [{ params: ["outer"] }, { params: ["inner"] }])
    }))

  test("CK-045", ({ page, server }) =>
    Effect.gen(function*() {
      yield* pausedAt(page.clock, 1000)
      yield* page.addInitScript(() => {
        Date.now()
      })
      yield* page.goto(server.EMPTY_PAGE)
      yield* page.clock.adjust(1000)
      yield* page.goto(server.PREFIX + "/title.html")
      assert.strictEqual(yield* nowOf(page), 2000)
      // Playwright's `waitForTimeout(500)`
      yield* Effect.sleep("500 millis")
      assert.strictEqual(yield* nowOf(page), 2000)
    }))

  test("CK-046", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 1000 })
      yield* page.goto(server.EMPTY_PAGE)
      // Playwright's `waitForTimeout(500)`
      yield* Effect.sleep("500 millis")
      const [monotonic, wall] = yield* page.evaluateInMainWorld(() => [performance.now(), Date.now()])
      assert.deepStrictEqual([monotonic, wall], [0, 1000])
    }))

  test("CK-047", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `install()` runs in real time
      yield* page.clock.install({ mode: "offset", by: 0 })
      yield* page.goto("data:text/html,")
      // Playwright's `waitForTimeout(1000)`
      yield* Effect.sleep("1 second")
      const dateValue = yield* nowOf(page)
      assert.isTrue(Number.isInteger(dateValue))
      // Playwright's `waitForTimeout(1000)`
      yield* Effect.sleep("1 second")
      const dateValue2 = yield* nowOf(page)
      assert.isTrue(Number.isInteger(dateValue2))
    }))

  test("CK-048", ({ page }) =>
    Effect.gen(function*() {
      // Playwright's `install({ time: 0 })`, then `pauseAt(1000)`, both before the page loads
      yield* pausedAt(page.clock, 1000)
      yield* page.goto("data:text/html,")
      yield* page.clock.adjust(0.5)
      const dateValue = yield* nowOf(page)
      assert.isTrue(Number.isInteger(dateValue))
      assert.strictEqual(dateValue, 1001)
    }))

  test("CK-049", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "fixed", at: new Date("2020-01-01T00:00:00Z") })
      yield* page.goto("data:text/html,")
      const seen = yield* page.evaluateInMainWorld(() => {
        const Temporal = (globalThis as any).Temporal
        return {
          instant: Temporal.Now.instant().toString(),
          zonedDateTime: Temporal.Now.zonedDateTimeISO("UTC").toString(),
          plainDateTime: Temporal.Now.plainDateTimeISO("UTC").toString(),
          plainDate: Temporal.Now.plainDateISO("UTC").toString(),
          plainTime: Temporal.Now.plainTimeISO("UTC").toString()
        }
      })
      assert.deepStrictEqual(seen, {
        instant: "2020-01-01T00:00:00Z",
        zonedDateTime: "2020-01-01T00:00:00+00:00[UTC]",
        plainDateTime: "2020-01-01T00:00:00",
        plainDate: "2020-01-01",
        plainTime: "00:00:00"
      })
    }))

  test("CK-050", ({ page }) =>
    Effect.gen(function*() {
      yield* pausedAt(page.clock, 1000)
      yield* page.goto("data:text/html,")
      yield* page.clock.adjust(2000)
      const epoch = yield* page.evaluateInMainWorld(() => (globalThis as any).Temporal.Now.instant().epochMilliseconds)
      assert.strictEqual(epoch, 3000)
    }))

  test("CK-051", { page: false }, () =>
    Effect.scoped(Effect.gen(function*() {
      const context = yield* Browser.newContext({ emulation: { timezone: "America/Los_Angeles" } })
      const page = yield* context.newPage
      yield* context.clock.install({ mode: "fixed", at: new Date("2020-01-01T00:00:00Z") })
      yield* page.goto("data:text/html,")
      const seen = yield* page.evaluateInMainWorld(() => {
        const Temporal = (globalThis as any).Temporal
        return {
          timeZoneId: Temporal.Now.timeZoneId(),
          zonedDateTime: Temporal.Now.zonedDateTimeISO().toString(),
          plainDateTime: Temporal.Now.plainDateTimeISO().toString()
        }
      })
      assert.deepStrictEqual(seen, {
        timeZoneId: "America/Los_Angeles",
        zonedDateTime: "2019-12-31T16:00:00-08:00[America/Los_Angeles]",
        plainDateTime: "2019-12-31T16:00:00"
      })
    })))

  test("CK-052", ({ page }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      yield* page.goto("data:text/html,")
      const seen = yield* page.evaluateInMainWorld(() => {
        const Temporal = (globalThis as any).Temporal
        return {
          tag: Object.prototype.toString.call(Temporal.Now),
          enumerable: Object.keys(Temporal).concat(Object.keys(Temporal.Now)),
          isInstant: Temporal.Now.instant() instanceof Temporal.Instant,
          duration: Temporal.Duration.from({ hours: 1 }).toString()
        }
      })
      assert.deepStrictEqual(seen, {
        tag: "[object Temporal.Now]",
        enumerable: [],
        isInstant: true,
        duration: "PT1H"
      })
    }))

  test("CK-053", ({ page, browserName }) =>
    Effect.gen(function*() {
      yield* page.clock.install({ mode: "controlled", at: 0 })
      // Playwright's `evaluateHandle`: the controller is kept in the page, read back with each check
      yield* page.evaluateInMainWorld(() => {
        const signal = AbortSignal.any([AbortSignal.timeout(100)])
        const handle = { signal, event: false, handler: false }
        signal.addEventListener("abort", () => handle.event = true)
        signal.onabort = () => handle.handler = true
        ;(window as any).controller = handle
      })
      const state = () =>
        page.evaluateInMainWorld(() => {
          const handle = (window as any).controller
          return { signal: handle.signal.aborted, event: handle.event, handler: handle.handler }
        })
      assert.deepStrictEqual(yield* state(), { signal: false, event: false, handler: false })
      yield* page.clock.adjust(200)
      const reason = yield* page.evaluateInMainWorld(() => {
        const { reason } = (window as any).controller.signal
        return { name: reason.name, message: reason.message, code: reason.code }
      })
      assert.deepStrictEqual({ ...(yield* state()), reason }, {
        signal: true,
        event: true,
        handler: true,
        reason: {
          name: "TimeoutError",
          message: browserName === "chromium" ? "signal timed out" : "The operation timed out.",
          code: 23
        }
      })
      assert.strictEqual(yield* page.evaluateInMainWorld(() => AbortSignal.abort().aborted), true)
    }))

  test("CK-054", ({ page, server }) =>
    Effect.gen(function*() {
      // Playwright's `setSystemTime` leaves the clock running from that time; Strider's resumed controlled clock does too
      yield* page.clock.install({ mode: "controlled", at: new Date("2026-01-01") })
      yield* page.clock.resume
      server.setRoute("/repro.html", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`
          <html>
            <body>
              <script>
              {
                const start = performance.now();
                while (performance.now() - start < 100) { }
              }
              {
                const start = Date.now();
                while (Date.now() - start < 100) { }
              }
              console.log('done');
              </script>
            </body>
          </html>
        `)
      })
      const done = yield* ConsoleMessage.next(page, { text: /^done$/ })
      yield* page.goto(server.PREFIX + "/repro.html")
      yield* done
    }))
})
