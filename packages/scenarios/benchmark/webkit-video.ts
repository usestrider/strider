/** Paired stock-WebKit sampling probe. Run only under the browser lock, in the pinned integration shell.
 * clutch lock browser -- nix develop .#integration --ignore-environment --keep TERM --command node packages/scenarios/benchmark/webkit-video.ts
 * Optional arguments: output directory, seconds per sample (default 8), repetitions (default 3).
 * Polling matches trace.ts: wait interval, then capture; encoding repeats the latest PNG at 25fps.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import { Browser, VideoWriter } from "@usestrider/browser"
import { WebKit } from "@usestrider/browser/webkit"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assertPinned, webkitgtk } from "../../browser/test/integration/browsers.ts"
import { socketConnector } from "../../browser/test/integration/sockets.ts"
import { useXvfb } from "../../browser/test/integration/stockWebKit.ts"

if (process.env["STRIDER_ENVIRONMENT"] !== "nix-integration") throw new Error("Requires pinned integration shell")
const output = path.resolve(process.argv[2] ?? ".data/benchmarks/webkit-video")
const seconds = Number(process.argv[3] ?? 8)
const repeats = Number(process.argv[4] ?? 3)
const ffmpeg = process.env["STRIDER_FFMPEG"]!
const ffprobe = process.env["STRIDER_FFPROBE"]!
fs.mkdirSync(output, { recursive: true })
const rows: Array<unknown> = []
const auxv = fs.readFileSync("/proc/self/auxv")
let clockTicksPerSecond: number | undefined
for (let offset = 0; offset + 16 <= auxv.length; offset += 16) {
  if (auxv.readBigUInt64LE(offset) === 17n) clockTicksPerSecond = Number(auxv.readBigUInt64LE(offset + 8))
}
if (clockTicksPerSecond === undefined) throw new Error("Missing Linux AT_CLKTCK")
const html = (animated: boolean) =>
  `<body style="margin:0;background:white"><button onclick="window.clicks++">Increment</button><canvas width="800" height="500"></canvas><script>
window.clicks=0;window.raf=[];window.timers=[];let prev=performance.now(),tp=prev;const c=document.querySelector('canvas'),x=c.getContext('2d');
function draw(t){window.raf.push(t-prev);prev=t;${
    animated
      ? "x.fillStyle='white';x.fillRect(0,0,800,500);x.fillStyle='#0645ad';x.fillRect((t/4)%700,50,100,100);x.fillStyle='black';x.font='24px sans-serif';x.fillText('Frame '+Math.floor(t)+' — small text 0123456789',20,250);"
      : ""
  }requestAnimationFrame(draw)}requestAnimationFrame(draw);
setInterval(()=>{let t=performance.now();window.timers.push(t-tp);tp=t},20);</script>`
const cpuTicks = () => {
  const found: Record<string, number> = {}
  for (const pid of fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
      if (!stat.includes("(ffmpeg)")) continue
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
      if (Number(fields[1]) !== process.pid) continue
      found[pid] = Number(fields[11]) + Number(fields[12])
    } catch { /* Process exited between listing and reading. */ }
  }
  return found
}
await Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    yield* useXvfb()
    yield* Effect.gen(function*() {
      const browser = yield* Browser.Browser
      assertPinned("WebKitGTK", browser.info.version, webkitgtk.version)
      fs.writeFileSync(
        path.join(output, "environment.json"),
        JSON.stringify(
          {
            browser: browser.info,
            executable: webkitgtk.executable,
            ffmpeg,
            ffmpegVersion: execFileSync(ffmpeg, ["-version"], { encoding: "utf8" }),
            kernel: os.release(),
            arch: os.arch(),
            cpus: os.cpus(),
            seconds,
            repeats,
            clockTicksPerSecond,
            note:
              "No artificial load; 1280x800 Xvfb, requested 800x600 viewport; sequential paired baseline/capture, alternating order by repetition."
          },
          null,
          2
        )
      )
      const writer = yield* VideoWriter.VideoWriter
      for (const animated of [false, true]) {
        for (let repeat = 0; repeat < repeats; repeat++) {
          for (const interval of [100, 200, 500]) {
            for (const encode of [false, true]) {
              for (const capture of repeat % 2 === 0 ? [false, true] : [true, false]) {
                yield* Effect.scoped(Effect.gen(function*() {
                  const name = `${animated ? "animated" : "idle"}-${repeat}-${interval}-${encode ? "writer" : "poll"}-${
                    capture ? "capture" : "baseline"
                  }`
                  const page = yield* Browser.newPage({ emulation: { viewport: { width: 800, height: 600 } } })
                  yield* page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html(animated))}`, {
                    waitUntil: "load"
                  })
                  yield* Effect.sleep(500)
                  yield* page.evaluateInMainWorld(() => {
                    ;(window as any).raf = []
                    ;(window as any).timers = []
                  })
                  const shots: Array<{ at: number; latency: number; hash: string; bytes: number }> = []
                  const inputs: Array<number> = []
                  const writerWaits: Array<number> = []
                  const writerSources: Array<number> = []
                  let writerFinishedAt: number | undefined
                  let lastFrameAt: number | undefined
                  const ffmpegTicks: Record<string, number> = {}
                  let latest: Uint8Array | undefined
                  const start = performance.now()
                  const cpu = process.cpuUsage()
                  const poll = capture ?
                    yield* Effect.gen(function*() {
                      while (true) {
                        yield* Effect.sleep(interval)
                        const before = performance.now()
                        const image = yield* page.screenshot()
                        latest = image
                        shots.push({
                          at: performance.now() - start,
                          latency: performance.now() - before,
                          hash: createHash("sha256").update(image).digest("hex"),
                          bytes: image.length
                        })
                        if (shots.length === 1) fs.writeFileSync(path.join(output, `${name}.png`), image)
                      }
                    }).pipe(Effect.forkScoped) :
                    undefined
                  let frames = 0
                  const writing = capture && encode ?
                    yield* Effect.gen(function*() {
                      while (latest === undefined) yield* Effect.sleep(1)
                      const initial = Buffer.from(latest)
                      const width = initial.readUInt32BE(16), height = initial.readUInt32BE(20)
                      const started = performance.now()
                      const stream = Stream.fromEffectRepeat(Effect.gen(function*() {
                        const target = started + frames * 40
                        const wait = target - performance.now()
                        if (wait > 0) yield* Effect.sleep(wait)
                        writerWaits.push(Math.max(0, performance.now() - target))
                        for (const [pid, ticks] of Object.entries(frames % 25 === 0 ? cpuTicks() : {})) {
                          ffmpegTicks[pid] = Math.max(ffmpegTicks[pid] ?? 0, ticks)
                        }
                        if (frames === 0) fs.writeFileSync(path.join(output, `${name}-writer-input.png`), latest!)
                        writerSources.push(shots.length - 1)
                        lastFrameAt = performance.now() - start
                        frames++
                        return { at: performance.now() * 1e6, format: "png" as const, data: latest!, width, height }
                      })).pipe(Stream.take(Math.ceil((seconds * 1000 - (performance.now() - start)) / 40)))
                      const result = yield* writer.write(stream, {
                        path: path.join(output, `${name}.webm`),
                        width,
                        height
                      })
                      writerFinishedAt = performance.now() - start
                      return result
                    }).pipe(Effect.forkScoped) :
                    undefined
                  while (performance.now() - start < seconds * 1000) {
                    yield* Effect.sleep(350)
                    const before = performance.now()
                    yield* page.getByRole("button", { name: "Increment" }).click()
                    // Include round trip confirming that the page processed the native input.
                    yield* page.evaluateInMainWorld(() => (window as any).clicks)
                    inputs.push(performance.now() - before)
                  }
                  if (poll) yield* Fiber.interrupt(poll)
                  const finishStart = performance.now()
                  if (writing) yield* Fiber.join(writing)
                  const finishMs = performance.now() - finishStart
                  const elapsed = performance.now() - start
                  const nodeCpu = process.cpuUsage(cpu)
                  const metrics = yield* page.evaluateInMainWorld(() => ({
                    raf: (window as any).raf,
                    timers: (window as any).timers,
                    clicks: (window as any).clicks,
                    width: innerWidth,
                    height: innerHeight
                  }))
                  if (metrics.clicks !== inputs.length) throw new Error(`Lost input: ${name}`)
                  let decoded: unknown
                  let quality: string | undefined
                  if (writing) {
                    const file = path.join(output, `${name}.webm`)
                    decoded = JSON.parse(
                      execFileSync(ffprobe, [
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
                    execFileSync(ffmpeg, ["-v", "error", "-i", file, "-f", "null", "-"])
                    execFileSync(ffmpeg, [
                      "-v",
                      "error",
                      "-i",
                      file,
                      "-frames:v",
                      "1",
                      "-y",
                      path.join(output, `${name}-decoded.png`)
                    ])
                  }
                  if (writing) {
                    const comparison = spawnSync(ffmpeg, [
                      "-i",
                      path.join(output, `${name}-writer-input.png`),
                      "-i",
                      path.join(output, `${name}-decoded.png`),
                      "-lavfi",
                      "psnr",
                      "-f",
                      "null",
                      "-"
                    ], { encoding: "utf8" })
                    if (comparison.status !== 0) throw new Error(comparison.stderr)
                    quality = comparison.stderr
                    fs.writeFileSync(path.join(output, `${name}-quality.log`), quality)
                  }
                  const row = {
                    name,
                    animated,
                    repeat,
                    interval,
                    encode,
                    capture,
                    elapsed,
                    shots,
                    inputs,
                    writerWaits,
                    writerSources,
                    writerFinishedAt,
                    lastFrameAt,
                    frames,
                    ffmpegTicks,
                    nodeCpu,
                    finishMs,
                    metrics,
                    decoded,
                    quality
                  }
                  rows.push(row)
                  fs.writeFileSync(path.join(output, "samples.json"), JSON.stringify(rows, null, 2))
                  console.log(name, JSON.stringify({ shots: shots.length, frames, elapsed, finishMs }))
                }))
              }
            }
          }
        }
      }
    }).pipe(
      Effect.provide(Layer.mergeAll(
        VideoWriter.layerFfmpeg({ path: ffmpeg }),
        WebKit.layer({ executablePath: webkitgtk.executable }).pipe(
          Layer.provide(Layer.mergeAll(NodeServices.layer, socketConnector))
        )
      ))
    )
  })).pipe(Effect.provide(NodeServices.layer))
)
