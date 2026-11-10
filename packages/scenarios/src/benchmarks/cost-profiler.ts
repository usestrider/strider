/** Node-only sampling recorder; no browser commands or runtime instrumentation. */
import * as fs from "node:fs"
import { Session } from "node:inspector/promises"
import * as path from "node:path"
import { performance, PerformanceObserver } from "node:perf_hooks"

export const recorder = async (name: string, output: string) => {
  const inspector = new Session()
  inspector.connect()
  await inspector.post("Profiler.enable")
  await inspector.post("Profiler.setSamplingInterval", { interval: 1000 })
  await inspector.post("HeapProfiler.enable")
  const gc: Array<{ start: number; duration: number; detail: unknown }> = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gc.push({ start: entry.startTime, duration: entry.duration, detail: entry.toJSON() })
    }
  })
  observer.observe({ entryTypes: ["gc"] })
  const phases: Array<{
    label: string
    start: number
    actionStart?: number
    actionEnd?: number
    end?: number
    complete: boolean
  }> = []
  let success = false
  const save = () =>
    fs.writeFileSync(
      path.join(output, "capture.json"),
      JSON.stringify(
        {
          kind: "instrumented-node-cost-profile",
          name,
          success,
          runs: 20,
          warmups: 3,
          requestSizes: "omitted",
          cpuSamplingMicroseconds: 1000,
          allocationSamplingBytes: 32768,
          collectedObjectsIncluded: true,
          phases,
          gc,
          node: process.version,
          execArgv: process.execArgv,
          limits:
            "Node process only. Samples are statistical; absent frames are not zero cost. CPU profiles include boundary bookkeeping; allocation profiles also include inspector start/stop allocations. In-process stopped profiles arrive as JavaScript objects in the measured heap; these objects and their serialization perturb that heap and subsequent GC, even when file writing is outside profile windows. This is a plausible mechanism for observed stop-window major GC, not an experimentally established cause. Simultaneous allocation sampling adds CPU overhead and may affect code generation. Each source/case is captured once in fixed order, confounding source with run position. Do not convert CPU sample counts into exact milliseconds or infer elapsed duration from counts; total and idle counts cannot establish an elapsed-time comparison between sources. GC entries use performance.now time coordinates and may be delivered later. Browser startup and every setup/cleanup/warmup have separate captures. Import/startup before inspector attachment is outside these profiles. No explicit forced-GC command, wall-time ratios or confidence intervals."
        },
        null,
        2
      )
    )
  const phase = async <A>(label: string, action: () => Promise<A>): Promise<A> => {
    const row: (typeof phases)[number] = { label, start: performance.now(), complete: false }
    phases.push(row)
    await inspector.post("HeapProfiler.startSampling", {
      samplingInterval: 32768,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    })
    await inspector.post("Profiler.start")
    try {
      row.actionStart = performance.now()
      return await action()
    } finally {
      row.actionEnd = performance.now()
      const cpu = await inspector.post("Profiler.stop")
      const heap = await inspector.post("HeapProfiler.stopSampling")
      row.end = performance.now()
      row.complete = true
      fs.writeFileSync(path.join(output, `${label}.cpuprofile`), JSON.stringify(cpu.profile))
      fs.writeFileSync(path.join(output, `${label}.heapprofile`), JSON.stringify(heap.profile))
      save()
    }
  }

  return {
    phase,
    finish: async (completed: boolean) => {
      success = completed
      await new Promise<void>((resolve) => setImmediate(resolve))
      observer.disconnect()
      inspector.disconnect()
      save()
    }
  }
}
