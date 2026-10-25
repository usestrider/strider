// A segment for the CLI tests: opens the shop's popup and returns it, to be named into the session.
import * as Effect from "effect/Effect"
import { CurrentSession } from "../../../src/cli/index.ts"
import { Popup } from "../../../src/index.ts"

export default Effect.gen(function*() {
  const session = yield* CurrentSession.CurrentSession
  const shop = yield* session.page("shop")
  const popups = yield* Popup.next(shop)
  yield* shop.activate
  yield* shop.getByRole("button", { name: "Open" }).click()
  const popup = yield* popups
  return { popup }
})
