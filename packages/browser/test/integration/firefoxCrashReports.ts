/**
 * Firefox's crash reports for the integration tests, kept when a test fails.
 *
 * When the parent process kills a content process it can no longer talk to (`ContentParent::KillHard`, in
 * `dom/ipc/ContentParent.cpp` at FIREFOX_158_0_RELEASE), it writes a paired crash report whose `.extra` file carries
 * the reason as the `ipc_channel_error` annotation. `GeneratePairedMinidump` writes it only when
 * - the crash reporter is on, which `MOZ_CRASHREPORTER=1` in the environment does (`toolkit/xre/nsAppRunner.cpp`),
 * - the content process has a crash reporter host (always, once the reporter is on), and
 * - `dom.ipc.tabs.createKillHardCrashReports` is true. It is read once, at startup, and defaults to false on release
 *   builds (`modules/libpref/init/StaticPrefList.yaml`: `@IS_NOT_RELEASE_OR_BETA@`), which the pinned Firefox is.
 * Without `MOZ_CRASHREPORTER_NO_REPORT` the report waits in `Crash Reports/pending` of the user's application data
 * directory, under the home directory, where a profile's removal doesn't reach it (with it set, it would stay in the
 * profile's `minidumps/`, which is deleted with it); nothing is submitted, because that needs the reporter's
 * settings, which the tests never turn on.
 *
 * `environment` and `prefs` make Firefox write the reports for every launch the tests make (`environment.ts`).
 * After a test that failed, the runner (`failureTraceRunner.ts`) copies the reports written since it began to
 * `.data/integration-failures/`, as `<test file>-<test id>-<pid>-firefox-crash/`, and a passing test keeps nothing.
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

/** Turns Firefox's crash reporter on, with nothing to show or submit. */
export const environment: Readonly<Record<string, string>> = { MOZ_CRASHREPORTER: "1" }

/** The preference that makes `KillHard` write its report. */
export const prefs: Readonly<Record<string, boolean>> = { "dom.ipc.tabs.createKillHardCrashReports": true }

/** The largest minidump kept, in bytes; a larger one is named in `omitted.txt`. */
export const maxDumpBytes = 8 * 1024 * 1024

/** The most minidump bytes kept for one test. */
export const maxTotalBytes = 32 * 1024 * 1024

/** Where Firefox waits with the reports of its crashes, for a home directory. */
export const pendingDirectory = (
  home: string = os.homedir(),
  platform: string = process.platform
): string =>
  platform === "darwin"
    ? path.join(home, "Library", "Application Support", "Firefox", "Crash Reports", "pending")
    : path.join(home, ".mozilla", "firefox", "Crash Reports", "pending")

/** The ids of the reports in `pending` written at or after `since` (epoch milliseconds), oldest first. */
export const reportsSince = (pending: string, since: number): ReadonlyArray<string> => {
  let names: Array<string>
  try {
    names = fs.readdirSync(pending)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith(".extra"))
    .map((name) => ({ id: name.slice(0, -".extra".length), time: fs.statSync(path.join(pending, name)).mtimeMs }))
    .filter((report) => report.time >= since)
    .sort((a, b) => a.time - b.time)
    .map((report) => report.id)
}

/**
 * What a test that failed keeps: the `.extra` of each report written in `pending` since `since`, and its minidumps
 * up to `maxDumpBytes` each and `maxTotalBytes` together, copied into `destination`, which is made only if there is
 * one. A test that passed (`failed` false) keeps nothing. The reports are removed from `pending` either way, so no
 * later test is shown them. Returns the destination, or `undefined` when nothing was kept.
 */
export const keep = (
  pending: string,
  destination: string,
  since: number,
  failed: boolean
): string | undefined => {
  const ids = reportsSince(pending, since)
  if (ids.length === 0) return undefined
  let kept = false
  let total = 0
  const omitted: Array<string> = []
  try {
    if (failed) {
      fs.mkdirSync(destination, { recursive: true })
      for (const id of ids) {
        fs.copyFileSync(path.join(pending, `${id}.extra`), path.join(destination, `${id}.extra`))
        kept = true
        for (const name of fs.readdirSync(pending)) {
          if (!name.startsWith(id) || name.endsWith(".extra")) continue
          const size = fs.statSync(path.join(pending, name)).size
          if (size > maxDumpBytes || total + size > maxTotalBytes) {
            omitted.push(`${name} (${size} bytes)`)
            continue
          }
          fs.copyFileSync(path.join(pending, name), path.join(destination, name))
          total += size
        }
      }
      if (omitted.length > 0) {
        fs.writeFileSync(
          path.join(destination, "omitted.txt"),
          `Not kept, over ${maxDumpBytes} bytes each or ${maxTotalBytes} together:\n${omitted.join("\n")}\n`
        )
      }
    }
  } finally {
    for (const name of fs.readdirSync(pending)) {
      if (ids.some((id) => name.startsWith(id))) fs.rmSync(path.join(pending, name), { force: true })
    }
  }
  return kept ? destination : undefined
}
