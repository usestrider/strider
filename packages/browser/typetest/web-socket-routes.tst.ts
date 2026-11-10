import { Deadline, Target, UserContext, WebSocketRoute } from "@usestrider/browser"
import { Effect, Scope } from "effect"
import { expect, it } from "tstyche"

declare const context: UserContext.UserContext
declare const socket: WebSocketRoute.Connection
interface Dependency {
  readonly dependency: unique symbol
}
declare const dependency: Effect.Effect<void, never, Dependency>

it("requires explicit script consent", () => {
  expect(context.routeWebSocket("**", () => Effect.void)).type.toRaiseError()
  expect(context.routeWebSocket("**", () => Effect.void, {})).type.toRaiseError()
  expect(context.routeWebSocket("**", () => Effect.void, undefined)).type.toRaiseError()
  expect(context.routeWebSocket("**", () => Effect.void, { implementation: "native" })).type.toRaiseError()
})
it("captures connection and directional handler requirements", () => {
  const registration = context.routeWebSocket("**", (connection) =>
    connection.open({
      fromPage: () => dependency
    }), { implementation: "script" })
  expect(registration).type.toBe<
    Effect.Effect<
      WebSocketRoute.Registration,
      WebSocketRoute.WebSocketRouteError | Target.TargetGone | Deadline.Timeout,
      Scope.Scope | Dependency
    >
  >()
  expect(socket.connectToServer({ fromServer: () => dependency })).type.toBe<
    Effect.Effect<
      WebSocketRoute.Server,
      WebSocketRoute.WebSocketRouteError | Target.TargetGone | Deadline.Timeout,
      Dependency
    >
  >()
})
