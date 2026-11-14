/**
 * What the ports of Playwright's WebSocket routing share: the options every route passes, and a route's messages as text.
 */
import type { WebSocketRoute } from "@usestrider/browser"
import type { Fixtures } from "./upstream.ts"

/**
 * The routing options every route passes: the script consent Strider asks for, and the timing WebKit accepts. A page's
 * sockets are made after each route is registered, so the earlier timing isn't needed for them.
 */
export const routing = (browserName: Fixtures["browserName"]): WebSocketRoute.Options => ({
  implementation: "script",
  timing: browserName === "webkit" ? "bestEffort" : "beforeAuthorScript"
})

/** A text message as the route sees it. */
export const text = (data: string): WebSocketRoute.Message => ({ _tag: "Text", data })

/** A route message's text, or its bytes decoded as text. */
export const textOf = (message: WebSocketRoute.Message): string =>
  message._tag === "Text" ? message.data : new TextDecoder().decode(message.data)
