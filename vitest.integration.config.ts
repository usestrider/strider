/**
 * The browser integration tests, which run only in the Nix environment that fixes the machine they see
 * (`flake.nix`, `devShells.integration`): `pnpm test:integration` enters it and runs this configuration.
 *
 * `STRIDER_INTEGRATION_JOB` runs the files of one of CI's Linux jobs: `chromium`, `firefox` or `webkit`, the files
 * whose names start with or contain the browser's, or `other`, every file none of them names, with the upstream cases.
 */
import * as path from "node:path"
import { configDefaults, defineConfig, type ViteUserConfig } from "vitest/config"
import { failureTracePlugin } from "./packages/browser/test/integration/tracePlugin.ts"
import { resolve } from "./vitest.config.ts"
import { upstreamTest } from "./vitest.upstream.config.ts"

export const integrationJobs = ["chromium", "firefox", "webkit", "other"] as const
export type IntegrationJob = typeof integrationJobs[number]

export const readIntegrationJob = (value: string | undefined): IntegrationJob | undefined => {
  if (value === undefined || value === "") return undefined
  if (!integrationJobs.some((job) => job === value)) {
    throw new Error(`STRIDER_INTEGRATION_JOB is ${value}: use chromium, firefox, webkit or other`)
  }
  return value as IntegrationJob
}

const browserJobs = {
  chromium: "test/integration/**/Chromium*.test.ts",
  firefox: "test/integration/**/Firefox*.test.ts",
  webkit: "test/integration/**/*WebKit*.test.ts"
}

export const integrationConfig = (
  group: "default" | "heavy" | "full",
  job = readIntegrationJob(process.env.STRIDER_INTEGRATION_JOB)
) => {
  const integration = {
    name: "integration",
    root: "packages/browser",
    include: job === undefined || job === "other" ? ["test/integration/**/*.test.ts"] : [browserJobs[job]!],
    exclude: job === "other" ? [...configDefaults.exclude, ...Object.values(browserJobs)] : configDefaults.exclude,
    setupFiles: [
      path.join(import.meta.dirname, "vitest.setup.ts"),
      path.join(import.meta.dirname, "packages/browser/test/integration/environment.ts")
    ]
  }

  const upstream = {
    ...upstreamTest,
    // The diagnostic suites have known failures, tracked as issues; run them with test:upstream.
    include: ["test/upstream/Astro.test.ts", "test/upstream/Vite.test.ts"]
  }

  return {
    resolve,
    plugins: [failureTracePlugin()],
    test: {
      fileParallelism: false,
      tags: [{ name: "heavy", description: "Large local-file uploads (32, 256 and 600 MiB)" }],
      reporters: ["default", ["./packages/browser/test/integration/timingReporter.ts", {
        directory: `.data/integration-timings/${group}/${job ?? "all"}`,
        group,
        job: job ?? "all"
      }]],
      runner: path.join(import.meta.dirname, "packages/browser/test/integration/failureTraceRunner.ts"),
      projects: [
        { extends: true, test: integration },
        ...(job === undefined || job === "other" ? [{ extends: true, test: upstream }] : [])
      ]
    }
  } satisfies ViteUserConfig
}

export default defineConfig(integrationConfig("default"))
