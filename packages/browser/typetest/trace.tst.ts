/**
 * A trace's DOM snapshots render with its network, so options that ask for snapshots without the network don't
 * compile.
 */
import type { Trace } from "@usestrider/browser"
import { describe, expect, it } from "tstyche"

/** Options as `Trace.record` takes them, contextually typed as a call's are. */
declare const options: (options?: Trace.Options | undefined) => void
declare const flag: boolean

describe("Trace.Options", () => {
  it("take snapshots with the network", () => {
    expect(options).type.toBeCallableWith({ domSnapshots: true, network: true })
    expect(options).type.toBeCallableWith({ network: true, screenshots: "perAction" })
    expect(options).type.toBeCallableWith({ domSnapshots: false, network: false })
    expect(options).type.toBeCallableWith({})
    expect(options).type.toBeCallableWith()
  })

  it("never take snapshots without it", () => {
    expect(options).type.not.toBeCallableWith({ domSnapshots: true })
    expect(options).type.not.toBeCallableWith({ domSnapshots: true, network: false })
  })

  it("take a computed flag as a choice of branch", () => {
    expect(options).type.not.toBeCallableWith({ domSnapshots: flag, network: flag })
    expect(options).type.toBeCallableWith(flag ? { domSnapshots: true, network: true } : {})
  })
})
