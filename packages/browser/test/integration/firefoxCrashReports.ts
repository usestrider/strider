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
 *
 * No crash reporter window opens and nothing is submitted: `MOZ_CRASHREPORTER_NO_REPORT=1` keeps a parent-process
 * crash from launching the crash reporter client (`ShouldReport` in `toolkit/crashreporter/nsExceptionHandler.cpp`),
 * and `browser.tabs.crashReporting.sendReport` false leaves the crashed tab's page with its send box unticked.
 * With `MOZ_CRASHREPORTER_NO_REPORT` set, Firefox keeps every report in the profile's `minidumps/`, and no setting
 * moves it. A running Firefox still owns those files, so the harness takes them only once it has exited: `wrap` (and
 * `install`, for the default ledger) hooks the ledger every launch records its browser in (`Ledger.CurrentLedger`),
 * and when a Firefox is forgotten, after it exits and before its temporary profile is removed, moves its reports to
 * `outbox`, a directory every copy of this module computes alike for the process.
 *
 * The runner (`failureTraceRunner.ts`) then keeps what the outbox holds:
 * - after a test that failed, the reports that arrived while it ran, such as those of a browser started for it, in
 *   `.data/integration-failures/<test file>-<test id>-<pid>-firefox-crash/`; a passing test takes nothing, since a
 *   shared browser recycled during it may bring an earlier failed test's reports;
 * - at the file's end, once its shared scope has closed, the rest, such as a browser shared by the file's tests, in
 *   `<test file>-<file id>-<pid>-shared-firefox-crash/` beside the shared trace when any test in the file failed,
 *   and deletes them when none did. A report's `.extra` records its crash time, which places it against the test
 *   traces' timestamps.
 * A collection that fails is logged and changes neither the test's result nor its trace. Firefox started by the
 * `strider` daemon in the CLI tests runs in another process, with its own ledger and preferences, and isn't covered.
 *
 * Only the Firefox adapter files opt in (`optIn`): `adapter/Firefox.adapter.test.ts`, `adapter/FirefoxSpecific.test.ts`
 * and `adapter/FirefoxCrashReportsWritten.test.ts`, each undoing it when it ends. Every other file, the slice suites
 * included, launches Firefox without crash reporting and keeps no crash reports.
 */
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { firefoxPrefs } from "../../src/internal/profiles.ts"
import * as Ledger from "../../src/Ledger.ts"

/** Turns Firefox's crash reporter on, with no client to show and nothing to submit. */
export const environment: Readonly<Record<string, string>> = {
  MOZ_CRASHREPORTER: "1",
  MOZ_CRASHREPORTER_NO_REPORT: "1"
}

/** The preference that makes `KillHard` write its report, and the tab-crashed page's send box unticked. */
export const prefs: Readonly<Record<string, boolean>> = {
  "dom.ipc.tabs.createKillHardCrashReports": true,
  "browser.tabs.crashReporting.sendReport": false
}

/** The largest minidump kept, in bytes; a larger one is named in `omitted.txt`. */
export const maxDumpBytes = 8 * 1024 * 1024

/** The most minidump bytes kept for one test. */
export const maxTotalBytes = 32 * 1024 * 1024

/** Where this test process gathers the reports moved out of its browsers' profiles. */
export const outbox = path.join(os.tmpdir(), `strider-firefox-crash-reports-${process.pid}`)

const logged = (what: string, file: string, error: unknown): void => {
  // A file Firefox removed while finalizing a report is expected; anything else is worth knowing
  if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return
  console.error(`Couldn't ${what} Firefox's crash report ${file}`, error)
}

/**
 * Moves the reports in `<profile>/minidumps/` into `into`. Run only once the browser has exited, since a running
 * Firefox still writes them. A file is removed only once its copy is made; a failure is logged and leaves it.
 */
export const collect = (profile: string, into: string = outbox): void => {
  const minidumps = path.join(profile, "minidumps")
  let names: Array<string>
  try {
    names = fs.readdirSync(minidumps)
  } catch (error) {
    logged("list", minidumps, error)
    return
  }
  for (const name of names) {
    if (!name.endsWith(".extra") && !name.endsWith(".dmp")) continue
    const file = path.join(minidumps, name)
    try {
      fs.mkdirSync(into, { recursive: true })
      fs.copyFileSync(file, path.join(into, name))
    } catch (error) {
      logged("copy", file, error)
      continue
    }
    try {
      fs.rmSync(file, { force: true })
    } catch (error) {
      logged("remove", file, error)
    }
  }
}

/** Whether a ledger item is a Firefox the tests launched: its executable is Firefox's own, on Linux and macOS. */
export const isFirefox = (item: Ledger.Item): item is Extract<Ledger.Item, { _tag: "Browser" }> =>
  item._tag === "Browser" && /^firefox/i.test(path.basename(item.executable))

/**
 * A ledger that does what `ledger` does and, when a Firefox is forgotten, after it exits and before its temporary
 * profile is removed, moves its reports to `outbox`. Other browsers and items are passed through untouched.
 */
export const wrap = (ledger: Ledger.Ledger): Ledger.Ledger => ({
  add: ledger.add,
  remove: (item) =>
    Effect.suspend(() => {
      if (isFirefox(item)) collect(item.profile)
      return ledger.remove(item)
    })
})

/** Wraps the default ledger in place, so every launch that isn't given a ledger of its own is followed. */
export const install = (): void => {
  const ledger = Effect.runSync(Effect.gen(function*() {
    return yield* Ledger.CurrentLedger
  })) as { add: Ledger.Ledger["add"]; remove: Ledger.Ledger["remove"] }
  const wrapped = wrap({ add: ledger.add, remove: ledger.remove })
  ledger.add = wrapped.add
  ledger.remove = wrapped.remove
}

/**
 * Turns crash reporting on for the Firefox a test file launches, and returns what turns it off again: the
 * environment, the preferences in every launch profile, and the default ledger's wrap, each restored as it was. A
 * Vitest worker runs several files in one process, so a file that opts in undoes it when it ends (`afterAll`), and
 * every other file launches Firefox as it would without this module.
 */
export const optIn = (): () => void => {
  const env = Object.fromEntries(Object.keys(environment).map((name) => [name, process.env[name]]))
  const profiles = Object.values(firefoxPrefs) as Array<Record<string, unknown>>
  const before = profiles.map((profile) => Object.fromEntries(Object.keys(prefs).map((name) => [name, profile[name]])))
  const ledger = Effect.runSync(Effect.gen(function*() {
    return yield* Ledger.CurrentLedger
  })) as { add: Ledger.Ledger["add"]; remove: Ledger.Ledger["remove"] }
  const { add, remove } = ledger
  Object.assign(process.env, environment)
  for (const profile of profiles) Object.assign(profile, prefs)
  install()
  return () => {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    profiles.forEach((profile, index) => {
      for (const [name, value] of Object.entries(before[index]!)) {
        if (value === undefined) delete profile[name]
        else profile[name] = value
      }
    })
    ledger.add = add
    ledger.remove = remove
  }
}

const mtime = (file: string): number | undefined => {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return undefined
  }
}

/** The ids of the reports in `directory` written at or after `since` (epoch milliseconds), oldest first. */
export const reportsSince = (directory: string, since: number): ReadonlyArray<string> => {
  let names: Array<string>
  try {
    names = fs.readdirSync(directory)
  } catch {
    return []
  }
  return names.filter((name) => name.endsWith(".extra"))
    .map((name) => ({ id: name.slice(0, -".extra".length), time: mtime(path.join(directory, name)) }))
    .filter((report): report is { id: string; time: number } => report.time !== undefined && report.time >= since)
    .sort((a, b) => a.time - b.time)
    .map((report) => report.id)
}

/**
 * What a test that failed keeps: the `.extra` of each report in `directory` written since `since`, and its minidumps
 * up to `maxDumpBytes` each and `maxTotalBytes` together, copied into `destination`, which is made only if there is
 * one. A test that passed (`failed` false) keeps nothing. A file is removed from `directory` only once it is copied,
 * or when the test passed, so a failed copy leaves the evidence where it was. Files that vanish are skipped; a
 * failure to make `destination` is thrown. Returns the destination, or `undefined` when nothing was kept.
 */
export const keep = (
  directory: string,
  destination: string,
  since: number,
  failed: boolean
): string | undefined => {
  const ids = reportsSince(directory, since)
  if (ids.length === 0) return undefined
  let names: Array<string>
  try {
    names = fs.readdirSync(directory)
  } catch {
    return undefined
  }
  const discard = (name: string) => fs.rmSync(path.join(directory, name), { force: true })
  const of = (id: string) => names.filter((name) => name.startsWith(id))
  if (!failed) {
    for (const id of ids) of(id).forEach(discard)
    return undefined
  }
  fs.mkdirSync(destination, { recursive: true })
  let kept = false
  let total = 0
  const omitted: Array<string> = []
  const copy = (name: string): boolean => {
    try {
      fs.copyFileSync(path.join(directory, name), path.join(destination, name))
      return true
    } catch {
      return false
    }
  }
  for (const id of ids) {
    if (!copy(`${id}.extra`)) continue
    kept = true
    discard(`${id}.extra`)
    for (const name of of(id)) {
      if (name.endsWith(".extra")) continue
      let size: number
      try {
        size = fs.statSync(path.join(directory, name)).size
      } catch {
        continue
      }
      if (size > maxDumpBytes || total + size > maxTotalBytes) {
        omitted.push(`${name} (${size} bytes)`)
        discard(name)
        continue
      }
      if (copy(name)) {
        total += size
        discard(name)
      }
    }
  }
  if (omitted.length > 0) {
    fs.writeFileSync(
      path.join(destination, "omitted.txt"),
      `Not kept, over ${maxDumpBytes} bytes each or ${maxTotalBytes} together:\n${omitted.join("\n")}\n`
    )
  }
  return kept ? destination : undefined
}
