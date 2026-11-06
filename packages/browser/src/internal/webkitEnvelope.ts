/**
 * The envelope stock WebKit's pages reach the WebKit adapter in: ours, not the browser's. The transports
 * (`webkitStockTransport.ts` attached, `webkitAutomation.ts` launched) present each page as a page proxy, whose
 * messages carry its `pageProxyId` and whose inspector target is reached through `Target`, as WebKit's own inspector
 * proxies reach a page (`webkitWire.ts`).
 *
 * - **The domain** is what the transports make up: `enable` announces the pages open, and `pageProxyCreated` and
 *   `pageProxyDestroyed` their coming and going.
 * - **The framing** (`wrap`, `unwrap`) puts a page proxy's id first in a page's message, and takes it off a command,
 *   on the text: a transport never parses a page's messages.
 * - **The endpoint** (`makeEndpoint`) is the side of the envelope both transports share: it announces pages, routes
 *   each command to its page, and serves the domain. A transport only finds its pages and moves their text.
 */
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import * as Protocol from "../protocol/Protocol.ts"
import * as Transport from "../protocol/Transport.ts"
import * as Link from "./link.ts"
import { parseRecord } from "./protocolClient.ts"

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

// ── Framing ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A page's message in the envelope: its JSON object with the page proxy's id first. What isn't an object stays
 * malformed, so the wire fails it as the browser's.
 */
export const wrap = (pageProxyId: string, message: string): string =>
  `{"pageProxyId":${JSON.stringify(pageProxyId)},${message.startsWith("{") ? message.slice(1) : message}`

const wrapped = /^\{"pageProxyId":("(?:[^"\\]|\\.)*"),/

/** A command `wrap` addressed to a page: the page proxy's id, and the command as the page takes it. */
export const unwrap = (text: string): { readonly pageProxyId: string; readonly message: string } | undefined => {
  const match = wrapped.exec(text)
  if (match === null) return undefined
  try {
    return { pageProxyId: JSON.parse(match[1]!) as string, message: `{${text.slice(match[0].length)}` }
  } catch {
    return undefined
  }
}

// ── The endpoint ──────────────────────────────────────────────────────────────────────────────────────────

/** The envelope's side of a transport: its pages, and the transport the WebKit adapter speaks to. */
export interface Endpoint {
  readonly transport: Transport.Transport
  /** A page arrived: it's announced, in its context, and the commands to it go to `send`. */
  readonly created: (
    pageProxyId: string,
    browserContextId: string,
    send: (message: string) => Effect.Effect<void, Transport.TransportError>
  ) => void
  /** A page's message, as its target sent it. */
  readonly message: (pageProxyId: string, message: string) => void
  /** A page that can't be reached: commands to it are dropped until its end is announced. */
  readonly detached: (pageProxyId: string) => void
  /** A page's end, announced once. */
  readonly destroyed: (pageProxyId: string) => void
  /** Loses the connection, after what was announced. */
  readonly lose: (reason: Transport.ConnectionLost) => void
  /** The loss, once the connection is lost. */
  readonly lost: () => Transport.ConnectionLost | undefined
}

/**
 * An endpoint. `Envelope.enable` announces the pages that arrived before it, runs `enable` (which may find more),
 * and replies; a failing `enable` loses the connection. Every other method of the browser's session is answered as
 * JSON-RPC answers one it doesn't have. A command to a page that can't be reached is dropped: its end, which
 * follows, fails what waits on it.
 */
export const makeEndpoint: (enableWith: Effect.Effect<void, Transport.ConnectionLost>) => Effect.Effect<Endpoint> =
  Effect.fnUntraced(function*(enableWith: Effect.Effect<void, Transport.ConnectionLost>) {
    const link = yield* Link.make()
    const routes = new Map<string, (message: string) => Effect.Effect<void, Transport.TransportError>>()
    const live = new Set<string>()
    let enabled = false
    const held: Array<string> = []
    const announce = (message: string) => {
      if (enabled) link.receive(message)
      else held.push(message)
    }
    const reply = (message: Record<string, unknown>) => link.receive(JSON.stringify(message))

    // The browser's session: the domain, which only the endpoint serves
    const browser = (text: string): Effect.Effect<void> => {
      const command = parseRecord(text)
      if (Result.isFailure(command)) return Effect.void
      const { id, method } = command.success
      if (method !== enable.method) {
        reply({ id, error: { code: -32601, message: `'${String(method)}' was not found` } })
        return Effect.void
      }
      enabled = true
      for (const message of held.splice(0)) link.receive(message)
      return enableWith.pipe(
        Effect.match({
          onFailure: (reason) => link.lose(reason),
          onSuccess: () => reply({ id, result: {} })
        })
      )
    }

    return {
      transport: {
        send: (text) =>
          link.whenOpen(Effect.suspend(() => {
            const command = unwrap(text)
            if (command === undefined) return browser(text)
            return routes.get(command.pageProxyId)?.(command.message) ?? Effect.void
          })),
        messages: link.messages,
        closed: link.closed
      },
      created: (pageProxyId, browserContextId, send) => {
        routes.set(pageProxyId, send)
        live.add(pageProxyId)
        announce(JSON.stringify({ method: pageProxyCreated.method, params: { pageProxyId, browserContextId } }))
      },
      message: (pageProxyId, message) => {
        if (live.has(pageProxyId)) announce(wrap(pageProxyId, message))
      },
      detached: (pageProxyId) => {
        routes.delete(pageProxyId)
      },
      destroyed: (pageProxyId) => {
        routes.delete(pageProxyId)
        if (!live.delete(pageProxyId)) return
        announce(JSON.stringify({ method: pageProxyDestroyed.method, params: { pageProxyId } }))
      },
      lose: link.lose,
      lost: link.lost
    } satisfies Endpoint
  })
