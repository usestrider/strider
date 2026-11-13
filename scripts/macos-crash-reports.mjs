/** Retain bounded Crashpad minidumps from a run-owned database, with macOS reports as a fallback. */
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, opendir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const limits = { directoryEntries: 512, reports: 32, perReportBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 }

// Standard MINIDUMP_HEADER / DIRECTORY, MiscInfo (process ID), and Exception stream.
// Preserve the original bytes too: these fields correlate a dump, they do not symbolize a native stack.
export const minidumpIdentity = (bytes) => {
  if (bytes.length < 32 || bytes.toString("ascii", 0, 4) !== "MDMP") throw new Error("Invalid minidump header")
  const count = bytes.readUInt32LE(8), directory = bytes.readUInt32LE(12)
  if (count > 4096 || directory + count * 12 > bytes.length) throw new Error("Invalid minidump directory")
  const result = { timestamp: new Date(bytes.readUInt32LE(20) * 1000).toISOString() }
  for (let i = 0; i < count; i++) {
    const at = directory + i * 12,
      type = bytes.readUInt32LE(at),
      size = bytes.readUInt32LE(at + 4),
      offset = bytes.readUInt32LE(at + 8)
    if (offset + size > bytes.length) throw new Error("Truncated minidump stream")
    if (type === 15 && size >= 12 && (bytes.readUInt32LE(offset + 4) & 1)) result.pid = bytes.readUInt32LE(offset + 8)
    if (type === 6 && size >= 168) {
      result.threadId = bytes.readUInt32LE(offset)
      result.exceptionCode = bytes.readUInt32LE(offset + 8)
    }
  }
  return result
}

const boundedRead = async (file, maximum) => {
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await fd.stat()
    if (!info.isFile() || info.size > maximum) throw new Error("Not a regular file or byte limit exceeded")
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await fd.read(bytes, length, bytes.length - length, null)
      if (read.bytesRead === 0) break
      length += read.bytesRead
    }
    if (length !== info.size) throw new Error("File changed while collecting")
    return bytes.subarray(0, length)
  } finally {
    await fd.close()
  }
}

export const collect = async (directory, roots, database) => {
  let status
  try {
    status = JSON.parse(await readFile(path.join(directory, "capture-status.json"), "utf8"))
  } catch (error) {
    await mkdir(directory, { recursive: true })
    status = { started: new Date().toISOString(), setupError: String(error) }
  }
  status.finished = new Date().toISOString()
  status.suiteOutcome = process.env.STRIDER_MACOS_SUITE_OUTCOME ?? "unknown"
  status.reports = []
  status.errors = []
  status.directoryLimits = []
  status.database = database ?? null
  let bytes = 0, copied = 0
  const sources = [
    ...(database
      ? ["pending", "completed", "new"].map((name) => ({ source: path.join(database, name), kind: "crashpad" }))
      : []),
    ...roots.flatMap((root) => [root, path.join(root, "Retired")].map((source) => ({ source, kind: "system" })))
  ]
  for (const { source, kind } of sources) {
    try {
      const entries = await opendir(source)
      let scanned = 0
      for await (const entry of entries) {
        if (++scanned > limits.directoryEntries) {
          status.directoryLimits.push({
            source,
            note: "Directory entry limit reached; remaining entries not inspected"
          })
          break
        }
        const name = entry.name
        if (
          !entry.isFile() || !(kind === "crashpad"
            ? name.endsWith(".dmp")
            : /chrome|chromium|crashpad/i.test(name) && /\.(ips|crash|diag)$/i.test(name))
        ) continue
        const file = path.join(source, name)
        try {
          const info = await lstat(file)
          if (!info.isFile() || info.mtimeMs < Date.parse(status.started)) continue
          const report = { source: file, kind, bytes: info.size, modified: info.mtime.toISOString() }
          const data = copied >= limits.reports || info.size > limits.perReportBytes ||
              bytes + info.size > limits.totalBytes
            ? undefined
            : await boundedRead(file, limits.perReportBytes)
          if (data === undefined || bytes + data.length > limits.totalBytes) {
            report.omitted = "Report count or byte limit exceeded"
            if (data !== undefined) report.bytes = data.length
          } else {
            report.bytes = data.length
            report.artifact = `${status.reports.length}-${name}`
            await writeFile(path.join(directory, report.artifact), data)
            bytes += data.length
            copied++
            report.copied = true
            report.sha256 = createHash("sha256").update(data).digest("hex")
            if (kind === "crashpad") {
              try {
                report.minidump = minidumpIdentity(data)
              } catch (error) {
                status.errors.push({ source: file, error: String(error) })
              }
            }
          }
          status.reports.push(report)
        } catch (error) {
          status.errors.push({ source: file, error: String(error) })
        }
      }
    } catch (error) {
      status.errors.push({ source, error: String(error) })
    }
  }
  status.copiedBytes = bytes
  status.nativeReports = copied ? "present" : "absent"
  status.verification = { state: "not-observed" }
  try {
    const intent = JSON.parse((await boundedRead(path.join(directory, "deliberate-crash.json"), 64 * 1024)).toString())
    const matches = status.reports.filter(({ minidump: dump }) =>
      dump?.pid !== undefined && dump.exceptionCode !== undefined &&
      intent.rendererPids.includes(dump.pid) &&
      Date.parse(dump.timestamp) >= Math.floor(Date.parse(intent.started) / 1000) * 1000 &&
      Date.parse(dump.timestamp) <= Date.parse(intent.observed)
    )
    status.verification = {
      state: matches.length ? "verified" : "missing",
      intent,
      artifacts: matches.map((report) => report.artifact)
    }
  } catch (error) {
    status.verification.error = String(error)
  }
  status.note =
    "One collection, no polling: late or incomplete Crashpad/system reports may be absent. Verification requires an exception minidump with a renderer PID from the isolated deliberate-crash browser and a header time in its marked window. Native files need a separate symbolizer to identify a crash cause."
  await writeFile(path.join(directory, "capture-status.json"), JSON.stringify(status, null, 2) + "\n")
  console.log(
    `Native macOS reports: ${status.nativeReports}; deliberate crash: ${status.verification.state}; ${bytes} bytes copied; ${status.errors.length} collection errors`
  )
  return status
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(".data/macos-crash-reports")
  if (process.argv[2] === "start") {
    await mkdir(directory, { recursive: true })
    const pins = JSON.parse(
      await readFile(new URL("../packages/browser/test/integration/browsers.macos.json", import.meta.url), "utf8")
    )
    await writeFile(
      path.join(directory, "capture-status.json"),
      JSON.stringify(
        {
          started: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          run: process.env.GITHUB_RUN_ID,
          commit: process.env.GITHUB_SHA,
          browser: pins.chromium,
          nativeReports: "not-collected",
          mechanism: "macOS Crashpad database via BREAKPAD_DUMP_LOCATION; system-report fallback",
          limits
        },
        null,
        2
      ) + "\n"
    )
  } else if (process.argv[2] === "finish") {
    const status = await collect(directory, [
      path.join(homedir(), "Library/Logs/DiagnosticReports"),
      "/Library/Logs/DiagnosticReports"
    ], process.env.STRIDER_MACOS_CRASH_DATABASE)
    // Keep the artifact first; a green suite must not silently certify a probe that collected no deliberate crash.
    if (status.suiteOutcome === "success" && status.verification.state !== "verified") process.exitCode = 1
  } else throw new Error("Expected start or finish")
}
