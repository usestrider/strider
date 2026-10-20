/**
 * The adapter conformance suite against Playwright's WebKit: the pinned build (`browsers.ts`), in the Nix
 * environment `pnpm test:integration` enters. The launcher refuses another build by its `protocol.json`.
 */
import * as Effect from "effect/Effect"
import * as WebKitAdapter from "../../../src/internal/webkitAdapter.ts"
import * as WebKitLauncher from "../../../src/internal/webkitLauncher.ts"
import * as WebKitWire from "../../../src/internal/webkitWire.ts"
import { webkit } from "../browsers.ts"
import { fixtures, record } from "../record.ts"
import { conformance } from "./conformance.ts"

const executable = webkit.executable

conformance({
  name: "WebKit (Playwright)",
  connect: Effect.fnUntraced(function*(sink) {
    const { launched, transport } = yield* WebKitLauncher.launch({ executablePath: executable })
    const adapter = yield* WebKitAdapter.connect(record(transport, WebKitWire.wire, fixtures.webkit), {
      sink,
      ownership: "launched",
      revision: WebKitLauncher.build.revision
    })
    return { adapter, kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore) }
  })
})
