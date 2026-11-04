// Runs in a disposable child so procfs reads cannot block test cleanup indefinitely.
import { closeSync, openSync, readdirSync, readSync, writeSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const readFile = (path) => {
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

export const collectSnapshot = ({ root, previous, emit, read = readFile, list = () => readdirSync("/proc") }) => {
  const known = new Map(previous.slice(0, 128).map((item) => [item.pid, item]))
  const records = new Map()
  let omitted = previous.length > 128
  const update = (pid, fields) => {
    if (!records.has(pid) && records.size >= 128) {
      omitted = true
      return
    }
    records.set(pid, { ...records.get(pid), pid, ...fields })
    emit({ kind: "process", process: { pid, ...fields } })
  }
  const stat = (pid) => {
    const stat = read(`/proc/${pid}/stat`)
    const fields = stat.text?.slice(stat.text.lastIndexOf(")") + 2).split(" ")
    return { stat, ppid: Number(fields?.[1]), startTime: fields?.[19] }
  }
  emit({ kind: "header", root, utc: new Date().toISOString() })
  for (
    const path of [
      "/proc/sys/kernel/core_pattern",
      "/proc/sys/kernel/core_pipe_limit",
      "/proc/sys/kernel/core_uses_pid",
      "/proc/sys/fs/suid_dumpable"
    ]
  ) emit({ kind: "host", path, value: read(path) })

  // Flush status/limits/wchan for known PIDs before any broad scan or cmdline read can block.
  const priority = [...known.values()].sort((a, b) =>
    Number(b.role === "renderer candidate") - Number(a.role === "renderer candidate")
  )
  for (const item of [{ pid: root }, ...priority]) {
    if (records.has(item.pid)) continue
    update(item.pid, { previousStartTime: known.get(item.pid)?.startTime, role: known.get(item.pid)?.role })
    for (const field of ["status", "limits", "wchan"]) update(item.pid, { [field]: read(`/proc/${item.pid}/${field}`) })
    const current = stat(item.pid)
    update(item.pid, {
      ...current,
      pidReused: known.has(item.pid) && current.startTime !== undefined && known.get(item.pid).startTime !== undefined
        ? current.startTime !== known.get(item.pid).startTime
        : undefined
    })
  }

  const all = list().filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b))
  const processes = all.slice(0, 8192).map((name) => {
    const pid = Number(name)
    return { pid, ...stat(pid) }
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
  const ranked = processes.sort((a, b) =>
    Number(descendants.has(b.pid)) - Number(descendants.has(a.pid)) || a.pid - b.pid
  )
  for (const item of ranked) {
    const cmdline = read(`/proc/${item.pid}/cmdline`)
    const crashpad = /(?:^|\/)[^/ ]*crashpad_handler$/.test((cmdline.text ?? "").split(" ")[0])
    if (!descendants.has(item.pid) && !known.has(item.pid) && !crashpad) continue
    if (!records.has(item.pid) && records.size >= 128) {
      omitted = true
      continue
    }
    update(item.pid, {
      ...item,
      cmdline,
      role: item.pid === root
        ? "browser root"
        : /--type=renderer(?: |$)/.test(cmdline.text ?? "")
        ? "renderer candidate"
        : crashpad
        ? "Crashpad candidate"
        : "browser descendant",
      relation: descendants.has(item.pid)
        ? "browser tree"
        : known.has(item.pid)
        ? "previous snapshot"
        : "unattributed crashpad candidate"
    })
    // Known PIDs already have these fields; keep the earliest failure-time observations.
    if (!known.has(item.pid) && item.pid !== root) {
      for (const field of ["status", "limits", "wchan"]) {
        update(item.pid, { [field]: read(`/proc/${item.pid}/${field}`) })
      }
    }
  }
  for (const item of known.values()) {
    if (!processes.some((current) => current.pid === item.pid)) update(item.pid, { notObservedInProcScan: true })
  }
  emit({
    kind: "complete",
    rootObserved: processes.some((item) => item.pid === root),
    processScanTruncated: all.length > 8192,
    selectedTruncated: omitted || previous.length > 128,
    mapping:
      "Browser descendants are candidates, not a target-to-renderer mapping. Crashpad may be reparented or shared; non-descendant candidates are not attributed to this browser."
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bytes = 0
  const emit = (record) => {
    const buffer = Buffer.from(JSON.stringify(record) + "\n")
    if (bytes + buffer.length > 1024 * 1024 - 128) {
      writeSync(1, "{\"kind\":\"output-truncated\"}\n")
      process.exit(0)
    }
    bytes += buffer.length
    for (let offset = 0; offset < buffer.length;) offset += writeSync(1, buffer, offset)
  }
  try {
    collectSnapshot({ root: Number(process.argv[2]), previous: JSON.parse(process.argv[3]), emit })
  } catch (error) {
    emit({ kind: "collector-error", error: String(error) })
    process.exitCode = 1
  }
}
