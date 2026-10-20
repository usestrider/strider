/**
 * The adapter conformance suite against Firefox over WebDriver BiDi. Set `STRIDER_FIREFOX`, or put `firefox`
 * on `PATH`.
 */
import * as Effect from "effect/Effect"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as BidiAdapter from "../../../src/internal/bidiAdapter.ts"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import { conformance } from "./conformance.ts"

const findFirefox = (): string | undefined => {
  const configured = process.env["STRIDER_FIREFOX"]
  if (configured !== undefined && configured !== "") return configured
  for (const directory of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "firefox")
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const executable = findFirefox()

conformance({
  name: "Firefox (BiDi)",
  skip: executable === undefined,
  connect: Effect.fnUntraced(function*(sink) {
    const { launched, transport } = yield* FirefoxLauncher.launch({ executablePath: executable! })
    const adapter = yield* BidiAdapter.connect(transport, { sink, ownership: "launched" })
    return { adapter, kill: launched.handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore) }
  })
})
