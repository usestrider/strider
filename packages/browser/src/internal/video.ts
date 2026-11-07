/** Shared image timing, writer backpressure and bounded finish for native and polled video. */
import * as Cause from "effect/Cause"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as Reason from "../Reason.ts"
import type * as VideoWriter from "../VideoWriter.ts"
import * as Adapter from "./adapter.ts"
import * as BrowserClock from "./browserClock.ts"
import * as Operation from "./operation.ts"
import * as ProtocolClient from "./protocolClient.ts"

export interface Delivery {
  readonly frame: VideoWriter.Frame
  readonly take: Effect.Effect<void>
}

export interface Source {
  readonly frames: Stream.Stream<Delivery, Adapter.AdapterError>
  /** Observed independently of pulls, including when a writer blocks. */
  readonly ended: Effect.Effect<void, Adapter.AdapterError>
}

export const record = Effect.fnUntraced(function*(
  source: Effect.Effect<Source, Adapter.AdapterError, Scope.Scope>,
  writer: VideoWriter.VideoWriter,
  directory: string
) {
  const clock = yield* BrowserClock.CurrentClock
  const started = clock.now()
  let stopped = started
  const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
  const sourceScope = yield* Scope.fork(scope)
  const { frames, ended: termination } = yield* source.pipe(
    Scope.provide(sourceScope),
    Effect.onError(() => Scope.close(sourceScope, Exit.void))
  )
  const input = yield* Queue.bounded<
    { readonly frame: VideoWriter.Frame; readonly accept: Effect.Effect<void> },
    Cause.Done
  >(1)
  const first = Deferred.makeUnsafe<VideoWriter.Frame | undefined, Adapter.AdapterError>()
  const ended = Deferred.makeUnsafe<void, Adapter.AdapterError>()
  const result = Deferred.makeUnsafe<string, Adapter.AdapterError>()
  const backendFailure = (hint: string) =>
    new Adapter.AdapterError({
      reason: new Reason.BackendFailure({ kind: "Rejected", method: "VideoWriter.write", hint })
    })
  let stopping = false
  const end = Effect.sync(() => {
    if (!stopping) {
      stopping = true
      stopped = clock.now()
    }
    Deferred.doneUnsafe(first, Effect.succeed(undefined))
    Deferred.doneUnsafe(ended, Effect.void)
  })
  let latest: VideoWriter.Frame | undefined
  yield* frames.pipe(
    Stream.runForEach((delivery) =>
      Effect.gen(function*() {
        const accepted = Deferred.makeUnsafe<void>()
        latest = { ...delivery.frame, at: Math.max(latest?.at ?? 0, delivery.frame.at - started) }
        yield* Queue.offer(input, {
          frame: latest,
          accept: delivery.take.pipe(Effect.andThen(Deferred.succeed(accepted, undefined)), Effect.asVoid)
        })
        Deferred.doneUnsafe(first, Effect.succeed(delivery.frame))
        yield* Deferred.await(accepted)
      })
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        Deferred.doneUnsafe(first, Effect.fail(error))
        Deferred.doneUnsafe(ended, Effect.fail(error))
      })
    ),
    Effect.ensuring(end),
    Operation.detached,
    Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
    Effect.forkIn(sourceScope)
  )
  // Observe the session separately: a blocked writer may prevent the frame consumer from pulling again.
  yield* termination.pipe(
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
    const path = `${directory}/strider-${crypto.randomUUID()}.webm`
    const finishing = Effect.gen(function*() {
      yield* Deferred.await(ended)
      if (latest !== undefined) {
        yield* Queue.offer(input, {
          frame: { ...latest, at: Math.max(latest.at, stopped - started) },
          accept: Effect.void
        })
      }
    }).pipe(
      Effect.catch((error) => Deferred.fail(ended, error).pipe(Effect.asVoid)),
      Effect.ensuring(Queue.end(input)),
      Effect.forkScoped
    )
    return yield* Effect.scoped(Effect.gen(function*() {
      yield* finishing
      let firstFrame = true
      return yield* writer.write(
        Stream.fromEffectRepeat(Queue.take(input)).pipe(
          Stream.flatMap(({ frame, accept }) => {
            const initial = firstFrame
            firstFrame = false
            const original = Stream.fromEffect(Effect.as(accept, frame))
            // A synthetic boundary picture does not take the original source delivery.
            return initial && frame.at > 0
              ? Stream.concat(Stream.make({ ...frame, at: 0 }), original)
              : original
          })
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
    Effect.provideService(ProtocolClient.CommandDeadline, Option.none()),
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
})
