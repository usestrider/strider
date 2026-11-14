/**
 * The compat harness's ports (`packages/compat`), in the integration tests' Nix environment: `pnpm compat` enters
 * it and runs this configuration. `STRIDER_COMPAT_BROWSERS` selects browsers, and `STRIDER_COMPAT_RUN` names the run,
 * whose results go to `.data/compat/runs/<run>/` (or `STRIDER_COMPAT_OUTPUT`).
 */
import * as path from "node:path"
import { defineConfig } from "vitest/config"
import { resolve } from "./vitest.config.ts"

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")
process.env["STRIDER_COMPAT_RUN"] ??= stamp

export default defineConfig({
  resolve,
  test: {
    name: "compat",
    root: "packages/compat",
    include: ["ports/**/*.test.ts"],
    // Timing-sensitive cases and five-second deadlines: one file at a time, as the integration suites run
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: { STRIDER_COMPAT_RUN: process.env["STRIDER_COMPAT_RUN"] },
    reporters: ["default", "./ports/harness/reporter.ts"],
    setupFiles: [
      path.join(import.meta.dirname, "vitest.setup.ts"),
      path.join(import.meta.dirname, "packages/browser/test/integration/environment.ts")
    ]
  }
})
