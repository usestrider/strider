/**
 * What a page looks like on CDP: screenshots, PDFs, the browser's accessibility tree and a screencast of its
 * frames.
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as FiberSet from "effect/FiberSet"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Accessibility from "../../cdp/Accessibility.ts"
import * as DOM from "../../cdp/DOM.ts"
import * as Emulation from "../../cdp/Emulation.ts"
import * as Page from "../../cdp/Page.ts"
import * as Runtime from "../../cdp/Runtime.ts"
import * as L1Page from "../../Page.ts"
import * as Protocol from "../../protocol/Protocol.ts"
import * as Reason from "../../Reason.ts"
import type * as L1Target from "../../Target.ts"
import * as VideoWriter from "../../VideoWriter.ts"
import * as Adapter from "../adapter.ts"
import * as Kit from "../adapterKit.ts"
import * as BrowserClock from "../browserClock.ts"
import * as Operation from "../operation.ts"
import * as ProtocolClient from "../protocolClient.ts"
import { type CaptureGuard, downloadDirectory, pageOf, type State, type TargetEntry } from "./state.ts"

interface Guard {
  readonly check: Effect.Effect<void, Adapter.AdapterError>
  readonly reply: (received: number) => void
}
const CurrentGuard = Context.Reference<Guard | undefined>("strider/internal/captureGuard", {
  defaultValue: () => undefined
})

/** Install in the event worker before any document-dependent L1 preparation. */
export const guard = <A, E, R>(
  state: State,
  id: L1Target.NavigableId,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | Adapter.AdapterError, R> =>
  Effect.gen(function*() {
    yield* pageOf(state, id)
    const invalidated = yield* Deferred.make<never, Adapter.AdapterError>()
    let reply: number | undefined
    let failure: Adapter.AdapterError | undefined
    let registration!: CaptureGuard
    const acquire = state.control.run(Effect.sync(() => {
      registration = {
        page: id,
        document: state.navigables.get(id)?.document?.id,
        replaced: (replacement, received) => {
          if (failure !== undefined || (reply !== undefined && reply < received)) return
          // A page without an initial document cannot yet supply document-dependent geometry.
          if (registration.document === undefined) return
          failure = new Adapter.AdapterError({
            reason: new L1Page.CaptureInvalidated({
              document: registration.document,
              replacement,
              hint:
                "Navigation replaced the screenshot's document; no retry or repair is attempted, and a dispatched Chromium capture is not canceled"
            })
          })
          Deferred.doneUnsafe(invalidated, Effect.fail(failure))
        }
      }
      state.captures.add(registration)
    }))
    const current: Guard = {
      check: Effect.suspend(() => failure === undefined ? Effect.void : Effect.fail(failure)),
      reply: (received) => {
        reply = received
      }
    }
    return yield* Effect.acquireUseRelease(
      acquire,
      () =>
        effect.pipe(
          Effect.provideService(CurrentGuard, current),
          Effect.raceFirst(Deferred.await(invalidated))
        ),
      () =>
        Effect.sync(() => {
          state.captures.delete(registration)
        })
    )
  })

// Renderer commands wait behind tracked navigation processing; frameNavigated alone can precede
// browser-side frame activation checked by screenshot and screencast acquisition. This single read
// adds renderer/style/layout work within the existing deadline and can fail or exhaust it before
// capture dispatch. It is interruptible, not an activation lease across another navigation.
const layoutMetrics = (session: ProtocolClient.Session) =>
  Kit.protocol(Page.getLayoutMetrics().pipe(Protocol.on(session)))

export const screenshot = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, options: Adapter.ScreenshotOptions) {
    const page = yield* pageOf(state, id)
    const on = Protocol.on(page.target.session)
    let clip = Option.getOrUndefined(options.clip)
    let scale = 1
    const guard = yield* CurrentGuard
    const metrics = yield* layoutMetrics(page.target.session).pipe(
      Effect.catch((error) => {
        const reason = error.reason
        // A terminal metrics error must not overtake an already observed replacement. Metrics are
        // preparation, not the native capture reply; a lost session or unanswered command keeps its error.
        if (
          guard === undefined || reason._tag !== "Protocol" ||
          (reason.error.reason._tag !== "Rejected" && reason.error.reason._tag !== "Decode")
        ) {
          return Effect.fail(error)
        }
        return page.target.session.drainObserved.pipe(
          Effect.andThen(guard.check),
          Effect.andThen(Effect.fail(error))
        )
      })
    )
    if ((options.fullPage && clip === undefined) || options.scale === "css") {
      if (options.fullPage && clip === undefined) {
        clip = { x: 0, y: 0, width: metrics.cssContentSize.width, height: metrics.cssContentSize.height }
      }
      if (options.scale === "css") {
        // A CSS pixel each: the capture scaled by the device pixel ratio's inverse. The layout metrics don't say the
        // ratio, so the page is asked, without side effects
        const ratio = yield* Kit.protocol(
          Runtime.evaluate({ expression: "window.devicePixelRatio", returnByValue: true }).pipe(on)
        )
        scale = 1 / (typeof ratio.result.value === "number" && ratio.result.value > 0 ? ratio.result.value : 1)
        clip ??= {
          x: metrics.cssVisualViewport.pageX,
          y: metrics.cssVisualViewport.pageY,
          width: metrics.cssVisualViewport.clientWidth,
          height: metrics.cssVisualViewport.clientHeight
        }
      }
    }
    if (options.omitBackground) {
      yield* Kit.protocol(Emulation.setDefaultBackgroundColorOverride({ color: { r: 0, g: 0, b: 0, a: 0 } }).pipe(on))
    }
    yield* page.target.session.drainObserved
    if (guard !== undefined) yield* guard.check
    const { data } = yield* Kit.protocol(
      Page.captureScreenshot({
        format: options.format,
        ...(Option.isSome(options.quality) ? { quality: options.quality.value } : {}),
        ...(clip === undefined ? {} : { clip: { ...clip, scale }, captureBeyondViewport: true }),
        fromSurface: true
      }).pipe(on, Effect.provideService(ProtocolClient.ReplyReceived, guard?.reply))
    ).pipe(
      Effect.catch((error) => {
        const reason = error.reason
        // Only a native terminal reply participates: a lost session or an unanswered command retains its error.
        if (
          guard === undefined || (reason._tag !== "Unsupported" && !(reason._tag === "Protocol" &&
            (reason.error.reason._tag === "Rejected" || reason.error.reason._tag === "Decode")))
        ) {
          return Effect.fail(error)
        }
        return page.target.session.drainObserved.pipe(
          Effect.andThen(guard.check),
          Effect.andThen(Effect.fail(error))
        )
      }),
      Effect.ensuring(
        options.omitBackground ? Emulation.setDefaultBackgroundColorOverride({}).pipe(on, Effect.ignore) : Effect.void
      )
    )
    yield* page.target.session.drainObserved
    if (guard !== undefined) yield* guard.check
    return yield* Kit.decodeBase64(data, "Page.captureScreenshot")
  }
)

export const pdf = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId, options: Adapter.PdfOptions) {
  const page = yield* pageOf(state, id)
  const { data } = yield* Kit.protocol(
    Page.printToPDF({
      landscape: options.landscape,
      printBackground: options.printBackground,
      scale: options.scale,
      paperWidth: options.paperWidth,
      paperHeight: options.paperHeight,
      marginTop: options.margins.top,
      marginBottom: options.margins.bottom,
      marginLeft: options.margins.left,
      marginRight: options.margins.right,
      ...(Option.isSome(options.pageRanges) ? { pageRanges: options.pageRanges.value } : {}),
      ...(Option.isNone(options.header) && Option.isNone(options.footer) ? {} : {
        displayHeaderFooter: true,
        // An unset one is empty, not Chromium's own (the date, the title, the URL)
        headerTemplate: Option.getOrElse(options.header, () => "<span></span>"),
        footerTemplate: Option.getOrElse(options.footer, () => "<span></span>")
      }),
      preferCSSPageSize: options.preferCssPageSize
    }).pipe(Protocol.on(page.target.session))
  )
  return yield* Kit.decodeBase64(data, "Page.printToPDF")
})

/** The full tree, ignored nodes left out and their children given to their parent. */
export const accessibilityTree = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId) {
  const page = yield* pageOf(state, id)
  const main = state.frames.get(page.targetId)
  const converted = yield* frameTree(state, main?.owner ?? page.target, main?.frameId)
  return converted.length === 1
    ? converted[0]!
    : { role: "RootWebArea", name: "", properties: {}, children: converted }
})

// A frame's tree, read on the session that owns the frame, with each iframe's frame stitched in under it: Chromium
// reads a frame's tree alone
const frameTree = (
  state: State,
  owner: TargetEntry,
  frameId: string | undefined
): Effect.Effect<ReadonlyArray<Adapter.AxNode>, Adapter.AdapterError> =>
  Effect.gen(function*() {
    const on = Protocol.on(owner.session)
    const { nodes } = yield* Kit.protocol(
      Accessibility.getFullAXTree(frameId === undefined ? {} : { frameId: frameId as Page.FrameId }).pipe(on)
    )
    const byId = new Map(nodes.map((node) => [node.nodeId, node]))
    const text = (value: Accessibility.AXValue | undefined) =>
      value === undefined || value.value === undefined ? "" : String(value.value)
    // The frame each iframe holds, by its element, and that frame's tree
    const stitched = new Map<string, ReadonlyArray<Adapter.AxNode>>()
    yield* Effect.forEach(
      nodes.filter((node) => text(node.role) === "Iframe" && node.backendDOMNodeId !== undefined),
      (node) =>
        Effect.gen(function*() {
          const described = yield* DOM.describeNode({ backendNodeId: node.backendDOMNodeId! }).pipe(
            on,
            Effect.option
          )
          const held = Option.flatMap(described, ({ node }) => Option.fromUndefinedOr(node.frameId))
          const child = Option.isSome(held) ? state.frames.get(held.value) : undefined
          if (child === undefined) return
          stitched.set(
            node.nodeId,
            yield* frameTree(state, child.owner, child.frameId).pipe(Effect.orElseSucceed(() => []))
          )
        }),
      { concurrency: "unbounded", discard: true }
    )
    const convert = (node: Accessibility.AXNode): ReadonlyArray<Adapter.AxNode> => {
      const children = [
        ...(node.childIds ?? []).flatMap((child) => {
          const found = byId.get(child)
          return found === undefined ? [] : convert(found)
        }),
        ...(stitched.get(node.nodeId) ?? [])
      ]
      if (node.ignored) return children
      const properties: Record<string, unknown> = {}
      if (node.description !== undefined) properties.description = node.description.value
      if (node.value !== undefined) properties.value = node.value.value
      for (const property of node.properties ?? []) properties[property.name] = property.value.value
      return [{ role: text(node.role), name: text(node.name), properties, children }]
    }
    const root = nodes.find((node) => node.parentId === undefined)
    return root === undefined ? [] : convert(root)
  })

/** A normal target/session end closes input; transport and model failures retain their original errors. */
const normalSourceEnd = (error: Adapter.AdapterError): boolean => {
  const reason = error.reason
  return reason._tag === "Protocol" && reason.error.reason._tag === "SessionEnded" &&
    reason.error.reason.why !== "connectionLost" && reason.error.reason.why !== "modelUnavailable"
}

interface Delivery {
  readonly frame: Adapter.ScreencastFrame
  readonly take: Effect.Effect<void>
}
interface ScreencastOwner {
  readonly frames: Queue.Queue<Delivery, Adapter.AdapterError | Cause.Done>
  readonly pending: Set<() => Effect.Effect<void>>
  status: "reserved" | "pending" | "success" | "failure" | "sessionEnded"
  released: boolean
  stopAtDispatch: number
}
interface ScreencastOwners {
  readonly termination: Deferred.Deferred<void, Adapter.AdapterError>
  latest: Adapter.ScreencastFrame | undefined
  readonly active: Set<ScreencastOwner>
  /** Starts awaiting an outcome, including abandoned commands retained until reply or session end. */
  readonly pending: Set<ScreencastOwner>
  readonly run: (effect: Effect.Effect<void>) => unknown
  stopping: Deferred.Deferred<void> | undefined
  /** Fresh confirmed or uncertain start evidence not yet covered by a cleanup attempt. */
  needsStop: boolean
  /** A successful start/join with no stop dispatched since, safe for another consumer to reuse. */
  confirmed: boolean
  stops: number
  ended: boolean
}
const screencastOwners = new WeakMap<Protocol.ProtocolSession, Deferred.Deferred<ScreencastOwners>>()

const ownersOf = Effect.fnUntraced(function*(state: State, session: Protocol.ProtocolSession) {
  return yield* Effect.uninterruptible(Effect.suspend(() => {
    const existing = screencastOwners.get(session)
    if (existing !== undefined) return Deferred.await(existing)
    const ready = Deferred.makeUnsafe<ScreencastOwners>()
    screencastOwners.set(session, ready)
    return Effect.gen(function*() {
      const run = yield* FiberSet.makeRuntime().pipe(
        Effect.provideService(Scope.Scope, state.cleanupScope),
        Operation.detached,
        Effect.provideService(ProtocolClient.CommandDeadline, Option.none())
      )
      const owners: ScreencastOwners = {
        termination: Deferred.makeUnsafe<void, Adapter.AdapterError>(),
        latest: undefined,
        active: new Set(),
        pending: new Set(),
        run,
        stopping: undefined,
        needsStop: false,
        confirmed: false,
        stops: 0,
        ended: false
      }
      yield* session.ended.pipe(
        Effect.andThen(Effect.sync(() => {
          owners.ended = true
          owners.active.clear()
          owners.pending.clear()
          owners.needsStop = false
          owners.confirmed = false
        })),
        Operation.detached,
        Effect.forkIn(state.cleanupScope)
      )
      const frames = yield* session.subscribe(Page.screencastFrame).pipe(
        Effect.provideService(Scope.Scope, state.cleanupScope)
      )
      yield* frames.pipe(
        Stream.mapError(Kit.protocolError),
        Stream.runForEach((event) =>
          Effect.gen(function*() {
            const jpeg = yield* Kit.decodeBase64(event.data, "Page.screencastFrame")
            const frame = { at: Adapter.now(), ...Adapter.jpegSize(jpeg), jpeg }
            owners.latest = frame
            const pending = new Set(owners.active)
            let acked = false
            const ack = Effect.suspend(() => {
              if (acked || pending.size > 0) return Effect.void
              acked = true
              return Page.screencastFrameAck({ sessionId: event.sessionId }).pipe(Protocol.on(session), Effect.ignore)
            })
            for (const owner of pending) {
              const take = () =>
                Effect.suspend(() => {
                  pending.delete(owner)
                  owner.pending.delete(take)
                  return ack
                })
              owner.pending.add(take)
              yield* Queue.offer(owner.frames, { frame, take: take() })
            }
            yield* ack
          })
        ),
        Effect.tapError((error) =>
          Effect.gen(function*() {
            if (normalSourceEnd(error)) {
              yield* Deferred.succeed(owners.termination, undefined)
            } else {
              yield* Deferred.fail(owners.termination, error)
            }
            yield* Effect.forEach([...owners.active], (owner) => Queue.fail(owner.frames, error))
          })
        ),
        Effect.ignore,
        Effect.ensuring(Deferred.succeed(owners.termination, undefined)),
        Operation.detached,
        Effect.forkIn(state.cleanupScope)
      )
      yield* Deferred.succeed(ready, owners)
      return owners
    })
  }))
})

/** Frames as Chromium paints them; the next comes once this one is acknowledged. */
const screencastDeliveries = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId) {
  const page = yield* pageOf(state, id)
  const session = page.target.session
  const on = Protocol.on(session)
  const owners = yield* ownersOf(state, session)
  const acquiring = yield* Effect.withFiberSucceed((fiber) => fiber)
  let waiting = true
  const stop: Effect.Effect<void> = Effect.suspend(() => {
    if (owners.ended || owners.active.size > 0 || !owners.needsStop || owners.stopping !== undefined) return Effect.void
    const done = Deferred.makeUnsafe<void>()
    owners.stopping = done
    owners.needsStop = false
    owners.confirmed = false
    owners.latest = undefined
    owners.stops++
    // Bound transport writing as well as reply confirmation. A new start waits for this exchange to finish
    // (or be interrupted at its budget) before it can dispatch, so this stop cannot overtake that start.
    return Page.stopScreencast().pipe(
      on,
      Effect.interruptible,
      BrowserClock.timeoutOption(1000),
      Effect.asVoid,
      Effect.ignore,
      Operation.detached,
      Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
      Effect.provideService(Protocol.CommandTimeout, Duration.seconds(1)),
      Effect.ensuring(Effect.sync(() => {
        owners.stopping = undefined
        Deferred.doneUnsafe(done, Effect.void)
        // A late start success during the exchange is new evidence of a stream. If no consumer took it,
        // clean that evidence after this stop settles; a failed stop alone never schedules another attempt.
        if (owners.needsStop && owners.active.size === 0 && !owners.ended) owners.run(stop)
      }))
    )
  })
  const owner: ScreencastOwner = {
    frames: yield* Queue.unbounded<Delivery, Adapter.AdapterError | Cause.Done>(),
    pending: new Set(),
    status: "reserved",
    released: false,
    stopAtDispatch: owners.stops
  }
  const release = Effect.suspend(() => {
    if (owner.released) return Effect.void
    owner.released = true
    owners.active.delete(owner)
    if (owner.status === "pending") {
      // Abandonment itself is cleanup evidence; a missing reply must not retain a consumer or add a delay.
      // An exchange already dispatched after this start covers its uncertain outcome. A later success
      // is fresh evidence, reported separately by ReplyOutcome even after this owner has been released.
      if (owner.stopAtDispatch === owners.stops && owners.stopping === undefined) owners.needsStop = true
    }
    return Effect.forEach([...owner.pending], (take) => take()).pipe(
      Effect.andThen(Queue.clear(owner.frames).pipe(Effect.ignore)),
      Effect.andThen(Queue.end(owner.frames)),
      Effect.andThen(stop),
      Effect.asVoid
    )
  })
  const reserve: Effect.Effect<void> = Effect.suspend(() => {
    if (owner.released) return Effect.interrupt
    if (owners.stopping !== undefined) return Deferred.await(owners.stopping).pipe(Effect.andThen(reserve))
    return Effect.void
  })
  yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function*() {
      // Ownership is registered before start can be dispatched or its reply consumed. Both the scope and
      // acquisition's failure path release the same idempotent token, so no post-consumption handoff is needed.
      yield* Effect.addFinalizer(() =>
        Effect.suspend(() => {
          if (waiting) owners.run(Fiber.interrupt(acquiring))
          return release
        })
      )
      if (!owner.released) {
        owners.active.add(owner)
        if (owners.latest !== undefined && owners.confirmed) {
          yield* Queue.offer(owner.frames, { frame: owners.latest, take: Effect.void })
        }
      }
      yield* restore(
        layoutMetrics(session).pipe(
          Effect.andThen(reserve),
          Effect.andThen(Effect.suspend(() => {
            if (owner.released) return Effect.interrupt
            if (owners.confirmed) {
              owner.status = "success"
              return Effect.void
            }
            const joining = owners.pending.size > 0 || owners.needsStop
            owner.status = "pending"
            owner.stopAtDispatch = owners.stops
            owners.pending.add(owner)
            return Kit.protocol(
              Page.startScreencast({ format: "jpeg" }).pipe(
                on,
                Effect.provideService(ProtocolClient.ReplyOutcome, (outcome) => {
                  owners.pending.delete(owner)
                  owner.status = outcome
                  if (outcome === "success") {
                    owners.needsStop = true
                    if (owners.stopping === undefined && owner.stopAtDispatch === owners.stops) owners.confirmed = true
                    if (owner.released) owners.run(stop)
                  }
                }),
                Protocol.withLateReplyHandler(() => Effect.void),
                Effect.catch((error) => {
                  const reason = error.reason
                  // Chromium refuses another start while an earlier owned start is already active, even if
                  // that earlier reply is outstanding. Join that stream, without retrying the command.
                  if (
                    joining && reason._tag === "Rejected" && reason.code === -32000 &&
                    reason.description === "Screencast is already active"
                  ) {
                    owner.status = "success"
                    owners.needsStop = true
                    owners.confirmed = true
                    return Effect.void
                  }
                  return Effect.fail(error)
                })
              )
            )
          }))
        )
      ).pipe(Effect.onExit((exit) =>
        Effect.suspend(() => {
          waiting = false
          return Exit.isFailure(exit)
            ? release.pipe(Operation.detached, Effect.forkIn(state.cleanupScope), Effect.asVoid)
            : Effect.void
        })
      ))
    })
  )
  return Stream.fromEffectRepeat(
    Queue.take(owner.frames).pipe(
      Effect.raceFirst(session.ended.pipe(Effect.andThen(Cause.done())))
    )
  )
})

/** A user screencast acknowledges when its stream consumer takes the image. */
export const screencast = Effect.fnUntraced(function*(state: State, id: L1Target.NavigableId) {
  const deliveries = yield* screencastDeliveries(state, id)
  return deliveries.pipe(Stream.mapEffect(({ frame, take }) => Effect.as(take, frame)))
})

/** Video is another session consumer; pacing and its lifetime are independent of the caller's acquisition deadline. */
export const video = Effect.fnUntraced(
  function*(state: State, id: L1Target.NavigableId, writer: Option.Option<VideoWriter.VideoWriter>) {
    if (Option.isNone(writer)) {
      return yield* Effect.fail(Kit.unsupported("capability.video", "Chromium video requires a VideoWriter service"))
    }
    const page = yield* pageOf(state, id)
    const directory = downloadDirectory(state, page.context.id)
    if (Option.isNone(directory)) {
      return yield* Effect.fail(Kit.unsupported("capability.video", "The context must allow downloads to a directory"))
    }
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    const sourceScope = yield* Scope.fork(scope)
    const frames = yield* screencastDeliveries(state, id).pipe(
      Scope.provide(sourceScope),
      Effect.onError(() => Scope.close(sourceScope, Exit.void))
    )
    const input = yield* Queue.bounded<
      { readonly frame: VideoWriter.Frame; readonly accept: Effect.Effect<void> },
      Cause.Done
    >(1)
    const first = Deferred.makeUnsafe<Adapter.ScreencastFrame | undefined, Adapter.AdapterError>()
    const ended = Deferred.makeUnsafe<void, Adapter.AdapterError>()
    const result = Deferred.makeUnsafe<string, Adapter.AdapterError>()
    const backendFailure = (hint: string) =>
      new Adapter.AdapterError({
        reason: new Reason.BackendFailure({ kind: "Rejected", method: "VideoWriter.write", hint })
      })
    const end = Effect.sync(() => {
      Deferred.doneUnsafe(first, Effect.succeed(undefined))
      Deferred.doneUnsafe(ended, Effect.void)
    })
    let latest: Delivery | undefined
    let accepted = Deferred.makeUnsafe<void>()
    yield* frames.pipe(
      Stream.runForEach((delivery) =>
        Effect.gen(function*() {
          accepted = Deferred.makeUnsafe<void>()
          latest = delivery
          Deferred.doneUnsafe(first, Effect.succeed(delivery.frame))
          yield* Deferred.await(accepted)
        })
      ),
      Effect.catch((error) =>
        normalSourceEnd(error)
          ? end
          : Effect.sync(() => {
            Deferred.doneUnsafe(first, Effect.fail(error))
            Deferred.doneUnsafe(ended, Effect.fail(error))
          })
      ),
      Effect.ensuring(end),
      Operation.detached,
      Effect.forkIn(sourceScope)
    )
    // Observe the session separately: a blocked writer may prevent the frame consumer from pulling again.
    const owners = yield* ownersOf(state, page.target.session)
    yield* Deferred.await(owners.termination).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          Deferred.doneUnsafe(first, Effect.fail(error))
          Deferred.doneUnsafe(ended, Effect.fail(error))
        })
      ),
      Effect.andThen(end),
      Effect.raceFirst(Deferred.await(result).pipe(Effect.ignore)),
      Operation.detached,
      Effect.forkIn(scope)
    )
    const running = yield* Effect.gen(function*() {
      const initial = yield* Deferred.await(first)
      if (initial === undefined) {
        return yield* Effect.fail(backendFailure("The recording ended before receiving a frame; no writer was started"))
      }
      const path = `${directory.value}/strider-${crypto.randomUUID()}.webm`
      const clock = yield* BrowserClock.CurrentClock
      const started = clock.now()
      const pacing = Effect.gen(function*() {
        let index = 0
        while (true) {
          const at = started + index++ * 40e6
          const left = (at - clock.now()) / 1e6
          if (left > 0) yield* clock.sleep(left)
          const delivery = latest!
          const frame = delivery.frame
          const taking = accepted
          yield* Queue.offer(input, {
            frame: { at, format: "jpeg", data: frame.jpeg, width: frame.width, height: frame.height },
            accept: delivery.take.pipe(Effect.andThen(Deferred.succeed(taking, undefined)), Effect.asVoid)
          })
        }
      }).pipe(
        Effect.raceFirst(Deferred.await(ended)),
        Effect.catch((error) => Deferred.fail(ended, error).pipe(Effect.asVoid)),
        Effect.ensuring(Queue.end(input)),
        Effect.forkScoped
      )
      return yield* Effect.scoped(Effect.gen(function*() {
        yield* pacing
        return yield* writer.value.write(
          Stream.fromEffectRepeat(
            Queue.take(input).pipe(Effect.flatMap(({ frame, accept }) => Effect.as(accept, frame)))
          ),
          { path, width: initial.width, height: initial.height }
        ).pipe(
          Effect.mapError((error) => backendFailure(error.message)),
          Effect.raceFirst(
            Deferred.await(ended).pipe(
              Effect.andThen(clock.sleep(5000)),
              Effect.andThen(Effect.fail(backendFailure("The writer did not finish within 5 seconds")))
            )
          ),
          Effect.tap(() =>
            Effect.flatMap(
              Deferred.poll(ended),
              (termination) => Option.isSome(termination) ? termination.value : Effect.void
            )
          )
        )
      }))
    }).pipe(
      Effect.ensuring(Scope.close(sourceScope, Exit.void)),
      Effect.exit,
      Effect.flatMap((exit) => Deferred.done(result, exit)),
      Operation.detached,
      Effect.interruptible,
      Effect.forkIn(scope)
    )
    yield* Effect.addFinalizer(() =>
      Effect.gen(function*() {
        yield* end
        yield* Scope.close(sourceScope, Exit.void)
        yield* Fiber.await(running)
        yield* Scope.close(scope, Exit.void)
      }).pipe(Operation.detached)
    )
    return Deferred.await(result)
  }
)
