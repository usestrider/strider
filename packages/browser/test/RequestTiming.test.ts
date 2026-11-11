import { assert, describe, it } from "@effect/vitest"
import * as Option from "effect/Option"
import * as Timing from "../src/internal/requestTiming.ts"

const origin = { timestamp: 10, wallTime: 1000 }
describe("request timing normalization", () => {
  it("converts CDP seconds and preserves genuine zero phase offsets", () => {
    const value = Timing.cdp(origin, {
      requestTime: 10.25,
      dnsStart: -1,
      dnsEnd: -1,
      connectStart: 0,
      connectEnd: 2,
      sslStart: -1,
      sendStart: 3,
      receiveHeadersStart: 5
    }, 10.3)
    assert.deepStrictEqual(value.startTime, Option.some(1000250))
    assert.deepStrictEqual(value.domainLookupStart, Option.none())
    assert.deepStrictEqual(value.connectStart, Option.some(0))
    assert.approximately(Option.getOrThrow(value.responseEnd), 50, .00001)
  })
  it("uses Firefox's own redirect-hop requestTime, not chain redirectStart", () => {
    const value = Timing.bidi({
      timeOrigin: 0,
      requestTime: 10020,
      redirectStart: 10000,
      dnsStart: 0,
      dnsEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      tlsStart: 0,
      requestStart: 10022,
      responseStart: 10024,
      responseEnd: 10025
    }, false)
    assert.deepStrictEqual(value.startTime, Option.some(10020))
    assert.deepStrictEqual(value.requestStart, Option.some(2))
    assert.deepStrictEqual(value.responseEnd, Option.none())
    const complete = Timing.bidi({ timeOrigin: 9000, requestTime: 1020, requestStart: 1022, responseEnd: 1030 }, true)
    assert.deepStrictEqual(complete.startTime, Option.some(10020))
    assert.deepStrictEqual(complete.responseEnd, Option.some(10))
  })
  it("converts WebKit fetchStart seconds and refuses ambiguous zero phases", () => {
    const value = Timing.webkit(origin, {
      fetchStart: 10.5,
      startTime: 10.1,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      secureConnectionStart: 0,
      requestStart: 2,
      responseStart: 4,
      responseEnd: 5
    }, 10.6)
    assert.deepStrictEqual(value.startTime, Option.some(1000500))
    assert.deepStrictEqual(value.requestStart, Option.some(2))
    assert.deepStrictEqual(value.connectStart, Option.none())
    assert.approximately(Option.getOrThrow(value.responseEnd), 100, .00001)
  })
  it("leaves unknown origins unavailable and does not turn header end into completion", () => {
    assert.deepStrictEqual(Timing.cdp(origin, undefined).responseEnd, Option.none())
    assert.deepStrictEqual(
      Timing.bidi({ timeOrigin: 0, requestTime: 0, requestStart: 4 }, true).requestStart,
      Option.none()
    )
    assert.deepStrictEqual(Timing.webkit(origin, { fetchStart: NaN, requestStart: 3 }, 11).responseEnd, Option.none())
  })
})
