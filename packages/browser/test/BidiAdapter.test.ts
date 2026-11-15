/** How the BiDi adapter closes a browser it launched, played over a fake transport, without launching one. */
import { assert, describe, it } from "@effect/vitest"
import { Deadline } from "@usestrider/browser"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { TestClock } from "effect/testing"
import * as BidiAdapter from "../src/internal/bidiAdapter.ts"
import { makeBrowser } from "./utils/FakeBrowser.ts"
import { onTestClock, withProtocolScheduler } from "./utils/ProtocolScheduler.ts"

const results: Record<string, unknown> = {
  "session.new": {
    sessionId: "session",
    capabilities: {
      acceptInsecureCerts: false,
      browserName: "firefox",
      browserVersion: "158.0",
      platformName: "linux",
      setWindowRect: false,
      userAgent: "Firefox/158.0"
    }
  },
  "session.subscribe": { subscription: "subscription" },
  "browsingContext.getTree": { contexts: [] }
}

describe("BiDi owned Firefox shutdown", () => {
  for (
    const mode of [
      "order",
      "no reply",
      "disconnect before exit",
      "hung child",
      "signal exit",
      "interrupted caller",
      "expired deadline",
      "failed handshake",
      "attached"
    ] as const
  ) {
    it.effect(mode, () =>
      withProtocolScheduler((drain) =>
        Effect.gen(function*() {
          const browser = yield* makeBrowser
          const exited = yield* Deferred.make<void, string>()
          const closeSent = yield* Deferred.make<void>()
          const scope = yield* Scope.make()
          const commands: Array<string> = []
          let fallback = false
          yield* Scope.addFinalizer(
            scope,
            Effect.sync(() => {
              fallback = true
            })
          )
          yield* Effect.gen(function*() {
            while (true) {
              const command = yield* browser.next
              commands.push(command.method)
              if (command.method === "browser.close") {
                assert.strictEqual(fallback, false)
                yield* Deferred.succeed(closeSent, undefined)
                // Firefox answers before it has written its profile: the exit, not the reply, ends shutdown
                if (mode !== "no reply") yield* browser.receive({ type: "success", id: command.id, result: {} })
                continue
              }
              if (mode === "failed handshake" && command.method === "session.subscribe") {
                yield* browser.receive({
                  type: "error",
                  id: command.id,
                  error: "unknown error",
                  message: "handshake rejected"
                })
                continue
              }
              yield* browser.receive({ type: "success", id: command.id, result: results[command.method] ?? {} })
            }
          }).pipe(Effect.forkScoped)
          const acquisition = yield* Effect.exit(
            BidiAdapter.connect(browser.transport, {
              ownership: mode === "attached" ? "attached" : "launched",
              sink: () => Effect.void,
              exited: Deferred.await(exited)
            }).pipe(Scope.provide(scope))
          )
          assert.strictEqual(Exit.isFailure(acquisition), mode === "failed handshake")
          if (mode === "attached" || mode === "failed handshake") {
            yield* Scope.close(scope, Exit.void)
            assert.strictEqual(commands.includes("browser.close"), false)
            assert.strictEqual(fallback, true)
            return
          }
          assert(Exit.isSuccess(acquisition))
          let connectionLost = false
          yield* acquisition.value.closed.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                connectionLost = true
              })
            ),
            Effect.forkScoped
          )
          const closing = yield* (mode === "interrupted caller"
            ? Effect.gen(function*() {
              yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
              return yield* Effect.never
            }).pipe(Effect.scoped, Effect.forkChild)
            : Scope.close(scope, Exit.void).pipe(
              mode === "expired deadline" ? Deadline.within("0 millis") : (self) => self,
              Effect.forkChild
            ))
          yield* drain
          const interrupted = mode === "interrupted caller"
            ? yield* Fiber.interrupt(closing).pipe(Effect.forkChild)
            : undefined
          yield* drain
          yield* Deferred.await(closeSent)
          // `browser.close` ends the session itself, so it goes before `session.end`, which waits for the exit
          assert.deepStrictEqual(commands.slice(-1), ["browser.close"])
          assert.strictEqual(connectionLost, false)
          assert.strictEqual(fallback, false)
          if (mode === "disconnect before exit") {
            yield* browser.lose("closed before process exit")
            yield* drain
            assert.strictEqual(fallback, false)
          }
          if (mode === "hung child" || mode === "expired deadline") {
            yield* TestClock.adjust("4999 millis")
            assert.strictEqual(fallback, false)
            yield* TestClock.adjust("1 millis")
          } else if (mode === "signal exit") {
            yield* Deferred.fail(exited, "SIGTERM")
          } else {
            yield* Deferred.succeed(exited, undefined)
          }
          yield* drain
          // The browser's exit closes its socket; `session.end` then fails at once rather than waiting
          if (mode !== "disconnect before exit") yield* browser.lose("the browser exited")
          if (interrupted !== undefined) yield* Fiber.join(interrupted)
          else yield* Fiber.join(closing)
          yield* drain
          assert.strictEqual(connectionLost, true)
          assert.strictEqual(fallback, true)
        }).pipe(onTestClock)
      ))
  }
})
