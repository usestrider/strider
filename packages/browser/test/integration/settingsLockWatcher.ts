/**
 * Temporary: a reporter that, from the main process, tries a non-blocking exclusive flock on the shared crash
 * database's `settings.dat` every 250 ms through a python3 helper. A refusal lasting 1 s or more is recorded with
 * the file's openers, their ps rows and samples. Separately, it logs each mdworker open and whether a lock attempt
 * during it was refused.
 */
import { execFile, spawn } from "node:child_process"
import type { ChildProcess } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import type { Reporter, TestModule } from "vitest/node"

const database = process.env["STRIDER_MACOS_CRASH_DATABASE"] ?? ""
const settingsFile = path.join(database, "settings.dat")
const directory = path.resolve(import.meta.dirname, "../../../../.data/macos-crash-reports")
const enabled = process.platform === "darwin" && database !== ""

// Prints one line per attempt: "<epoch ms> ok", "<epoch ms> refused <errno>" or "<epoch ms> absent".
const helper = `
import errno, fcntl, os, sys, time
path = sys.argv[1]
while True:
    now = int(time.time() * 1000)
    try:
        fd = os.open(path, os.O_RDONLY)
    except FileNotFoundError:
        print(now, "absent", flush=True)
    else:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
            print(now, "ok", flush=True)
        except OSError as error:
            print(now, "refused", errno.errorcode.get(error.errno, error.errno), flush=True)
        finally:
            os.close(fd)
    time.sleep(0.25)
`

const run = (command: string, args: Array<string>, timeout: number) =>
  new Promise<string>((resolve) => {
    execFile(
      command,
      args,
      { timeout, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve(String(stdout) + String(stderr) + (error === null ? "" : `\n[${String(error)}]`))
    )
  })

const record = (value: object) => {
  mkdirSync(directory, { recursive: true })
  appendFileSync(
    path.join(directory, "settings-locks.ndjson"),
    JSON.stringify({ timestamp: new Date().toISOString(), ...value }) + "\n"
  )
}

const openers = (lsof: string) =>
  lsof.split("\n").slice(1).flatMap((line) => {
    const fields = line.trim().split(/\s+/)
    const pid = Number(fields[1])
    return Number.isInteger(pid) && pid > 0 ? [{ pid, command: fields[0] ?? "", line }] : []
  })

const interesting = /Chrome for Testing|chrome_crashpad_handler|mdworker/

interface Contention {
  startedAt: number
  lastRefusedAt: number
  file: string | undefined
  captured: boolean
  errno: string
}
interface MdworkerOpen {
  pid: number
  command: string
  line: string
  firstSeenAt: number
  lastSeenAt: number
  file: string | undefined
  attempts: number
  refused: number
}

export default class SettingsLockWatcher implements Reporter {
  private file: string | undefined
  private helper: ChildProcess | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private contention: Contention | undefined
  private readonly sampled = new Set<number>()
  private readonly mdworkers = new Map<number, MdworkerOpen>()
  private counts = { ok: 0, refused: 0, absent: 0, contentions: 0, mdworkerOpens: 0 }
  private buffer = ""

  onInit() {
    if (!enabled) return
    record({ kind: "start", settingsFile })
    const child = spawn("/usr/bin/python3", ["-c", helper, settingsFile], { stdio: ["ignore", "pipe", "pipe"] })
    this.helper = child
    child.stdout.on("data", (chunk) => {
      this.buffer += String(chunk)
      const lines = this.buffer.split("\n")
      this.buffer = lines.pop() ?? ""
      for (const line of lines) this.attempt(line)
    })
    child.stderr.on("data", (chunk) => record({ kind: "helper-stderr", text: String(chunk) }))
    child.once("exit", (code, signal) => {
      if (!this.stopped) record({ kind: "helper-exit", code, signal })
    })
    this.schedule()
  }

  onTestModuleStart(module: TestModule) {
    this.file = path.relative(process.cwd(), module.moduleId)
  }

  onTestRunEnd() {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.helper?.kill("SIGKILL")
    if (!enabled) return
    this.endContention(Date.now())
    for (const open of this.mdworkers.values()) this.endMdworker(open)
    record({ kind: "end", counts: this.counts })
  }

  private attempt(line: string) {
    const [at, result, code] = line.trim().split(" ")
    const time = Number(at)
    if (!Number.isFinite(time)) return
    if (result === "ok") this.counts.ok++
    else if (result === "refused") this.counts.refused++
    else this.counts.absent++
    for (const open of this.mdworkers.values()) {
      if (time >= open.firstSeenAt - 500) {
        open.attempts++
        if (result === "refused") open.refused++
      }
    }
    if (result === "refused") {
      if (this.contention === undefined) {
        this.contention = { startedAt: time, lastRefusedAt: time, file: this.file, captured: false, errno: code ?? "" }
      } else this.contention.lastRefusedAt = time
      if (!this.contention.captured && time - this.contention.startedAt >= 1_000) {
        this.contention.captured = true
        this.counts.contentions++
        void this.capture(this.contention)
      }
    } else this.endContention(time)
  }

  private endContention(time: number) {
    const contention = this.contention
    if (contention === undefined) return
    this.contention = undefined
    const lastedMs = contention.lastRefusedAt - contention.startedAt
    if (contention.captured || lastedMs >= 1_000) {
      record({
        kind: "contention-end",
        startedAt: new Date(contention.startedAt).toISOString(),
        refusedForMs: lastedMs,
        clearedWithin: time - contention.lastRefusedAt,
        file: contention.file,
        fileNow: this.file,
        errno: contention.errno
      })
    } else if (lastedMs > 0) {
      record({ kind: "short-refusal", startedAt: new Date(contention.startedAt).toISOString(), refusedForMs: lastedMs })
    }
  }

  private async capture(contention: Contention) {
    const lsof = await run("/usr/sbin/lsof", ["-nP", settingsFile], 5_000)
    const found = openers(lsof)
    const rows = await Promise.all(found.map(async ({ pid, command }) => {
      const ps = await run("/bin/ps", ["-o", "pid,ppid,pgid,stat,etime,command", "-p", String(pid)], 5_000)
      const sample = this.sampled.has(pid) ? null : await run("/usr/bin/sample", [String(pid), "1"], 15_000)
      this.sampled.add(pid)
      return { pid, command, ps, sample }
    }))
    const all = await run("/bin/ps", ["-axo", "pid,ppid,pgid,stat,etime,time,command"], 5_000)
    record({
      kind: "contention",
      startedAt: new Date(contention.startedAt).toISOString(),
      refusedForMsAtCapture: Date.now() - contention.startedAt,
      file: contention.file,
      errno: contention.errno,
      lsof,
      openers: rows,
      processes: all.split("\n").filter((entry) => interesting.test(entry))
    })
  }

  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.poll(), 500)
    this.timer.unref()
  }

  // Each mdworker open of the file, from first to last sighting, with the lock attempts made meanwhile.
  private async poll() {
    const now = Date.now()
    const present = new Map(
      openers(await run("/usr/sbin/lsof", ["-nP", settingsFile], 5_000))
        .filter(({ command }) => command.startsWith("mdworker"))
        .map((entry) => [entry.pid, entry])
    )
    for (const [pid, open] of this.mdworkers) {
      if (!present.has(pid)) {
        this.mdworkers.delete(pid)
        this.endMdworker(open)
      }
    }
    for (const [pid, { command, line }] of present) {
      const open = this.mdworkers.get(pid)
      if (open === undefined) {
        this.counts.mdworkerOpens++
        this.mdworkers.set(pid, {
          pid,
          command,
          line,
          firstSeenAt: now,
          lastSeenAt: now,
          file: this.file,
          attempts: 0,
          refused: 0
        })
      } else open.lastSeenAt = now
    }
    this.schedule()
  }

  private endMdworker(open: MdworkerOpen) {
    record({
      kind: "mdworker-open",
      pid: open.pid,
      command: open.command,
      lsof: open.line,
      firstSeen: new Date(open.firstSeenAt).toISOString(),
      seenForMs: open.lastSeenAt - open.firstSeenAt,
      file: open.file,
      lockAttempts: open.attempts,
      lockRefused: open.refused
    })
  }
}
