import * as path from "node:path"
import { defineConfig } from "vitest/config"
import { resolve } from "../../../../../vitest.config.ts"
import { failureTracePlugin } from "../../integration/tracePlugin.ts"
export default defineConfig({
  resolve,
  plugins: [failureTracePlugin()],
  test: {
    include: [path.join(import.meta.dirname, "*.fixture.ts")],
    runner: path.join(import.meta.dirname, "../../integration/failureTraceRunner.ts")
  }
})
