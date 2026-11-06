import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Browser from "../src/Browser.ts"
import * as Cdp from "../src/internal/cdpAdapter.ts"
import * as VideoWriter from "../src/VideoWriter.ts"

describe("VideoWriter", () => {
  it("reports Chromium video only with an optional writer", () => {
    const info = new Browser.Info({ protocol: "cdp", product: "Chromium", version: "test", revision: "test" })
    const entry = (writer: boolean) =>
      Cdp.capabilities(info, "launched", true, writer).entries.find((e) => e.name === "capability.video")!
    assert.strictEqual(entry(false).status, "unsupported")
    assert.include(entry(false).limitations.join(" "), "VideoWriter")
    assert.strictEqual(entry(true).status, "supported")
  })

  it.effect("accepts timestamped PNG frames without a browser or a process dependency", () =>
    Effect.gen(function*() {
      const writer = yield* VideoWriter.VideoWriter
      assert.strictEqual(
        yield* writer.write(Stream.make({ at: 0, format: "png", data: new Uint8Array(), width: 2, height: 2 }), {
          path: "/tmp/video.webm",
          width: 2,
          height: 2
        }),
        "/tmp/video.webm"
      )
    }).pipe(Effect.provide(Layer.succeed(VideoWriter.VideoWriter, {
      write: (frames, destination) => frames.pipe(Stream.runDrain, Effect.as(destination.path))
    }))))
})
