/**
 * The envelope stock WebKit's pages reach the WebKit adapter in: ours, not the browser's. The
 * transports (`webkitStockTransport.ts` attached, `webkitAutomation.ts` launched) present each page as a page proxy,
 * whose messages carry its `pageProxyId` and whose inspector target is reached through `Target`, as WebKit's own
 * inspector proxies reach a page (`webkitWire.ts`). This domain is what the transports make up: `enable` announces
 * the pages open, and `pageProxyCreated` and `pageProxyDestroyed` their coming and going.
 */
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"

/** The domain's name, which the transports answer and the wire routes by. */
export const domain = "Envelope"

/** Announces the pages open, before it replies, and every page after. */
export const enable: Protocol.CommandDef<"Envelope.enable", void, void> = Protocol.command(
  "Envelope.enable",
  undefined,
  undefined,
  { status: "stable", session: "browser" }
)

/** A page and the context it is in: the browser process's key, launched, or `default`. */
export interface PageProxyCreatedParams {
  readonly browserContextId: string
  readonly pageProxyId: string
}

export const PageProxyCreatedParams: Schema.Codec<PageProxyCreatedParams> = Schema.Struct({
  browserContextId: Schema.String,
  pageProxyId: Schema.String
})

export const pageProxyCreated: Protocol.EventDef<"Envelope.pageProxyCreated", PageProxyCreatedParams> = Protocol
  .event("Envelope.pageProxyCreated", PageProxyCreatedParams, { status: "stable" })

/** A page gone. */
export interface PageProxyDestroyedParams {
  readonly pageProxyId: string
}

export const PageProxyDestroyedParams: Schema.Codec<PageProxyDestroyedParams> = Schema.Struct({
  pageProxyId: Schema.String
})

export const pageProxyDestroyed: Protocol.EventDef<"Envelope.pageProxyDestroyed", PageProxyDestroyedParams> = Protocol
  .event("Envelope.pageProxyDestroyed", PageProxyDestroyedParams, { status: "stable" })
