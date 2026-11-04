/** The hosted policy is exercised with shell stubs and temporary files, never sysctl writes. */
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
  if [[ "\${POLICY_FAIL_RESTORE:-}" == true && "$4" == *9223372036854775808* ]]; then return 24; fi
  if [[ "\${POLICY_SKIP_APPLY:-}" == true && "$4" != *9223372036854775808* ]]; then return 0; fi
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

describe("hosted core policy", () => {
  for (const [event, code] of [["schedule", 0], ["workflow_dispatch", 7]] as const) {
    it(`changes only the limit argument, restores the original and preserves exit ${code} for ${event}`, () => {
      const f = fixture()
      try {
        const result = spawnSync("bash", [
          script,
          "--",
          process.execPath,
          "-e",
          `process.exit(${code})`
        ], { env: { ...f.env, GITHUB_EVENT_NAME: event }, encoding: "utf8" })
        assert.strictEqual(result.status, code, result.stderr)
        assert.strictEqual(f.writes(), treatment + "\n" + original + "\n")
        assert.strictEqual(f.pattern(), original + "\n")
        assert.include(result.stdout, "applied=" + treatment)
      } finally {
        rmSync(f.path, { recursive: true })
      }
    })
  }

  it("restores even when the treatment write reports failure after changing the value", () => {
    const f = fixture()
    try {
      const result = spawnSync("bash", [script, "--", process.execPath, "-e", "process.exit(0)"], {
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
        const result = spawnSync("bash", [script, "--", process.execPath, "-e", "process.exit(0)"], {
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

  for (const code of [0, 7]) {
    it(`reports restoration failure and preserves a prior command failure: ${code}`, () => {
      const f = fixture()
      try {
        const result = spawnSync("bash", [script, "--", process.execPath, "-e", `process.exit(${code})`], {
          env: { ...f.env, POLICY_FAIL_RESTORE: "true" },
          encoding: "utf8"
        })
        assert.strictEqual(result.status, code === 0 ? 1 : code)
        assert.include(result.stderr, "ERROR: original core_pattern could not be restored")
        assert.include(result.stderr, "ERROR: restored core_pattern does not match original")
      } finally {
        rmSync(f.path, { recursive: true })
      }
    })
  }

  it("refuses to run the command when the applied pattern fails verification", () => {
    const f = fixture()
    try {
      const result = spawnSync("bash", [script, "--", process.execPath, "-e", "console.log('COMMAND RAN')"], {
        env: { ...f.env, POLICY_SKIP_APPLY: "true" },
        encoding: "utf8"
      })
      assert.strictEqual(result.status, 1)
      assert.include(result.stderr, "Policy verification failed")
      assert.notInclude(result.stdout, "COMMAND RAN")
      assert.strictEqual(f.pattern(), original + "\n")
    } finally {
      rmSync(f.path, { recursive: true })
    }
  })

  for (
    const override of [
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { RUNNER_OS: "Windows" },
      { GITHUB_EVENT_NAME: "push" }
    ]
  ) {
    it(`refuses an unsupported runner or event: ${JSON.stringify(override)}`, () => {
      const f = fixture()
      try {
        const result = spawnSync("bash", [script, "--", process.execPath, "-e", "process.exit(0)"], {
          env: { ...f.env, ...override },
          encoding: "utf8"
        })
        assert.strictEqual(result.status, 2)
        assert.strictEqual(f.writes(), "")
      } finally {
        rmSync(f.path, { recursive: true })
      }
    })
  }

  it("restores the original when the wrapper receives SIGTERM", async () => {
    const f = fixture()
    const child = spawn("bash", [
      script,
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
