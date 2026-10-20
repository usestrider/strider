/**
 * Rules the types must enforce. Each is a failing expression or an exact type, so a loosened rule fails
 * `pnpm test-types`.
 */
import {
  Deferred,
  Download,
  JSHandle,
  Locator,
  NetworkRequest,
  NetworkResponse,
  Page,
  Snapshot
} from "@usestrider/browser"
import { Deferred as EffectDeferred, Effect, Schema } from "effect"
import { HttpIncomingMessage } from "effect/http"
import { describe, expect, it } from "tstyche"

declare const observed: Page.ObservedPage
declare const reader: Page.ReadonlyPage
declare const page: Page.Page
declare const latched: Deferred.ReadonlyDeferred<number>
declare const ref: Snapshot.RefId

describe("access is typed", () => {
  it("a page you may only inspect offers no actions", () => {
    expect(reader.getByRole("button").click()).type.toRaiseError("Property 'click' does not exist")
  })

  it("a snapshot carries its page's access, so its refs can't act either", () => {
    expect<Effect.Success<ReturnType<typeof reader.snapshot>>>().type.toBe<Snapshot.Snapshot<Locator.ReadonlyLocator>>()
    expect<Effect.Success<ReturnType<typeof page.snapshot>>>().type.toBe<Snapshot.Snapshot<Locator.Locator>>()
    expect((null! as Snapshot.Snapshot<Locator.ReadonlyLocator>).ref(ref).click()).type.toRaiseError(
      "Property 'click' does not exist"
    )
  })

  it("the main world needs control", () => {
    expect(reader.evaluateInMainWorld(() => 1)).type.toRaiseError("Property 'evaluateInMainWorld' does not exist")
  })

  it("downloads need control", () => {
    expect(Download.next(observed)).type.toRaiseError()
  })

  it("collecting bodies needs inspect", () => {
    expect(
      NetworkResponse.next(observed, {
        url: "https://example.com/**",
        body: HttpIncomingMessage.schemaBodyJson(Schema.String)
      })
    ).type.toRaiseError()
  })

  it("kind guards never narrow access", () => {
    const u: unknown = page
    if (Page.isPage(u)) expect(u).type.toBe<Page.ObservedPage>()
    if (Locator.isLocator(u)) expect(u).type.toBe<Locator.ReadonlyLocator>()
  })
})

describe("inputs say what they mean", () => {
  it("\"any request\" as a first match is a footgun: next requires a url", () => {
    expect(NetworkRequest.next(page, {})).type.toRaiseError()
  })

  it("a file path must say whose machine it is on", () => {
    expect(page.getByLabel("Avatar").setInputFiles("./avatar.png")).type.toRaiseError()
  })

  it("filter({ has }) takes only a relative locator", () => {
    expect(page.getByRole("row").filter({ has: page.getByRole("button") })).type.toRaiseError()
    expect(page.getByRole("row").filter({ has: Locator.relative.getByRole("button") })).type.toBe<Locator.Locator>()
  })
})

describe("latched results are read-only", () => {
  it("a latched result can't be completed by its reader", () => {
    expect(EffectDeferred.succeed(latched, 1)).type.toRaiseError()
  })
})

describe("evaluation results are what arrives", () => {
  it("a Date survives the crossing", () => {
    expect<Effect.Success<ReturnType<typeof page.evaluate<[], Date>>>>().type.toBe<Date>()
  })

  it("a class instance arrives as its data", () => {
    class Point {
      constructor(readonly x: number) {}
      norm() {
        return Math.abs(this.x)
      }
    }
    expect<JSHandle.Serialized<Point>>().type.toBe<{ readonly x: number }>()
  })

  it("DOM nodes don't cross by value", () => {
    expect<JSHandle.Serialized<HTMLElement>>().type.toBe<
      JSHandle.NotSerializable<"DOM nodes don't cross by value; use evaluateHandle">
    >()
  })
})
