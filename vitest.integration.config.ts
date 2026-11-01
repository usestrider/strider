/**
 * The browser integration tests, which run only in the Nix environment that fixes the machine they see
 * (`flake.nix`, `devShells.integration`): `pnpm test:integration` enters it and runs this configuration.
 */
import * as path from "node:path"
import { defineConfig } from "vitest/config"
import { resolve } from "./vitest.config.ts"
import { upstreamTest } from "./vitest.upstream.config.ts"

export default defineConfig({
  resolve,
  test: {
    projects: [{
      extends: true,
      test: {
        name: "integration",
        root: "packages/browser",
        include: ["test/integration/**/*.test.ts"],
        setupFiles: [
          path.join(import.meta.dirname, "vitest.setup.ts"),
          path.join(import.meta.dirname, "packages/browser/test/integration/environment.ts")
        ]
      }
    }, {
      extends: true,
      test: {
        ...upstreamTest,
        // The diagnostic suites have known failures, tracked on Rookery; run them with test:upstream.
        include: ["test/upstream/Astro.test.ts", "test/upstream/Vite.test.ts"]
      }
    }]
  }
})
