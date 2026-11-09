/** Test-only source instrumentation shared by Vitest and the Node preload. No shipped source is changed. */
import * as path from "node:path"
import type { Plugin } from "vitest/config"

export const instrument = (source: string, id: string) => {
  const file = id.split("?")[0]!
  const transport = file.endsWith("/src/protocol/Transport.ts")
  const inspector = file.endsWith("/src/internal/webkitInspectorSocket.ts")
  const firefox = file.endsWith("/src/internal/firefoxLauncher.ts")
  const launch = file.endsWith("/src/internal/launch.ts")
  const trace = file.endsWith("/src/internal/trace.ts")
  if (!transport && !inspector && !trace && !firefox && !launch) return
  const replace = (from: string, to: string, count: number) => {
    if (source.split(from).length - 1 !== count) {
      throw new Error(`Failure trace instrumentation no longer matches ${file}: ${from}`)
    }
    source = source.replaceAll(from, to)
  }
  const helper = path.join(import.meta.dirname, "failureTrace.ts")
  source = `import { connection as __failureConnection } from ${JSON.stringify(helper)};${source}`
  const packetHelper = path.join(import.meta.dirname, "firefoxPackets.ts")
  if (transport || firefox || launch) {
    source = `import * as __firefoxPackets from ${JSON.stringify(packetHelper)};${source}`
  }
  if (firefox) {
    replace(
      "profileUserJs(existing, options.profilePrefs ?? profilePrefs[options.profile ?? \"automation\"])",
      "profileUserJs(existing, __firefoxPackets.preferences(options.profilePrefs ?? profilePrefs[options.profile ?? \"automation\"]))",
      1
    )
  }
  if (launch) {
    replace(
      "const [file, fileArgs] = command(executable, args, options.coreDumps ?? false)",
      "const [file, fileArgs] = __firefoxPackets.command(command(executable, args, options.coreDumps ?? false), executable)",
      1
    )
  }
  if (transport) {
    replace(
      "const construct = yield* Socket.WebSocketConstructor",
      "const __packets = __firefoxPackets.connection(url); const construct = yield* Socket.WebSocketConstructor",
      1
    )
    replace(
      "ws = construct(url, headers === undefined ? undefined : { headers })",
      "ws = __packets.native(construct(url, headers === undefined ? undefined : { headers }))",
      1
    )
    replace("link.receive(frame)", "(__packets.record(\"transport-receive\", frame), link.receive(frame))", 1)
    replace(
      "link.receive(decoder.decode(frame))",
      "(__packets.record(\"transport-receive\", frame), link.receive(decoder.decode(frame)))",
      1
    )
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
      replace(
        "writer.write(message)",
        "(__trace(\"send\", message), __packets.record(\"transport-send\", message), writer.write(message))",
        1
      )
    } else replace("writer.write(frame(message))", "(__trace(\"send\", message), writer.write(frame(message)))", 1)
  }
  return { code: source, map: null }
}

export const failureTracePlugin = (): Plugin => ({
  name: "integration-failure-trace",
  enforce: "pre",
  transform: instrument
})
