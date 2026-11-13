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
import * as path from "node:path"
import * as FirefoxLauncher from "../../src/internal/firefoxLauncher.ts"
import { firefox } from "./browsers.ts"
import * as FirefoxCrashReports from "./firefoxCrashReports.ts"

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

const services = Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor)

layer(services, { excludeTestServices: true })((it) => {
  it.effect(
    "writes the crash report of a content process that aborts where the harness keeps it from",
    () =>
      Effect.gen(function*() {
        const pending = FirefoxCrashReports.pendingDirectory()
        const started = Date.now()
        const { launched } = yield* FirefoxLauncher.launch({ executablePath: firefox.executable })
        // A web content process, which Firefox may start through a fork server on Linux
        let tab: number | undefined
        for (let attempt = 0; attempt < 100 && tab === undefined; attempt++) {
          tab = [...descendants(Number(launched.handle.pid))]
            .find(([, args]) => args.includes("-contentproc") && args.includes("-isForBrowser"))?.[0]
          if (tab === undefined) yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
        }
        assert.isDefined(tab, "Firefox started no web content process")
        // An abort, which Firefox's exception handler reports as a crash of that process
        process.kill(tab!, "SIGABRT")
        let ids: ReadonlyArray<string> = []
        for (let attempt = 0; attempt < 100 && ids.length === 0; attempt++) {
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
          ids = FirefoxCrashReports.reportsSince(pending, started)
        }
        assert.isAbove(
          ids.length,
          0,
          `no report in ${pending} (it holds: ${listing(pending)}; its parent: ${listing(path.dirname(pending))})`
        )
        const extra = fs.readFileSync(path.join(pending, `${ids[0]}.extra`), "utf8")
        assert.include(extra, "ProcessType")
        // A failed test keeps the report beside its trace, and a passing one discards it
        const destination = fs.mkdtempSync(path.join(path.dirname(pending), "kept-"))
        try {
          assert.strictEqual(FirefoxCrashReports.keep(pending, destination, started, true), destination)
          assert.isTrue(fs.existsSync(path.join(destination, `${ids[0]}.extra`)))
          assert.deepStrictEqual(FirefoxCrashReports.reportsSince(pending, started), [])
        } finally {
          fs.rmSync(destination, { recursive: true, force: true })
        }
      }),
    60_000
  )
})
