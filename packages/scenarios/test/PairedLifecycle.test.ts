import { EventEmitter } from "node:events"
import { afterEach, expect, it, vi } from "vitest"
import { comparisonDeadline, workerMessages } from "../src/benchmarks/lifecycle.ts"

afterEach(() => vi.useRealTimers())

it("rejects an already pending waiter on child error without waiting for exit", async () => {
  const child = new EventEmitter()
  const worker = workerMessages(child, "base")
  const waiting = worker.next()
  const failed = expect(waiting).rejects.toThrow("IPC failed")
  child.emit("error", new Error("IPC failed"))
  await failed
  await expect(worker.next()).rejects.toThrow("IPC failed")
})

it("keeps timeout as the first cause when killing workers immediately emits an exit failure", async () => {
  vi.useFakeTimers()
  const child = new EventEmitter()
  const worker = workerMessages(child, "head")
  const waiting = worker.next()
  const failed = expect(waiting).rejects.toThrow("Comparison exceeded 90 minutes")
  const deadline = comparisonDeadline((error) => {
    worker.fail(error)
    child.emit("exit", null)
  })
  vi.advanceTimersByTime(90 * 60 * 1000)
  await failed
  await expect(worker.next()).rejects.toThrow("Comparison exceeded 90 minutes")
  expect(String(deadline.failure(new Error("head worker failed (null)")))).toContain("Comparison exceeded 90 minutes")
  deadline.close()
})

it("clears a completed deadline and retains the first non-timeout failure", () => {
  vi.useFakeTimers()
  const abort = vi.fn()
  const deadline = comparisonDeadline(abort)
  const error = new Error("setup failed")
  expect(deadline.failure(error)).toBe(error)
  deadline.close()
  vi.advanceTimersByTime(90 * 60 * 1000)
  expect(abort).not.toHaveBeenCalled()
  expect(deadline.failure(new Error("later"))).toBe(error)
})
