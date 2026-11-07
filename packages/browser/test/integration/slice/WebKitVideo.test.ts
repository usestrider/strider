/** Explicit stock-WebKit PNG video: lifecycle and real encoder output. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, describe, it } from "@effect/vitest"
import { Browser, Capability, Trace, VideoWriter } from "@usestrider/browser"
import { WebKit } from "@usestrider/browser/webkit"
import * as Deferred from "effect/Deferred"
import type * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Result from "effect/Result"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as BrowserImpl from "../../../src/internal/browser.ts"
import * as WebKitAdapter from "../../../src/internal/webkitAdapter.ts"
import * as WebKitAutomation from "../../../src/internal/webkitAutomation.ts"
import * as Envelope from "../../../src/internal/webkitEnvelope.ts"
import { site } from "../adapter/harness.ts"
import { webkitgtk } from "../browsers.ts"
import { socketConnector } from "../sockets.ts"
import { startMiniBrowser, useXvfb } from "../stockWebKit.ts"

const encoder = VideoWriter.layerFfmpeg({ path: process.env["STRIDER_FFMPEG"]! })
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
const launched = Effect.fnUntraced(function*<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  writer:
    | Layer.Layer<VideoWriter.VideoWriter, never, import("effect/process/ChildProcessSpawner").ChildProcessSpawner>
    | null = encoder,
  enabled = true,
  polled: Duration.Input = "100 millis"
) {
  const fs = yield* FileSystem.FileSystem
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "strider-webkit-video-" })
  yield* useXvfb()
  return yield* effect.pipe(Effect.provide(
    WebKit.layer({
      executablePath: webkitgtk.executable,
      ...(enabled ? { video: { polled, directory } } : {})
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeServices.layer,
          socketConnector,
          writer?.pipe(Layer.provide(NodeServices.layer)) ?? Layer.empty
        )
      )
    )
  ))
})

const probe = (file: string) => {
  const info = JSON.parse(
    execFileSync(process.env["STRIDER_FFPROBE"]!, [
      "-v",
      "error",
      "-count_frames",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      file
    ], { encoding: "utf8" })
  )
  execFileSync(process.env["STRIDER_FFMPEG"]!, ["-v", "error", "-i", file, "-f", "null", "-"])
  return info
}

describe("WebKit polled video", () => {
  for (const [enabled, writer] of [[false, false], [true, false], [false, true]] as const) {
    it.live(`refuses video with polling=${enabled}, writer=${writer}`, () =>
      run(launched(
        Effect.gen(function*() {
          const browser = yield* Browser.Browser
          assert.strictEqual(
            (yield* browser.capabilities).entries.find((e) => e.name === "capability.video")!.status,
            "unsupported"
          )
          const page = yield* Browser.newPage()
          const error = yield* Effect.flip(page.capability(Capability.Video))
          assert(Capability.isCapabilityError(error))
          assert.strictEqual(error.reason._tag, "Unsupported")
        }),
        writer ? encoder : null,
        enabled
      )), 60_000)
  }

  it.live("acquires the first PNG without waiting for a long polling interval", () =>
    run(Effect.gen(function*() {
      const first = yield* Deferred.make<void>()
      const writer = Layer.succeed(VideoWriter.VideoWriter, {
        write: (frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) =>
          frames.pipe(Stream.runForEach(() => Deferred.succeed(first, undefined)), Effect.as(destination.path))
      })
      yield* launched(
        Effect.gen(function*() {
          const page = yield* Browser.newPage()
          yield* page.capability(Capability.Video)
          yield* Deferred.await(first)
        }),
        writer,
        true,
        "1 hour"
      )
    })), 15_000)

  it.live(
    "records timestamped samples, survives navigation and fits resized PNGs",
    () =>
      run(Effect.gen(function*() {
        const samples: Array<VideoWriter.Frame> = []
        const frames = yield* Queue.unbounded<VideoWriter.Frame>()
        const writer = Layer.effect(VideoWriter.VideoWriter)(Effect.gen(function*() {
          const real = yield* VideoWriter.VideoWriter
          return {
            write: (input: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) =>
              real.write(
                input.pipe(Stream.tap((frame) => {
                  samples.push(frame)
                  return Queue.offer(frames, frame)
                })),
                destination
              )
          }
        })).pipe(Layer.provide(encoder))
        yield* launched(
          Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const page = yield* Browser.newPage({ emulation: { viewport: { width: 640, height: 480 } } })
            yield* page.goto(`${origin}/fixture?html=${encodeURIComponent("<style>html{background:red}</style>")}`)
            const recording = yield* Effect.scoped(Effect.gen(function*() {
              const video = yield* page.capability(Capability.Video)
              const initial = yield* Queue.take(frames)
              assert.strictEqual(initial.format, "png")
              assert.deepStrictEqual([initial.width, initial.height], [640, 480])
              yield* Effect.sleep("300 millis")
              // A new document/process target must not terminate the page proxy's recording.
              yield* page.goto(
                `${crossSite}/fixture?html=${
                  encodeURIComponent("<style>html{background:blue}</style><h1>second document</h1>")
                }`
              )
              yield* page.emulate({ viewport: { width: 400, height: 480 } })
              while (true) {
                const frame = yield* Queue.take(frames)
                if (frame.width === 400) break
              }
              yield* Effect.sleep("500 millis")
              return video
            }))
            const file = yield* recording.file
            const info = probe(file)
            const video = info.streams[0]
            assert.strictEqual(video.codec_name, "vp8")
            assert.strictEqual(Number(video.nb_read_frames), samples.length)
            assert.closeTo(Number(info.format.duration), samples.at(-1)!.at / 1e9, 0.002)
            assert.deepStrictEqual([video.width, video.height], [640, 480])
            assert.isAtLeast(Number(video.nb_read_frames), 3)
            const pixels = execFileSync(process.env["STRIDER_FFMPEG"]!, [
              "-v",
              "error",
              "-sseof",
              "-0.1",
              "-i",
              file,
              "-frames:v",
              "1",
              "-f",
              "rawvideo",
              "-pix_fmt",
              "rgb24",
              "pipe:1"
            ], { maxBuffer: 2_000_000 })
            assert.strictEqual(pixels.length, 640 * 480 * 3)
            assert.isAbove(pixels[(300 * 640 + 320) * 3 + 2]!, 200)
            assert.isBelow(pixels[0]!, 20, "unused width is black")
            console.log(
              "WebKit WebM validation",
              JSON.stringify({
                codec: video.codec_name,
                fps: video.r_frame_rate,
                width: video.width,
                height: video.height,
                frames: video.nb_read_frames,
                duration: info.format.duration
              })
            )
          }),
          writer
        )
      })),
    60_000
  )

  for (const kind of ["same-site", "cross-site"] as const) {
    it.live(`keeps recording across ${kind} navigations that interrupt a capture`, () =>
      run(Effect.gen(function*() {
        const writer = Layer.succeed(VideoWriter.VideoWriter, {
          write: (frames: Stream.Stream<VideoWriter.Frame>, destination: VideoWriter.Destination) =>
            frames.pipe(Stream.runDrain, Effect.as(destination.path))
        })
        yield* launched(
          Effect.gen(function*() {
            const { origin, crossSite } = yield* site
            const page = yield* Browser.newPage()
            yield* page.goto(`${origin}/fixture?html=${encodeURIComponent("<p>first</p>")}`)
            const video = yield* Effect.scoped(Effect.gen(function*() {
              const video = yield* page.capability(Capability.Video)
              // Same-process navigations keep the target, so a capture they cut short is no SessionEnded;
              // cross-site ones swap it while a capture may be in flight.
              for (let i = 0; i < 40; i++) {
                const base = kind === "cross-site" && i % 2 === 0 ? crossSite : origin
                yield* page.goto(`${base}/fixture?html=${encodeURIComponent(`<p>document ${i}</p>`)}`)
              }
              return video
            }))
            const file = yield* Effect.result(video.file)
            assert.isTrue(Result.isSuccess(file), Result.isFailure(file) ? String(file.failure) : "")
          }),
          writer,
          true,
          "1 millis"
        )
      })), 60_000)
  }

  it.live(
    "selects video for native traces while leaving screencast and downloads unsupported",
    () =>
      run(launched(Effect.gen(function*() {
        const entries = (yield* (yield* Browser.Browser).capabilities).entries
        assert.strictEqual(entries.find((e) => e.name === "capability.video")!.status, "supported")
        assert.strictEqual(entries.find((e) => e.name === "capability.screencast")!.status, "unsupported")
        assert.strictEqual(entries.find((e) => e.name === "downloads")!.status, "unsupported")
        const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
        const page = yield* Browser.newPage()
        const trace = yield* Trace.record(page, { screencast: "native" })
        yield* Effect.sleep("300 millis")
        const file = `${directory}/trace.zip`
        yield* trace.exportTrace(file)
        const files = new Map<string, Uint8Array>()
        yield* Stream.make(new Uint8Array(fs.readFileSync(file))).pipe(
          Stream.pipeThroughChannel(Zip.decode()),
          Stream.runForEach((entry) =>
            Stream.runCollect(entry.body).pipe(Effect.map((chunks) => {
              files.set(entry.header.path, Buffer.concat(chunks))
            }))
          )
        )
        const events = new TextDecoder().decode(files.get("trace.trace")).trim().split("\n").map((line) =>
          JSON.parse(line)
        )
        const videos = events.filter((e) => e.type === "video")
        assert.strictEqual(videos.length, 1)
        assert.deepStrictEqual(Array.from(files.get(videos[0].file)!.subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3])
      }))),
    60_000
  )

  for (const capture of ["size query", "snapshot"] as const) {
    for (const end of ["page", "connection"] as const) {
      it.live(`handles ${end} closure with a video ${capture} still pending`, () =>
        run(Effect.gen(function*() {
          yield* useXvfb()
          const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
          const first = yield* Deferred.make<void>()
          const pending = yield* Deferred.make<void>()
          let hold = false
          let group!: WebKitAutomation.Group
          const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
            group = yield* WebKitAutomation.start({ executablePath: webkitgtk.executable })
            const real = yield* VideoWriter.VideoWriter
            return yield* WebKitAdapter.connect({
              ...group.transport,
              send: Effect.fnUntraced(function*(message: string) {
                const addressed = Envelope.unwrap(message)
                if (hold && addressed !== undefined) {
                  const outer = JSON.parse(addressed.message)
                  if (outer.method === "Target.sendMessageToTarget") {
                    const inner = JSON.parse(outer.params.message)
                    if (
                      capture === "snapshot"
                        ? inner.method === "Page.snapshotRect"
                        : inner.method === "Runtime.evaluate" && inner.params.expression === "[innerWidth, innerHeight]"
                    ) {
                      // Leave a real protocol command pending until page teardown rejects it.
                      // This selects the close-before-reply ordering without timing or load.
                      yield* Deferred.succeed(pending, undefined)
                      return
                    }
                  }
                }
                yield* group.transport.send(message)
              })
            }, { sink, ownership: "launched", automation: group, video: { polled: 100, directory } }).pipe(
              Effect.provideService(VideoWriter.VideoWriter, {
                write: (frames, destination) =>
                  real.write(frames.pipe(Stream.tap(() => Deferred.succeed(first, undefined))), destination)
              })
            )
          })).pipe(
            Layer.provide(
              Layer.mergeAll(NodeServices.layer, socketConnector, encoder.pipe(Layer.provide(NodeServices.layer)))
            )
          )
          yield* Effect.gen(function*() {
            const page = yield* Browser.newPage()
            const video = yield* page.capability(Capability.Video)
            yield* Deferred.await(first)
            hold = true
            yield* Deferred.await(pending)
            if (end === "page") {
              yield* page.close()
              assert.isAtLeast(Number(probe(yield* video.file).streams[0].nb_read_frames), 1)
            } else {
              yield* group.first.close
              const error = yield* Effect.flip(video.file)
              assert(Capability.isCapabilityError(error))
              assert.strictEqual(error.reason._tag, "BackendFailure")
              assert.match(error.message, /connectionLost/)
            }
          }).pipe(Effect.provide(backend))
        })), 60_000)
    }
  }

  for (const end of ["page", "context"] as const) {
    it.live(
      `finishes on ${end} closure with the recording scope still open`,
      () =>
        run(launched(Effect.gen(function*() {
          const contextScope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void))
          const context = yield* Browser.newContext().pipe(Scope.provide(contextScope))
          const page = yield* context.newPage
          const video = yield* page.capability(Capability.Video)
          yield* Effect.sleep("200 millis")
          if (end === "page") yield* page.close()
          else yield* Scope.close(contextScope, Exit.void)
          assert.isAtLeast(Number(probe(yield* video.file).streams[0].nb_read_frames), 1)
        }))),
      60_000
    )
  }

  for (const end of ["page", "context", "connection"] as const) {
    it.live(`bounds a blocked writer after ${end} end`, () =>
      run(Effect.gen(function*() {
        yield* useXvfb()
        const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
        const started = yield* Deferred.make<void>()
        let released = false
        const writer = {
          write: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Effect.sync(() => {
                released = true
              }))
            )
        }
        let group!: WebKitAutomation.Group
        const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
          group = yield* WebKitAutomation.start({ executablePath: webkitgtk.executable })
          return yield* WebKitAdapter.connect(group.transport, {
            sink,
            ownership: "launched",
            automation: group,
            video: { polled: 100, directory }
          }).pipe(Effect.provideService(VideoWriter.VideoWriter, writer))
        })).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector)))
        yield* Effect.gen(function*() {
          const contextScope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void))
          const context = end === "connection"
            ? yield* (yield* Browser.Browser).defaultContext.control
            : yield* Browser.newContext().pipe(Scope.provide(contextScope))
          const page = yield* context.newPage
          const video = yield* page.capability(Capability.Video)
          yield* Deferred.await(started)
          const before = performance.now()
          if (end === "connection") yield* group.first.close
          else if (end === "context") yield* Scope.close(contextScope, Exit.void)
          else yield* page.close()
          const error = yield* Effect.flip(video.file)
          assert(Capability.isCapabilityError(error))
          assert.strictEqual(error.reason._tag, "BackendFailure")
          assert.isBelow(performance.now() - before, 7000)
          assert.isTrue(released)
        }).pipe(Effect.provide(backend))
      })), 60_000)
  }

  for (const mode of ["failure", "earlyClose"] as const) {
    it.live(`reports ${mode} from PNG acquisition and releases its source`, () =>
      run(Effect.gen(function*() {
        yield* useXvfb()
        const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
        const dispatched = yield* Deferred.make<void>()
        const shots = new Set<string>()
        let writes = 0
        const backend = BrowserImpl.layer(Effect.fnUntraced(function*(sink) {
          const group = yield* WebKitAutomation.start({ executablePath: webkitgtk.executable })
          return yield* WebKitAdapter.connect({
            ...group.transport,
            send: Effect.fnUntraced(function*(message: string) {
              const addressed = Envelope.unwrap(message)
              if (addressed !== undefined) {
                const outer = JSON.parse(addressed.message)
                if (outer.method === "Target.sendMessageToTarget") {
                  const inner = JSON.parse(outer.params.message)
                  if (inner.method === "Page.snapshotRect") {
                    shots.add(`${addressed.pageProxyId}:${inner.id}`)
                    yield* Deferred.succeed(dispatched, undefined)
                  }
                }
              }
              yield* group.transport.send(message)
            }),
            messages: group.transport.messages.pipe(Stream.filterMap((message) => {
              const outer = JSON.parse(message)
              if (outer.method === "Target.dispatchMessageFromTarget") {
                const inner = JSON.parse(outer.params.message)
                if (shots.has(`${outer.pageProxyId}:${inner.id}`)) {
                  if (mode === "earlyClose") return Result.fail(undefined)
                  return Result.succeed(
                    JSON.stringify({
                      ...outer,
                      params: {
                        ...outer.params,
                        message: JSON.stringify({
                          id: inner.id,
                          error: { code: -32000, message: "injected PNG capture failure" }
                        })
                      }
                    })
                  )
                }
              }
              return Result.succeed(message)
            }))
          }, { sink, ownership: "launched", automation: group, video: { polled: 100, directory } }).pipe(
            Effect.provideService(VideoWriter.VideoWriter, {
              write: (_, destination) =>
                Effect.sync(() => {
                  writes++
                }).pipe(Effect.as(destination.path))
            })
          )
        })).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector)))
        yield* Effect.gen(function*() {
          const page = yield* Browser.newPage()
          const scope = yield* Effect.acquireRelease(Scope.make(), (s) => Scope.close(s, Exit.void))
          const video = yield* page.capability(Capability.Video).pipe(Scope.provide(scope))
          yield* Deferred.await(dispatched)
          if (mode === "earlyClose") yield* Scope.close(scope, Exit.void)
          const error = yield* Effect.flip(video.file)
          assert(Capability.isCapabilityError(error))
          assert.strictEqual(error.reason._tag, "BackendFailure")
          assert.match(
            error.message,
            mode === "earlyClose" ? /before receiving a frame/ : /injected PNG capture failure/
          )
          assert.strictEqual(writes, 0)
        }).pipe(Effect.provide(backend))
      })), 60_000)
  }

  it.live("records an attached browser without requiring download support", () =>
    run(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped()
      const { endpoint } = yield* startMiniBrowser("data:text/html,<h1>attached video</h1>")
      yield* Effect.gen(function*() {
        const [entry] = yield* (yield* Browser.Browser).pages
        const page = yield* entry!.inspect
        const video = yield* Effect.scoped(Effect.gen(function*() {
          const video = yield* page.capability(Capability.Video)
          yield* Effect.sleep("300 millis")
          return video
        }))
        probe(yield* video.file)
      }).pipe(
        Effect.provide(
          WebKit.layerAttach(endpoint, { video: { polled: "100 millis", directory } }).pipe(
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                NodeSocket.layerWebSocketConstructor,
                encoder.pipe(Layer.provide(NodeServices.layer))
              )
            )
          )
        )
      )
    })), 60_000)
})
