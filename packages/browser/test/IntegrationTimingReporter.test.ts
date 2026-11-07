import { afterEach, assert, describe, it } from "@effect/vitest"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { vi } from "vitest"
import type { TestCase, TestModule, TestSpecification } from "vitest/node"
import TimingReporter from "./integration/timingReporter.ts"

const directories: Array<string> = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

const fixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-timings-"))
  directories.push(directory)
  const output = vi.spyOn(console, "log").mockImplementation(() => {})
  let now = 100
  vi.spyOn(performance, "now").mockImplementation(() => now)
  const reporter = new TimingReporter({ directory })
  return {
    reporter,
    directory,
    output,
    advance: (ms: number) => {
      now += ms
    },
    read: () => JSON.parse(fs.readFileSync(path.join(directory, "timings.json"), "utf8")),
    events: () =>
      fs.readFileSync(path.join(directory, "events.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  }
}

const moduleFixture = (id: string, executionMs = 0) => {
  const cases: Array<TestCase> = []
  const specification = {
    taskId: id,
    moduleId: path.resolve(`${id}.test.ts`),
    project: { name: "integration" }
  } as TestSpecification
  let state = "pending"
  const module = {
    id,
    moduleId: specification.moduleId,
    project: specification.project,
    state: () => state,
    diagnostic: () => ({ duration: executionMs }),
    errors: () => [],
    children: { allTests: () => cases.values(), allSuites: () => [].values() }
  } as unknown as TestModule
  return {
    module,
    specification,
    state: (value: string) => {
      state = value
    },
    test: (name: string, outcome: "passed" | "failed" | "skipped" | "pending", durationMs?: number) => {
      const test = {
        id: `${id}-${cases.length}`,
        module,
        fullName: `suite > ${name}`,
        tags: [],
        result: () => ({ state: outcome }),
        diagnostic: () => durationMs === undefined ? undefined : { duration: durationMs, retryCount: 0, repeatCount: 0 }
      } as unknown as TestCase
      cases.push(test)
      return test
    }
  }
}

describe("Linux integration timing reporter", () => {
  it("aggregates all outcomes and file execution separately from wall time, and ranks slow cases and files", () => {
    const f = fixture()
    const fast = moduleFixture("fast", 600)
    const slow = moduleFixture("slow", 1100)
    fast.test("quick", "passed", 100)
    fast.test("filtered", "skipped")
    slow.test("slow failure", "failed", 900)
    slow.test("not reached", "pending")
    f.reporter.onTestRunStart([fast.specification, slow.specification])
    for (const m of [fast, slow]) {
      f.reporter.onTestModuleCollected(m.module)
      f.reporter.onTestModuleEnd(m.module)
    }
    fast.state("passed")
    slow.state("failed")
    f.advance(2500)
    f.reporter.onTestRunEnd([fast.module, slow.module], [new Error("worker failed")], "failed")
    const report = f.read()
    assert.strictEqual(report.reason, "failed")
    assert.strictEqual(report.wallMs, 2500)
    assert.strictEqual(report.summedFileExecutionMs, 1700)
    assert.strictEqual(report.knownCases, 4)
    assert.deepStrictEqual(report.counts, { passed: 1, failed: 1, skipped: 1, pending: 1 })
    assert.strictEqual(report.unhandledErrors, 1)
    assert.strictEqual(report.completedFiles, 2)
    assert.strictEqual(report.files[0].tests[1].durationMs, null)
    assert.strictEqual(report.files[1].tests[1].durationMs, null)
    const printed = f.output.mock.calls.flat().join("\n")
    assert.isBelow(printed.indexOf("1.100 s"), printed.indexOf("0.600 s"))
    assert.isBelow(printed.indexOf("0.900 s"), printed.indexOf("0.100 s"))
    assert.strictEqual(f.events().at(-1).reason, "failed")
  })

  it("writes complete successful runs without duplicating file-end callbacks", () => {
    const f = fixture()
    const m = moduleFixture("success", 123)
    const test = m.test("done", "passed", 100)
    m.state("passed")
    f.reporter.onTestRunStart([m.specification])
    f.reporter.onTestModuleCollected(m.module)
    f.reporter.onTestCaseResult(test)
    f.reporter.onTestModuleEnd(m.module)
    f.reporter.onTestModuleEnd(m.module)
    f.reporter.onTestRunEnd([m.module], [], "passed")
    const report = f.read()
    assert.strictEqual(report.reason, "passed")
    assert.strictEqual(report.knownCases, 1)
    assert.strictEqual(report.counts.passed, 1)
    assert.strictEqual(report.summedFileExecutionMs, 123)
    assert.strictEqual(report.files[0].tests[0].retryCount, 0)
  })

  it("reports disjoint default and heavy case costs without assigning shared file overhead to either group", () => {
    const f = fixture()
    const m = moduleFixture("groups", 1000)
    m.test("ordinary", "passed", 100)
    const heavy = m.test("upload", "passed", 400)
    Object.assign(heavy, { tags: ["heavy"] })
    f.reporter.onTestRunStart([m.specification])
    f.reporter.onTestModuleCollected(m.module)
    f.reporter.onTestModuleEnd(m.module)
    f.reporter.onTestRunEnd([m.module], [], "passed")
    const r = f.read()
    assert.strictEqual(r.groups.default.counts.passed, 1)
    assert.strictEqual(r.groups.heavy.counts.passed, 1)
    assert.strictEqual(r.groups.default.measuredCaseMs, 100)
    assert.strictEqual(r.groups.heavy.measuredCaseMs, 400)
    assert.strictEqual(r.summedFileExecutionMs, 1000)
    assert.include(f.output.mock.calls.flat().join("\n"), "heavy cases:")
  })

  it("retains a collection failure with no cases and does not invent counts for an uncollected file", () => {
    const f = fixture()
    const broken = moduleFixture("broken", 0)
    const unknown = moduleFixture("unknown")
    broken.state("failed")
    Object.assign(broken.module, { errors: () => [{ message: "collection failed" }] })
    f.reporter.onTestRunStart([broken.specification, unknown.specification])
    f.reporter.onTestModuleCollected(broken.module)
    f.reporter.onTestModuleEnd(broken.module)
    f.reporter.onTestRunEnd([broken.module], [], "failed")
    const report = f.read()
    assert.strictEqual(report.plannedFiles, 2)
    assert.strictEqual(report.collectedFiles, 0)
    assert.strictEqual(report.completedFiles, 1)
    assert.strictEqual(report.knownCases, 0)
    assert.strictEqual(report.files[0].outcome, "failed")
    assert.strictEqual(report.files[0].collectionStatus, "failed")
    assert.strictEqual(report.files[0].caseCount, null)
    assert.strictEqual(report.files[0].executionMs, null)
    assert.strictEqual(report.unknownCaseFiles, 2)
    assert.strictEqual(report.files[1].outcome, "not-collected")
    assert.strictEqual(report.files[1].executionMs, null)
  })

  it("records why a file failed when it has no failed case, as when collection or a shared fixture fails", () => {
    // Vitest reports a file that throws while collecting as failed with no cases, and the cases under a
    // failed beforeAll (where a shared browser fixture is acquired) as skipped: the file's errors are the
    // only record of the failure.
    const f = fixture()
    const broken = moduleFixture("broken", 0)
    const fixtureFailed = moduleFixture("fixture", 40)
    broken.state("failed")
    fixtureFailed.state("failed")
    const withErrors = (module: TestModule, message: string) =>
      Object.assign(module, { errors: () => [{ name: "Error", message }] })
    withErrors(broken.module, "boom at collection")
    fixtureFailed.test("one", "skipped")
    f.reporter.onTestRunStart([broken.specification, fixtureFailed.specification])
    f.reporter.onTestModuleCollected(broken.module)
    f.reporter.onTestModuleCollected(fixtureFailed.module)
    withErrors(fixtureFailed.module, "browser did not launch")
    f.reporter.onTestModuleEnd(broken.module)
    f.reporter.onTestModuleEnd(fixtureFailed.module)
    f.reporter.onTestRunEnd([broken.module, fixtureFailed.module], [], "failed")
    const report = f.read()
    assert.strictEqual(report.counts.failed, 0)
    assert.strictEqual(report.failedFiles, 2)
    assert.strictEqual(report.files[1].collected, true)
    assert.strictEqual(report.files[1].caseCount, 1)
    assert.strictEqual(report.counts.skipped, 1)
    const printed = f.output.mock.calls.flat().join("\n")
    assert.include(printed, "failed files: 2")
    assert.include(printed, "boom at collection")
    assert.include(printed, "browser did not launch")
    assert.deepStrictEqual(report.files.map((file: { errors?: Array<string> }) => file.errors), [
      ["boom at collection"],
      ["browser did not launch"]
    ])
  })

  it("reports real Vitest collection and nested shared-layer failures without changing skipped case outcomes", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strider-timing-probe-"))
    directories.push(directory)
    const root = fileURLToPath(new URL("../../../", import.meta.url))
    const config = path.join(directory, "vitest.config.mjs")
    fs.writeFileSync(
      config,
      `export default {
      root: ${JSON.stringify(root)},
      test: {
        include: ["packages/browser/test/fixtures/timings/*.fixture.ts"],
        fileParallelism: false,
        reporters: ["default", [${
        JSON.stringify(fileURLToPath(new URL("./integration/timingReporter.ts", import.meta.url)))
      },
          { directory: ${JSON.stringify(directory)} }]]
      }
    }`
    )
    const cli = fileURLToPath(new URL("./vitest.mjs", import.meta.resolve("vitest/package.json")))
    const result = spawnSync(process.execPath, [cli, "--run", "--config", config], {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000
    })
    assert.strictEqual(result.status, 1, result.stderr + result.stdout)
    const report = JSON.parse(fs.readFileSync(path.join(directory, "timings.json"), "utf8"))
    assert.strictEqual(report.failedFiles, 2)
    assert.strictEqual(report.collectedFiles, 1)
    assert.strictEqual(report.unknownCaseFiles, 1)
    assert.deepStrictEqual(report.counts, { passed: 0, failed: 0, skipped: 1, pending: 0 })
    const collection = report.files.find((file: { file: string }) => file.file.endsWith("collection.fixture.ts"))
    const shared = report.files.find((file: { file: string }) => file.file.endsWith("shared.fixture.ts"))
    assert.strictEqual(collection.collected, false)
    assert.strictEqual(collection.collectionStatus, "failed")
    assert.strictEqual(collection.caseCount, null)
    assert.strictEqual(collection.executionMs, null)
    assert.include(collection.errors.join("\n"), "timing probe collection failed")
    assert.strictEqual(shared.collected, true)
    assert.strictEqual(shared.caseCount, 1)
    assert.include(shared.errors.join("\n"), "timing probe shared fixture failed")
    assert.include(result.stdout, "failed files: 2")
    assert.include(result.stdout, "timing probe collection failed")
    assert.include(result.stdout, "timing probe shared fixture failed")
  }, 30_000)

  it("keeps a gracefully interrupted file incomplete and preserves received case timings", () => {
    const f = fixture()
    const m = moduleFixture("partial", 9999)
    const test = m.test("finished", "passed", 25)
    m.test("still pending", "pending")
    f.reporter.onTestRunStart([m.specification])
    f.reporter.onTestModuleCollected(m.module)
    f.reporter.onTestCaseResult(test)
    f.advance(50)
    f.reporter.onTestRunEnd([m.module], [], "interrupted")
    const report = f.read()
    assert.strictEqual(report.reason, "interrupted")
    assert.strictEqual(report.completedFiles, 0)
    assert.strictEqual(report.summedFileExecutionMs, 0)
    assert.strictEqual(report.files[0].executionMs, null)
    assert.deepStrictEqual(report.counts, { passed: 1, failed: 0, skipped: 0, pending: 1 })
    assert.strictEqual(f.events().find((event) => event.event === "case").test.durationMs, 25)
  })

  it("leaves incremental results and an unfinished snapshot when no run-end callback arrives", () => {
    const f = fixture()
    const m = moduleFixture("killed")
    const test = m.test("last received", "failed", 10)
    f.reporter.onTestRunStart([m.specification])
    f.reporter.onTestModuleCollected(m.module)
    f.reporter.onTestCaseResult(test)
    const events = f.events()
    assert.strictEqual(f.read().reason, "running")
    assert.strictEqual(events.at(-1).event, "case")
    assert.strictEqual(events.at(-1).test.outcome, "failed")
    assert.strictEqual(events.find((event) => event.event === "collected").file.tests.length, 1)
    assert.isFalse(events.some((event) => event.event === "end"))
    // A subsequent invocation replaces the old artifacts instead of mixing runs.
    f.reporter.onTestRunStart([])
    f.reporter.onTestRunEnd([], [], "passed")
    assert.strictEqual(f.read().knownCases, 0)
    assert.strictEqual(f.events().length, 2)
    assert.strictEqual(f.read().reason, "passed")
  })
})
