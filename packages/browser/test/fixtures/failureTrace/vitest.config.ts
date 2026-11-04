import * as path from "node:path"
import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: [path.join(import.meta.dirname, "*.fixture.ts")],
    runner: path.join(import.meta.dirname, "../../integration/failureTraceRunner.ts")
  }
})
