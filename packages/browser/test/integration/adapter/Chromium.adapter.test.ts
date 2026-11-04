/**
 * The adapter conformance suite against Chromium over CDP, launched over the pipe: the pinned Chromium
 * (`browsers.ts`), in the Nix environment `pnpm test:integration` enters. Another version fails it.
 */
import * as Effect from "effect/Effect"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as CdpWire from "../../../src/internal/cdpWire.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { assertPinned, chromium } from "../browsers.ts"
import { fixtures, record } from "../record.ts"
import { conformance, viewportMeasurement, viewportRestoration } from "./conformance.ts"
import { engine } from "./engine.ts"
import type { Backend } from "./harness.ts"
import { trace } from "./iframeTrace.ts"

const executable = chromium.executable

const backend: Backend = {
  name: "Chromium (CDP)",
  connect: Effect.fnUntraced(function*(sink) {
    const { launched, transport } = yield* ChromiumLauncher.launch({ executablePath: executable })
    const adapter = yield* CdpAdapter.connect(trace(record(transport, CdpWire.wire, fixtures.cdp)), {
      sink,
      ownership: "launched"
    })
    assertPinned("Chromium", adapter.info.version, chromium.version)
    return { adapter, kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore) }
  })
}

conformance(backend)
viewportRestoration(backend)
viewportMeasurement(backend)
engine(backend)
