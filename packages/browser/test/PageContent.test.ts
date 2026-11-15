/** Replacement failures retain the page operation and typed evaluation reason. */
import { assert, it } from "@effect/vitest"
import { Browser, Target } from "@usestrider/browser"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as BrowserImpl from "../src/internal/browser.ts"
import * as Fake from "../src/internal/fake.ts"

// Where the protocol reports `document.open()`, only the write evaluates; elsewhere a cleanup removes its listener
for (const [reportsDocumentOpen, expected] of [[false, 2], [true, 1]] as const) {
  it.effect(`setContent names evaluation exceptions and does no work on unused pages (document.open() reported: ${reportsDocumentOpen})`, () => {
    let evaluations = 0
    const backend = BrowserImpl.layer((sink) =>
      Effect.map(
        Fake.connect([], {
          info: new Browser.Info(Fake.info),
          capabilities: new Browser.CapabilitySet({ entries: Fake.capabilities })
        })(sink),
        (fake) => ({
          ...fake,
          reportsDocumentOpen,
          realm: () => Effect.succeed(Target.RealmId.make("replacement-realm")),
          evaluate: () => {
            evaluations++
            if (evaluations > 1) {
              return Effect.succeed({ _tag: "Value" as const, value: { type: "undefined" as const } })
            }
            return Effect.succeed({
              _tag: "Exception" as const,
              text: "Uncaught Error: blocked replacement",
              exception: { type: "undefined" as const },
              stack: Option.none()
            })
          }
        })
      )
    )
    return Effect.scoped(Effect.gen(function*() {
      const page = yield* Browser.newPage()
      assert.strictEqual(evaluations, 0)
      const error = yield* page.setContent("<p>Hello</p>").pipe(Effect.flip)
      assert.strictEqual(error._tag, "PageError")
      if (error._tag === "PageError") {
        assert.strictEqual(error.operation, "Page.setContent")
        assert.strictEqual(error.reason._tag, "EvaluationThrown")
      }
      assert.strictEqual(evaluations, expected)
    })).pipe(Effect.provide(backend))
  })
}
