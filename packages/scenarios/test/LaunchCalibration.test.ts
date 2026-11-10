import { expect, it } from "vitest"
import { calibrateRoot } from "../benchmark/native-launch-trace.ts"

it("runs three bounded root probes between calibration marks", async () => {
  const order: Array<string> = []
  await calibrateRoot(async () => {
    order.push("send")
  }, (name) => {
    order.push(name)
  })
  expect(order).toEqual(["calibration.start", "send", "send", "send", "calibration.end"])
})
it("preserves a rejected command and stops sending", async () => {
  const failure = new Error("connection closed")
  const marks: Array<string> = []
  let calls = 0
  await expect(calibrateRoot(async () => {
    calls++
    throw failure
  }, (name) => {
    marks.push(name)
  })).rejects.toBe(failure)
  expect(calls).toBe(1)
  expect(marks).toEqual(["calibration.start", "calibration.error"])
})
it("bounds a stalled reply and sends no later probes when it eventually resolves", async () => {
  let release!: () => void
  let calls = 0
  await expect(calibrateRoot(
    () => {
      calls++
      return new Promise<void>((resolve) => {
        release = resolve
      })
    },
    () => {},
    5
  )).rejects.toThrow("calibration command timed out")
  release()
  await Promise.resolve()
  expect(calls).toBe(1)
})
