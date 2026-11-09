import { it } from "@effect/vitest"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

it("generates clean-checkout packages and merges independent feature branches", () => {
  execFileSync(process.execPath, ["--test", "scripts/test/generated-outputs.test.mjs"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    stdio: "pipe"
  })
}, 120_000)
