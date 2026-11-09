/** Non-gating Linux budget report from an exact GitHub run attempt and its timing artifacts. */
import { execFileSync } from "node:child_process"
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const jobs = ["chromium", "firefox", "webkit", "other"] as const
interface Run {
  id: number
  run_attempt: number
  head_sha: string
}
interface Job {
  id: number
  name: string
  run_id: number
  run_attempt: number
  head_sha: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
}
interface Artifact {
  id: number
  name: string
  expired: boolean
  created_at: string
  workflow_run: { id: number; head_sha: string }
}
interface Snapshot {
  selection: { group: string; job: string }
  startedAt: string
  updatedAt: string
  reason: string
  plannedFiles: number
  collectedFiles: number
  completedFiles: number
  failedFiles: number
  unknownCaseFiles: number
  unhandledErrors: number
  counts: { failed: number; pending: number }
  summedFileExecutionMs: number
  files: Array<{ project: string; file: string; executionMs: number | null; errors: Array<string> }>
}
export interface Evidence {
  run: Run
  jobs: Array<Job>
  artifacts: Array<Artifact>
  snapshots: Record<string, Snapshot | undefined>
  errors?: Record<string, string>
}
const time = (value: string | null) => value === null ? NaN : Date.parse(value)
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0
const comparison = (seconds: number, goal: number) => seconds <= goal ? "under goal" : "over goal"

export function renderBudget(evidence: Evidence): string {
  const { run } = evidence
  const lines = [
    "## Linux integration operating goals",
    "",
    `Run ${run.id}, attempt ${run.run_attempt}, commit \`${run.head_sha}\`. Informational only; no hard gate.`,
    "",
    "| Linux job | GitHub elapsed s / 1200 s | File execution s | Evidence |",
    "| --- | ---: | ---: | --- |"
  ]
  let aggregate = 0
  let complete = true
  const files = new Set<string>()
  for (const name of jobs) {
    const issues: Array<string> = []
    const matches = evidence.jobs.filter((j) => j.name === `integration (${name})`)
    const job = matches.length === 1 ? matches[0] : undefined
    if (!job) issues.push("missing or duplicate job")
    const identity = job && job.run_id === run.id && job.run_attempt === run.run_attempt &&
      job.head_sha === run.head_sha
    if (job && !identity) issues.push("job/run-attempt identity mismatch")
    const start = time(job?.started_at ?? null)
    const end = time(job?.completed_at ?? null)
    const elapsed = identity && job?.status === "completed" && finite(end - start) ? (end - start) / 1000 : null
    if (elapsed === null) issues.push("missing/partial elapsed evidence")
    if (job && job.conclusion !== "success") issues.push(`job ${job.conclusion ?? job.status}`)
    const artifacts = evidence.artifacts.filter((a) =>
      a.name === `integration-log-${name}` && a.workflow_run.id === run.id &&
      a.workflow_run.head_sha === run.head_sha && time(a.created_at) >= start && time(a.created_at) <= end
    )
    const artifact = artifacts.length === 1 ? artifacts[0] : undefined
    if (!artifact || artifact.expired) issues.push("missing/expired/ambiguous artifact for this job attempt")
    const snapshot = evidence.snapshots[String(artifact?.id)]
    let execution: number | null = null
    if (!snapshot) issues.push(evidence.errors?.[String(artifact?.id)] ?? "missing timing snapshot")
    else {
      if (snapshot.selection?.group !== "full" || snapshot.selection?.job !== name) {
        issues.push("snapshot selection mismatch")
      }
      if (
        !(time(snapshot.startedAt) >= start && time(snapshot.updatedAt) <= end &&
          time(snapshot.updatedAt) >= time(snapshot.startedAt))
      ) {
        issues.push("snapshot outside job attempt")
      }
      if (snapshot.reason !== "passed") issues.push(`snapshot ${snapshot.reason ?? "unknown"}`)
      if (
        !(snapshot.plannedFiles > 0 && snapshot.collectedFiles === snapshot.plannedFiles &&
          snapshot.completedFiles === snapshot.plannedFiles)
      ) {
        issues.push("partial file evidence")
      }
      if (
        snapshot.failedFiles !== 0 || snapshot.unknownCaseFiles !== 0 || snapshot.unhandledErrors !== 0 ||
        snapshot.counts?.failed !== 0 || snapshot.counts?.pending !== 0
      ) issues.push("failed/unknown/pending evidence")
      if (
        !Array.isArray(snapshot.files) || snapshot.files.length !== snapshot.plannedFiles ||
        snapshot.files.some((f) => !finite(f.executionMs) || !Array.isArray(f.errors) || f.errors.length > 0)
      ) issues.push("missing/failed file durations")
      else {
        const sum = snapshot.files.reduce((n, f) => n + f.executionMs!, 0)
        if (!finite(snapshot.summedFileExecutionMs) || Math.abs(sum - snapshot.summedFileExecutionMs) > 0.001) {
          issues.push("file sum mismatch")
        } else execution = sum / 1000
        for (const file of snapshot.files) {
          const key = JSON.stringify([file.project, file.file])
          if (files.has(key)) issues.push("duplicate file across snapshots")
          files.add(key)
        }
      }
    }
    if (issues.length) complete = false
    else aggregate += execution!
    const elapsedText = elapsed === null
      ? "unavailable"
      : `${elapsed.toFixed(3)} (${issues.length ? "comparison unavailable" : comparison(elapsed, 1200)})`
    lines.push(
      `| ${name}${identity ? ` (job ${job.id})` : ""} | ${elapsedText} | ${execution?.toFixed(3) ?? "unavailable"} | ${
        issues.join("; ") || "complete, passed"
      } |`
    )
  }
  lines.push(
    "",
    complete
      ? `Aggregate file execution: **${aggregate.toFixed(3)} s / 3300 s (${comparison(aggregate, 3300)})**.`
      : "Aggregate file execution: **unavailable — missing, partial, failed or mismatched evidence; no under-goal conclusion**.",
    "",
    "Elapsed time is GitHub job start to completion, including setup, tests and upload, excluding pre-start queueing. File execution includes hooks; it is summed across all four full selections. These layers overlap and must not be added. macOS is separate.",
    ""
  )
  return lines.join("\n")
}

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"))
export async function main(archive?: string) {
  let evidence: Evidence
  if (archive) {
    const artifacts = json(join(archive, "artifacts.json")).artifacts as Array<Artifact>
    evidence = {
      run: json(join(archive, "run-api.json")),
      jobs: json(join(archive, "jobs-api.json")).jobs,
      artifacts,
      snapshots: Object.fromEntries(jobs.map((name) => [
        artifacts.find((a) => a.name === `integration-log-${name}`)!.id,
        json(join(archive, "jobs", name, "artifact", ".data/integration-timings/full", name, "timings.json"))
      ]))
    }
  } else {
    const repo = process.env.GITHUB_REPOSITORY!
    const id = process.env.GITHUB_RUN_ID!
    const attempt = process.env.GITHUB_RUN_ATTEMPT!
    const api = (endpoint: string) => JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }))
    const pages = (endpoint: string, key: string) =>
      (JSON.parse(
        execFileSync("gh", ["api", `${endpoint}?per_page=100`, "--paginate", "--slurp"], { encoding: "utf8" })
      ) as Array<Record<string, Array<never>>>).flatMap((p) => p[key]!)
    evidence = {
      run: api(`repos/${repo}/actions/runs/${id}/attempts/${attempt}`),
      jobs: pages(`repos/${repo}/actions/runs/${id}/attempts/${attempt}/jobs`, "jobs"),
      artifacts: pages(`repos/${repo}/actions/runs/${id}/artifacts`, "artifacts"),
      snapshots: {},
      errors: {}
    }
    const dir = mkdtempSync(join(tmpdir(), "integration-budget-"))
    try {
      for (
        const a of evidence.artifacts.filter((a) => jobs.some((j) => a.name === `integration-log-${j}`) && !a.expired)
      ) {
        try {
          const zip = join(dir, `${a.id}.zip`)
          writeFileSync(
            zip,
            execFileSync("gh", ["api", `repos/${repo}/actions/artifacts/${a.id}/zip`], { maxBuffer: 64 * 1024 * 1024 })
          )
          const name = a.name.slice("integration-log-".length)
          evidence.snapshots[String(a.id)] = JSON.parse(
            execFileSync("unzip", ["-p", zip, `.data/integration-timings/full/${name}/timings.json`], {
              encoding: "utf8",
              maxBuffer: 16 * 1024 * 1024
            })
          )
        } catch {
          evidence.errors![String(a.id)] = "artifact download or timing parse failed"
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const report = renderBudget(evidence)
  console.log(report)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error) => {
    const report = `## Linux integration operating goals\n\nBudget evidence unavailable: ${
      String(error).replaceAll(/[^a-zA-Z0-9 .:_/-]/g, " ")
    }\n\nNo budget conclusion; informational only.\n`
    console.log(report)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
  })
}
