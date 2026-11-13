/**
 * The pinned Firefox writes the crash report of a content process that dies, where the harness looks for it
 * (`firefoxCrashReports.ts`), on the platform running the tests.
 */
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeSocket from "@effect/platform-node/NodeSocket"
import { assert, layer } from "@effect/vitest"
import { Browser } from "@usestrider/browser"
import { Firefox } from "@usestrider/browser/firefox"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assertPinned, firefox } from "./browsers.ts"
import * as FirefoxCrashReports from "./firefoxCrashReports.ts"

const walk = (dir: string, depth: number): Array<string> => {
  if (depth > 6) return []
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return /Crash Reports|minidumps|\.extra$|\.dmp$/.test(entry.name) ? [full] : entry.isDirectory() ? walk(full, depth + 1) : []
    })
  } catch {
    return []
  }
}

const backend = Firefox.layer({ executablePath: firefox.executable }).pipe(
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeSocket.layerWebSocketConstructor))
)

layer(backend, { excludeTestServices: true })((it) => {
  it.effect(
    "writes a crash report with its annotations for a content process that crashes",
    () =>
      Effect.gen(function*() {
        const browser = yield* Browser.Browser
        assertPinned("Firefox", browser.info.version, firefox.version)
        const pending = FirefoxCrashReports.pendingDirectory()
        const started = Date.now()
        const page = yield* Browser.newPage()
        const navigation = yield* page.goto("about:crashcontent").pipe(Effect.exit)
        let ids: ReadonlyArray<string> = []
        for (let attempt = 0; attempt < 100 && ids.length === 0; attempt++) {
          yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)))
          ids = FirefoxCrashReports.reportsSince(pending, started)
        }
        assert.isAbove(
          ids.length,
          0,
          `no .extra in ${pending}; goto ${JSON.stringify(navigation)}; found ${walk(os.tmpdir(), 0).join(" ")}`
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
