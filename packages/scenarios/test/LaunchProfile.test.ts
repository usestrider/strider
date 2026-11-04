import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(import.meta.dirname, "../../..")
const directory = path.join(root, "packages/scenarios/benchmark")

// Launches real browsers, so it runs only in the integration environment, holding the browser lock.
describe.runIf(process.env["STRIDER_ENVIRONMENT"] === "nix-integration")("launch diagnostics", () => {
  it.each(["/internal/chromiumLauncher.ts", "/chromium/Chromium.ts", "/internal/cdpAdapter.ts"])(
    "doesn't report a run as completed when the loader's rule for %s never applied",
    (suffix) => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "launch-profile-"))
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
            "1"
          ],
          { cwd: root, encoding: "utf8", timeout: 60_000 }
        )
        expect(JSON.parse(fs.readFileSync(output, "utf8")).status).toBe("error")
        expect(result.status).not.toBe(0)
      } finally {
        fs.rmSync(scratch, { recursive: true, force: true })
      }
    },
    90_000
  )
})
