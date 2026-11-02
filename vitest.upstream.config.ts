import * as path from "node:path"
import { defineConfig } from "vitest/config"
import { resolve } from "./vitest.config.ts"

export const upstreamTest = {
  name: "upstream",
  root: "packages/scenarios",
  include: ["test/upstream/**/*.test.ts"],
  testTimeout: 60000,
  // Astro disables its HTTP middleware under VITEST and HMR under NODE_ENV=test.
  env: {
    VITEST: "",
    NODE_ENV: "development",
    ASTRO_TELEMETRY_DISABLED: "1",
    ASTRO_DISABLE_UPDATE_CHECK: "true"
  },
  setupFiles: [
    path.join(import.meta.dirname, "vitest.setup.ts"),
    path.join(import.meta.dirname, "packages/browser/test/integration/environment.ts")
  ]
}

export default defineConfig({
  resolve,
  test: {
    reporters: ["default", "./packages/scenarios/test/upstream/reporter.ts"],
    projects: [{ extends: true, test: upstreamTest }]
  }
})
