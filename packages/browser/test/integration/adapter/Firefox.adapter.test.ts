/**
 * The adapter conformance suite against Firefox over WebDriver BiDi: the pinned Firefox (`browsers.ts`), in the
 * Nix environment `pnpm test:integration` enters. Another version fails it.
 */
import * as Effect from "effect/Effect"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as BidiWire from "../../../src/internal/bidiWire.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import { assertPinned, firefox } from "../browsers.ts"
import { fixtures, record } from "../record.ts"
import { conformance } from "./conformance.ts"

const executable = firefox.executable

conformance({
  name: "Firefox (BiDi)",
  connect: Effect.fnUntraced(function*(sink) {
    const { launched, transport } = yield* FirefoxLauncher.launch({ executablePath: executable })
    const adapter = yield* BidiAdapter.connect(record(transport, BidiWire.wire, fixtures.bidi), {
      sink,
      ownership: "launched"
    })
    assertPinned("Firefox", adapter.info.version, firefox.version)
    return { adapter, kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore) }
  })
})
