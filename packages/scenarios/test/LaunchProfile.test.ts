import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../..")
const directory = path.join(root, "packages/scenarios/benchmark")

// Hosted diagnostics retain both rejected reports and child output alongside the successful profile.
const scratchDirectory = (prefix: string) => {
  const retained = process.env["STRIDER_LAUNCH_TEST_OUTPUT"]
  if (retained !== undefined) fs.mkdirSync(retained, { recursive: true })
  return fs.mkdtempSync(path.join(retained ?? os.tmpdir(), prefix))
}
const cleanup = (scratch: string) => {
  if (process.env["STRIDER_LAUNCH_TEST_OUTPUT"] === undefined) fs.rmSync(scratch, { recursive: true, force: true })
}
const retainOutput = (scratch: string, result: { stdout: string; stderr: string }) => {
  fs.writeFileSync(path.join(scratch, "stdout.log"), result.stdout ?? "")
  fs.writeFileSync(path.join(scratch, "stderr.log"), result.stderr ?? "")
}

// Launches real browsers, so it runs only in the integration environment, holding the browser lock.
describe.runIf(process.env["STRIDER_ENVIRONMENT"] === "nix-integration")("launch diagnostics", () => {
  it.each(["default", "persistent", "native"])("retains a complete successful report (%s)", (mode) => {
    const scratch = scratchDirectory("launch-profile-success-")
    try {
      const output = path.join(scratch, "report.json")
      const result = spawnSync(process.execPath, [
        "--import",
        path.join(directory, "launch-profile-hooks.mjs"),
        path.join(directory, "launch-profile.ts"),
        output,
        "1",
        ...(mode === "persistent" ? [mode] : [])
      ], {
        cwd: root,
        env: { ...process.env, STRIDER_LAUNCH_NATIVE: mode === "native" ? "1" : "0" },
        encoding: "utf8",
        timeout: 60_000
      })
      retainOutput(scratch, result)
      expect(result.status, result.stderr).toBe(0)
      const report = JSON.parse(fs.readFileSync(output, "utf8"))
      expect(report.status).toBe("completed")
      expect(report.error).toBeNull()
      expect(report.samples).toHaveLength(8)
      expect(report.samples.filter((sample: { index: number }) => sample.index >= 0)).toHaveLength(2)
      for (const sample of report.samples) {
        if (mode === "native") {
          expect(sample.native.status).toBe("complete")
          expect(sample.native.calibration).toHaveLength(3)
          expect(sample.native.uncertaintyMs).toBeLessThanOrEqual(sample.native.beforeCalibrationUncertaintyMs)
          expect(sample.native.uncertaintyMs).toBeGreaterThanOrEqual(0)
          expect(JSON.parse(fs.readFileSync(sample.native.file, "utf8")).traceEvents.length).toBeGreaterThan(0)
          if (sample.library === "strider") {
            expect(sample.events.some((event: { name: string }) => event.name === "diagnostic.initialPage.alive")).toBe(
              true
            )
          }
        }
        expect(sample.ms).toBeGreaterThan(0)
        expect(sample.events.some((event: { name: string }) => event.name === "launch.available")).toBe(true)
        expect(sample.events.some((event: { kind: string }) => event.kind === "wire")).toBe(true)
      }
    } finally {
      cleanup(scratch)
    }
  }, 90_000)
  it("retains a complete report for a launch with no initial page", () => {
    const scratch = scratchDirectory("launch-profile-no-window-")
    try {
      const hooks = fs.readFileSync(path.join(directory, "launch-profile-hooks.mjs"), "utf8")
      const rule = "  [\"/internal/chromiumLauncher.ts\", ["
      expect(hooks).toContain(rule)
      // Launch as `--no-startup-window` does: the launcher's last argument is the flag, not `about:blank`.
      const swap = JSON.stringify(["  \"about:blank\"\n]", "  \"--no-startup-window\"\n]"])
      fs.writeFileSync(path.join(scratch, "hooks.mjs"), hooks.replace(rule, `${rule}\n    ${swap},`))
      const output = path.join(scratch, "report.json")
      const result = spawnSync(
        process.execPath,
        ["--import", path.join(scratch, "hooks.mjs"), path.join(directory, "launch-profile.ts"), output, "1"],
        { cwd: root, env: { ...process.env, STRIDER_LAUNCH_NATIVE: "0" }, encoding: "utf8", timeout: 60_000 }
      )
      retainOutput(scratch, result)
      expect(result.status, result.stderr).toBe(0)
      const report = JSON.parse(fs.readFileSync(output, "utf8"))
      expect(report.status).toBe("completed")
      const strider = report.samples.filter((sample: { library: string }) => sample.library === "strider")
      expect(strider.length).toBeGreaterThan(0)
      for (const sample of strider) {
        const spawned = sample.events.find((event: { name: string }) => event.name === "spawn.args")
        expect(spawned.data.args).toContain("--no-startup-window")
        expect(spawned.data.args).not.toContain("about:blank")
        expect(sample.resources.visiblePages).toBe(0)
        expect(sample.events.some((event: { name: string }) => event.name === "target.gate.end")).toBe(false)
      }
    } finally {
      cleanup(scratch)
    }
  }, 90_000)
  it.each(
    ["/internal/chromiumLauncher.ts", "/chromium/Chromium.ts", "/internal/cdpAdapter.ts"].flatMap((suffix) =>
      ["default", "persistent"].map((mode) => [suffix, mode] as const)
    )
  )(
    "doesn't report a run as completed when the loader's rule for %s never applied (%s)",
    (suffix, mode) => {
      const scratch = scratchDirectory("launch-profile-")
      try {
        const hooks = fs.readFileSync(path.join(directory, "launch-profile-hooks.mjs"), "utf8")
        expect(hooks).toContain(`"${suffix}"`)
        // What moving or renaming the module does: the rule matches nothing, and no site is reported missing.
        fs.writeFileSync(path.join(scratch, "hooks.mjs"), hooks.replace(`"${suffix}"`, `"${suffix}.moved"`))
        const output = path.join(scratch, "report.json")
        const result = spawnSync(
          process.execPath,
          [
            "--import",
            path.join(scratch, "hooks.mjs"),
            path.join(directory, "launch-profile.ts"),
            output,
            "1",
            ...(mode === "persistent" ? [mode] : [])
          ],
          { cwd: root, encoding: "utf8", timeout: 60_000 }
        )
        retainOutput(scratch, result)
        const report = JSON.parse(fs.readFileSync(output, "utf8"))
        expect(report.status).toBe("error")
        const cause = suffix === "/internal/chromiumLauncher.ts" ?
          "missing phase mark executable.start"
          : suffix === "/internal/cdpAdapter.ts" ?
          "missing phase mark adapter.start"
          : "missing protocol send Browser.getVersion"
        expect(report.error).toContain(cause)
        expect(result.status).not.toBe(0)
      } finally {
        cleanup(scratch)
      }
    },
    90_000
  )
  it.each(["default", "persistent"])("rejects missing Playwright wire instrumentation (%s)", (mode) => {
    const scratch = scratchDirectory("launch-profile-wire-")
    try {
      const hooks = fs.readFileSync(path.join(directory, "launch-profile-hooks.mjs"), "utf8")
      // Keep Playwright's phase marks while suppressing only its protocol observations.
      expect(hooks).toContain("globalThis.__launchTrace.wire(")
      fs.writeFileSync(
        path.join(scratch, "hooks.mjs"),
        hooks.replaceAll("globalThis.__launchTrace.wire(", "globalThis.__launchTrace.mark(")
      )
      const output = path.join(scratch, "report.json")
      const result = spawnSync(process.execPath, [
        "--import",
        path.join(scratch, "hooks.mjs"),
        path.join(directory, "launch-profile.ts"),
        output,
        "1",
        ...(mode === "persistent" ? [mode] : [])
      ], { cwd: root, encoding: "utf8", timeout: 60_000 })
      retainOutput(scratch, result)
      const report = JSON.parse(fs.readFileSync(output, "utf8"))
      expect(report.status).toBe("error")
      expect(report.error).toContain("missing protocol send Browser.getVersion")
      expect(result.status).not.toBe(0)
    } finally {
      cleanup(scratch)
    }
  }, 90_000)
  it("retains native evidence and disposes the browser when calibration has no native handlers", () => {
    const scratch = scratchDirectory("launch-profile-calibration-missing-")
    try {
      const hooks = fs.readFileSync(path.join(directory, "launch-profile-hooks.mjs"), "utf8")
      const original = "globalThis.__launchTrace.rootCommand = () => this.rootSession.send("
      expect(hooks).toContain(original)
      fs.writeFileSync(
        path.join(scratch, "hooks.mjs"),
        hooks.replace(original, "globalThis.__launchTrace.rootCommand = () => Promise.resolve(")
      )
      const output = path.join(scratch, "report.json")
      const result = spawnSync(process.execPath, [
        "--import",
        path.join(scratch, "hooks.mjs"),
        path.join(directory, "launch-profile.ts"),
        output,
        "1"
      ], {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, STRIDER_LAUNCH_NATIVE: "1" }
      })
      retainOutput(scratch, result)
      expect(result.status).not.toBe(0)
      const report = JSON.parse(fs.readFileSync(output, "utf8"))
      expect(report.status).toBe("error")
      expect(report.error).toContain("Missing calibration root")
      expect(report.samples).toHaveLength(1)
      const sample = report.samples[0]
      expect(sample.native.status).toBe("error")
      expect(JSON.parse(fs.readFileSync(sample.native.file, "utf8")).traceEvents.length).toBeGreaterThan(0)
      expect(sample.events.some((e: { name: string }) => e.name === "diagnostic.disposed")).toBe(true)
    } finally {
      cleanup(scratch)
    }
  }, 90_000)
})
