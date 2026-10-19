/** A CLI segment (CLI.md): `eb -s checkout run segment.ts`. Its pages are found by name. */
import { Effect } from "effect"
import { Deferred, Popup } from "../src/index.ts"
import { CurrentSession } from "../src/cli.ts"

export default Effect.gen(function* () {
  const session = yield* CurrentSession
  const shop = yield* session.page("shop")              // looked up first, so a missing page fails before any step
  const popups = yield* Popup.next(shop)
  yield* shop.getByText("Pay").click
  const popup = yield* Deferred.await(popups)
  yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
  return { popup }                                      // returned handles move into the session
})
