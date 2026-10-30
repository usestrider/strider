/**
 * The transports that carry a raw browser connection's messages: framed text in both directions, read by one
 * consumer, and never reconnected.
 *
 * `pipe` talks to a browser launched with `--remote-debugging-pipe`, over file descriptors 3 and 4 with
 * NUL-framed messages. `webSocket` dials an endpoint through the `Socket.WebSocketConstructor` in context.
 * Either way, a write after the connection is lost fails at once, and nothing reconnects: a new connection starts
 * over.
 *
 * **Gotchas**
 *
 * - `messages` has exactly one consumer, the connection's dispatcher. A second reader takes messages from the
 *   first.
 * - Node's built-in WebSocket closes the connection on a message over 128 MiB, and `ws` on one over 100 MiB
 *   unless its `maxPayload` is raised. Chrome sends 200 MiB replies, such as a large response body, without
 *   complaint, and the pipe carries them.
 * - No transport can deliver a message longer than the runtime's longest string, 2^29 − 24 characters in V8;
 *   such a message loses the connection, saying so. Chrome escapes non-ASCII text as `\uXXXX`, six bytes a
 *   character, so a 100-million-character string of accented text is a 600 MB message.
 *
 * @stability experimental
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Predicate from "effect/Predicate"
import type * as ChildProcess from "effect/process/ChildProcess"
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner"
import * as Queue from "effect/Queue"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as Link from "../internal/link.ts"

/**
 * A browser connection's messages, in both directions.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface Transport {
  /**
   * Sends one message. Fails at once after the connection is lost.
   *
   * **Example** (Sending a raw CDP command)
   *
   * ```ts import.meta.vitest
   * import type { Transport } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const askVersion = Effect.fn("askVersion")(function*(transport: Transport.Transport) {
   *   yield* transport.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }))
   * })
   * ```
   */
  readonly send: (message: string) => Effect.Effect<void, TransportError>
  /**
   * The messages received, in order. Fails with the reason when the connection is lost, after delivering what
   * arrived before. Exactly one consumer.
   *
   * **Example** (Logging a connection's traffic)
   *
   * ```ts import.meta.vitest
   * import type { Transport } from "@usestrider/browser/protocol"
   * import { Effect, Stream } from "effect"
   *
   * const logged = (transport: Transport.Transport): Transport.Transport => ({
   *   send: (message) =>
   *     Effect.logDebug("sent", message).pipe(Effect.andThen(transport.send(message))),
   *   messages: transport.messages.pipe(
   *     Stream.tap((message) => Effect.logDebug("received", message))
   *   ),
   *   closed: transport.closed
   * })
   * ```
   */
  readonly messages: Stream.Stream<string, TransportError>
  /**
   * Waits as long as the connection lives, then gives the reason it was lost.
   *
   * **Example** (Logging why a connection was lost)
   *
   * ```ts import.meta.vitest
   * import type { Transport } from "@usestrider/browser/protocol"
   * import { Effect } from "effect"
   *
   * const watch = Effect.fn("watch")(function*(transport: Transport.Transport) {
   *   const lost = yield* transport.closed
   *   yield* Effect.logWarning(`Closed by the ${lost.initiator} side: ${lost.description}`)
   * })
   * ```
   */
  readonly closed: Effect.Effect<ConnectionLost>
}

/**
 * The extra file descriptors a browser launched with `--remote-debugging-pipe` reads and writes, for
 * `ChildProcess.make`'s `additionalFds`.
 *
 * **Details**
 *
 * The browser reads commands from file descriptor 3 and writes replies and events to file descriptor 4.
 *
 * **Example** (Launching Chromium with a pipe)
 *
 * ```ts import.meta.vitest
 * import { Transport } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 * import { ChildProcess } from "effect/process"
 *
 * const launch = Effect.fn("launch")(function*(executable: string, userDataDir: string) {
 *   const browser = yield* ChildProcess.make(executable, [
 *     "--headless",
 *     "--remote-debugging-pipe",
 *     `--user-data-dir=${userDataDir}`
 *   ], {
 *     additionalFds: Transport.pipeFds,
 *     stderr: "ignore",
 *     forceKillAfter: "5 seconds"
 *   })
 *   return yield* Transport.pipe(browser)
 * })
 * ```
 *
 * @see {@link pipe} for the transport over these descriptors
 * @stability experimental
 * @category constants
 * @since 0.1.0
 */
export const pipeFds: {
  readonly fd3: { readonly type: "input" }
  readonly fd4: { readonly type: "output" }
} = {
  fd3: { type: "input" },
  fd4: { type: "output" }
} satisfies Record<`fd${number}`, ChildProcess.AdditionalFdConfig>

const encoder = new TextEncoder()

/**
 * Splits a byte stream on NUL into messages, collecting each message's bytes and decoding them once. NUL never
 * occurs inside a UTF-8 sequence, so a boundary is always a character boundary.
 *
 * Throws `MessageTooLong` for a message that decodes to more than the runtime's longest string.
 */
const makeNulFramer = (emit: (message: string) => void) => {
  const decoder = new TextDecoder()
  let pieces: Array<Uint8Array> = []
  let size = 0
  const decode = (last: Uint8Array): string => {
    const total = size + last.length
    let bytes = last
    if (pieces.length > 0) {
      bytes = new Uint8Array(total)
      let offset = 0
      for (const piece of pieces) {
        bytes.set(piece, offset)
        offset += piece.length
      }
      bytes.set(last, offset)
    }
    pieces = []
    size = 0
    try {
      return decoder.decode(bytes)
    } catch (cause) {
      throw new MessageTooLong(total, cause)
    }
  }
  return (chunk: Uint8Array): void => {
    let start = 0
    let end = chunk.indexOf(0)
    while (end !== -1) {
      emit(decode(chunk.subarray(start, end)))
      start = end + 1
      end = chunk.indexOf(0, start)
    }
    if (start < chunk.length) {
      // Copied, because the stream may reuse the chunk's buffer.
      pieces.push(chunk.slice(start))
      size += chunk.length - start
    }
  }
}

class MessageTooLong extends Error {
  constructor(bytes: number, cause: unknown) {
    super(
      `The browser sent a message of ${bytes} bytes, longer than the longest string this runtime can hold`,
      { cause }
    )
  }
}

const describe = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && typeof cause.message === "string" ? cause.message : String(cause)

/**
 * Makes a transport over a launched browser's pipe: commands to file descriptor 3, replies and events from 4,
 * each message followed by NUL.
 *
 * **Details**
 *
 * The process must have been spawned with `additionalFds: Transport.pipeFds`. The connection is lost when the
 * browser closes its pipe or exits. Closing the scope ends file descriptor 3, and Chrome exits when its
 * command pipe ends; the process's own scope still terminates it.
 *
 * **Gotchas**
 *
 * - Spawn with `forceKillAfter`. Without it, a browser that ignores `SIGTERM` holds its scope open forever.
 * - Ignore or drain the browser's `stderr`. A chatty browser fills an unread pipe and stalls.
 *
 * **Example** (Connecting over a launched browser's pipe)
 *
 * ```ts import.meta.vitest
 * import { CdpConnection, Transport } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 * import type { ChildProcessSpawner } from "effect/process"
 *
 * const connect = Effect.fn("connect")(
 *   function*(browser: ChildProcessSpawner.ChildProcessHandle) {
 *     const transport = yield* Transport.pipe(browser)
 *     return yield* CdpConnection.make(transport)
 *   }
 * )
 * ```
 *
 * @see {@link pipeFds} for the spawn options
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const pipe: (handle: ChildProcessSpawner.ChildProcessHandle) => Effect.Effect<Transport, never, Scope.Scope> =
  Effect.fnUntraced(function*(handle: ChildProcessSpawner.ChildProcessHandle) {
    const link = yield* Link.make()
    const outbox = yield* Queue.unbounded<Uint8Array, Cause.Done>()
    const remote = (description: string) => new ConnectionLost({ initiator: "remote", description })

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        link.lose(new ConnectionLost({ initiator: "local", description: "The connection was closed" }))
        Queue.endUnsafe(outbox)
      })
    )
    // One long-lived stream feeds the browser: a finite one would end file descriptor 3, which disconnects it.
    // The writer outlives the scope on purpose: closing the scope ends the outbox, the writer then ends file
    // descriptor 3, and the browser exits on its own. Interrupting it instead would leave the pipe open. It
    // can't outlive the process, whose exit ends or breaks the pipe.
    yield* Stream.fromQueue(outbox).pipe(
      Stream.run(handle.getInputFd(3)),
      Effect.catch((error) => Effect.sync(() => link.lose(remote(`Writing to the pipe failed: ${error.message}`)))),
      Effect.forkDetach
    )
    const frame = makeNulFramer(link.receive)
    yield* handle.getOutputFd(4).pipe(
      Stream.runForEach((chunk) => Effect.try({ try: () => frame(chunk), catch: (cause) => remote(describe(cause)) })),
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.sync(() => {
            const error = Cause.squash(cause)
            link.lose(
              error instanceof ConnectionLost ? error : remote(`Reading the pipe failed: ${describe(error)}`)
            )
          }),
        onSuccess: () => Effect.sync(() => link.lose(remote("The browser closed its pipe")))
      }),
      Effect.forkScoped
    )
    yield* handle.exitCode.pipe(
      Effect.matchEffect({
        onFailure: (error) => Effect.sync(() => link.lose(remote(`The browser's process failed: ${error.message}`))),
        onSuccess: (code) => Effect.sync(() => link.lose(remote(`The browser exited with code ${code}`)))
      }),
      Effect.forkScoped
    )

    return {
      send: (message: string) =>
        link.whenOpen(Effect.sync(() => {
          Queue.offerUnsafe(outbox, encoder.encode(message + "\0"))
        })),
      messages: link.messages,
      closed: link.closed
    }
  })

/**
 * Settings for `webSocket`.
 *
 * @stability experimental
 * @category models
 * @since 0.1.0
 */
export interface WebSocketOptions {
  /**
   * Headers for the WebSocket handshake, such as a grid's token. The constructor in context must support
   * headers; a browser's built-in WebSocket can't send them.
   *
   * @default none
   */
  readonly headers?: Readonly<Record<string, string | Redacted.Redacted<string>>> | undefined
  /**
   * How long to wait for the connection to open.
   *
   * @default "10 seconds"
   */
  readonly openTimeout?: Duration.Input | undefined
}

const decoder = new TextDecoder()

/**
 * Makes a transport over a WebSocket, through the `Socket.WebSocketConstructor` in context.
 *
 * **Details**
 *
 * Succeeds once the connection is open, and fails with `ConnectFailed` if it doesn't open within
 * `openTimeout`. The connection is lost when either side closes it. Closing the scope closes it with code
 * 1000. A message sent while the WebSocket is closing fails rather than vanish.
 *
 * **Gotchas**
 *
 * The constructor decides the largest message the connection accepts. Node's built-in WebSocket, which
 * `NodeSocket.layerWebSocketConstructor` uses unless headers are given, closes the connection on a message
 * over 128 MiB.
 *
 * **Example** (Connecting to a running Chrome)
 *
 * ```ts import.meta.vitest
 * import { Transport } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const connect = Effect.fn("connect")(function*(endpoint: string) {
 *   return yield* Transport.webSocket(endpoint, { openTimeout: "5 seconds" })
 * })
 * ```
 *
 * @stability experimental
 * @category constructors
 * @since 0.1.0
 */
export const webSocket: (
  url: string,
  options?: WebSocketOptions | undefined
) => Effect.Effect<Transport, TransportError, Scope.Scope | Socket.WebSocketConstructor> = Effect.fnUntraced(
  function*(url: string, options?: WebSocketOptions | undefined) {
    const construct = yield* Socket.WebSocketConstructor
    const timeout = options?.openTimeout ?? "10 seconds"
    const headers = options?.headers === undefined ? undefined : Object.fromEntries(
      Object.entries(options.headers).map((
        [name, value]
      ) => [name, Redacted.isRedacted(value) ? Redacted.value(value) : value])
    )
    // `Socket` dials once for every reader, so the reader is acquired once, below, and this is the WebSocket.
    let ws: Socket.WebSocketLike | undefined
    const socket = yield* Socket.fromWebSocket(
      Effect.acquireRelease(
        Effect.try({
          try: () => (ws = construct(url, headers === undefined ? undefined : { headers })),
          catch: (cause) => new Socket.SocketError({ reason: new Socket.SocketOpenError({ kind: "Unknown", cause }) })
        }),
        (ws) => Effect.sync(() => ws.close(1000))
      ),
      { openTimeout: timeout }
    )
    const reader = yield* socket.reader.pipe(
      Effect.mapError((error) =>
        new TransportError({ reason: new ConnectFailed({ description: openFailure(error.reason, timeout) }) })
      )
    )
    const writer = yield* socket.writer
    const opened = ws!
    const link = yield* Link.make()
    const remote = (description: string) => new ConnectionLost({ initiator: "remote", description })

    // Added after the reader, so it runs before the reader's release: the loss is this side's, never the close
    // the release reports to the reader.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => link.lose(new ConnectionLost({ initiator: "local", description: "The connection was closed" })))
    )
    // One fiber reads for as long as the scope, handing each message to the link. The socket fails after the
    // messages that arrived before its close or error, and that loses the connection.
    yield* reader.pull.pipe(
      Effect.flatMap((frames) =>
        Effect.sync(() => {
          for (const frame of frames) {
            if (typeof frame === "string") {
              link.receive(frame)
              continue
            }
            try {
              link.receive(decoder.decode(frame))
            } catch (cause) {
              link.lose(remote(new MessageTooLong(frame.byteLength, cause).message))
            }
          }
        })
      ),
      Effect.forever,
      Effect.catch((error) => Effect.sync(() => link.lose(remote(lostWith(error.reason))))),
      Effect.forkScoped
    )

    const sendFailed = (error: Socket.SocketError) =>
      Effect.suspend(() => {
        const cause = error.reason._tag === "SocketWriteError" ? error.reason.cause : error.reason
        link.lose(remote(`Sending failed: ${describe(cause)}`))
        return Effect.fail(new TransportError({ reason: link.lost()! }))
      })

    return {
      send: (message: string) =>
        link.whenOpen(Effect.suspend(() =>
          // A closing WebSocket drops what it's sent without a word. Its close is on the way to the reader,
          // behind the messages before it, so the send fails here and the reader loses the connection.
          opened.readyState === 1
            ? Effect.catch(writer.write(message), sendFailed)
            : Effect.fail(new TransportError({ reason: remote("The WebSocket is closing") }))
        )),
      messages: link.messages,
      closed: link.closed
    }
  }
)

const closedWith = (reason: Socket.SocketCloseError): string =>
  `The WebSocket closed with code ${reason.code}${reason.closeReason ? `: ${reason.closeReason}` : ""}`

/** An error event's message, when it has one. */
const eventMessage = (event: unknown): string | undefined =>
  Predicate.hasProperty(event, "message") && typeof event.message === "string" && event.message !== ""
    ? event.message
    : undefined

/** Why a WebSocket didn't open. */
const openFailure = (reason: Socket.SocketErrorReason, timeout: Duration.Input): string => {
  switch (reason._tag) {
    case "SocketOpenError":
      if (reason.kind === "Timeout") return `The WebSocket didn't open within ${String(timeout)}`
      // The constructor's exception, or the WebSocket's error event
      return reason.cause instanceof Error
        ? reason.cause.message
        : eventMessage(reason.cause) ?? "The connection failed"
    case "SocketCloseError":
      return `${closedWith(reason)} before opening`
    default:
      return reason.message
  }
}

/** Why an open WebSocket was lost. */
const lostWith = (reason: Socket.SocketErrorReason): string => {
  switch (reason._tag) {
    case "SocketCloseError":
      return closedWith(reason)
    case "SocketReadError": {
      const message = eventMessage(reason.cause)
      return message === undefined ? "The WebSocket failed" : `The WebSocket failed: ${message}`
    }
    default:
      return reason.message
  }
}

/**
 * Reason for a connection that couldn't be made: refused, rejected at the handshake, or not open in time.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class ConnectFailed extends Schema.Error<ConnectFailed>("@usestrider/browser/protocol/Transport/ConnectFailed")({
  _tag: Schema.tag("ConnectFailed"),
  description: Schema.String
}) {
  override get message(): string {
    return `Couldn't connect: ${this.description}`
  }
}

/**
 * Reason for a connection that was lost.
 *
 * **Details**
 *
 * `initiator` is `"local"` when this side closed it, by closing the transport's scope, and `"remote"` when the
 * browser closed it, exited or broke it. `description` says how.
 *
 * @stability experimental
 * @category reasons
 * @since 0.1.0
 */
export class ConnectionLost
  extends Schema.Error<ConnectionLost>("@usestrider/browser/protocol/Transport/ConnectionLost")({
    _tag: Schema.tag("ConnectionLost"),
    initiator: Schema.Literals(["local", "remote"]),
    description: Schema.String
  })
{
  override get message(): string {
    return `The connection was lost: ${this.description}`
  }
}

const TransportErrorTypeId = "~@usestrider/browser/protocol/Transport/TransportError"

/**
 * Error for a transport that couldn't connect or lost its connection.
 *
 * **Example** (Falling back to a second endpoint)
 *
 * ```ts import.meta.vitest
 * import { Transport } from "@usestrider/browser/protocol"
 * import { Effect } from "effect"
 *
 * const connect = Effect.fn("connect")(function*(primary: string, fallback: string) {
 *   return yield* Transport.webSocket(primary).pipe(
 *     Effect.catchReason(
 *       "TransportError",
 *       "ConnectFailed",
 *       () => Transport.webSocket(fallback)
 *     )
 *   )
 * })
 * ```
 *
 * @stability experimental
 * @category errors
 * @since 0.1.0
 */
export class TransportError extends Schema.TaggedError<TransportError>(TransportErrorTypeId)("TransportError", {
  reason: Schema.Union([ConnectFailed, ConnectionLost])
}) {
  readonly [TransportErrorTypeId] = TransportErrorTypeId
  override get message(): string {
    return this.reason.message
  }
}

/**
 * Checks whether a value is a `TransportError`.
 *
 * @stability experimental
 * @category guards
 * @since 0.1.0
 */
export const isTransportError = (u: unknown): u is TransportError => Predicate.hasProperty(u, TransportErrorTypeId)
