import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, expect, it } from "vitest"

const driver = path.resolve(import.meta.dirname, "../src/benchmarks/compare-bin.ts")
const repository = path.resolve(import.meta.dirname, "../../..")
const pins = ["pnpm-lock.yaml", "flake.lock", "flake.nix", "packages/browser/test/integration/browsers.json"]
const temporary: Array<string> = []
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

// A checkout holding the driver's own pins, with one file optionally replaced.
const checkout = (changed?: { file: string; text: string }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paired-ref-"))
  temporary.push(root)
  for (const file of pins) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.copyFileSync(path.join(repository, file), path.join(root, file))
  }
  for (const directory of ["packages/browser/src", "packages/scenarios/src"]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true })
    fs.writeFileSync(path.join(root, directory, "index.ts"), "export {}\n")
  }
  if (changed) fs.writeFileSync(path.join(root, changed.file), changed.text)
  return root
}

const compare = (base: string, head: string, env: NodeJS.ProcessEnv) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "paired-out-"))
  temporary.push(output)
  const result = spawnSync(
    process.execPath,
    [driver, "--base", base, "--head", head, "--output", output, "--runs", "4"],
    { encoding: "utf8", env, timeout: 60_000 }
  )
  const report = path.join(output, "comparison.json")
  return {
    result,
    started: fs.existsSync(path.join(output, "base", "worker.log")),
    report: fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, "utf8")) : undefined,
    summary: fs.existsSync(path.join(output, "summary.md"))
      ? fs.readFileSync(path.join(output, "summary.md"), "utf8")
      : undefined,
    driverPins: pins.every((file) => fs.existsSync(path.join(output, "driver", path.basename(file))))
  }
}

const browser = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paired-browser-")), "chromium")
  temporary.push(path.dirname(file))
  fs.writeFileSync(file, "")
  return { ...process.env, STRIDER_CHROMIUM: file }
}

it("rejects refs whose browser pins differ, not only flake.lock, before starting workers", () => {
  for (
    const changed of [
      { file: "flake.nix", text: "{ outputs = _: {}; }\n" },
      { file: "packages/browser/test/integration/browsers.json", text: "{}\n" }
    ]
  ) {
    const { result, started, report } = compare(checkout(), checkout(changed), browser())
    expect(started, changed.file).toBe(false)
    expect(result.status, changed.file).toBe(1)
    expect(report?.status).toBe("failed")
    expect(report?.provenance.driver.files[changed.file]).toBeDefined()
    expect(report?.error).toContain(`Environment pin mismatch: head ${changed.file} differs from driver`)
  }
})

it("rejects refs whose pins differ from the environment that supplies the browser", () => {
  // Both refs agree with each other, but not with the driver's Nix environment the workers run in.
  const changed = { file: "flake.lock", text: "{\"nodes\":{},\"root\":\"root\",\"version\":7}\n" }
  const { result, started, report } = compare(checkout(changed), checkout(changed), browser())
  expect(started).toBe(false)
  expect(result.status).toBe(1)
  expect(report?.error).toContain("Environment pin mismatch: base flake.lock differs from driver")
})

it("records a failed comparison, without starting workers, when the browser is not named", () => {
  const env = { ...process.env }
  delete env["STRIDER_CHROMIUM"]
  const { result, started, report } = compare(checkout(), checkout(), env)
  expect(started).toBe(false)
  expect(result.status).toBe(1)
  expect(report?.status).toBe("failed")
  expect(report?.error).toContain("STRIDER_CHROMIUM must name the pinned browser executable")
}, 70_000)

it("retains driver pins and a failed summary for an unreadable browser executable", () => {
  const env = { ...process.env, STRIDER_CHROMIUM: "/missing-paired-browser" }
  const { result, started, report, summary, driverPins } = compare(checkout(), checkout(), env)
  expect(result.status).toBe(1)
  expect(started).toBe(false)
  expect(report.status).toBe("failed")
  expect(report.error).toContain("ENOENT")
  expect(driverPins).toBe(true)
  expect(summary).toContain("No valid comparison")
  expect(summary).not.toContain("| Head/base")
})

it("rejects an executable with the wrong browser version before workers start", () => {
  const env = browser()
  fs.writeFileSync(env.STRIDER_CHROMIUM, "#!/bin/sh\necho Chromium 0.0.0.0\n", { mode: 0o755 })
  fs.chmodSync(env.STRIDER_CHROMIUM, 0o755)
  const { result, started, report } = compare(checkout(), checkout(), {
    ...env,
    STRIDER_ENVIRONMENT: "nix-integration"
  })
  expect(result.status).toBe(1)
  expect(started).toBe(false)
  expect(report.error).toContain("Browser version mismatch")
  expect(report.environment.browserHash).toMatch(/^[a-f0-9]{64}$/)
  expect(report.environment.browserVersion).toBe("Chromium 0.0.0.0")
})
