/**
 * The adapter conformance suite against Playwright's WebKit build. Set `STRIDER_WEBKIT` to its `pw_run.sh`, or
 * install it where Playwright does (`PLAYWRIGHT_BROWSERS_PATH`, or Playwright's cache).
 */
import * as Effect from "effect/Effect"
import { existsSync } from "node:fs"
import * as WebKitAdapter from "../../../src/internal/webkitAdapter.ts"
import * as WebKitLauncher from "../../../src/internal/webkitLauncher.ts"
import * as WebKitWire from "../../../src/internal/webkitWire.ts"
import { fixtures, record } from "../record.ts"
import { conformance } from "./conformance.ts"

const findWebKit = (): string | undefined => {
  const configured = process.env["STRIDER_WEBKIT"]
  if (configured !== undefined && configured !== "") return configured
  return WebKitLauncher.cacheCandidates(process.platform, process.env).find((candidate) => existsSync(candidate))
}

const executable = findWebKit()

conformance({
  name: "WebKit (Playwright)",
  skip: executable === undefined,
  connect: Effect.fnUntraced(function*(sink) {
    const { launched, transport } = yield* WebKitLauncher.launch({ executablePath: executable! })
    const adapter = yield* WebKitAdapter.connect(record(transport, WebKitWire.wire, fixtures.webkit), {
      sink,
      ownership: "launched",
      revision: WebKitLauncher.build.revision
    })
    return { adapter, kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore) }
  })
})
