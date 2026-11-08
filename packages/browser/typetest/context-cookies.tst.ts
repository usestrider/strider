import { CookieJar, Deadline, Target, UserContext } from "@usestrider/browser"
import type { HttpClient } from "effect/http"
import { describe, expect, it } from "tstyche"

declare const context: UserContext.UserContext
declare const client: HttpClient.HttpClient.With<"transport", "service">

describe("UserContext.withCookies", () => {
  it("preserves the client's errors and requirements in both forms", () => {
    type Shared = HttpClient.HttpClient.With<
      "transport" | CookieJar.CookieJarError | Target.TargetGone | Deadline.Timeout,
      "service"
    >
    expect(UserContext.withCookies(client, context)).type.toBe<Shared>()
    expect(client.pipe(UserContext.withCookies(context))).type.toBe<Shared>()
    expect(UserContext.withCookies(client, {} as UserContext.ObservedUserContext)).type.toRaiseError()
  })
})
