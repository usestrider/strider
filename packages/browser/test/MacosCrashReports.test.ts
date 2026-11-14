import { it } from "@effect/vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

it("retains bounded native crash evidence and verifies deliberate-crash identity", () => {
  execFileSync(process.execPath, ["--test", "scripts/test/macos-crash-reports.test.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "pipe"
  })
})
