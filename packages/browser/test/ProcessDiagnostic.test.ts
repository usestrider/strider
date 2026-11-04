/** Failure evidence must run before teardown and must not replace the test's failure. */
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { observeProcesses, snapshot } from "./integration/processDiagnostic.ts"

describe("crash process diagnostics", () => {
  for (const exit of [Exit.fail("original failure"), Exit.interrupt()] as const) {
    it.effect(`snapshots before teardown for ${String(exit)}`, () =>
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const order: Array<string> = []
        let alive = true
        const read = () =>
          Effect.sync(() => {
            assert.isTrue(alive)
            order.push("snapshot")
            return { processes: [{ pid: 123, startTime: "456" }] }
          })
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            alive = false
            order.push("browser teardown")
          })
        ).pipe(Scope.provide(scope))
        yield* observeProcesses(
          (source, value) => {
            if (source === "process snapshot") order.push((value as { phase: string }).phase)
          },
          123,
          "target",
          read
        ).pipe(Scope.provide(scope))
        yield* Scope.close(scope, exit)
        assert.deepStrictEqual(order, [
          "snapshot",
          "before Page.crash",
          "snapshot",
          "failure before browser teardown",
          "browser teardown"
        ])
      }))
  }

  it.effect("preserves the original defect when diagnostic collection fails", () =>
    Effect.gen(function*() {
      const original = new Error("original test failure")
      const notes: Array<string> = []
      const result = yield* Effect.scoped(Effect.gen(function*() {
        yield* observeProcesses((source) => notes.push(source), 123, "target", () => Effect.die("read denied"))
        return yield* Effect.die(original)
      })).pipe(Effect.exit)
      assert.deepStrictEqual(result, Exit.die(original))
      assert.deepStrictEqual(notes, ["process snapshot error", "process snapshot error"])
    }))

  it.effect("reads actual limits and reports disappeared processes without failing", () =>
    Effect.gen(function*() {
      const value = yield* snapshot(process.pid, [{ pid: 2147483647, startTime: "gone" }])
      const result = value as {
        processes: Array<
          {
            pid: number
            limits?: { text: string }
            notObservedInProcScan?: boolean
            pidReused?: boolean
            role?: string
            cmdline?: { text: string }
            relation?: string
          }
        >
      }
      for (const item of result.processes) {
        if (item.role === "Crashpad candidate" || item.relation === "unattributed crashpad candidate") {
          assert.match(item.cmdline!.text.split(" ")[0]!, /(?:^|\/)[^/ ]*crashpad_handler$/)
        }
      }
      assert.include(result.processes.find((item) => item.pid === process.pid)!.limits!.text, "Max core file size")
      assert.isTrue(result.processes.find((item) => item.pid === 2147483647)!.notObservedInProcScan)
      assert.notStrictEqual(result.processes.find((item) => item.pid === 2147483647)!.pidReused, true)
    }))
  it.effect("retains partial records and kill metadata when the collector is terminated", () =>
    Effect.gen(function*() {
      const directory = mkdtempSync(join(tmpdir(), "process-snapshot-test-"))
      const collector = join(directory, "blocked.mjs")
      writeFileSync(
        collector,
        `process.stdout.write(JSON.stringify({kind:"process",process:{pid:123,status:{text:"CoreDumping: 1"}}})+"\\n"); setInterval(()=>{},1000)`
      )
      try {
        const value = yield* snapshot(123, [], collector)
        const result = value as {
          partial: boolean
          exit: { signal: string; killed: boolean; code: number | null }
          processes: Array<{ pid: number; status: { text: string } }>
        }
        assert.isTrue(result.partial)
        assert.strictEqual(result.exit.signal, "SIGKILL")
        assert.isTrue(result.exit.killed)
        assert.deepStrictEqual(result.processes, [{ pid: 123, status: { text: "CoreDumping: 1" } }])
      } finally {
        rmSync(directory, { recursive: true })
      }
    }))

  it("emits known-PID core fields before broad scanning or cmdline reads", () => {
    const url = pathToFileURL(join(import.meta.dirname, "integration/processSnapshot.mjs")).href
    const code = `
      import {collectSnapshot} from ${JSON.stringify(url)};
      const records=[];
      const read=path=>{ if(path.endsWith('/cmdline')) throw Error('cmdline too early'); return {text:'fixture'}; };
      let error;
      try {collectSnapshot({root:123,previous:[{pid:456,startTime:'old',role:'renderer candidate'}],emit:r=>records.push(r),read,list:()=>{throw Error('stop at broad scan')}})} catch(e) {error=String(e)}
      console.log(JSON.stringify({records,error}));`
    const result = JSON.parse(
      execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" })
    ) as { records: Array<{ kind: string; process?: Record<string, any> }>; error: string }
    assert.include(result.error, "stop at broad scan")
    const known = result.records.filter((record) => record.process?.pid === 456).map((record) => record.process!)
    assert.isTrue(known.some((record) => record.status?.text === "fixture"))
    assert.isTrue(known.some((record) => record.limits?.text === "fixture"))
    assert.isTrue(known.some((record) => record.wchan?.text === "fixture"))
  })
})
