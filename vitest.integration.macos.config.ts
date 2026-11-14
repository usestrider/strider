/** macOS covers Chromium and Firefox adapters and public API slices; WebKitGTK requires Linux. */
import * as path from "node:path"
import { defineConfig } from "vitest/config"
import { failureTracePlugin } from "./packages/browser/test/integration/tracePlugin.ts"
import { resolve } from "./vitest.config.ts"

export default defineConfig({
  resolve,
  plugins: [failureTracePlugin()],
  test: {
    runner: path.join(import.meta.dirname, "packages/browser/test/integration/failureTraceRunner.ts"),
    projects: [{
      extends: true,
      test: {
        name: "integration-macos",
        root: "packages/browser",
        include: ["test/integration/slice/ChromiumLaunchStress.test.ts"],
        exclude: ["test/integration/**/WebKit*.test.ts"],
        setupFiles: [
          path.join(import.meta.dirname, "vitest.setup.ts"),
          path.join(import.meta.dirname, "packages/browser/test/integration/environment.ts")
        ]
      }
    }]
  }
})
