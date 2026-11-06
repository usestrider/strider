/** Source instrumentation is confined to Vitest's integration module graph. No shipped source is changed. */
import * as path from "node:path"
import type { Plugin } from "vitest/config"

export const instrument = (source: string, id: string) => {
  const file = id.split("?")[0]!
  const transport = file.endsWith("/src/protocol/Transport.ts")
  const inspector = file.endsWith("/src/internal/webkitInspectorSocket.ts")
  if (!transport && !inspector) return
  const replace = (from: string, to: string, count: number) => {
    if (source.split(from).length - 1 !== count) {
      throw new Error(`Failure trace instrumentation no longer matches ${file}: ${from}`)
    }
    source = source.replaceAll(from, to)
  }
  const helper = path.join(import.meta.dirname, "failureTrace.ts")
  source = `import { connection as __failureConnection } from ${JSON.stringify(helper)};${source}`
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
