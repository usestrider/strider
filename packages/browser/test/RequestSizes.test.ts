import { assert, describe, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Sizes from "../src/internal/requestSizes.ts"

describe("native request sizes", () => {
  it("keeps unavailable, invalid and genuine zero counts distinct", () => {
    for (const n of [undefined, null, -1, NaN, Infinity, 1.5]) {
      assert.deepStrictEqual(Sizes.count(n), Option.none())
    }
    assert.deepStrictEqual(Sizes.count(0), Option.some(0))
    assert.deepStrictEqual(Sizes.count(65), Option.some(65))
    assert.deepStrictEqual(Sizes.webkit(undefined), Sizes.empty())
  })
  it("keeps WebKit transferred bytes distinct from encoded entity bytes", () => {
    const result = Sizes.webkit({
      requestHeaderBytesSent: 414, requestBodyBytesSent: 0, responseHeaderBytesReceived: 205,
      responseBodyBytesReceived: 76, responseBodyDecodedSize: 4124
    })
    assert.deepStrictEqual(result.requestBodySize, Option.some(0))
    assert.deepStrictEqual(result.responseBodySize, Option.some(76))
    assert.deepStrictEqual(result.responseBodyEncodedSize, Option.none())
    assert.deepStrictEqual(result.responseBodyDecodedSize, Option.some(4124))
    assert.deepStrictEqual(result.responseTransferSize, Option.some(281))
    assert.deepStrictEqual(Sizes.webkit({ responseBodyBytesReceived: 76 }).responseTransferSize, Option.none())
    assert.deepStrictEqual(Sizes.webkit({responseHeaderBytesReceived: Number.MAX_SAFE_INTEGER, responseBodyBytesReceived: 1}).responseTransferSize, Option.none())
  })
  it("never accepts Firefox's decoded zero or infers a header/body split for unproven accounting", () => {
    const result = Sizes.bidi({protocol: "http/1.1", status: 200, fromCache: false, bytesReceived: 281, headersSize: 205, bodySize: 65, content: {size: 0}}, true)
    assert.deepStrictEqual(result.responseBodyEncodedSize, Option.some(65))
    assert.deepStrictEqual(result.responseBodyDecodedSize, Option.none())
    assert.deepStrictEqual(result.responseBodySize, Option.some(76))
    assert.deepStrictEqual(Sizes.bidi({protocol: "h2", status: 200, fromCache: false, bytesReceived: 281, headersSize: 205, bodySize: 65}, true).responseBodySize, Option.none())
    assert.deepStrictEqual(Sizes.bidi({protocol: "http/1.1", status: 200, fromCache: false, bytesReceived: 4, headersSize: 205}, true).responseBodySize, Option.none())
  })
  it("publishes no final body totals before completion or for ambiguous cache/redirect evidence", () => {
    const native = {protocol: "http/1.1", status: 200, fromCache: false, bytesReceived: 281, headersSize: 205, bodySize: 65}
    assert.deepStrictEqual(Sizes.bidi(native, false).responseTransferSize, Option.none())
    assert.deepStrictEqual(Sizes.bidi(native, false).responseBodyEncodedSize, Option.none())
    assert.deepStrictEqual(Sizes.bidi({...native, fromCache: true}, true), Sizes.empty())
    assert.deepStrictEqual(Sizes.bidi({...native, status: 304}, true), Sizes.empty())
    assert.deepStrictEqual(Sizes.cdp(281, 4124).responseTransferSize, Option.some(281))
    assert.deepStrictEqual(Sizes.cdp(281, 4124).responseBodyDecodedSize, Option.some(4124))
    assert.deepStrictEqual(Sizes.cdp(281, undefined).responseBodyDecodedSize, Option.none())
    assert.deepStrictEqual(Sizes.cdp(281, 0).responseBodyEncodedSize, Option.none())
  })
})
