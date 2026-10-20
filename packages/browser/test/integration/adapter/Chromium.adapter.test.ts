/**
 * The adapter conformance suite against Chromium over CDP, launched over the pipe. Set `STRIDER_CHROMIUM`,
 * or put Chromium or Chrome on `PATH`.
 */
import * as Effect from "effect/Effect"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as CdpAdapter from "../../../src/internal/cdpAdapter.ts"
import * as ChromiumLauncher from "../../../src/internal/chromiumLauncher.ts"
import { conformance } from "./conformance.ts"

const findChromium = (): string | undefined => {
  const configured = process.env["STRIDER_CHROMIUM"]
  if (configured !== undefined && configured !== "") return configured
  for (const directory of (process.env["PATH"] ?? "").split(path.delimiter)) {
    for (const name of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"]) {
      const candidate = path.join(directory, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const executable = findChromium()

conformance({
  name: "Chromium (CDP)",
  skip: executable === undefined,
  connect: Effect.fnUntraced(function*(sink) {
    const { transport } = yield* ChromiumLauncher.launch({ executablePath: executable! })
    return yield* CdpAdapter.connect(transport, { sink, ownership: "launched" })
  })
})
