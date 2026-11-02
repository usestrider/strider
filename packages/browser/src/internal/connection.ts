/**
 * A WebSocket's or EventSource's handle: fixed at open, its frames as a channel of
 * their own, and its end.
 */
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Inspectable from "effect/Inspectable"
import { pipeArguments } from "effect/Pipeable"
import type * as NetworkConnection from "../NetworkConnection.ts"
import * as Events from "./events.ts"
import type * as Model from "./model.ts"

const TypeId = "~@usestrider/browser/NetworkConnection"

const frames: Events.Kind<NetworkConnection.Frame, NetworkConnection.Frame> = {
  operation: "NetworkConnection.frames",
  noun: "a frame",
  deliver: (frame) => frame
}

export const make = (entry: Model.ConnectionEntry): NetworkConnection.NetworkConnection => ({
  [TypeId]: TypeId,
  id: entry.id,
  kind: entry.kind,
  url: entry.url,
  openedAt: entry.openedAt,
  frames: Effect.suspend(() => Events.stream(frames, entry.frames, () => true, undefined)),
  closed: Deferred.await(entry.closed),
  pipe() {
    return pipeArguments(this, arguments)
  },
  toString() {
    return `NetworkConnection(${entry.id})`
  },
  toJSON() {
    return { _id: "NetworkConnection", id: entry.id, kind: entry.kind, url: entry.url }
  },
  [Inspectable.NodeInspectSymbol]() {
    return { _id: "NetworkConnection", id: entry.id, kind: entry.kind, url: entry.url }
  }
})
