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
 * Nothing is shown or submitted: `MOZ_CRASHREPORTER_NO_REPORT=1` keeps a parent-process crash from launching the
 * crash reporter client (`ShouldReport` in `toolkit/crashreporter/nsExceptionHandler.cpp`), and
 * `browser.tabs.crashReporting.sendReport` false leaves the tab-crashed page's send box unticked. With
 * `MOZ_CRASHREPORTER_NO_REPORT` set, Firefox keeps every report in the profile's `minidumps/`, and no setting moves
 * it, so the harness moves them out before the profile is deleted: `install` wraps the ledger every launch records
 * its browser in (`Ledger.CurrentLedger`), and when a browser is forgotten, after it exits and before its temporary
 * profile is removed, its reports move to `outbox`. `sweep` moves those of browsers still running, such as a
 * suite's shared Firefox, at the end of each test. A launch given a ledger of its own isn't followed.
 *
 * After each test the runner (`failureTraceRunner.ts`) sweeps, then `keep` copies what the outbox holds to
 * `.data/integration-failures/<test file>-<test id>-<pid>-firefox-crash/` when the test failed, and empties it either
 * way, so a passing test keeps nothing.
 */
import * as Effect from "effect/Effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
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

/** The profiles of the browsers running now, which `sweep` moves reports out of. */
const live = new Set<string>()

/** Moves the files of `<profile>/minidumps/` into `into`; a file that vanishes or can't be moved stays or is skipped. */
export const collect = (profile: string, into: string = outbox): void => {
  const minidumps = path.join(profile, "minidumps")
  let names: Array<string>
  try {
    names = fs.readdirSync(minidumps)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.endsWith(".extra") && !name.endsWith(".dmp")) continue
    try {
      fs.mkdirSync(into, { recursive: true })
      fs.copyFileSync(path.join(minidumps, name), path.join(into, name))
      fs.rmSync(path.join(minidumps, name), { force: true })
    } catch {
      // Gone, or not movable: Firefox may still be finalizing it, and a later sweep takes it
    }
  }
}

/** The profiles of the browsers running now. */
export const liveProfiles = (): ReadonlyArray<string> => [...live]

/** Moves the reports of every browser still running into `outbox`. */
export const sweep = (): void => {
  for (const profile of live) collect(profile)
}

/** Follows every launch made under the default ledger, moving its browser's reports out before the profile goes. */
export const install = (): void => {
  const ledger = Effect.runSync(Effect.gen(function*() {
    return yield* Ledger.CurrentLedger
  })) as { add: Ledger.Ledger["add"]; remove: Ledger.Ledger["remove"] }
  const { add, remove } = ledger
  ledger.add = (item) =>
    Effect.suspend(() => {
      if (item._tag === "Browser") live.add(item.profile)
      return add(item)
    })
  ledger.remove = (item) =>
    Effect.suspend(() => {
      if (item._tag === "Browser") {
        collect(item.profile)
        live.delete(item.profile)
      }
      return remove(item)
    })
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
