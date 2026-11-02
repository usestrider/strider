/** Bounded, event-driven confirmation of stock WebKit's native-window viewport (ROOK-91). */
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as MonotonicInstant from "../../MonotonicInstant.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Automation from "../../webkit-automation-protocol/Automation.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import type * as WebKitAutomation from "../webkitAutomation.ts"

export const confirmationMillis = 5000
type Size = { readonly width: number; readonly height: number }
let sequence = 0
// This is part of the existing cleanup budget, not an additional wait.
const finalMeasurementMillis = 1000
const CleanupDeadline = Context.Reference<Option.Option<MonotonicInstant.MonotonicInstant>>(
  "@usestrider/browser/internal/WebKitViewport/CleanupDeadline",
  { defaultValue: () => Option.none() }
)

/** Only a confirmed vanished resource makes cleanup unnecessary. */
export const isGone = (error: Adapter.AdapterError | Protocol.ProtocolError): boolean => {
  if (error._tag === "AdapterError") {
    // Pairing exhaustion also uses Vanished for a still-listed page; that is not proof of removal.
    if (error.reason._tag === "Gone") return error.reason.reason._tag !== "Vanished"
    return error.reason._tag === "Protocol" && isGone(error.reason.error)
  }
  return error.reason._tag === "SessionEnded" ||
    (error.reason._tag === "Rejected" && error.reason.code === -32000 &&
      error.reason.description === "WindowNotFound")
}

/** Best-effort teardown preserves the primary outcome; a gone resource needs no cleanup. */
export const reportCleanup = <A, E extends Adapter.AdapterError | Protocol.ProtocolError, R>(
  effect: Effect.Effect<A, E, R>,
  message: string
) => effect.pipe(Effect.catch((error) => isGone(error) ? Effect.void : Effect.logWarning(message, error)))

/** A separate five-second budget for restoration, callback disposal and failed creation cleanup. */
export const cleanup = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Operation.detached(Effect.gen(function*() {
    const inherited = yield* CleanupDeadline
    const next = yield* BrowserClock.after(confirmationMillis)
    const at = Option.isSome(inherited) && inherited.value < next ? inherited.value : next
    const result = yield* effect.pipe(
      Effect.provideService(CleanupDeadline, Option.some(at)),
      Effect.provideService(ProtocolClient.CommandDeadline, Option.some(at)),
      BrowserClock.until(at)
    )
    if (Option.isNone(result)) {
      return yield* Effect.fail(Kit.protocolError(
        new Protocol.ProtocolError({
          reason: new Protocol.NoReply({
            method: "WebKit viewport cleanup",
            timeout: Duration.millis(confirmationMillis)
          })
        })
      ))
    }
    return result.value
  }))

/** Runs in the page. The timeout removes listeners; Automation itself enforces callbackTimeout. */
export const watch = function(
  width: number,
  height: number,
  key: string,
  millis: number,
  callback: (value: string) => void
) {
  const host = globalThis as unknown as Record<string, unknown>
  let timer: ReturnType<typeof setTimeout> | undefined
  const dispose = () => {
    removeEventListener("resize", check)
    removeEventListener("pagehide", navigated)
    clearTimeout(timer)
    delete host[key]
  }
  const finish = (value: string) => {
    dispose()
    callback(value)
  }
  const check = () => {
    if (innerWidth === width && innerHeight === height) finish("matched")
  }
  const navigated = () => finish("navigated")
  host[key] = () => finish("cancelled")
  addEventListener("resize", check)
  addEventListener("pagehide", navigated)
  timer = setTimeout(dispose, millis)
  check()
}

export const confirm = Effect.fnUntraced(function*(
  process: Pick<WebKitAutomation.Process, "automation">,
  handle: Automation.BrowsingContextHandle,
  requested: Size
) {
  const on = Protocol.on(process.automation)
  const deadline = yield* ProtocolClient.CommandDeadline
  const left = Option.isSome(deadline) ? BrowserClock.millisLeft(BrowserClock.live, deadline.value) : Infinity
  const restoring = Option.isSome(yield* CleanupDeadline)
  const millis = Math.max(0, Math.min(confirmationMillis, restoring ? left - finalMeasurementMillis : left))
  const key = `__striderViewport${++sequence}`
  const read = Effect.gen(function*() {
    const { result } = yield* Automation.evaluateJavaScriptFunction({
      browsingContextHandle: handle,
      function: "function() { return { width: innerWidth, height: innerHeight } }",
      arguments: []
    }).pipe(on, Kit.protocol)
    try {
      const size: unknown = JSON.parse(result)
      if (
        typeof size === "object" && size !== null && "width" in size && "height" in size &&
        typeof size.width === "number" && typeof size.height === "number"
      ) return { width: size.width, height: size.height }
    } catch { /* A malformed measurement remains a protocol failure. */ }
    return yield* Effect.fail(Kit.undecodable("Automation.evaluateJavaScriptFunction", "Invalid viewport dimensions"))
  })
  const dispose = Automation.evaluateJavaScriptFunction({
    browsingContextHandle: handle,
    function: "function(key) { if (typeof globalThis[key] === 'function') globalThis[key]() }",
    arguments: [JSON.stringify(key)]
  }).pipe(on, Kit.protocol)
  yield* Effect.gen(function*() {
    // With only the reserved measurement time left, measure directly within the shared cleanup budget.
    const waiting = Automation.evaluateJavaScriptFunction({
      browsingContextHandle: handle,
      function: watch.toString(),
      arguments: [
        JSON.stringify(requested.width),
        JSON.stringify(requested.height),
        JSON.stringify(key),
        JSON.stringify(millis)
      ],
      expectsImplicitCallbackArgument: true,
      callbackTimeout: millis
    }).pipe(
      on,
      Effect.map((reply) => Option.some(reply)),
      Effect.catch((error) => {
        if (
          error.reason._tag === "Rejected" &&
          /^JavaScriptTimeout(?:$|[;: ])/.test(error.reason.description)
        ) {
          // A shorter operation deadline remains a timeout, never a viewport mismatch.
          if (!restoring && left < confirmationMillis) {
            return Effect.fail(Kit.protocolError(
              new Protocol.ProtocolError({
                reason: new Protocol.NoReply({
                  method: "Automation.evaluateJavaScriptFunction",
                  timeout: Duration.millis(millis)
                })
              })
            ))
          }
          return Effect.succeed(Option.none<Automation.EvaluateJavaScriptFunctionResult>())
        }
        return Effect.fail(Kit.protocolError(error))
      })
    )
    const reply = restoring && millis === 0
      ? Option.none<Automation.EvaluateJavaScriptFunctionResult>()
      : yield* waiting
    if (Option.isSome(reply)) {
      if (reply.value.result === "\"matched\"") return
      return yield* Effect.fail(Kit.protocolError(
        new Protocol.ProtocolError({
          reason: new Protocol.Rejected({
            method: "Automation.evaluateJavaScriptFunction",
            reason: "NoSuchFrame",
            code: "Navigation",
            description: "The document navigated while confirming its viewport"
          })
        })
      ))
    }
    // One final read covers a viewport whose resize event was suppressed or throttled.
    const actual = yield* read
    if (actual.width === requested.width && actual.height === requested.height) return
    return yield* Effect.fail(
      new Adapter.AdapterError({
        reason: {
          _tag: "ViewportMismatch",
          requested,
          actual,
          hint: "The requested CSS size was not observed within the 5 second confirmation limit"
        }
      })
    )
  }).pipe(
    Effect.ensuring(
      reportCleanup(cleanup(dispose), "WebKit viewport callback disposal failed; the primary outcome is unchanged")
    )
  )
})
