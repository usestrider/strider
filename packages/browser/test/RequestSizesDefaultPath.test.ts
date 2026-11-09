/** Per-session chunk scopes must stop work before queueing and schema decoding. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Kit from "../src/internal/adapterKit.ts"
import * as Network from "../src/internal/cdpAdapter/network.ts"
import * as State from "../src/internal/cdpAdapter/state.ts"
import * as Ingestion from "../src/internal/ingestion.ts"
import type * as ProtocolClient from "../src/internal/protocolClient.ts"
import * as Sizes from "../src/internal/requestSizes.ts"
import * as Request from "../src/NetworkRequest.ts"
import * as Protocol from "../src/protocol/Protocol.ts"

const method = "Network.dataReceived"
const chunk = (dataLength: number) => ({ requestId: "R1", timestamp: 10, dataLength, encodedDataLength: 0 })
const setup = Effect.fnUntraced(function*() {
  const decodes: Array<string> = []
  const dispatches: Array<string> = []
  const lost: Array<unknown> = []
  const buffer = yield* Kit.makeFactBuffer(() => Effect.void)
  const cleanupScope = yield* Effect.scope
  let state!: State.State
  const sessions = new Map<string, ProtocolClient.Session>()
  const handlers = Network.register(Kit.handlers<State.Event>())
  const ingestion = yield* Ingestion.make({
    limits: { events: 10, bytes: 10000 },
    session: (key) => sessions.get(key),
    end: () => {
      throw new Error("Unexpected session loss")
    },
    lost: () => false,
    decoder: (codec, method) => (params) =>
      Effect.sync(() => {
        decodes.push(method)
      }).pipe(
        Effect.andThen(Schema.decodeUnknownEffect(codec)(params)),
        Effect.mapError((error) =>
          new Protocol.ProtocolError({ reason: new Protocol.Decode({ method, issue: error.message }) })
        )
      ),
    fold: (control) => {
      buffer.connect(control)
      state = State.make({
        cleanupScope,
        connect: { sink: () => Effect.void, ownership: "launched" },
        ids: Kit.makeIds(),
        buffer,
        control,
        root: () => {
          throw new Error("Unexpected browser command")
        },
        release: () => {}
      })
      return {
        events: handlers.events,
        eventScopes: Network.eventScopes(state),
        apply: (session, method, params) =>
          Effect.sync(() => {
            dispatches.push(session.key!)
            handlers.apply(method, params, { state, target: state.targets.get(session) })
          }),
        lost: (_session, failure) =>
          Effect.sync(() => {
            lost.push(failure)
          }),
        ended: () => Effect.void
      }
    }
  })
  const add = (key: string, enabled: boolean, kind: "page" | "iframe" | "worker" = "page") => {
    const session = { key: key as Protocol.SessionKey } as ProtocolClient.Session
    sessions.set(key, session)
    const context = {
      requestSizes: enabled ? new Map() : undefined,
      removing: false,
      disposed: false
    } as State.ContextEntry
    const page = { context, ended: false } as State.PageEntry
    const target = { session, page, kind, ended: false } as State.TargetEntry
    state.targets.set(session, target)
    const hop = `${key}.0` as Request.HopId
    if (enabled) Sizes.keep(context.requestSizes!, hop, key)
    const frame = { page } as State.FrameEntry
    state.requests.set(State.requestKey(target, "R1"), { hop, frame } as State.RequestEntry)
    const ingest = ingestion.track(session, false, 0)
    return { session, context, page, target, hop, ingest }
  }
  const send = (entry: ReturnType<typeof add>, sequence: number, params: unknown) =>
    ingestion.event(entry.ingest, sequence, method, params, "chunk event")
  return { ingestion, add, send, decodes, dispatches, lost }
})

describe("Request sizes ingestion isolation", () => {
  it.effect("drops disabled chunks before queue accounting, decoding and dispatch", () =>
    Effect.gen(function*() {
      const world = yield* setup()
      const off = world.add("off", false)
      world.send(off, 1, { malformed: true })
      assert.strictEqual(off.ingest.queuedEvents, 0)
      assert.strictEqual(off.ingest.queuedBytes, 0)
      assert.strictEqual(off.ingest.lastQueued, 0)
      yield* world.ingestion.worker.pipe(Effect.forkScoped)
      yield* world.ingestion.drained(off.ingest)
      assert.deepStrictEqual(world.decodes, [])
      assert.deepStrictEqual(world.dispatches, [])
      assert.deepStrictEqual(world.lost, [])
    }).pipe(Effect.scoped))

  it.effect("decodes only enabled page/frame sessions when contexts coexist and stops after teardown", () =>
    Effect.gen(function*() {
      const world = yield* setup()
      const off = world.add("off", false)
      const on = world.add("on", true, "iframe")
      yield* world.ingestion.worker.pipe(Effect.forkScoped)
      world.send(off, 1, { malformed: true })
      world.send(on, 2, chunk(512))
      world.send(off, 3, { malformed: true })
      world.send(on, 4, chunk(3612))
      yield* world.ingestion.drained(on.ingest)
      assert.deepStrictEqual(world.decodes, [method, method])
      assert.deepStrictEqual(world.dispatches, ["on", "on"])
      assert.strictEqual(on.context.requestSizes!.get(on.hop)!.decoded, 4124)
      assert.deepStrictEqual(
        Sizes.cdp(262, on.context.requestSizes!.get(on.hop)!.decoded).responseBodyDecodedSize,
        Option.some(4124)
      )
      assert.strictEqual(off.ingest.queuedEvents, 0)
      assert.strictEqual(off.ingest.lastQueued, 0)
      on.context.disposed = true
      on.context.requestSizes!.clear()
      world.send(on, 5, { malformed: true })
      world.send(off, 6, { malformed: true })
      assert.strictEqual(on.ingest.lastQueued, 4)
      assert.strictEqual(on.ingest.queuedEvents, 0)
      assert.deepStrictEqual(world.decodes, [method, method])
      assert.deepStrictEqual(world.lost, [])
    }).pipe(Effect.scoped))

  it.effect("rechecks a queued chunk's owner before decoding when the owner ends", () =>
    Effect.gen(function*() {
      const world = yield* setup()
      const on = world.add("on", true)
      world.send(on, 1, chunk(65))
      assert.strictEqual(on.ingest.queuedEvents, 1)
      on.page.ended = true
      yield* world.ingestion.worker.pipe(Effect.forkScoped)
      yield* world.ingestion.drained(on.ingest)
      assert.deepStrictEqual(world.decodes, [])
      assert.deepStrictEqual(world.dispatches, [])
      assert.deepStrictEqual(world.lost, [])
    }).pipe(Effect.scoped))
})

it.effect("keeps counting during unconfirmed disposal, which may fail", () =>
  Effect.gen(function*() {
    const world = yield* setup()
    const on = world.add("on", true)
    yield* world.ingestion.worker.pipe(Effect.forkScoped)
    on.context.removing = true
    world.send(on, 1, chunk(65))
    world.send(on, 2, chunk(66))
    assert.strictEqual(on.ingest.queuedEvents, 2)
    yield* world.ingestion.drained(on.ingest)
    on.context.removing = false
    assert.strictEqual(on.context.requestSizes!.get(on.hop)!.decoded, 131)
    assert.deepStrictEqual(world.decodes, [method, method])
    assert.deepStrictEqual(world.lost, [])
  }).pipe(Effect.scoped))

it.effect("keeps native decoded bytes for page-attributed worker sessions", () =>
  Effect.gen(function*() {
    const world = yield* setup()
    const on = world.add("worker", true, "worker")
    world.send(on, 1, chunk(65))
    assert.strictEqual(on.ingest.queuedEvents, 1)
    yield* world.ingestion.worker.pipe(Effect.forkScoped)
    yield* world.ingestion.drained(on.ingest)
    assert.strictEqual(on.context.requestSizes!.get(on.hop)!.decoded, 65)
    assert.deepStrictEqual(world.decodes, [method])
  }).pipe(Effect.scoped))
