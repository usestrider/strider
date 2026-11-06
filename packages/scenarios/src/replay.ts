/**
 * A public demo site's recording, replayed under a Strider program that visits the site live: the program is
 * written as a reader would write it, and the runner answers every request it makes from the recording, so a run
 * sends nothing to anyone.
 */
import { Browser, Route, type UserContext } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as FileSystem from "effect/FileSystem"

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
