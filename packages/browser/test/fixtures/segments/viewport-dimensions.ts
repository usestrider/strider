import * as Effect from "effect/Effect"
import { CurrentSession } from "../../../src/cli/index.ts"

export default Effect.gen(function*() {
  const session = yield* CurrentSession.CurrentSession
  const pages = []
  for (const name of ["first", "second"]) {
    const page = yield* session.page(name).pipe(Effect.option)
    if (page._tag === "None") continue
    pages.push({
      name,
      id: page.value.id,
      dimensions: yield* page.value.evaluateInMainWorld(() => ({
        url: location.href,
        inner: [innerWidth, innerHeight],
        outer: [outerWidth, outerHeight],
        screen: [screen.width, screen.height],
        available: [screen.availWidth, screen.availHeight],
        dpr: devicePixelRatio,
        text: document.querySelector("#size")?.textContent
      }))
    })
  }
  console.log(JSON.stringify(pages))
})
