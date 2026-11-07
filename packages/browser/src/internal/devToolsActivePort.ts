/** Reads the endpoint Chromium publishes after opening its debugging port. */
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Schedule from "effect/Schedule"
import * as BrowserClock from "./browserClock.ts"

/** Both lines must be present before a connection can be attempted. */
export const parse = (text: string): { readonly port: number; readonly browserPath: string } | undefined => {
  const lines = text.split("\n")
  const [port, browserPath] = lines
  if (
    port === undefined || !/^[0-9]+$/.test(port) ||
    Number(port) < 1 || Number(port) > 65535 ||
    browserPath === undefined || !browserPath.startsWith("/devtools/browser/") ||
    browserPath.length === "/devtools/browser/".length || /\s/.test(browserPath) ||
    lines.length > 3 || (lines.length === 3 && lines[2] !== "")
  ) return undefined
  return { port: Number(port), browserPath }
}

/** Retries missing, partial and invalid contents on the live clock, bounded by the caller's launch wait. */
export const read = Effect.fnUntraced(function*(
  userDataDir: string,
  options?: {
    readonly timeout?: Duration.Input | undefined
    readonly until?: (() => Effect.Effect<boolean>) | undefined
  }
) {
  const fs = yield* FileSystem.FileSystem
  return yield* fs.readFileString(`${userDataDir}/DevToolsActivePort`).pipe(
    Effect.map(parse),
    Effect.filterOrFail((endpoint) => endpoint !== undefined),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), until: options?.until }),
    Effect.timeout(options?.timeout ?? "30 seconds"),
    BrowserClock.onLive
  )
})
