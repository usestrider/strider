import { assert, describe, it } from "@effect/vitest"
import { integrationConfig, integrationJobs, readIntegrationJob } from "../../../vitest.integration.config.ts"

describe("Linux integration jobs", () => {
  it("accepts only the four explicit jobs or an unset selection", () => {
    for (const job of integrationJobs) assert.strictEqual(readIntegrationJob(job), job)
    assert.strictEqual(readIntegrationJob(undefined), undefined)
    assert.strictEqual(readIntegrationJob(""), undefined)
    for (const invalid of ["all", "toString", "CHROMIUM", "unknown"]) {
      assert.throws(() => readIntegrationJob(invalid), /STRIDER_INTEGRATION_JOB/)
    }
  })

  it("gives every command and job a distinct artifact directory and keeps files serial", () => {
    const directories = new Set<string>()
    for (const group of ["default", "heavy", "full"] as const) {
      for (const job of [...integrationJobs, undefined]) {
        const config = integrationConfig(group, job)
        assert.strictEqual(config.test.fileParallelism, false)
        const reporters = config.test.reporters
        assert.strictEqual(reporters[0], "default")
        const reporter = reporters[1]
        assert(Array.isArray(reporter))
        const options = reporter[1]
        assert(options !== undefined && typeof options === "object")
        assert.deepStrictEqual(options, {
          directory: `.data/integration-timings/${group}/${job ?? "all"}`,
          group,
          job: job ?? "all"
        })
        directories.add(options.directory)
        assert.include(config.test.runner, "failureTraceRunner.ts")
      }
    }
    assert.strictEqual(directories.size, 15)
  })

  it("keeps upstream cases only in the unselected and other jobs, whose exclusions cover each browser glob", () => {
    const other = integrationConfig("full", "other").test.projects
    const all = integrationConfig("full").test.projects
    assert.strictEqual(other.length, 2)
    assert.strictEqual(all.length, 2)
    assert.deepStrictEqual(other[1], all[1])
    const otherProject = other[0]
    assert(otherProject !== undefined && "exclude" in otherProject.test)
    for (const job of ["chromium", "firefox", "webkit"] as const) {
      const projects = integrationConfig("full", job).test.projects
      assert.strictEqual(projects.length, 1)
      const project = projects[0]
      assert(project !== undefined)
      assert.include(otherProject.test.exclude, project.test.include[0])
    }
  })
})
