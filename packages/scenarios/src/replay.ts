/**
 * A public demo site's recording, replayed under a Strider program that visits the site live: the program is
 * written as a reader would write it, and the runner answers every request it makes from the recording, so a run
 * sends nothing to anyone.
 */
import { Browser, Route, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"
import * as Schema from "effect/Schema"
import * as fs from "node:fs"
import type { Scenario } from "./scenarios.ts"

/** The browser, with every context it makes, and every page in one, answered from the HAR at `path` */
export const replaying = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  path: string
): Effect.Effect<A, E, R | Browser.Browser | FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const browser = yield* Browser.Browser
    const handler = yield* Route.fromHar(path).pipe(Effect.orDie)
    const newContext = (options?: UserContext.Options) =>
      browser.newContext(options).pipe(
        Effect.tap((context) => context.route("**/*", handler).pipe(Effect.orDie))
      )
    const replayed: Browser.Browser = {
      ...browser,
      newContext,
      newPage: (options) =>
        newContext(options).pipe(
          Effect.orDie,
          Effect.flatMap((context) => context.newPage)
        )
    }
    return yield* Effect.provideService(effect, Browser.Browser, replayed)
  })

// Only request identity is needed here; replay remains responsible for matching bodies and serving responses.
const Coverage = Schema.Struct({
  log: Schema.Struct({
    entries: Schema.Array(Schema.Struct({ request: Schema.Struct({ method: Schema.String, url: Schema.String }) }))
  })
})

/** Check the selected scenarios' required pages before launching any replay browser. */
export const recordingProblems = (
  chosen: ReadonlyArray<Scenario>,
  file: (name: string) => string
): Array<string> => {
  const required = new Map<string, Set<string>>()
  for (const scenario of chosen) {
    if (scenario.recording === undefined) continue
    const pages = required.get(scenario.recording) ?? new Set<string>()
    for (const url of scenario.requiredPages) pages.add(url)
    required.set(scenario.recording, pages)
  }
  const problems: Array<string> = []
  for (const [name, pages] of required) {
    const path = file(name)
    if (!fs.existsSync(path)) {
      problems.push(`No recording at ${path}; required page URLs: ${[...pages].join(", ")}`)
      continue
    }
    try {
      const har = Schema.decodeUnknownSync(Coverage)(JSON.parse(fs.readFileSync(path, "utf8")))
      const recorded = new Set(
        har.log.entries.filter((entry) => entry.request.method === "GET").map((entry) => entry.request.url)
      )
      const missing = [...pages].filter((url) => !recorded.has(url))
      if (missing.length > 0) problems.push(`Recording ${path} is missing required page URLs: ${missing.join(", ")}`)
    } catch (error) {
      problems.push(`Cannot read recording ${path}: ${String(error)}`)
    }
  }
  return problems
}
