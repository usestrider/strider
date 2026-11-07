import { defineConfig } from "vitest/config"
import { resolve } from "../../../../vitest.config.ts"
export default defineConfig({
  resolve,
  test: {
    include: ["packages/vitest/test/fixtures/failure.fixture.ts"],
    setupFiles: ["vitest.setup.ts"],
    attachmentsDir: `${process.env["STRIDER_VITEST_TRACES"]}/attachments`,
    testTimeout: 60_000
  }
})
