/**
 * The adapter conformance suite against stock WebKit: WebKitGTK's MiniBrowser (`browsers.ts`) launched
 * in automation mode, a browser process per context, on an X server of the test's own (`stockWebKit.ts`), with
 * Node's sockets (`sockets.ts`). Its pages' traffic and its Automation target's are recorded as one fixture.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as WebKitAdapter from "../../../src/internal/webkitAdapter.ts"
import * as WebKitAutomation from "../../../src/internal/webkitAutomation.ts"
import * as WebKitWire from "../../../src/internal/webkitWire.ts"
import { webkitgtk } from "../browsers.ts"
import { fixtures, record } from "../record.ts"
import { socketConnector } from "../sockets.ts"
import { useXvfb } from "../stockWebKit.ts"
import { conformance, viewportRestoration } from "./conformance.ts"
import { engine } from "./engine.ts"
import type { Backend } from "./harness.ts"

// The transport presents the pages in our envelope, whose `Envelope` domain is its own, not the browser's
const made = (method: string) => method.startsWith("Envelope.")

const backend: Backend = {
  name: "WebKit (stock)",
  connect: Effect.fnUntraced(function*(sink) {
    yield* useXvfb().pipe(Effect.orDie)
    const group = yield* WebKitAutomation.start({
      executablePath: webkitgtk.executable,
      wrapAutomation: (transport) => record(transport, WebKitWire.wire, fixtures.webkitStock)
    }).pipe(Effect.provide(Layer.merge(socketConnector, Layer.empty)))
    const adapter = yield* WebKitAdapter.connect(
      record(group.transport, WebKitWire.wire, fixtures.webkitStock, { made }),
      { sink, ownership: "launched", automation: group }
    )
    return { adapter, kill: group.first.kill }
  })
}

conformance(backend)
viewportRestoration(backend)
engine(backend)
