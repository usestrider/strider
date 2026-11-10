import type { VitestBrowser } from "@usestrider/vitest"
import { expect, it } from "tstyche"

declare const options: (options: VitestBrowser.TraceOptions) => void
it("requires snapshots and network to be enabled together", () => {
  expect(options).type.toBeCallableWith({ directory: "traces" })
  expect(options).type.toBeCallableWith({ directory: "traces", screenshots: "off" })
  expect(options).type.toBeCallableWith({ directory: "traces", domSnapshots: false, network: false })
  expect(options).type.toBeCallableWith({ directory: "traces", domSnapshots: true, network: true })
  expect(options).type.not.toBeCallableWith({ directory: "traces", network: false })
  expect(options).type.not.toBeCallableWith({ directory: "traces", domSnapshots: true, network: false })
})
