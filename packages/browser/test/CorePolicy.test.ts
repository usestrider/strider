/** The hosted policy comparison is exercised with shell stubs and temporary files, never sysctl writes. */
import { assert, describe, it } from "@effect/vitest"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const original = "|/usr/lib/systemd/systemd-coredump %P %u %g %s %t 9223372036854775808 %h %d"
const treatment = "|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %h %d"
const script = resolve(import.meta.dirname, "../../../scripts/integration-core-policy.sh")
const fixture = (pattern = original, hosted = true) => {
  const path = mkdtempSync(join(tmpdir(), "core-policy-test-"))
  writeFileSync(join(path, "pattern"), pattern + "\n")
  writeFileSync(join(path, "writes"), "")
  const prelude = join(path, "prelude.sh")
  writeFileSync(
    prelude,
    `
cat() { if [[ "$1" == /proc/sys/kernel/core_pattern ]]; then command cat "$POLICY_FIXTURE/pattern"; else command cat "$@"; fi; }
systemd() { echo 'systemd fixture-version'; }
sudo() {
  [[ $# == 4 && "$1" == -n && "$2" == sysctl && "$3" == --write ]] || return 99
  printf '%s\\n' "\${4#kernel.core_pattern=}" >> "$POLICY_FIXTURE/writes"
  printf '%s\\n' "\${4#kernel.core_pattern=}" > "$POLICY_FIXTURE/pattern"
  if [[ "\${POLICY_FAIL_APPLY:-}" == true && "$4" == *9223372036854775808* ]]; then return 0; fi
  if [[ "\${POLICY_FAIL_APPLY:-}" == true ]]; then return 23; fi
}
`
  )
  const env = {
    ...process.env,
    BASH_ENV: prelude,
    POLICY_FIXTURE: path,
    GITHUB_ACTIONS: hosted ? "true" : "false",
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    GITHUB_EVENT_NAME: "workflow_dispatch"
  }
  return {
    path,
    env,
    pattern: () => readFileSync(join(path, "pattern"), "utf8"),
    writes: () => readFileSync(join(path, "writes"), "utf8")
  }
}

describe("hosted core-policy comparison", () => {
  it("control leaves any existing pattern unchanged and records version and before/after", () => {
    const f = fixture("unrelated pattern", false)
    try {
      const result = spawnSync("bash", [script, "control", "--", process.execPath, "-e", "process.exit(0)"], {
        env: f.env,
        encoding: "utf8"
      })
      assert.strictEqual(result.status, 0, result.stderr)
      assert.strictEqual(f.writes(), "")
      assert.strictEqual(f.pattern(), "unrelated pattern\n")
      assert.include(result.stdout, "systemd fixture-version")
      assert.include(result.stdout, "before=unrelated pattern")
      assert.include(result.stdout, "restored=unrelated pattern")
    } finally {
      rmSync(f.path, { recursive: true })
    }
  })

  for (const code of [0, 7]) {
    it(`changes only the limit argument, restores the original and preserves exit ${code}`, () => {
      const f = fixture()
      try {
        const result = spawnSync("bash", [
          script,
          "respect-limit",
          "--",
          process.execPath,
          "-e",
          `process.exit(${code})`
        ], { env: f.env, encoding: "utf8" })
        assert.strictEqual(result.status, code, result.stderr)
        assert.strictEqual(f.writes(), treatment + "\n" + original + "\n")
        assert.strictEqual(f.pattern(), original + "\n")
        assert.include(result.stdout, "treatment=" + treatment)
      } finally {
        rmSync(f.path, { recursive: true })
      }
    })
  }

  it("restores even when the treatment write reports failure after changing the value", () => {
    const f = fixture()
    try {
      const result = spawnSync("bash", [script, "respect-limit", "--", process.execPath, "-e", "process.exit(0)"], {
        env: { ...f.env, POLICY_FAIL_APPLY: "true" },
        encoding: "utf8"
      })
      assert.strictEqual(result.status, 23, result.stderr)
      assert.strictEqual(f.pattern(), original + "\n")
      assert.strictEqual(f.writes(), treatment + "\n" + original + "\n")
    } finally {
      rmSync(f.path, { recursive: true })
    }
  })

  for (const [pattern, hosted] of [["unexpected pattern", true], [original, false]] as const) {
    it(`refuses treatment for pattern=${pattern}, hosted=${hosted}`, () => {
      const f = fixture(pattern, hosted)
      try {
        const result = spawnSync("bash", [script, "respect-limit", "--", process.execPath, "-e", "process.exit(0)"], {
          env: f.env,
          encoding: "utf8"
        })
        assert.strictEqual(result.status, 2)
        assert.strictEqual(f.writes(), "")
        assert.strictEqual(f.pattern(), pattern + "\n")
      } finally {
        rmSync(f.path, { recursive: true })
      }
    })
  }

  it("restores the original when the wrapper receives SIGTERM", async () => {
    const f = fixture()
    const child = spawn("bash", [
      script,
      "respect-limit",
      "--",
      process.execPath,
      "-e",
      "console.log('ready'); setInterval(() => {}, 1000)"
    ], { env: f.env })
    try {
      let output = ""
      await new Promise<void>((resolve, reject) => {
        child.on("error", reject)
        child.stdout.on("data", (chunk) => {
          output += String(chunk)
          if (output.includes("ready")) resolve()
        })
        child.on("exit", () => reject(new Error("wrapper exited before command was ready")))
      })
      const exited = once(child, "exit")
      child.kill("SIGTERM")
      const [code] = await exited
      assert.strictEqual(code, 143)
      assert.strictEqual(f.pattern(), original + "\n")
    } finally {
      child.kill("SIGKILL")
      rmSync(f.path, { recursive: true })
    }
  })
})
