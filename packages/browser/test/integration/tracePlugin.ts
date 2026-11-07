/** Source instrumentation is confined to Vitest's integration module graph. No shipped source is changed. */
import * as path from "node:path"
import type { Plugin } from "vitest/config"

export const instrument = (source: string, id: string) => {
  const file = id.split("?")[0]!
  const transport = file.endsWith("/src/protocol/Transport.ts")
  const inspector = file.endsWith("/src/internal/webkitInspectorSocket.ts")
  const trace = file.endsWith("/src/internal/trace.ts")
  const har = file.endsWith("/src/internal/har.ts")
  if (!transport && !inspector && !trace && !har) return
  const replace = (from: string, to: string, count: number) => {
    if (source.split(from).length - 1 !== count) {
      throw new Error(`Failure trace instrumentation no longer matches ${file}: ${from}`)
    }
    source = source.replaceAll(from, to)
  }
  const helper = path.join(import.meta.dirname, "failureTrace.ts")
  source = `import { connection as __failureConnection } from ${JSON.stringify(helper)};${source}`
  if (har) {
    source = `import { waitTrace as __waitTrace } from ${
      JSON.stringify(path.join(import.meta.dirname, "waitTrace.ts"))
    };${source}`
    replace(
      "const own = yield* Scope.fork(scope)",
      "const __har = __waitTrace(\"har\"); __har.event(\"recorder-start\", { target: target.id, targetKind: \"context\" in target ? \"Page\" : \"UserContext\" }); const own = yield* Scope.fork(scope)",
      1
    )
    replace(
      "Effect.ensuring(read(recorded), Deferred.done(recorded.done, Exit.void))",
      "__har.observe(\"hop-follow\", Effect.ensuring(read(recorded), Deferred.done(recorded.done, Exit.void)), recorded.request.hop)",
      1
    )
    replace("Deferred.await(hop.end)", "__har.observe(\"hop-end\", Deferred.await(hop.end), recorded.request.hop)", 1)
    for (const name of ["requestBody", "responseBody"]) {
      replace(
        `runtime.model.adapter.${name}(recorded.request.hop).pipe(`,
        `__har.observe("${
          name === "requestBody" ? "request-body" : "response-body"
        }", runtime.model.adapter.${name}(recorded.request.hop), recorded.request.hop).pipe(`,
        1
      )
    }
    replace(
      "if (settings.requestBodies) {",
      "if (!settings.requestBodies) __har.event(\"request-body-skipped\", { hop: recorded.request.hop }); if (settings.requestBodies) {",
      1
    )
    replace(
      "const response = (yield* hop.state.get).response",
      "const response = (yield* hop.state.get).response; if (!(settings.content !== \"omit\" && end._tag === \"Finished\" && Option.isSome(response) && hasBody(response.value.status))) __har.event(\"response-body-skipped\", { hop: recorded.request.hop })",
      1
    )
    replace(
      "yield* SubscriptionRef.set(count, entries.length)",
      "yield* SubscriptionRef.set(count, entries.length); __har.event(\"hop-collected\", { hop: recorded.request.hop, count: entries.length })",
      1
    )
    replace(
      "}).pipe(Effect.ignore, Operation.detached, Effect.forkIn(own))\n    if (settings.webSocketFrames)",
      "}).pipe((effect) => __har.observe(\"queue-loop\", effect), Effect.ignore, Operation.detached, Effect.forkIn(own))\n    if (settings.webSocketFrames)",
      1
    )
    replace(
      "const settle = Effect.gen(function*() {",
      "const settle = __har.observe(\"settle\", Effect.gen(function*() {",
      1
    )
    replace(
      "yield* FiberSet.awaitEmpty(hops).pipe(BrowserClock.until(at), Effect.asVoid)",
      "__har.event(\"budget-acquired\"); yield* __har.observe(\"await-empty\", FiberSet.awaitEmpty(hops).pipe(BrowserClock.until(at), Effect.asVoid))",
      1
    )
    replace("    })\n    // A hop that ended", "    }))\n    // A hop that ended", 1)
    replace("stopped = true", "__har.event(\"har-finalizer-enter\"); stopped = true", 1)
    replace(
      "return settings.inFlightAtStop === \"wait\" ? settle : Effect.void",
      "return __har.observe(\"har-finalizer\", settings.inFlightAtStop === \"wait\" ? settle : Effect.void)",
      1
    )
    replace("stop: Scope.close(own, Exit.void)", "stop: __har.observe(\"stop\", Scope.close(own, Exit.void))", 1)
  }
  if (trace) {
    replace(
      "const videoFailures: Array<VideoFailure> = []",
      "const videoFailures: Array<VideoFailure> = []; const __nativeVideoTrace = __failureConnection(\"native-video\")",
      1
    )
    replace(
      "videoFailures.push(failure)",
      "(__nativeVideoTrace(\"native-video-failure\", videoFailureEvent(failure, \"strict\")), videoFailures.push(failure))",
      1
    )
  }
  if (trace) {
    replace(
      "const pendingEvent = pendingVideoEvent(page, exported)",
      "const pendingEvent = pendingVideoEvent(page, exported); __nativeVideoTrace(\"native-video-pending\", pendingEvent)",
      1
    )
  }
  if (transport || inspector) {
    replace(
      "const link = yield* Link.make",
      `const __trace = __failureConnection(${
        JSON.stringify(inspector ? "webkit-inspector" : "pipe-or-websocket")
      }); const link = yield* Link.make`,
      transport ? 2 : 1
    )
    replace(
      "const link = yield* Link.make" + (inspector ? "<Incoming>()" : "()"),
      "const link = yield* Link.make" + (inspector ? "<Incoming>()" : "()") +
        `; const __receive = link.receive; link.receive = (message) => { __trace("receive", message); __receive(message) }; const __lose = link.lose; link.lose = (reason) => { __trace("closed", reason); __lose(reason) }`,
      transport ? 2 : 1
    )
    if (transport) {
      replace(
        "Queue.offerUnsafe(outbox, encoder.encode(message + \"\\0\"))",
        "(__trace(\"send\", message), Queue.offerUnsafe(outbox, encoder.encode(message + \"\\0\")))",
        1
      )
      replace("writer.write(message)", "(__trace(\"send\", message), writer.write(message))", 1)
    } else replace("writer.write(frame(message))", "(__trace(\"send\", message), writer.write(frame(message)))", 1)
  }
  return { code: source, map: null }
}

export const failureTracePlugin = (): Plugin => ({
  name: "integration-failure-trace",
  enforce: "pre",
  transform: instrument
})
