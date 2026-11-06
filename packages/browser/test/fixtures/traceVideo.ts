import { assert } from "@effect/vitest"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Zip from "effect/encoding/Zip"
import * as FileSystem from "effect/FileSystem"
import * as Option from "effect/Option"
import * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { vi } from "vitest"
import * as Diagnostics from "../../src/Diagnostics.ts"
import * as Capabilities from "../../src/internal/capabilities.ts"
import * as Events from "../../src/internal/events.ts"
import type * as Model from "../../src/internal/model.ts"
import type * as Runtime from "../../src/internal/runtime.ts"
import * as Trace from "../../src/internal/trace.ts"
import * as Target from "../../src/Target.ts"

vi.mock("../../src/internal/capabilities.ts", () => ({ acquire: vi.fn() }))

class RecordingFailure extends Data.TaggedError("RecordingFailure")<{ readonly message: string }> {}

export const scenario = Effect.fnUntraced(
  function*(stage?: "acquisition" | "stop" | "file-read", interruptAt?: "stop" | "file-read") {
    let acquisitions = 0
    let reads = 0
    let stops = 0
    const exports: Array<Uint8Array> = []
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0xb0, 0x81, 32, 0xba, 0x81, 24])
    vi.mocked(Capabilities.acquire).mockImplementation(() =>
      Effect.suspend(() => {
        acquisitions++
        if (stage === "acquisition") {
          return Effect.fail(
            new RecordingFailure({
              message: "ACQUISITION_REASON https://user:pass@example.test/video?token=secret#fragment"
            })
          ) as never
        }
        return Effect.succeed({
          file: Effect.suspend(() => {
            stops++
            if (interruptAt === "stop") return Effect.interrupt
            return stage === "stop"
              ? Effect.fail(
                new RecordingFailure({
                  message: "STOP_REASON https://user:pass@example.test/video?token=secret#fragment"
                })
              )
              : Effect.succeed("/native.webm")
          })
        }) as never
      })
    )
    const id = "video-page" as Target.NavigableId
    const target = { _tag: "Page", id } as const
    const page = {
      id,
      events: {
        console: Events.make(target, () => 100),
        exception: Events.make(target, () => 100)
      }
    } as Model.PageEntry
    const runtime = {
      model: {
        adapter: {
          info: { protocol: "bidi" },
          capabilities: yield* SubscriptionRef.make({ entries: [{ name: "capability.video", status: "supported" }] })
        }
      },
      fileSystem: Option.some(FileSystem.makeNoop({
        readFile: () =>
          Effect.suspend(() => {
            reads++
            if (interruptAt === "file-read") return Effect.interrupt
            return stage === "file-read"
              ? Effect.fail(
                new PlatformError.PlatformError(
                  new PlatformError.SystemError({
                    _tag: "NotFound",
                    module: "FileSystem",
                    method: "readFile",
                    description: "READ_REASON https://user:pass@example.test/video?token=secret#fragment"
                  })
                )
              )
              : Effect.succeed(bytes)
          }),
        makeDirectory: () => Effect.void,
        writeFile: (_path, content) => Effect.sync(() => void exports.push(content))
      })),
      path: Option.none()
    } as unknown as Runtime.Runtime
    const trace = yield* Trace.start(runtime, { _tag: "Page", entry: page }, {
      screenshots: "off",
      screencast: "native",
      domSnapshots: false,
      network: false
    }, yield* Effect.scope)
    yield* Effect.yieldNow
    assert.strictEqual(acquisitions, 1)
    yield* trace.exportTrace("/first.zip")
    yield* trace.exportTrace("/second.zip").pipe(Diagnostics.withPreset("local"))
    const files = yield* Effect.forEach(exports, (zip) =>
      Stream.make(zip).pipe(
        Stream.pipeThroughChannel(Zip.decode()),
        Stream.mapEffect((entry) =>
          Stream.mkUint8Array(entry.body).pipe(
            Effect.map((content) => [entry.header.path, content] as const)
          )
        ),
        Stream.runCollect,
        Effect.map((entries) => new Map(entries))
      ))
    return { files, reads, stops, bytes }
  }
)
