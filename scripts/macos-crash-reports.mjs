/** Snapshot macOS Chrome reports without changing browser launch or crash handling. No polling or retries. */
import { copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

export const collect = async (directory, roots) => {
  const status = JSON.parse(await readFile(path.join(directory, "capture-status.json"), "utf8"))
  status.finished = new Date().toISOString()
  status.suiteOutcome = process.env.STRIDER_MACOS_SUITE_OUTCOME ?? "unknown"
  status.reports = []
  status.errors = []
  status.directoryLimits = []
  let bytes = 0
  // Only the standard report directories and their Retired subdirectory; never traverse the runner's home.
  for (const root of roots) {
    for (const source of [root, path.join(root, "Retired")]) {
      try {
        const names = (await readdir(source)).sort()
        if (names.length > 512) status.directoryLimits.push({ source, omittedEntries: names.length - 512 })
        for (const name of names.slice(-512)) {
          if (!/chrome|chromium|crashpad/i.test(name) || !/\.(ips|crash|diag)$/i.test(name)) continue
          const file = path.join(source, name)
          try {
            const info = await lstat(file)
            if (!info.isFile() || info.mtimeMs < Date.parse(status.started)) continue
            const report = { source: file, bytes: info.size }
            if (
              status.reports.filter((r) => r.copied).length >= 32 || info.size > 16 * 1024 * 1024 ||
              bytes + info.size > 64 * 1024 * 1024
            ) {
              report.omitted = "Report count or byte limit exceeded"
            } else {
              report.artifact = `${status.reports.length}-${name}`
              await copyFile(file, path.join(directory, report.artifact))
              bytes += info.size
              report.copied = true
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
  }
  status.copiedBytes = bytes
  status.nativeReports = status.reports.some((r) => r.copied) ? "present" : "absent"
  status.note =
    "One immediate collection after the suite; delayed OS reports can be absent. Reports are candidates by name/time, not proof of the failing renderer. Breakpad remains disabled by the automation profile; no minidumps requested."
  await writeFile(path.join(directory, "capture-status.json"), JSON.stringify(status, null, 2) + "\n")
  console.log(
    `Native macOS reports: ${status.nativeReports}; ${bytes} bytes copied; ${status.errors.length} collection errors (see capture-status.json)`
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(".data/macos-crash-reports")
  if (process.argv[2] === "start") {
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, "capture-status.json"),
      JSON.stringify(
        {
          started: new Date().toISOString(),
          platform: process.platform,
          architecture: process.arch,
          run: process.env.GITHUB_RUN_ID,
          commit: process.env.GITHUB_SHA,
          nativeReports: "not-collected",
          mechanism: "macOS DiagnosticReports; unchanged Chromium launch flags",
          limits: { directoryEntries: 512, reports: 32, perReportBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 }
        },
        null,
        2
      ) + "\n"
    )
  } else if (process.argv[2] === "finish") {
    await collect(directory, [
      path.join(homedir(), "Library/Logs/DiagnosticReports"),
      "/Library/Logs/DiagnosticReports"
    ])
  } else {
    throw new Error("Expected start or finish")
  }
}
