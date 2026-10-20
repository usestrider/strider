import * as path from "node:path"
import { defineConfig } from "vitest/config"

const src = (subpath: string) => path.join(import.meta.dirname, "packages/browser/src", subpath)

export default defineConfig({
  resolve: {
    // Tests read the package's source, as Effect's tests do.
    alias: [
      { find: /^@usestrider\/browser$/, replacement: src("index.ts") },
      {
        find: /^@usestrider\/browser\/(ai|bidi|cdp|chromium|cli|firefox|protocol|test|test\/vitest|webkit)$/,
        replacement: src("$1/index.ts")
      },
      { find: /^@usestrider\/browser\/(.+)$/, replacement: src("$1.ts") }
    ]
  },
  test: {
    projects: [{
      extends: true,
      test: {
        name: "browser",
        root: "packages/browser",
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
