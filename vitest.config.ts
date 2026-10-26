import * as path from "node:path"
import { defineConfig } from "vitest/config"

const src = (subpath: string) => path.join(import.meta.dirname, "packages/browser/src", subpath)

/** Tests read the package's source, as Effect's tests do; the integration tests' configuration shares it. */
export const resolve = {
  alias: [
    { find: /^@usestrider\/browser$/, replacement: src("index.ts") },
    {
      find:
        /^@usestrider\/browser\/(ai|bidi|bidi-protocol|cdp|chromium|cli|firefox|protocol|test|webkit|webkit-automation-protocol|webkit-protocol|webkit-stock-protocol)$/,
      replacement: src("$1/index.ts")
    },
    { find: /^@usestrider\/browser\/(.+)$/, replacement: src("$1.ts") },
    { find: /^@usestrider\/vitest$/, replacement: path.join(import.meta.dirname, "packages/vitest/src/index.ts") }
  ]
}

export default defineConfig({
  resolve,
  test: {
    projects: [{
      extends: true,
      test: {
        name: "browser",
        root: "packages/browser",
        include: ["test/**/*.test.ts"],
        // The browser integration tests run in the Nix environment: vitest.integration.config.ts
        exclude: ["test/integration/**"],
        setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")]
      }
    }, {
      extends: true,
      test: {
        name: "vitest",
        root: "packages/vitest",
        include: ["test/**/*.test.ts"],
        setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")]
      }
    }, {
      extends: true,
      test: {
        name: "codegen",
        root: "packages/tools/codegen",
        include: ["test/**/*.test.ts"],
        setupFiles: [path.join(import.meta.dirname, "vitest.setup.ts")]
      }
    }]
  }
})
