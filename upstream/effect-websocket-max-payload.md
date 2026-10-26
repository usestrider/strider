# Proposal for Effect: a WebSocket client's largest message, as an option

*Draft, 2026-10-25, for the maintainer to post. Not posted. Written against Effect `main` at `52e1716cc` (`effect/socket/Socket`, `@effect/platform-node/NodeSocket`). From Strider's QUIRKS.md, Q55.*

## Problem

A client of a browser's DevTools endpoint can receive one very large message: a screenshot of a long page, a large response body, a heap snapshot chunk. Chrome escapes non-ASCII text as `\uXXXX`, so a body grows by up to six times on the wire.

The limits are the WebSocket implementation's, and a program using Effect can't change them:

- **`ws`**, which `NodeSocket.layerWebSocketConstructorWS` uses and `layerWebSocketConstructor` uses for an options object, closes the connection on a message over 100 MiB, its default `maxPayload`.
- **Node's built-in `WebSocket`** closes it at 128 MiB, with no option to change it.

`WebSocketClientOptions` has `protocols` and `headers` only, and `makeWebSocketWS` passes `ws` nothing else, so the 100 MiB limit is fixed for every program on `@effect/platform-node`.

## Proposal

```ts
export interface WebSocketClientOptions {
  readonly protocols?: string | Array<string> | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  /**
   * The largest message accepted, in bytes; a larger one closes the connection.
   * Supported by the `ws` constructor; browser constructors reject this option, as they do `headers`.
   */
  readonly maxPayload?: number | undefined
}
```

`makeWebSocketWS` passes it through: `new WS.WebSocket(url, options.protocols, { headers: options.headers, maxPayload: options.maxPayload })`. `layerWebSocketConstructor` already sends an options object to `ws`, so nothing else changes.

## Alternatives

- **A layer that takes `ws`'s `ClientOptions` whole.** Wider than needed, and it ties the public type to `ws`.
- **Leaving it to programs to build their own constructor.** Possible today, but each program then re-implements what `makeWebSocketWS` does for headers and protocols.

## What Strider does meanwhile

A launched browser is driven over its pipe, which has no limit of its own; a remote endpoint is limited to the constructor's, and a message over it loses the connection with a description.
