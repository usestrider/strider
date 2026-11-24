/**
 * Temporary probe: how late a page's timers fire, idle, beside a frame loop, and in a real engine round, on Firefox
 * and Chromium. Prints `TIMER-PROBE` lines; asserts nothing about lateness.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import { Browser, Deadline, Expect, LaunchProfile } from "@usestrider/browser"
import { Chromium } from "@usestrider/browser/chromium"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { execSync } from "node:child_process"
import { site } from "../adapter/harness.ts"
import { chromium, firefox } from "../browsers.ts"

const services = Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)
const withPrefs = (prefs: Record<string, string | number | boolean>) =>
  new LaunchProfile.LaunchProfile({
    name: "automation",
    args: LaunchProfile.automation.args,
    prefs: { ...LaunchProfile.automation.prefs, ...prefs }
  })

const configs = [
  { name: "firefox", layer: Firefox.layer({ executablePath: firefox.executable }) },
  {
    name: "firefox-ppm-off",
    layer: Firefox.layer({
      executablePath: firefox.executable,
      profile: withPrefs({ "dom.ipc.processPriorityManager.enabled": false })
    })
  },
  { name: "firefox-concurrent", layer: Firefox.layer({ executablePath: firefox.executable, profile: LaunchProfile.concurrent }) },
  { name: "chromium", layer: Chromium.layer({ executablePath: chromium.executable }) }
] as const

const log = (config: string, probe: string, data: unknown) =>
  Effect.sync(() => console.log(`TIMER-PROBE ${JSON.stringify({ config, probe, data })}`))

const processes = () => {
  try {
    const rows = execSync(
      process.platform === "darwin" ? "ps -axo pid,ppid,pri,nice,stat,comm" : "ps -eo pid,ppid,pri,ni,cls,stat,comm",
      { encoding: "utf8" }
    )
    return rows.split("\n").filter((row, index) =>
      index === 0 || /firefox|plugin-container|Chrom|Google Chrome|chrome/i.test(row)
    )
  } catch (error) {
    return [String(error)]
  }
}

const policies = () => {
  if (process.platform !== "darwin") return []
  const pids = processes().slice(1).map((row) => row.trim().split(/\s+/)[0]).filter((pid) => /^\d+$/.test(pid!))
  return pids.map((pid) => {
    try {
      return `${pid}: ${execSync(`taskinfo ${pid} 2>&1 | grep -iE 'qos|role|priority|darwin bg|tier' || true`, { encoding: "utf8" })}`
    } catch (error) {
      return `${pid}: ${String(error)}`
    }
  })
}

const sh = (command: string) => {
  try {
    return execSync(command, { encoding: "utf8", shell: process.platform === "darwin" ? "/bin/bash" : "sh" }).trim().split("\n")
  } catch (error) {
    return [String(error)]
  }
}

// A native sleep's lateness, in ms, at 30, 70 and 150 ms, five each, under a task policy prefix.
const sleeps = (prefix: string) =>
  sh(
    `${prefix} perl -MTime::HiRes=time,sleep -e 'for $d (30,70,150) { @l = (); for (1..5) { $t = time; sleep($d/1000); push @l, int((time-$t)*1000-$d) } print "$d: @l\\n" }'`
  )

layer(services, { excludeTestServices: true, timeout: 120_000 })((it) => {
  it.effect("host: timer lateness of the test process and native sleeps under task policies", () =>
    Effect.gen(function*() {
      const late: Record<number, Array<number>> = {}
      for (const delay of [30, 70, 150]) {
        late[delay] = []
        for (let i = 0; i < 10; i++) {
          const set = performance.now()
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, delay)))
          late[delay].push(Math.round(performance.now() - set - delay))
        }
      }
      yield* log("host", "node-setTimeout", late)
      yield* log("host", "ancestors", sh(`p=${process.pid}; while [ "$p" -gt 1 ]; do ps -o pid=,ppid=,pri=,nice=,comm= -p $p; p=$(ps -o ppid= -p $p | tr -d ' '); done`))
      if (process.platform !== "darwin") return
      yield* log("host", "sysctl", sh("sysctl -a 2>/dev/null | grep -iE 'coalesc|timer_' | head -40"))
      for (const prefix of ["", "taskpolicy -c utility", "taskpolicy -c background", "taskpolicy -b", "taskpolicy -l 0 -t 0"]) {
        yield* log("host", `sleep[${prefix || "inherited"}]`, sleeps(prefix))
      }
    }), 120_000)
})

for (const config of configs) {
  layer(config.layer.pipe(Layer.provide(services)), { excludeTestServices: true, timeout: 120_000 })((it) => {
    it.effect(
      `${config.name}: timer lateness idle, beside a frame loop, and in an engine round`,
      () =>
        Effect.gen(function*() {
          const { origin } = yield* site
          const page = yield* Browser.newPage()
          yield* page.goto(`${origin}/fixture?html=${encodeURIComponent("<body><div class=box>box</div></body>")}`, {
            waitUntil: "load"
          })
          yield* log(
            config.name,
            "page",
            yield* page.evaluateInMainWorld(() => ({
              visibilityState: document.visibilityState,
              hasFocus: document.hasFocus(),
              hidden: document.hidden
            }))
          )
          yield* log(config.name, "processes", processes())
          yield* log(config.name, "policies", policies())
          if (process.platform === "darwin") {
            const content = processes().find((row) => /plugin-container|Renderer/.test(row))?.trim().split(/\s+/)[0]
            yield* log(config.name, "content-threads", sh(`ps -M -p ${content} | head -40`))
          }
          for (const frames of [false, true]) {
            const marks = yield* page.evaluateInMainWorld(async (withFrames: boolean) => {
              const frameMarks: Array<[number, number]> = []
              let running = withFrames
              const frame = () => {
                if (!running) return
                const start = performance.now()
                frameMarks.push([start, performance.now()])
                requestAnimationFrame(frame)
              }
              if (withFrames) requestAnimationFrame(frame)
              const timers: Array<{ delay: number; set: number; fired: number }> = []
              for (const delay of [30, 70, 150]) {
                for (let i = 0; i < 10; i++) {
                  const set = performance.now()
                  const fired = await new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), delay))
                  timers.push({ delay, set, fired })
                }
              }
              running = false
              const gaps = frameMarks.slice(1).map((mark, i) => mark[0] - frameMarks[i]![0])
              return {
                timers,
                frames: frameMarks.length,
                frameBusyMax: Math.max(0, ...frameMarks.map(([s, e]) => e - s)),
                frameGapMedian: gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? null,
                frameGapMax: Math.max(0, ...gaps)
              }
            }, frames)
            const late = (delay: number) =>
              marks.timers.filter((t) => t.delay === delay).map((t) => Math.round(t.fired - t.set - delay))
            yield* log(config.name, frames ? "b-frames" : "a-idle", {
              late30: late(30),
              late70: late(70),
              late150: late(150),
              frames: marks.frames,
              frameBusyMax: marks.frameBusyMax,
              frameGapMedian: marks.frameGapMedian,
              frameGapMax: marks.frameGapMax
            })
          }
          // (c) A real engine round: a 300 ms deadline gives the first round a cap of about 150 ms; the round's
          // start and reply, with its cap, are in the retained trace's engine-round entries.
          const rounds: Array<number> = []
          for (let i = 0; i < 5; i++) {
            const start = performance.now()
            const failure = yield* page.locator("#missing").pipe(
              Expect.toBeVisible,
              Deadline.within("300 millis"),
              Effect.flip
            )
            rounds.push(Math.round(performance.now() - start))
            assert.isDefined(failure)
          }
          yield* log(config.name, "c-expect-300ms", { hostElapsed: rounds })
        }),
      120_000
    )
  })
}
