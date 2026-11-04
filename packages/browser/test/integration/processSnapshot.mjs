// Runs in a disposable child so procfs reads cannot block test cleanup indefinitely.
import { closeSync, openSync, readdirSync, readSync } from "node:fs"

const read = (path) => {
  let fd
  try {
    fd = openSync(path, "r")
    const buffer = Buffer.alloc(65536)
    const size = readSync(fd, buffer, 0, buffer.length, 0)
    return { text: buffer.subarray(0, size).toString().replaceAll("\0", " "), truncated: size === buffer.length }
  } catch (error) {
    return { error: String(error) }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}
const root = Number(process.argv[2])
const previous = JSON.parse(process.argv[3])
const all = readdirSync("/proc").filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b))
const processes = all.slice(0, 8192).map((name) => {
  const pid = Number(name)
  const stat = read(`/proc/${pid}/stat`)
  const fields = stat.text?.slice(stat.text.lastIndexOf(")") + 2).split(" ")
  return { pid, ppid: Number(fields?.[1]), startTime: fields?.[19], stat, cmdline: read(`/proc/${pid}/cmdline`) }
})
const descendants = new Set([root])
for (let changed = true; changed;) {
  changed = false
  for (const item of processes) {
    if (descendants.has(item.ppid) && !descendants.has(item.pid)) {
      descendants.add(item.pid)
      changed = true
    }
  }
}
const known = new Map(previous.map((item) => [item.pid, item.startTime]))
const isCrashpad = (item) => /(?:^|\/)[^/ ]*crashpad_handler$/.test((item.cmdline.text ?? "").split(" ")[0])
const priority = (item) => item.pid === root ? 0 : descendants.has(item.pid) ? 1 : known.has(item.pid) ? 2 : 3
const selected = processes.filter((item) => descendants.has(item.pid) || known.has(item.pid) || isCrashpad(item)).sort((
  a,
  b
) => priority(a) - priority(b) || a.pid - b.pid)
const records = selected.slice(0, 128).map((item) => ({
  ...item,
  role: item.pid === root
    ? "browser root"
    : /--type=renderer(?: |$)/.test(item.cmdline.text ?? "")
    ? "renderer candidate"
    : isCrashpad(item)
    ? "Crashpad candidate"
    : "browser descendant",
  relation: descendants.has(item.pid)
    ? "browser tree"
    : known.has(item.pid)
    ? "previous snapshot"
    : "unattributed crashpad candidate",
  previousStartTime: known.get(item.pid),
  pidReused: known.has(item.pid) && known.get(item.pid) !== item.startTime,
  status: read(`/proc/${item.pid}/status`),
  wchan: read(`/proc/${item.pid}/wchan`),
  limits: read(`/proc/${item.pid}/limits`)
}))
for (const item of previous) {
  if (!processes.some((current) => current.pid === item.pid)) records.push({ ...item, notObservedInProcScan: true })
}
const host = Object.fromEntries([
  "/proc/sys/kernel/core_pattern",
  "/proc/sys/kernel/core_pipe_limit",
  "/proc/sys/kernel/core_uses_pid",
  "/proc/sys/fs/suid_dumpable"
].map((path) => [path, read(path)]))
console.log(JSON.stringify({
  utc: new Date().toISOString(),
  root,
  rootObserved: processes.some((item) => item.pid === root),
  host,
  processes: records,
  processScanTruncated: all.length > 8192,
  selectedTruncated: selected.length > 128,
  mapping:
    "Browser descendants are candidates, not a target-to-renderer mapping. Crashpad may be reparented or shared; non-descendant candidates are not attributed to this browser."
}))
