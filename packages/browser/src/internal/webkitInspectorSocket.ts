/**
 * WebKitGTK's and WPE's remote inspector server over its socket: the server a browser starts
 * at `WEBKIT_INSPECTOR_SERVER`, which WebKit's WebDriver server speaks to a browser in automation mode, and which
 * Strider speaks itself.
 *
 * - **Frames.** Each message is its body's size, big-endian in four bytes, a byte of flags (bit 0: little-endian),
 *   then the body: the message's name, a nul, and its parameters in GVariant, by the type its name has
 *   (`wtf/glib/SocketConnection.cpp`; `gvariant.ts`).
 * - **Messages.** The client starts an automation session (`StartAutomationSession`), and the server answers with
 *   the browser's name and version; it pushes the list of its targets whenever it changes (`SetTargetList`), an
 *   `Automation` target for the session and a `WebPage` target for each page; `Setup` connects to a target, and
 *   `SendMessageToBackend` and `SendMessageToFrontend` carry the protocol's JSON to and from it.
 * - **The connection** is one socket, which the program's `SocketConnector` opened, for as long as the scope.
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import type * as SocketConnector from "../protocol/SocketConnector.ts"
import * as Transport from "../protocol/Transport.ts"
import * as GVariant from "./gvariant.ts"
import * as Link from "./link.ts"

/** A target the server lists. */
export interface Target {
  readonly id: bigint
  /** `Automation`, `WebPage`, `JavaScript`, `ServiceWorker`, … */
  readonly type: string
  readonly name: string
  readonly url: string
  /** Whether a client is connected to it. */
  readonly paired: boolean
}

/** A message from the server. */
export type Incoming =
  | { readonly _tag: "DidStartAutomationSession"; readonly browserName: string; readonly browserVersion: string }
  | { readonly _tag: "SetTargetList"; readonly connection: bigint; readonly targets: ReadonlyArray<Target> }
  | {
    readonly _tag: "SendMessageToFrontend"
    readonly connection: bigint
    readonly target: bigint
    readonly message: string
  }
  | { readonly _tag: "DidClose" }

/** A message to the server. */
export type Outgoing =
  | {
    readonly _tag: "StartAutomationSession"
    readonly sessionId: string
    /** The session's capabilities, such as `acceptInsecureCerts`. */
    readonly capabilities: ReadonlyArray<readonly [name: string, value: GVariant.Variant]>
  }
  | { readonly _tag: "Setup"; readonly connection: bigint; readonly target: bigint }
  | {
    readonly _tag: "SendMessageToBackend"
    readonly connection: bigint
    readonly target: bigint
    readonly message: string
  }
  | { readonly _tag: "FrontendDidClose"; readonly connection: bigint; readonly target: bigint }

const incomingTypes: Readonly<Record<string, string | undefined>> = {
  DidStartAutomationSession: "(ss)",
  SetTargetList: "(ta(tsssb))",
  SendMessageToFrontend: "(tts)",
  DidClose: undefined
}

const outgoingTypes: Readonly<Record<Outgoing["_tag"], string>> = {
  StartAutomationSession: "(sa{sv})",
  Setup: "(tt)",
  SendMessageToBackend: "(tts)",
  FrontendDidClose: "(tt)"
}

const parametersOf = (message: Outgoing): GVariant.Value => {
  switch (message._tag) {
    case "StartAutomationSession":
      return [message.sessionId, message.capabilities.map(([name, value]) => [name, value])]
    case "Setup":
    case "FrontendDidClose":
      return [message.connection, message.target]
    case "SendMessageToBackend":
      return [message.connection, message.target, message.message]
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A message as its frame. */
export const frame = (message: Outgoing): Uint8Array => {
  const name = encoder.encode(`${message._tag}\0`)
  const parameters = GVariant.encode(outgoingTypes[message._tag], parametersOf(message))
  const out = new Uint8Array(5 + name.length + parameters.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, name.length + parameters.length, false)
  view.setUint8(4, 1)
  out.set(name, 5)
  out.set(parameters, 5 + name.length)
  return out
}

const incomingOf = (name: string, parameters: GVariant.Value): Incoming | undefined => {
  const values = parameters as ReadonlyArray<GVariant.Value>
  switch (name) {
    case "DidStartAutomationSession":
      return { _tag: name, browserName: values[0] as string, browserVersion: values[1] as string }
    case "SetTargetList":
      return {
        _tag: name,
        connection: values[0] as bigint,
        targets: (values[1] as ReadonlyArray<ReadonlyArray<GVariant.Value>>).map(([id, type, title, url, paired]) => ({
          id: id as bigint,
          type: type as string,
          name: title as string,
          url: url as string,
          paired: paired as boolean
        }))
      }
    case "SendMessageToFrontend":
      return { _tag: name, connection: values[0] as bigint, target: values[1] as bigint, message: values[2] as string }
    case "DidClose":
      return { _tag: name }
    default:
      return undefined
  }
}

/** The smallest body: a one-character name and its nul (`SocketConnection.cpp`). */
const minimumBody = 2
const maximumBody = 512 * 1024 * 1024

/**
 * Reads frames from the bytes as they arrive: each call gives the messages the bytes so far complete. A message
 * whose name it doesn't know is skipped; a frame that doesn't parse throws `GVariant.GVariantError`.
 */
export const makeFrameReader = () => {
  let buffer = new Uint8Array(0)
  return (chunk: Uint8Array): ReadonlyArray<Incoming> => {
    const joined = new Uint8Array(buffer.length + chunk.length)
    joined.set(buffer)
    joined.set(chunk, buffer.length)
    buffer = joined
    const messages: Array<Incoming> = []
    let at = 0
    while (buffer.length - at >= 5) {
      const view = new DataView(buffer.buffer, buffer.byteOffset + at)
      const size = view.getUint32(0, false)
      if (size < minimumBody || size > maximumBody) throw new GVariant.GVariantError(`A frame of ${size} bytes`)
      if (buffer.length - at < 5 + size) break
      const littleEndian = (view.getUint8(4) & 1) === 1
      const body = buffer.subarray(at + 5, at + 5 + size)
      const nul = body.indexOf(0)
      if (nul < 0) throw new GVariant.GVariantError("A frame without a name")
      const name = decoder.decode(body.subarray(0, nul))
      if (name in incomingTypes) {
        const type = incomingTypes[name]
        const parameters = type === undefined ? [] : GVariant.decode(type, body.subarray(nul + 1), littleEndian)
        const message = incomingOf(name, parameters)
        if (message !== undefined) messages.push(message)
      }
      at += 5 + size
    }
    buffer = buffer.slice(at)
    return messages
  }
}

/** A connection to an inspector server. */
export interface Connection {
  /** Sends a message. Fails once the connection is lost. */
  readonly send: (message: Outgoing) => Effect.Effect<void, Transport.TransportError>
  /** The server's messages, in order, then the loss, once what came before it is delivered. Exactly one consumer. */
  readonly messages: Stream.Stream<Incoming, Transport.TransportError>
  /** Why the connection ended, once it has. */
  readonly closed: Effect.Effect<Transport.ConnectionLost>
}

/** A connection over `socket`, which its connector opened, for as long as the scope. */
export const connect: (socket: SocketConnector.Connection) => Effect.Effect<Connection, never, Scope.Scope> = Effect
  .fnUntraced(function*(socket: SocketConnector.Connection) {
    const pull = socket.pull
    const writer = socket
    const link = yield* Link.make<Incoming>()
    const read = makeFrameReader()

    yield* pull.pipe(
      Effect.flatMap((chunks) =>
        Effect.try({
          try: () => {
            for (const chunk of chunks) {
              for (const message of read(typeof chunk === "string" ? encoder.encode(chunk) : chunk)) {
                link.receive(message)
              }
            }
          },
          catch: (error) =>
            new Transport.ConnectionLost({
              initiator: "remote",
              description: `The server sent a message that doesn't parse: ${
                error instanceof Error ? error.message : String(error)
              }`
            })
        })
      ),
      Effect.forever,
      Effect.catch((error) =>
        Effect.sync(() =>
          link.lose(
            error instanceof Transport.ConnectionLost
              ? error
              : new Transport.ConnectionLost({ initiator: "remote", description: error.message })
          )
        )
      ),
      Effect.forkScoped
    )
    yield* Effect.addFinalizer(() =>
      Effect.sync(() =>
        link.lose(new Transport.ConnectionLost({ initiator: "local", description: "The scope closed" }))
      )
    )

    return {
      send: (message) =>
        link.whenOpen(
          Effect.suspend(() => writer.write(frame(message))).pipe(
            Effect.catch((error) =>
              Effect.fail(
                new Transport.TransportError({
                  reason: new Transport.ConnectionLost({ initiator: "remote", description: error.message })
                })
              )
            )
          )
        ),
      messages: link.messages,
      closed: link.closed
    } satisfies Connection
  })
