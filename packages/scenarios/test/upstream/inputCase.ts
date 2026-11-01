import { type Page } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type { Page as PlaywrightPage } from "playwright-core"
import { withPlaywright, withStrider } from "./helpers.ts"
import type { inputSite } from "./inputSite.ts"
import { test } from "./timing.ts"

export type InputSite = Awaited<ReturnType<typeof inputSite>>

export const inputCase = (
  library: "strider" | "playwright",
  site: () => InputSite
) =>
(
  name: string,
  html: string | (() => string),
  strider: (page: Page.Page) => Effect.Effect<void, unknown, Scope.Scope>,
  playwright: (page: PlaywrightPage) => Promise<void>
) => {
  test(name, async () => {
    const content = typeof html === "string" ? html : html()
    const url = content === "@textarea" ? site().origin + "/input/textarea.html" : site().render(content)
    if (library === "playwright") {
      await withPlaywright(async (page) => {
        await page.goto(url)
        await playwright(page)
      })
    } else {
      await withStrider(
        Effect.fn(name)(function*(page) {
          yield* page.goto(url, { waitUntil: "load" })
          yield* strider(page)
        })
      )
    }
  })
}
