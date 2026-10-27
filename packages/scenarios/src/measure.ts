/**
 * What the report measures with: wall time, and the CPU time of the browser's renderers, read from `/proc` for
 * the processes this one started. Linux's, as the integration environment is.
 */
import * as fs from "node:fs"

export interface Stats {
  readonly runs: number
  readonly median: number
  readonly p90: number
  readonly min: number
}

export const stats = (values: ReadonlyArray<number>): Stats => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? Number.NaN
  return { runs: sorted.length, median: at(0.5), p90: at(0.9), min: sorted[0] ?? Number.NaN }
}

// `/proc` counts CPU time in USER_HZ, part of Linux's ABI: 100 on x86-64 and arm64, the flake's systems
const ticksPerSecond = 100

interface Proc {
  readonly pid: number
  readonly ppid: number
  readonly cpu: number
  readonly args: ReadonlyArray<string>
}

const readProc = (pid: number): Proc | undefined => {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8")
    // The command name is in parentheses and may hold spaces: the fields after it are space-separated
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    const args = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter((arg) => arg !== "")
    return {
      pid,
      ppid: Number(fields[1]),
      // utime and stime, in clock ticks
      cpu: ((Number(fields[11]) + Number(fields[12])) / ticksPerSecond) * 1000,
      args
    }
  } catch {
    return undefined
  }
}

/** The processes this one started, and theirs. */
export const descendants = (): ReadonlyArray<Proc> => {
  const all = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).map(Number).map(readProc)
    .filter((proc): proc is Proc => proc !== undefined)
  const byParent = new Map<number, Array<Proc>>()
  for (const proc of all) byParent.set(proc.ppid, [...(byParent.get(proc.ppid) ?? []), proc])
  const found: Array<Proc> = []
  const visit = (pid: number) => {
    for (const child of byParent.get(pid) ?? []) {
      found.push(child)
      visit(child.pid)
    }
  }
  visit(process.pid)
  return found
}

/** The CPU time, in milliseconds, the renderers this process's browsers run have used. */
export const rendererCpu = (): number => descendants().filter(isRenderer).reduce((sum, proc) => sum + proc.cpu, 0)

// A renderer forked from the zygote rewrites its command line, as one string where a launched process has its
// arguments apart
const isRenderer = (proc: Proc) => proc.args.join(" ").includes("--type=renderer")

/** The arguments of the browser process this process started: its own, not a helper's. */
export const browserArgs = (): ReadonlyArray<string> =>
  descendants().find((proc) =>
    proc.args.some((arg) => arg.includes("chromium")) && !proc.args.join(" ").includes("--type=")
  )
    ?.args ?? []
