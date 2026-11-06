import { AsyncLocalStorage } from "node:async_hooks"
import { type TaskMeta, test as vitestTest } from "vitest"

declare module "vitest" {
  interface TaskMeta {
    upstreamBrowserMs?: number
  }
}

const current = new AsyncLocalStorage<TaskMeta>()
const samples = Number(process.env["STRIDER_UPSTREAM_SAMPLES"] ?? "1")
if (!Number.isInteger(samples) || samples < 1 || samples > 20) {
  throw new Error("STRIDER_UPSTREAM_SAMPLES must be an integer between 1 and 20.")
}

// A benchmark has one discarded warmup per library and alternates which library goes first.
export const runs = Array.from({ length: samples + (samples > 1 ? 1 : 0) }, (_, index) => {
  const sample = samples === 1 ? 1 : index
  const libraries = index % 2 === 0 ? ["playwright", "strider"] as const : ["strider", "playwright"] as const
  return libraries.map((library) => ({ library, sample }))
}).flat()

export const test = (name: string, run: () => Promise<void>) =>
  vitestTest(name, async ({ task }) => current.run(task.meta, run))

/** Record a workflow's elapsed time, including when it fails. */
export const startTiming = () => {
  const meta = current.getStore()
  const started = performance.now()
  return () => {
    if (meta !== undefined) meta.upstreamBrowserMs = performance.now() - started
  }
}
