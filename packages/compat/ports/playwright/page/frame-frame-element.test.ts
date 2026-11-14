/**
 * Playwright's `tests/page/frame-frame-element.spec.ts`: the iframe element a frame belongs to, and frames whose
 * elements sit in a shadow root.
 *
 * What the port changes:
 * - Only FR-019 is ported. The others ask a frame for its element (`frame.frameElement()`), which Strider can't do: its
 *   frames are nodes of a tree and locators entered from an element, and a frame entered from an element has that
 *   element as its `owner`, so reading `owner` back is reading the locator the test just wrote. Each is `needsFeature`
 *   in the ledger, naming `method-frame-frameelement`.
 * - FR-019 counts the page's frames, enters the iframe by a locator that pierces the open shadow root, and reads the
 *   iframe's `name` from that element. The iframe's own document (`<h1>Hi!</h1>`) is read through the frame entered by
 *   the same element, which ties the element the locator found to the frame the shadow root holds.
 */
import { assert } from "@effect/vitest"
import { Expect } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { frameCount } from "../../harness/playwright.ts"
import { upstream } from "../../harness/upstream.ts"

upstream(import.meta.filename, {}, (test) => {
  test("FR-019", ({ page, server }) =>
    Effect.gen(function*() {
      yield* page.goto(server.EMPTY_PAGE, { waitUntil: "load" })
      yield* page.setContent(`
        <div>
          <template shadowrootmode="open">
            <iframe name="myframe" srcdoc="<h1>Hi!</h1>"></iframe>
            <slot></slot>
          </template>
          <span>footer</span>
        </div>
      `)
      assert.strictEqual(yield* frameCount(page), 2)
      // page.frames()[1].frameElement(): the iframe element, which a locator reaches through the open shadow root
      const frame = page.frame(page.locator("iframe"))
      assert.deepStrictEqual(yield* frame.owner.readAttribute("name"), Option.some("myframe"))
      // and the frame entered by that element holds the iframe's document
      yield* Expect.toHaveText(frame.locator("h1"), "Hi!")
    }))
})
