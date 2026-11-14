/**
 * The adapter conformance suite against Firefox over WebDriver BiDi: the pinned Firefox (`browsers.ts`), in the
 * Nix environment `pnpm test:integration` enters. Another version fails it.
 */
import * as Effect from "effect/Effect"
import { afterAll } from "vitest"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as BidiWire from "../../../src/internal/bidiWire.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import { assertPinned, firefox } from "../browsers.ts"
import * as FirefoxCrashReports from "../firefoxCrashReports.ts"
import { fixtures, record } from "../record.ts"
import { conformance, viewportRestoration } from "./conformance.ts"
import { engine } from "./engine.ts"
import type { Backend } from "./harness.ts"

// This file's Firefox writes the crash reports of a content process it kills, kept when a test fails
// (`firefoxCrashReports.ts`); the file undoes it when it ends, so later files launch Firefox as usual
afterAll(FirefoxCrashReports.optIn())

const executable = firefox.executable

const backend: Backend = {
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
}

conformance(backend)
viewportRestoration(backend)
engine(backend)
