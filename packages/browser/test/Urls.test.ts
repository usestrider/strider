import { assert, describe, it } from "@effect/vitest"
import * as Urls from "../src/internal/urls.ts"

describe("Urls.reported", () => {
  it("treats a document's placeholder names as about:blank", () => {
    for (const placeholder of ["", ":", "about:blank"]) {
      assert.strictEqual(Urls.reported(placeholder), "about:blank")
    }
  })

  it("keeps an absolute URL", () => {
    assert.strictEqual(Urls.reported("https://example.com/a?b#c"), "https://example.com/a?b#c")
  })

  it("throws on anything else, as an adapter's defect", () => {
    for (const url of ["nope", "/path", "::"]) {
      assert.throws(() => Urls.reported(url))
    }
  })
})
