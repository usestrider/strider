/**
 * The pinned Firefox writes the crash report of a content process that dies, where the harness looks for it
 * (`firefoxCrashReports.ts`), on the platform running the tests.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as FirefoxLauncher from "../../../src/internal/firefoxLauncher.ts"
import * as Ledger from "../../../src/Ledger.ts"
import { firefox } from "../browsers.ts"
import * as FirefoxCrashReports from "../firefoxCrashReports.ts"

interface Row {
  readonly pid: number
  readonly ppid: number
  readonly args: string
}

/** Every process, from `/proc` on Linux, where the integration environment has no `ps`, and from `ps` elsewhere. */
const processes = (): ReadonlyArray<Row> => {
  if (process.platform !== "linux") {
    return execFileSync("ps", ["-A", "-o", "pid=,ppid=,args="], { encoding: "utf8" }).split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
      .filter((match) => match !== null)
      .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), args: match[3]! }))
  }
  return fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name)).flatMap((name) => {
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8")
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
      const args = fs.readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").join(" ")
      return [{ pid: Number(name), ppid, args }]
    } catch {
      return []
    }
  })
}

/** The command lines of a process's descendants, by pid. */
const descendants = (root: number): Map<number, string> => {
  const rows = processes()
  const found = new Map<number, string>()
  const parents = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const row of rows) {
      if (parents.has(row.ppid) && !parents.has(row.pid)) {
        parents.add(row.pid)
        found.set(row.pid, row.args)
        grew = true
      }
    }
  }
  return found
}

const listing = (directory: string): string =>
  fs.existsSync(directory) ? fs.readdirSync(directory).join(", ") : "absent"

/** The id of a report in `directory` whose `.extra` is whole: JSON with its `ProcessType`. */
const complete = (directory: string): string | undefined => {
  let names: Array<string>
  try {
    names = fs.readdirSync(directory)
  } catch {
    return undefined
  }
  return names.filter((name) => name.endsWith(".extra")).find((name) => {
    try {
      return typeof JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")).ProcessType === "string"
    } catch {
      return false
    }
  })?.slice(0, -".extra".length)
}

const services = Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)

layer(services, { excludeTestServices: true })((it) => {
  it.effect(
    "writes the crash report of a content process that aborts where the harness keeps it from",
    () =>
      Effect.gen(function*() {
        const outbox = FirefoxCrashReports.outbox
        const started = Date.now()
        // The launch's ledger item names its profile; the wrapped ledger moves its reports once it exits
        const items: Array<Ledger.Item> = []
        const ledger = FirefoxCrashReports.wrap({
          add: (item) => Effect.sync(() => void items.push(item)),
          remove: () => Effect.void
        })
        const written = yield* Effect.scoped(Effect.gen(function*() {
          const { launched } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
          const profile = items.find(FirefoxCrashReports.isFirefox)?.profile
          assert.isDefined(profile, "the launch recorded no Firefox")
          const minidumps = path.join(profile!, "minidumps")
          // A web content process: Firefox's own binary with `-contentproc` on Linux, which may start it through
          // a fork server, and `plugin-container` on macOS; `-isForBrowser` marks it on both
          let processes = new Map<number, string>()
          let tab: number | undefined
          for (let attempt = 0; attempt < 100 && tab === undefined; attempt++) {
            processes = descendants(Number(launched.handle.pid))
            tab = [...processes].find(([, args]) => args.includes("-isForBrowser"))?.[0]
            if (tab === undefined) yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
          }
          assert.isDefined(
            tab,
            `Firefox started no web content process; its descendants: ${
              [...processes].map(([pid, args]) => `${pid} ${args}`).join("; ") || "none"
            }`
          )
          // An abort, which Firefox's exception handler reports as a crash of that process, in the profile. The
          // running Firefox still owns the files, so they're only read until one is complete
          process.kill(tab!, "SIGABRT")
          let id: string | undefined
          for (let attempt = 0; attempt < 100 && id === undefined; attempt++) {
            yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
            id = complete(minidumps)
          }
          assert.isDefined(id, `no complete report in ${minidumps} (it holds: ${listing(minidumps)})`)
          return id!
        })).pipe(Effect.provideService(Ledger.CurrentLedger, ledger))
        // The browser has exited and its profile is gone: the report waits in the outbox
        assert.include(
          FirefoxCrashReports.reportsSince(outbox, started),
          written,
          `the outbox holds: ${listing(outbox)}`
        )
        assert.property(JSON.parse(fs.readFileSync(path.join(outbox, `${written}.extra`), "utf8")), "ProcessType")
        // A failed test keeps the report beside its trace, and a passing one discards it
        const destination = fs.mkdtempSync(path.join(os.tmpdir(), "strider-kept-"))
        try {
          assert.strictEqual(FirefoxCrashReports.keep(outbox, destination, started, true), destination)
          assert.isTrue(fs.existsSync(path.join(destination, `${written}.extra`)))
          assert.deepStrictEqual(FirefoxCrashReports.reportsSince(outbox, started), [])
        } finally {
          fs.rmSync(destination, { recursive: true, force: true })
        }
      }),
    60_000
  )
})
