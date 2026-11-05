import { Deadline, Page, Route, Target, UserContext } from "@usestrider/browser"
import { Effect, Scope } from "effect"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as Redacted from "effect/Redacted"
import { describe, expect, it } from "tstyche"

declare const page: Page.Page
declare const context: UserContext.UserContext

interface Dependency {
  readonly dependency: unique symbol
}
declare const dependency: Effect.Effect<void, never, Dependency>
declare const optionalAuth: Route.Options<"auth">
declare const optionalResponse: { readonly phase: "response" | undefined }
declare const maybeOptions: { readonly phase: "auth" } | undefined
declare const unionPhase: { readonly phase: "auth" | "response" }

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

describe("page.route phase boundaries", () => {
  it("does not let explicit generics bypass the default", () => {
    expect(page.route<never, never, "auth">("**", auth)).type.toRaiseError()
    expect(page.route<never, never, "response">("**", response, {})).type.toRaiseError()
    expect(page.route<never, never, "auth">("**", auth, { phase: "auth" })).type.not.toRaiseError()
    expect(page.route<never, never, Route.Phase>("**", auth)).type.toRaiseError()
  })
  it("requires compatibility with every possible phase including the default", () => {
    expect(page.route("**", auth, optionalAuth)).type.toRaiseError()
    expect(page.route("**", response, optionalResponse)).type.toRaiseError()
    expect(page.route("**", auth, maybeOptions)).type.toRaiseError()
    expect(page.route("**", auth, unionPhase)).type.toRaiseError()
    expect(page.route("**", () => Route.continue, optionalAuth)).type.not.toRaiseError()
    expect(page.route("**", (paused) => {
      expect(paused).type.toBe<Route.RequestPhase | Route.AuthPhase>()
      return Route.continue
    }, optionalAuth)).type.not.toRaiseError()
    expect(page.route("**", () => Route.continue, unionPhase)).type.not.toRaiseError()
  })
  it("contextually types callbacks and preserves handler requirements", () => {
    const registration = page.route("**", (paused) => {
      expect(paused).type.toBe<Route.RequestPhase>()
      return Effect.flatMap(dependency, () => Route.continue)
    })
    expect(registration).type.toBe<
      Effect.Effect<
        Route.Registration,
        Route.RouteError | Target.TargetGone | Deadline.Timeout,
        Scope.Scope | Dependency
      >
    >()
    expect(page.route("**", (paused) => {
      expect(paused).type.toBe<Route.ResponsePhase>()
      return Effect.flatMap(Effect.fail("handler failure" as const), () => response())
    }, { phase: "response" })).type.toBe<
      Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
    >()
  })
})

describe("context.route phase boundaries", () => {
  it("does not let explicit generics bypass the default", () => {
    expect(context.route<never, never, "auth">("**", auth)).type.toRaiseError()
    expect(context.route<never, never, "response">("**", response, {})).type.toRaiseError()
    expect(context.route<never, never, "auth">("**", auth, { phase: "auth" })).type.not.toRaiseError()
    expect(context.route<never, never, Route.Phase>("**", auth)).type.toRaiseError()
  })
  it("requires compatibility with every possible phase including the default", () => {
    expect(context.route("**", auth, optionalAuth)).type.toRaiseError()
    expect(context.route("**", response, optionalResponse)).type.toRaiseError()
    expect(context.route("**", auth, maybeOptions)).type.toRaiseError()
    expect(context.route("**", auth, unionPhase)).type.toRaiseError()
    expect(context.route("**", () => Route.continue, optionalAuth)).type.not.toRaiseError()
    expect(context.route("**", (paused) => {
      expect(paused).type.toBe<Route.RequestPhase | Route.AuthPhase>()
      return Route.continue
    }, optionalAuth)).type.not.toRaiseError()
    expect(context.route("**", () => Route.continue, unionPhase)).type.not.toRaiseError()
  })
  it("contextually types callbacks and preserves handler requirements", () => {
    const registration = context.route("**", (paused) => {
      expect(paused).type.toBe<Route.RequestPhase>()
      return Effect.flatMap(dependency, () => Route.continue)
    })
    expect(registration).type.toBe<
      Effect.Effect<
        Route.Registration,
        Route.RouteError | Target.TargetGone | Deadline.Timeout,
        Scope.Scope | Dependency
      >
    >()
    expect(context.route("**", (paused) => {
      expect(paused).type.toBe<Route.ResponsePhase>()
      return Effect.flatMap(Effect.fail("handler failure" as const), () => response())
    }, { phase: "response" })).type.toBe<
      Effect.Effect<Route.Registration, Route.RouteError | Target.TargetGone | Deadline.Timeout, Scope.Scope>
    >()
  })
})

describe("route handlers declared for more phases than selected", () => {
  const everyPhase: Route.Handler<never, never, Route.Phase> = () => Route.continue
  const requestOrAuth: Route.Handler<never, never, "request" | "auth"> = () => Route.continue

  it("page.route accepts them at the default phase", () => {
    expect(page.route("**", everyPhase)).type.not.toRaiseError()
    expect(page.route("**", requestOrAuth)).type.not.toRaiseError()
    expect(page.route("**", everyPhase, {})).type.not.toRaiseError()
  })
  it("page.route accepts them at an explicit phase", () => {
    expect(page.route("**", everyPhase, { phase: "request" })).type.not.toRaiseError()
    expect(page.route("**", everyPhase, { phase: "response" })).type.not.toRaiseError()
    expect(page.route("**", everyPhase, { phase: "auth" })).type.not.toRaiseError()
    expect(page.route("**", requestOrAuth, { phase: "auth" })).type.not.toRaiseError()
  })
  it("context.route accepts them at the default phase", () => {
    expect(context.route("**", everyPhase)).type.not.toRaiseError()
    expect(context.route("**", requestOrAuth)).type.not.toRaiseError()
    expect(context.route("**", everyPhase, {})).type.not.toRaiseError()
  })
  it("context.route accepts them at an explicit phase", () => {
    expect(context.route("**", everyPhase, { phase: "request" })).type.not.toRaiseError()
    expect(context.route("**", everyPhase, { phase: "response" })).type.not.toRaiseError()
    expect(context.route("**", everyPhase, { phase: "auth" })).type.not.toRaiseError()
    expect(context.route("**", requestOrAuth, { phase: "auth" })).type.not.toRaiseError()
  })
})
