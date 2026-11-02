import { Dialog, FileChooser, Page, Route } from "@usestrider/browser"
import { Effect } from "effect"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"
import * as Redacted from "effect/Redacted"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const dialog: Dialog.Pending
declare const chooser: FileChooser.Pending
declare const plainRoute: Route.Decision<"request">
declare const plainDialog: Dialog.Decision
declare const plainChooser: FileChooser.Decision

describe("decision Effects", () => {
  it("preserves Route phases", () => {
    expect(Route.continue).type.toBe<Effect.Effect<Route.Decision<Route.Phase>>>()
    expect(Route.fallthrough).type.toBe<Effect.Effect<Route.Decision<Route.Phase>>>()
    expect(Route.abort()).type.toBe<Effect.Effect<Route.Decision<"request" | "response">>>()
    expect(Route.fulfill(HttpServerResponse.text("ok"))).type.toBe<
      Effect.Effect<Route.Decision<"request" | "response">>
    >()
    expect(Route.continueWith(HttpClientRequest.setHeader("x", "y"))).type.toBe<
      Effect.Effect<Route.Decision<"request">>
    >()
    expect(Route.continueWith({ status: 201 })).type.toBe<Effect.Effect<Route.Decision<"response">>>()
    const auth = Route.provideCredentials({ username: "u", password: Redacted.make("p") })
    expect(auth).type.toBe<Effect.Effect<Route.Decision<"auth">>>()
    expect<() => typeof auth>().type.not.toBeAssignableTo<Route.Handler<never, never, "request">>()
    expect<() => ReturnType<typeof Route.abort>>().type.not.toBeAssignableTo<Route.Handler<never, never, "auth">>()
    expect<() => ReturnType<typeof Route.continueWith>>().type.not.toBeAssignableTo<
      Route.Handler<never, never, "request">
    >()
  })
  it("exposes Effects for every pending decision", () => {
    if (dialog._tag === "BeforeUnload") {
      expect(dialog.leave).type.toBe<Effect.Effect<Dialog.Decision>>()
      expect(dialog.stay).type.toBe<Effect.Effect<Dialog.Decision>>()
    } else {
      expect(dialog.accept).type.toBe<Effect.Effect<Dialog.Decision>>()
      if (dialog._tag !== "Alert") expect(dialog.dismiss).type.toBe<Effect.Effect<Dialog.Decision>>()
      if (dialog._tag === "Prompt" || dialog._tag === "Unknown") {
        expect(dialog.respond("text")).type.toBe<Effect.Effect<Dialog.Decision>>()
      }
    }
    expect(chooser.cancel).type.toBe<Effect.Effect<FileChooser.Decision>>()
    expect<ReturnType<typeof chooser.select>>().type.toBe<Effect.Effect<FileChooser.Decision>>()
  })
  it("requires Effect-only handler returns", () => {
    expect(page.route("**", () => plainRoute)).type.toRaiseError()
    expect(Dialog.handle(page, () => plainDialog)).type.toRaiseError()
    expect(FileChooser.handle(page, () => plainChooser)).type.toRaiseError()
    expect(page.route("**", () => Route.abort())).type.not.toRaiseError()
    expect(Dialog.handle(page, Dialog.acceptAll)).type.not.toRaiseError()
    expect(FileChooser.handle(page, (pending) => pending.cancel)).type.not.toRaiseError()
  })
})
