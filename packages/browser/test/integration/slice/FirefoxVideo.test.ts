/** Native Firefox recording defaults in a small, non-emulated window. */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import { Browser, Capability } from "@usestrider/browser"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { firefox } from "../browsers.ts"

const backend = Firefox.layer({
  executablePath: firefox.executable,
  args: ["--width=640", "--height=480"]
}).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)))

layer(backend, { excludeTestServices: true })((it) => {
  it.effect(
    "does not enlarge default video from a small window without viewport emulation",
    () =>
      Effect.gen(function*() {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "small-video-"))
        yield* Effect.addFinalizer(() => Effect.sync(() => fs.rmSync(directory, { recursive: true, force: true })))
        const browser = yield* Browser.Browser
        const page = yield* (yield* browser.pages)[0]!.control
        yield* page.goto(
          "data:text/html,<p id='t'></p><script>setInterval(() => t.textContent = Date.now(), 50)</script>",
          { waitUntil: "load" }
        )
        const viewport = yield* page.evaluate(() => [innerWidth, innerHeight])
        assert.isBelow(viewport[0]!, 800)
        assert.isBelow(viewport[1]!, 800)
        const recording = yield* Effect.scoped(Effect.gen(function*() {
          const video = yield* page.capability(Capability.Video, { path: path.join(directory, "video.webm") })
          yield* Effect.sleep("800 millis")
          return video
        }))
        const video = JSON.parse(execFileSync(process.env["STRIDER_FFPROBE"]!, [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          yield* recording.file
        ], { encoding: "utf8" })).streams[0]
        console.log("Small window video", JSON.stringify({ viewport, width: video.width, height: video.height }))
        assert.closeTo(video.width, viewport[0]!, 2)
        assert.closeTo(video.height, viewport[1]!, 2)
      }),
    60_000
  )
})
