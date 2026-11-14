/**
 * Deadlines against a browser that stopped answering: its process is stopped (SIGSTOP), so no command gets a reply,
 * and each operation ends at its deadline with its `Timeout`, in the phase what it sent gives it, instead of waiting
 * for the protocol's `CommandTimeout`. The process is let go after, and the page answers again.
 */
import { assert, describe, layer } from "@effect/vitest"
import { Browser, Deadline, Ledger } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { site } from "../adapter/harness.ts"
import * as FirefoxCrashReports from "../firefoxCrashReports.ts"
import { supports } from "./capabilities.ts"

const timeout = 60_000

/** The processes the backend launched, latest last: on launched stock WebKit, each context is one. */
const launched: Array<number> = []

const ledger: Ledger.Ledger = {
  add: (item) => Effect.sync(() => void (item._tag === "Browser" && launched.push(item.pid))),
  remove: () => Effect.void
}

/** What an operation against a stopped browser ends with, and how long it took. */
const against = Effect.fnUntraced(function*<A, E>(operation: Effect.Effect<A, E>) {
  const started = performance.now()
  const failure = yield* operation.pipe(Deadline.within("500 millis"), Effect.flip)
  return { failure, elapsed: performance.now() - started }
})

export const deadlines = (name: string, backend: Layer.Layer<Browser.Browser, unknown>) =>
  describe(`${name} deadlines`, () => {
    layer(backend.pipe(Layer.provide(Layer.succeed(Ledger.CurrentLedger, FirefoxCrashReports.wrap(ledger)))), {
      excludeTestServices: true,
      timeout
    })((it) => {
      it.effect(
        "ends each operation at its deadline when the browser stops answering",
        () =>
          Effect.scoped(Effect.gen(function*() {
            const served = yield* site
            const page = yield* Browser.newPage()
            yield* page.goto(
              `${served.origin}/fixture?html=${encodeURIComponent("<title>Shop</title><button>Pay</button>")}`
            )
            const pid = launched.at(-1)
            assert(pid !== undefined, "the backend launched no process")
            // Let go before the page closes, whatever the test did
            yield* Effect.acquireRelease(
              Effect.sync(() => process.kill(pid, "SIGSTOP")),
              () => Effect.sync(() => process.kill(pid, "SIGCONT"))
            )
            const checks: Array<readonly [string, Effect.Effect<unknown, unknown>, Deadline.Timeout["phase"]]> = [
              ["CookieJar.list", page.context.cookies.list, "resolving"],
              [
                "CookieJar.set",
                page.context.cookies.set({ name: "cart", value: "1", scope: { url: served.origin } }),
                "dispatchedUnconfirmed"
              ],
              ["Page.title", page.title, "resolving"],
              ["Locator.isEditable", page.getByRole("button", { name: "Pay" }).isEditable, "resolving"],
              ["Locator.count", page.getByRole("button", { name: "Pay" }).count, "resolving"],
              ["Locator.click", page.getByRole("button", { name: "Pay" }).click(), "resolving"]
            ]
            if (yield* supports("emulation.viewport")) {
              checks.push([
                "Page.emulate",
                Effect.scoped(page.emulate({ viewport: { width: 800, height: 600 } })),
                "dispatchedUnconfirmed"
              ])
            }
            for (const [operation, effect, phase] of checks) {
              const { elapsed, failure } = yield* against(effect)
              assert(Deadline.isTimeout(failure), `${operation}: ${String(failure)}`)
              assert.strictEqual(failure.operation, operation)
              assert.strictEqual(failure.phase, phase, operation)
              // Not the protocol's 30 seconds
              assert.isTrue(elapsed < 5000, `${operation} took ${Math.round(elapsed)} ms`)
            }
            process.kill(pid, "SIGCONT")
            assert.strictEqual(yield* page.title, "Shop")
          })),
        timeout
      )
    })
  })
