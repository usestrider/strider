/** Run independent direct BiDi trials against one already verified Firefox installation. */
import { spawnSync } from "node:child_process"
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const directory = path.resolve(".data/firefox-print/probe")
mkdirSync(directory, { recursive: true })
const results = []
for (let trial = 1; trial <= 20; trial++) {
  const log = path.join(directory, `trial-${String(trial).padStart(2, "0")}.log`)
  const fd = openSync(log, "w")
  let result
  try {
    result = spawnSync(process.execPath, [path.join(import.meta.dirname, "firefox-print-probe.mjs"), "--screenshot"], {
      env: { ...process.env, STRIDER_PRINT_TRIAL: String(trial) },
      stdio: ["ignore", fd, fd]
    })
  } finally {
    closeSync(fd)
  }
  const outcome = {
    trial,
    status: result.status === 0 && !result.error ? "pass" : "fail",
    exitCode: result.status,
    signal: result.signal,
    error: result.error?.message,
    log
  }
  results.push(outcome)
  console.log("Direct BiDi trial", JSON.stringify(outcome))
  writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n")
  // A cancelled child must not launch another trial.
  if (result.signal === "SIGINT" || result.signal === "SIGTERM") process.exit(1)
}
const passed = results.filter((result) => result.status === "pass").length
const summary = { path: "direct-bidi", total: results.length, passed, failed: results.length - passed }
console.log("Firefox print summary", JSON.stringify(summary))
writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
if (summary.failed > 0) process.exitCode = 1
