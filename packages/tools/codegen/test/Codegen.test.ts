import { assert, describe, it } from "@effect/vitest"
import type { CdpProtocol } from "../src/Cdp.ts"
import { parse, possible } from "../src/Cdp.ts"
import { applyCorrections, applyOverlays, audit } from "../src/Corrections.ts"
import { emit } from "../src/Emit.ts"

const fixture: CdpProtocol = {
  domains: [
    {
      domain: "Net",
      types: [
        { id: "RequestId", type: "string" },
        {
          id: "Cookie",
          type: "object",
          properties: [
            { name: "name", type: "string" },
            { name: "value", type: "string" },
            { name: "priority", type: "string", enum: ["Low", "High"] },
            { name: "legacy", type: "string", deprecated: true },
            { name: "partition", type: "string", experimental: true }
          ]
        },
        { id: "Old", type: "object", deprecated: true, properties: [{ name: "x", type: "integer" }] },
        { id: "Kept", type: "object", deprecated: true, properties: [{ name: "x", type: "integer" }] },
        { id: "Headers", type: "object" }
      ],
      commands: [
        {
          name: "getCookies",
          parameters: [{ name: "urls", type: "array", items: { type: "string" }, optional: true }],
          returns: [{ name: "cookies", type: "array", items: { $ref: "Cookie" } }]
        },
        { name: "enable" },
        { name: "useKept", returns: [{ name: "kept", $ref: "Kept" }] },
        { name: "gone", deprecated: true }
      ],
      events: [{ name: "requestSent", parameters: [{ name: "requestId", $ref: "RequestId" }] }]
    },
    {
      domain: "Card",
      types: [{ id: "Protocol", type: "string", enum: ["T0", "T1"] }],
      commands: [{ name: "connect", parameters: [{ name: "id", $ref: "Net.RequestId" }] }]
    }
  ]
}

const model = parse("test", [fixture])

describe("parse", () => {
  it("keys every shape by name, including what the spec writes inline", () => {
    assert.deepStrictEqual(Object.keys(model.shapes), [
      "Card#Protocol",
      "Card#connect",
      "Card#connect.Params",
      "Net#Cookie",
      "Net#Cookie.priority",
      "Net#Headers",
      "Net#Kept",
      "Net#Old",
      "Net#RequestId",
      "Net#enable",
      "Net#getCookies",
      "Net#getCookies.Params",
      "Net#getCookies.Result",
      "Net#gone",
      "Net#requestSent",
      "Net#requestSent.Params",
      "Net#useKept",
      "Net#useKept.Result"
    ])
  })

  it("resolves references within and across domains", () => {
    const connect = model.shapes["Card#connect.Params"]
    assert(connect?._tag === "Struct")
    assert.deepStrictEqual(connect.members["id"]?.type, { _tag: "Ref", shape: "Net#RequestId" })
  })

  it("fails on a reference that doesn't resolve", () => {
    assert.throws(
      () =>
        parse("test", [{
          domains: [{ domain: "A", commands: [{ name: "x", returns: [{ name: "y", $ref: "Nope" }] }] }]
        }]),
      /A#Nope doesn't resolve/
    )
  })

  it("WebKit: keeps what some desktop build compiles in, once, with its condition", () => {
    const ios = "defined(WTF_PLATFORM_IOS_FAMILY) && WTF_PLATFORM_IOS_FAMILY"
    assert.isFalse(possible(ios))
    assert.isTrue(possible(`!(${ios})`))
    assert.isTrue(possible("(defined(ENABLE_WEB_ARCHIVE) && ENABLE_WEB_ARCHIVE) && (defined(USE_CF) && USE_CF)"))
    // WebKit's macros, as the Automation protocol writes them
    assert.isTrue(possible("ENABLE(WEBDRIVER_BIDI)"))
    assert.isTrue(possible("ENABLE(REMOTE_INSPECTOR) && USE(SOUP)"))
    assert.isFalse(possible("PLATFORM(IOS_FAMILY)"))
    assert.throws(() => possible("defined(A"), /expected \)/)
    const webkit = parse("test", [{
      domains: [{
        domain: "DOM",
        commands: [
          { name: "highlight", condition: ios, parameters: [{ name: "a", type: "string" }] },
          { name: "highlight", condition: `!(${ios})`, parameters: [{ name: "b", $ref: "boolean" }] }
        ]
      }]
    }], "webkit")
    const params = webkit.shapes["DOM#highlight.Params"]
    assert(params?._tag === "Struct")
    assert.deepStrictEqual(Object.keys(params.members), ["b"])
    assert.deepStrictEqual(params.members["b"]?.type, { _tag: "Scalar", scalar: "boolean" })
    assert.strictEqual(webkit.shapes["DOM#highlight"]?.traits.condition, `!(${ios})`)
  })
})

describe("corrections", () => {
  const correction = {
    spec: "urls is optional",
    wire: "Chrome requires it",
    evidence: "fixture",
    operations: [{ op: "replace" as const, path: "/shapes/Net#getCookies.Params/members/urls/optional", value: false }]
  }

  it("apply as JSON patches over the model", () => {
    const corrected = applyCorrections(model, [["urls.json", correction]])
    const params = corrected.shapes["Net#getCookies.Params"]
    assert(params?._tag === "Struct")
    assert.isFalse(params.members["urls"]?.optional)
  })

  it("fail, naming the file, when a pointer no longer resolves", () => {
    const stale = {
      ...correction,
      operations: [{ ...correction.operations[0]!, path: "/shapes/Net#gone.Params/members/urls/optional" }]
    }
    assert.throws(() => applyCorrections(model, [["stale.json", stale]]), /stale\.json/)
  })

  it("are audited: one the spec now agrees with is absorbed, and one another builds on is needed", () => {
    // The fixture's spec already says urls is optional, so this one changes nothing
    const absorbed = {
      ...correction,
      operations: [{ ...correction.operations[0]!, value: true }]
    }
    const added = {
      ...correction,
      operations: [{
        op: "add" as const,
        path: "/shapes/Net#getCookies.Params/members/limit",
        value: { type: { _tag: "Scalar", scalar: "integer" }, optional: true, traits: { status: "stable" } }
      }]
    }
    const builtOn = {
      ...correction,
      operations: [{
        op: "replace" as const,
        path: "/shapes/Net#getCookies.Params/members/limit/optional",
        value: false
      }]
    }
    assert.deepStrictEqual(
      audit(model, [["absorbed.json", absorbed], ["added.json", added], ["built-on.json", builtOn]]),
      [
        { file: "absorbed.json", verdict: "absorbed" },
        { file: "added.json", verdict: "needed" },
        { file: "built-on.json", verdict: "needed" }
      ]
    )
  })
})

describe("overlays", () => {
  it("annotate shapes and members", () => {
    const annotated = applyOverlays(model, [["o.json", {
      reason: "fixture",
      annotate: [
        { target: "Net#RequestId", traits: { id: true } },
        { target: "Net#Cookie:value", traits: { sensitive: true } }
      ]
    }]])
    assert.isTrue(annotated.shapes["Net#RequestId"]?.traits.id)
    const cookie = annotated.shapes["Net#Cookie"]
    assert(cookie?._tag === "Struct")
    assert.isTrue(cookie.members["value"]?.traits.sensitive)
  })

  it("check that a release names a command, its parameter, and a path through the result", () => {
    const release = (target: string, traits: object) =>
      applyOverlays(model, [["resources.json", {
        reason: "fixture",
        annotate: [{ target, traits: { createsResource: true, ...traits } }]
      }]])
    const valid = { method: "Card.connect", param: "id", from: "/cookies/*/name" }
    const annotated = release("Net#getCookies", { release: [valid] })
    assert.deepStrictEqual(annotated.shapes["Net#getCookies"]?.traits.release, [valid])
    assert.throws(
      () => release("Net#getCookies", { release: [{ ...valid, method: "Card.gone" }] }),
      /no command Card\.gone/
    )
    assert.throws(() => release("Net#getCookies", { release: [{ ...valid, param: "nope" }] }), /has no parameter nope/)
    assert.throws(
      () => release("Net#getCookies", { release: [{ ...valid, from: "/cookies/0/name" }] }),
      /doesn't resolve/
    )
    assert.throws(
      () => release("Net#getCookies", { release: [{ ...valid, from: "/cookies/*/*" }] }),
      /steps into a list/
    )
    assert.throws(
      () =>
        applyOverlays(model, [["resources.json", {
          reason: "fixture",
          annotate: [{ target: "Net#getCookies", traits: { release: [valid] } }]
        }]]),
      /only a command that creates a resource/
    )
  })

  it("fail on a target that doesn't exist", () => {
    assert.throws(
      () =>
        applyOverlays(model, [["o.json", {
          reason: "",
          annotate: [{ target: "Net#Cookie:nope", traits: { sensitive: true } }]
        }]]),
      /o\.json: Net#Cookie has no member nope/
    )
  })
})

describe("emit", () => {
  const annotated = applyOverlays(model, [["o.json", {
    reason: "fixture",
    annotate: [
      { target: "Net#RequestId", traits: { id: true } },
      { target: "Net#Cookie:value", traits: { sensitive: true } }
    ]
  }]])
  const { coverage, modules } = emit(annotated, { description: "a fixture", output: "cdp", directory: "cdp" })
  const net = modules.get("Net.ts")!
  const card = modules.get("Card.ts")!

  it("brands ids by protocol, domain and kind", () => {
    assert.include(net, `export type RequestId = Brand.Branded<string, "~@usestrider/browser/cdp/Net/RequestId">`)
  })

  it("decodes sensitive members as Redacted", () => {
    assert.include(net, "readonly value: Redacted.Redacted<string>")
    assert.include(net, "value: Schema.RedactedFromValue(Schema.String)")
  })

  it("keeps enums open, and makes experimental members optional", () => {
    assert.include(net, `| "High"\n  | (string & {})`)
    assert.include(net, "readonly partition?: string | undefined")
  })

  it("excludes deprecated items unless an emitted shape references them", () => {
    assert.notInclude(net, "export interface Old")
    assert.notInclude(net, "legacy")
    assert.notInclude(net, "export const gone")
    assert.include(net, "export interface Kept")
    assert.deepInclude(coverage.entries, { item: "Net#Old", verdict: "excluded", reason: "deprecated" })
    assert.deepInclude(coverage.entries, { item: "Net#Kept", verdict: "kept", reason: "deprecated-but-referenced" })
    assert.deepInclude(coverage.entries, { item: "Net#Cookie:legacy", verdict: "excluded", reason: "deprecated" })
  })

  it("records approximations", () => {
    assert.deepInclude(coverage.entries, { item: "Net#Headers", verdict: "approximated", reason: "untyped-object" })
  })

  it("emits commands and events as data", () => {
    assert.include(
      net,
      `export const getCookies: Protocol.CommandDef<"Net.getCookies", GetCookiesParams, GetCookiesResult>`
    )
    assert.include(net, `export const enable: Protocol.CommandDef<"Net.enable", void, void>`)
    assert.include(net, `export const requestSent: Protocol.EventDef<"Net.requestSent", RequestSentParams>`)
  })

  it("renames an import that would collide with the module's own names", () => {
    assert.include(card, `import * as Protocol_ from "../protocol/Protocol.ts"`)
    assert.include(card, "export type Protocol =")
  })
})
