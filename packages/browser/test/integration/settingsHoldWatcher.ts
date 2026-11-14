/**
 * Temporary: a reporter that watches, from the main process, which processes keep the shared crash database's
 * `settings.dat` open across 2 s or more, and records each once with its ps row, a sample and the running file.
 */
import { execFile } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import type { Reporter, TestModule } from "vitest/node"

const database = process.env["STRIDER_MACOS_CRASH_DATABASE"] ?? ""
const settingsFile = path.join(database, "settings.dat")
const directory = path.resolve(import.meta.dirname, "../../../../.data/macos-crash-reports")
const enabled = process.platform === "darwin" && database !== ""

const run = (command: string, args: Array<string>, timeout: number) =>
  new Promise<{ ok: boolean; output: string }>((resolve) => {
    execFile(
      command,
      args,
      { timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          ok: error === null,
          output: String(stdout) + String(stderr) + (error === null ? "" : `\n[${String(error)}]`)
        })
    )
  })

const record = (value: object) => {
  mkdirSync(directory, { recursive: true })
  appendFileSync(
    path.join(directory, "settings-holds.ndjson"),
    JSON.stringify({ timestamp: new Date().toISOString(), ...value }) + "\n"
  )
}

export default class SettingsHoldWatcher implements Reporter {
  private file: string | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly firstSeen = new Map<number, { at: number; file: string | undefined; line: string }>()
  private readonly recorded = new Set<number>()
  private polls = 0
  private sightings = 0

  onInit() {
    if (!enabled) return
    record({ kind: "start", settingsFile })
    this.schedule()
  }

  onTestModuleStart(module: TestModule) {
    this.file = path.relative(process.cwd(), module.moduleId)
  }

  onTestRunEnd() {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (enabled) record({ kind: "end", polls: this.polls, sightings: this.sightings, recorded: [...this.recorded] })
  }

  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.poll(), 500)
    this.timer.unref()
  }

  private async poll() {
    this.polls++
    const now = performance.now()
    const { output } = await run("/usr/sbin/lsof", ["-nP", settingsFile], 5_000)
    const present = new Map<number, string>()
    for (const line of output.split("\n").slice(1)) {
      const pid = Number(line.trim().split(/\s+/)[1])
      if (Number.isInteger(pid) && pid > 0) present.set(pid, line)
    }
    for (const pid of [...this.firstSeen.keys()]) if (!present.has(pid)) this.firstSeen.delete(pid)
    for (const [pid, line] of present) {
      this.sightings++
      const seen = this.firstSeen.get(pid)
      if (seen === undefined) {
        this.firstSeen.set(pid, { at: now, file: this.file, line })
        continue
      }
      if (now - seen.at >= 2_000 && !this.recorded.has(pid)) {
        this.recorded.add(pid)
        const [row, sample, all] = await Promise.all([
          run("/bin/ps", ["-o", "pid,ppid,pgid,stat,etime,command", "-p", String(pid)], 5_000),
          run("/usr/bin/sample", [String(pid), "1"], 15_000),
          run("/bin/ps", ["-axo", "pid,ppid,pgid,stat,etime,time,command"], 5_000)
        ])
        record({
          kind: "hold",
          pid,
          heldAtLeastMs: Math.round(now - seen.at),
          fileWhenFirstSeen: seen.file,
          fileNow: this.file,
          lsof: line,
          ps: row.output,
          chrome: all.output.split("\n").filter((entry) => /Chrome for Testing|chrome_crashpad_handler/.test(entry)),
          sample: sample.output
        })
      }
    }
    this.schedule()
  }
}
