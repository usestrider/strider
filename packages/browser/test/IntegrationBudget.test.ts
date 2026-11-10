import { assert, describe, it } from "@effect/vitest"
import { type Evidence, jobs, renderBudget } from "../../../scripts/integration-budget.ts"

const fixture = (): Evidence => ({
  run: { id: 42, run_attempt: 2, head_sha: "abc" },
  jobs: jobs.map((name, i) => ({
    id: i + 1,
    name: `integration (${name})`,
    run_id: 42,
    run_attempt: 2,
    head_sha: "abc",
    status: "completed",
    conclusion: "success",
    started_at: "2026-11-08T00:00:00Z",
    completed_at: "2026-11-08T00:16:40Z"
  })),
  artifacts: jobs.map((name, i) => ({
    id: i + 1,
    name: `integration-log-${name}`,
    expired: false,
    created_at: "2026-11-08T00:16:39Z",
    workflow_run: { id: 42, head_sha: "abc" }
  })),
  snapshots: Object.fromEntries(jobs.map((name, i) => [i + 1, {
    selection: { group: "full", job: name },
    startedAt: "2026-11-08T00:00:20Z",
    updatedAt: "2026-11-08T00:16:30Z",
    reason: "passed",
    plannedFiles: 1,
    collectedFiles: 1,
    completedFiles: 1,
    failedFiles: 0,
    unknownCaseFiles: 0,
    unhandledErrors: 0,
    counts: { failed: 0, pending: 0 },
    summedFileExecutionMs: 750000,
    files: [{ project: "integration", file: `${name}.test.ts`, executionMs: 750000, errors: [] }]
  }]))
})

describe("Linux integration budget summary", () => {
  it("compares actual complete GitHub job elapsed and aggregate file execution separately", () => {
    const report = renderBudget(fixture())
    assert.include(report, "1000.000 (under goal)")
    assert.include(report, "3000.000 s / 3300 s (under goal)")
    assert.include(report, "attempt 2")
    const evidence = fixture()
    evidence.jobs[0]!.completed_at = "2026-11-08T00:21:00Z"
    evidence.snapshots["1"]!.files[0]!.executionMs = 1100000
    evidence.snapshots["1"]!.summedFileExecutionMs = 1100000
    const over = renderBudget(evidence)
    assert.include(over, "1260.000 (over goal)")
    assert.include(over, "3350.000 s / 3300 s (over goal)")
  })

  it("refuses missing, duplicate and wrong run/attempt/commit jobs", () => {
    for (
      const mutate of [
        (e: Evidence) => {
          e.jobs.pop()
        },
        (e: Evidence) => {
          e.jobs.push({ ...e.jobs[0]! })
        },
        (e: Evidence) => {
          e.jobs[0]!.run_id = 43
        },
        (e: Evidence) => {
          e.jobs[0]!.run_attempt = 1
        },
        (e: Evidence) => {
          e.jobs[0]!.head_sha = "other"
        }
      ]
    ) {
      const e = fixture()
      mutate(e)
      assert.include(renderBudget(e), "Aggregate file execution: **unavailable")
    }
  })

  it("rejects stale or ambiguous artifacts, wrong selections and snapshots outside the job attempt", () => {
    for (
      const mutate of [
        (e: Evidence) => {
          e.artifacts[0]!.created_at = "2026-11-07T00:00:00Z"
        },
        (e: Evidence) => {
          e.artifacts[0]!.workflow_run.id = 1
        },
        (e: Evidence) => {
          e.artifacts[0]!.workflow_run.head_sha = "old"
        },
        (e: Evidence) => {
          e.artifacts[0]!.expired = true
        },
        (e: Evidence) => {
          e.artifacts.push({ ...e.artifacts[0]! })
        },
        (e: Evidence) => {
          e.snapshots["1"]!.selection.group = "default"
        },
        (e: Evidence) => {
          e.snapshots["1"]!.selection.job = "other"
        },
        (e: Evidence) => {
          e.snapshots["1"]!.startedAt = "2026-11-07T00:00:00Z"
        }
      ]
    ) {
      const e = fixture()
      mutate(e)
      assert.include(renderBudget(e), "Aggregate file execution: **unavailable")
    }
  })

  it("labels failed and partial evidence without an under-goal verdict for that job or the aggregate", () => {
    for (
      const mutate of [
        (e: Evidence) => {
          delete e.snapshots["1"]
        },
        (e: Evidence) => {
          e.jobs[0]!.conclusion = "failure"
        },
        (e: Evidence) => {
          e.jobs[0]!.completed_at = null
        },
        (e: Evidence) => {
          e.snapshots["1"]!.reason = "running"
        },
        (e: Evidence) => {
          e.snapshots["1"]!.completedFiles = 0
        },
        (e: Evidence) => {
          e.snapshots["1"]!.failedFiles = 1
        },
        (e: Evidence) => {
          e.snapshots["1"]!.unknownCaseFiles = 1
        },
        (e: Evidence) => {
          e.snapshots["1"]!.counts.pending = 1
        },
        (e: Evidence) => {
          e.snapshots["1"]!.unhandledErrors = 1
        },
        (e: Evidence) => {
          e.snapshots["1"]!.files[0]!.executionMs = null
        },
        (e: Evidence) => {
          e.snapshots["1"]!.summedFileExecutionMs = 0
        }
      ]
    ) {
      const e = fixture()
      mutate(e)
      const report = renderBudget(e)
      assert.include(report, "Aggregate file execution: **unavailable")
      assert.notInclude(report.split("\n").find((line) => line.startsWith("| chromium"))!, "under goal")
    }
  })

  it("does not double count a file repeated across jobs", () => {
    const e = fixture()
    e.snapshots["2"]!.files[0]!.file = "chromium.test.ts"
    assert.include(renderBudget(e), "duplicate file across snapshots")
    assert.include(renderBudget(e), "Aggregate file execution: **unavailable")
  })
})
