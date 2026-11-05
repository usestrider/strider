import { Page, Route, UserContext } from "@usestrider/browser"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Redacted from "effect/Redacted"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const context: UserContext.UserContext

const auth = () => Route.provideCredentials({ username: "u", password: Redacted.make("p") })
const response = () => Route.continueWith({ status: 201 })
const request = () => Route.continueWith(HttpClientRequest.setHeader("x", "y"))

describe("page.route phase selection", () => {
  it("defaults to request with omitted options", () => {
    expect(page.route("**", auth)).type.toRaiseError()
    expect(page.route("**", response)).type.toRaiseError()
    expect(page.route("**", request)).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue)).type.not.toRaiseError()
    expect(page.route("**", () => Route.abort())).type.not.toRaiseError()
  })
  it("defaults to request with undefined options", () => {
    expect(page.route("**", auth, undefined)).type.toRaiseError()
    expect(page.route("**", response, undefined)).type.toRaiseError()
    expect(page.route("**", request, undefined)).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue, undefined)).type.not.toRaiseError()
    expect(page.route("**", () => Route.abort(), undefined)).type.not.toRaiseError()
  })
  it("defaults to request with empty options", () => {
    expect(page.route("**", auth, {})).type.toRaiseError()
    expect(page.route("**", response, {})).type.toRaiseError()
    expect(page.route("**", request, {})).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue, {})).type.not.toRaiseError()
    expect(page.route("**", () => Route.abort(), {})).type.not.toRaiseError()
  })
  it("defaults to request with undefined phase", () => {
    expect(page.route("**", auth, { phase: undefined })).type.toRaiseError()
    expect(page.route("**", response, { phase: undefined })).type.toRaiseError()
    expect(page.route("**", request, { phase: undefined })).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue, { phase: undefined })).type.not.toRaiseError()
    expect(page.route("**", () => Route.abort(), { phase: undefined })).type.not.toRaiseError()
  })
  it("accepts compatible explicit phases and rejects incompatible handlers", () => {
    expect(page.route("**", request, { phase: "request" })).type.not.toRaiseError()
    expect(page.route("**", response, { phase: "response" })).type.not.toRaiseError()
    expect(page.route("**", auth, { phase: "auth" })).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue, { phase: "auth" })).type.not.toRaiseError()
    expect(page.route("**", auth, { phase: "request" })).type.toRaiseError()
    expect(page.route("**", response, { phase: "request" })).type.toRaiseError()
    expect(page.route("**", request, { phase: "response" })).type.toRaiseError()
    expect(page.route("**", response, { phase: "auth" })).type.toRaiseError()
  })
})

describe("context.route phase selection", () => {
  it("defaults to request with omitted options", () => {
    expect(context.route("**", auth)).type.toRaiseError()
    expect(context.route("**", response)).type.toRaiseError()
    expect(context.route("**", request)).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue)).type.not.toRaiseError()
    expect(context.route("**", () => Route.abort())).type.not.toRaiseError()
  })
  it("defaults to request with undefined options", () => {
    expect(context.route("**", auth, undefined)).type.toRaiseError()
    expect(context.route("**", response, undefined)).type.toRaiseError()
    expect(context.route("**", request, undefined)).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue, undefined)).type.not.toRaiseError()
    expect(context.route("**", () => Route.abort(), undefined)).type.not.toRaiseError()
  })
  it("defaults to request with empty options", () => {
    expect(context.route("**", auth, {})).type.toRaiseError()
    expect(context.route("**", response, {})).type.toRaiseError()
    expect(context.route("**", request, {})).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue, {})).type.not.toRaiseError()
    expect(context.route("**", () => Route.abort(), {})).type.not.toRaiseError()
  })
  it("defaults to request with undefined phase", () => {
    expect(context.route("**", auth, { phase: undefined })).type.toRaiseError()
    expect(context.route("**", response, { phase: undefined })).type.toRaiseError()
    expect(context.route("**", request, { phase: undefined })).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue, { phase: undefined })).type.not.toRaiseError()
    expect(context.route("**", () => Route.abort(), { phase: undefined })).type.not.toRaiseError()
  })
  it("accepts compatible explicit phases and rejects incompatible handlers", () => {
    expect(context.route("**", request, { phase: "request" })).type.not.toRaiseError()
    expect(context.route("**", response, { phase: "response" })).type.not.toRaiseError()
    expect(context.route("**", auth, { phase: "auth" })).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue, { phase: "auth" })).type.not.toRaiseError()
    expect(context.route("**", auth, { phase: "request" })).type.toRaiseError()
    expect(context.route("**", response, { phase: "request" })).type.toRaiseError()
    expect(context.route("**", request, { phase: "response" })).type.toRaiseError()
    expect(context.route("**", response, { phase: "auth" })).type.toRaiseError()
  })
})
