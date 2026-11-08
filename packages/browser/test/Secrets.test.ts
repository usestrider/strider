import { assert, describe, it } from "@effect/vitest"
import * as Secrets from "../src/internal/secrets.ts"

describe("secret diagnostics", () => {
  it("deduplicates original inputs and suggests only a unique name within one edit", () => {
    const messages = Secrets.diagnostics({ url: "%pasword%", values: ["%pasword%", "%other%"] }, ["password", "token"])
    assert.lengthOf(messages, 2)
    assert.include(messages[0]!, "Did you mean %password%?")
    assert.notInclude(messages[1]!, "Did you mean")
    assert.notInclude(Secrets.diagnostics("%cat%", ["bat", "car"])[0]!, "Did you mean")
    assert.notInclude(Secrets.diagnostics("%psswrd%", ["password"])[0]!, "Did you mean")
  })

  it("ignores configured names, percent escapes and text outside the name grammar", () => {
    assert.deepStrictEqual(
      Secrets.diagnostics("caf%C3%A9%20%AB%ff %password% %with.dot% %1name%", ["password", "with.dot"]),
      []
    )
    assert.lengthOf(Secrets.diagnostics("caf%C3%A9?x=%tokn%", ["token"]), 1)
    assert.deepStrictEqual(Secrets.diagnostics("https://example.test/%C3%ABC%20/%E2%82%ACtext%20", []), [])
    assert.include(Secrets.diagnostics("%bad%", [])[0]!, "%bad% names no secret")
  })

  it("quotes arbitrary configured names on one line for exported comments", () => {
    const [message] = Secrets.diagnostics("%typo%", ["name\n// injected\u2028"])
    assert.notMatch(message!, /[\n\r\u2028\u2029]/)
  })
})
