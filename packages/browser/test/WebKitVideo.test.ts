import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it } from "@effect/vitest"
import { WebKit } from "@usestrider/browser/webkit"
import type * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Config from "effect/Config"
import * as Deferred from "effect/Deferred"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as Adapter from "../src/internal/adapter.ts"
import * as BrowserClock from "../src/internal/browserClock.ts"
import * as Video from "../src/internal/video.ts"
import * as WebKitVideo from "../src/internal/webkitVideo.ts"
import * as SocketConnector from "../src/protocol/SocketConnector.ts"
import * as Reason from "../src/Reason.ts"
import * as VideoWriter from "../src/VideoWriter.ts"

const frame = { at: 0, format: "png" as const, data: new Uint8Array([1]), width: 10, height: 20 }
const image: Video.Delivery = {
  frame,
  take: Effect.void
}

describe("WebKit video settings", () => {
  const services = Layer.mergeAll(
    NodeServices.layer,
    NodeSocket.layerWebSocketConstructor,
    Layer.succeed(SocketConnector.SocketConnector, { connect: () => Effect.die("must not connect") })
  )
  for (
    const make of [
      () =>
        WebKit.layer({ executablePath: "/unused/MiniBrowser", video: { polled: 0, directory: "/tmp" } }).pipe(
          Layer.provide(services)
        ),
      () =>
        WebKit.layerConfig({
          executablePath: Config.succeed("/unused/MiniBrowser"),
          video: { polled: Config.succeed(0), directory: Config.succeed("/tmp") }
        }).pipe(Layer.provide(services)),
      () =>
        WebKit.layerAttach("http://127.0.0.1:1", { video: { polled: 0, directory: "/tmp" } }).pipe(
          Layer.provide(services)
        )
    ]
  ) {
    it.effect("validates polling options before any launch or connection", () =>
      Effect.gen(function*() {
        const error = yield* Layer.build(make()).pipe(Effect.flip)
        assert.strictEqual(error._tag, "BrowserError")
        assert.strictEqual(error._tag === "BrowserError" && error.reason._tag, "InvalidInput")
      }).pipe(
        Effect.scoped,
        Effect.provideService(SocketConnector.SocketConnector, { connect: () => Effect.die("must not connect") }),
        Effect.provide(NodeServices.layer)
      ))
  }

  for (const polled of [0, -1, Infinity, NaN, "0 millis", "-1 millis", "Infinity seconds"] as const) {
    it.effect(`refuses ${polled} as a polling interval before connecting`, () =>
      Effect.gen(function*() {
        const error = yield* Effect.flip(WebKitVideo.settings({ polled: polled as Duration.Input, directory: "/tmp" }))
        assert.strictEqual(error.reason._tag, "InvalidInput")
        assert.strictEqual(error.reason._tag === "InvalidInput" && error.reason.input, "video.polled")
      }))
  }
  it.effect("reports an unusable directory as InvalidInput even when removing its probe is refused", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(WebKitVideo.settings({ polled: 100, directory: "/videos" }))
      assert.strictEqual(error.reason._tag, "InvalidInput")
      assert.include(error.message, "PermissionDenied")
    }).pipe(Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        makeTempDirectory: () => Effect.succeed("/videos/probe"),
        remove: () =>
          Effect.fail(PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "remove" }))
      })
    )))

  it.effect("leaves omitted video disabled without requesting a filesystem", () =>
    Effect.gen(function*() {
      assert.isUndefined(yield* WebKitVideo.settings(undefined))
    }))
  it.effect("validates a caller directory and leaves no probe files", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped()
      assert.deepStrictEqual(yield* WebKitVideo.settings({ polled: "100 millis", directory }), {
        polled: 100,
        directory
      })
      assert.deepStrictEqual(yield* fs.readDirectory(directory), [])
      for (const path of ["relative", `${directory}/missing`]) {
        const error = yield* Effect.flip(WebKitVideo.settings({ polled: 100, directory: path }))
        assert.strictEqual(error.reason._tag, "InvalidInput")
      }
      const file = `${directory}/file`
      yield* fs.writeFileString(file, "not a directory")
      const error = yield* Effect.flip(WebKitVideo.settings({ polled: 100, directory: file }))
      assert.strictEqual(error.reason._tag, "InvalidInput")
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)))
})

describe("Shared video lifetime", () => {
  for (const ending of ["source", "page", "scope"] as const) {
    it.effect(`keeps irregular source times and a still tail on ${ending} end`, () =>
      Effect.gen(function*() {
        let now = 10e9
        const clock: BrowserClock.BrowserClock = {
          now: () => now as ReturnType<BrowserClock.BrowserClock["now"]>,
          sleep: () => Effect.never
        }
        const input = yield* Queue.unbounded<Video.Delivery, Cause.Done>()
        const written = yield* Queue.unbounded<VideoWriter.Frame>()
        const ended = yield* Deferred.make<void>()
        const scope = yield* Scope.make()
        const file = yield* Video.record(
          Effect.succeed({
            frames: Stream.fromQueue(input),
            ended: Deferred.await(ended)
          }),
          {
            write: (frames, destination) =>
              frames.pipe(
                Stream.runForEach((frame) => Queue.offer(written, frame)),
                Effect.as(destination.path)
              )
          },
          "/tmp"
        ).pipe(Scope.provide(scope), Effect.provideService(BrowserClock.CurrentClock, clock))
        // An initial image cached before recording starts must begin at zero.
        const initial = { ...image.frame, at: 9e9 }
        yield* Queue.offer(input, { ...image, frame: initial })
        assert.strictEqual((yield* Queue.take(written)).at, 0)
        now = 10.237e9
        const next = { ...image.frame, at: now }
        yield* Queue.offer(input, { ...image, frame: next })
        assert.strictEqual((yield* Queue.take(written)).at, 237e6)
        now = 12.391e9
        if (ending === "source") yield* Queue.end(input)
        if (ending === "page") yield* Deferred.succeed(ended, undefined)
        if (ending === "scope") yield* Scope.close(scope, Exit.void)
        yield* file
        const tail = yield* Queue.take(written)
        assert.strictEqual(tail.at, 2391e6)
        assert.deepStrictEqual(tail.data, image.frame.data)
        assert.strictEqual(yield* Queue.size(written), 0, "no paced copies during a still period")
        yield* Scope.close(scope, Exit.void)
      }))
  }

  it.effect("appends stop time to a single still image without another source frame", () =>
    Effect.gen(function*() {
      let now = 0
      const written: Array<number> = []
      const first = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const file = yield* Video.record(
        Effect.succeed({
          frames: Stream.concat(Stream.make(image), Stream.never),
          ended: Effect.never
        }),
        {
          write: (frames, destination) =>
            frames.pipe(
              Stream.runForEach((frame) =>
                Effect.sync(() => {
                  written.push(frame.at)
                  Deferred.doneUnsafe(first, Effect.void)
                })
              ),
              Effect.as(destination.path)
            )
        },
        "/tmp"
      ).pipe(
        Scope.provide(scope),
        Effect.provideService(BrowserClock.CurrentClock, {
          now: () => now as ReturnType<BrowserClock.BrowserClock["now"]>,
          sleep: () => Effect.never
        })
      )
      yield* Deferred.await(first)
      now = 2391e6
      yield* Scope.close(scope, Exit.void)
      yield* file
      assert.deepStrictEqual(written, [0, 2391e6])
    }))

  it.effect("reports an empty source without starting a writer", () =>
    Effect.gen(function*() {
      let writes = 0
      const file = yield* Video.record(Effect.succeed({ frames: Stream.empty, ended: Effect.never }), {
        write: (_, destination) => Effect.sync(() => writes++).pipe(Effect.as(destination.path))
      }, "/tmp")
      const error = yield* Effect.flip(file)
      assert.match(error.message, /before receiving a frame/)
      assert.strictEqual(writes, 0)
    }))

  it.effect("releases an acquisition closed before its first image", () =>
    Effect.gen(function*() {
      let released = false
      let writes = 0
      const scope = yield* Scope.make()
      const file = yield* Video.record(
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released = true
            })
          )
          return { frames: Stream.fromEffect(Effect.never), ended: Effect.never }
        }),
        { write: (_, destination) => Effect.sync(() => writes++).pipe(Effect.as(destination.path)) },
        "/tmp"
      ).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      assert.match((yield* Effect.flip(file)).message, /before receiving a frame/)
      assert.isTrue(released)
      assert.strictEqual(writes, 0)
    }))

  it.effect("retains capture failures and releases their source", () =>
    Effect.gen(function*() {
      const failure = new Adapter.AdapterError({
        reason: new Reason.BackendFailure({ kind: "Rejected", method: "Page.snapshotRect", hint: "capture failed" })
      })
      const file = yield* Video.record(Effect.succeed({ frames: Stream.fail(failure), ended: Effect.never }), {
        write: () => Effect.die("must not start")
      }, "/tmp")
      assert.strictEqual(yield* Effect.flip(file), failure)
    }))

  it.effect("bounds pending frames and gives a blocked writer five browser-clock seconds after end", () =>
    Effect.gen(function*() {
      const clock = BrowserClock.fromClock(yield* Clock.Clock)
      const ended = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      let produced = 0
      let released = false
      const file = yield* Video.record(
        Effect.succeed({
          frames: Stream.fromEffectRepeat(Effect.sync(() => {
            produced++
            return image
          })),
          ended: Deferred.await(ended)
        }),
        {
          write: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Effect.sync(() => {
                released = true
              }))
            )
        },
        "/tmp"
      ).pipe(Effect.provideService(BrowserClock.CurrentClock, clock))
      yield* Deferred.await(started)
      yield* TestClock.adjust("1 second")
      assert.strictEqual(produced, 1, "no unbounded PNG capture queue behind a blocked writer")
      yield* Deferred.succeed(ended, undefined)
      yield* TestClock.adjust("5 seconds")
      const error = yield* Effect.flip(file)
      assert.match(error.message, /did not finish within 5 seconds/)
      assert.isTrue(released)
    }))

  it.effect("propagates writer failure and releases the capture source", () =>
    Effect.gen(function*() {
      let released = false
      const file = yield* Video.record(
        Effect.gen(function*() {
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              released = true
            })
          )
          return { frames: Stream.fromEffectRepeat(Effect.succeed(image)), ended: Effect.never }
        }),
        {
          write: () =>
            Effect.fail(
              new VideoWriter.VideoWriterError({
                reason: new Reason.BackendFailure({ kind: "Rejected", method: "test", hint: "encoder failed" })
              })
            )
        },
        "/tmp"
      )
      assert.match((yield* Effect.flip(file)).message, /encoder failed/)
      assert.isTrue(released)
    }))
})
