/** A CLI segment (CLI.md): `strider -s checkout run segment.ts`. Its pages are found by name. */
import { Popup } from "@usestrider/browser"
import { CurrentSession, Segment } from "@usestrider/browser/cli"
import { Effect, Schema } from "effect"

export default Segment.make(
  Schema.Record(Schema.String, Schema.Never),
  Effect.fnUntraced(function*() {
    const session = yield* CurrentSession.CurrentSession
    const shop = yield* session.page("shop") // looked up first, so a missing page fails before any step
    const popups = yield* Popup.next(shop)
    yield* shop.getByText("Pay").click()
    const popup = yield* popups
    yield* popup.getByLabel("Card number").fill("4242 4242 4242 4242")
    return { popup } // returned handles move into the session
  })
)
