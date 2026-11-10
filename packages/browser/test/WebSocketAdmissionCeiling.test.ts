import { assert, describe, it } from "@effect/vitest"
import * as Allocation from "../src/internal/webSocketAllocation.ts"

describe("WebSocket production allocation", () => {
  it("keeps host replies usable after eight sockets and admits the documented mock capacity", () => {
    const allocation = Allocation.make()
    const leases = Array.from({ length: 14 }, (_, i) => allocation.admit(`realm:${i}`, 1))
    assert(leases.every((lease) => lease !== undefined))
    assert.isUndefined(allocation.admit("over-capacity", 1))
    assert.strictEqual(allocation.budget.reserved, Allocation.registrationBytes)
    const sends = leases.map(() => allocation.reserveHost(5))
    assert(sends.every((id) => id !== undefined))
    for (const id of sends) assert.isTrue(allocation.completeHost(id!))
    assert.strictEqual(allocation.budget.reserved, Allocation.registrationBytes)
  })

  it("counts proxy receive credit and bounds concurrent outbound payload without overgranting", () => {
    const allocation = Allocation.make()
    for (let i = 0; i < 7; i++) {
      const lease = allocation.admit(`proxy:${i}`, 1)!
      assert(lease !== undefined)
      assert.isTrue(allocation.proxy(lease))
    }
    assert.isUndefined(allocation.admit("eighth-proxy", 1))
    const first = allocation.reserveHost(Allocation.messageBytes)!
    const second = allocation.reserveHost(Allocation.messageBytes)!
    assert.isUndefined(allocation.reserveHost(1))
    assert.strictEqual(allocation.budget.reserved, Allocation.registrationBytes)
    assert.isTrue(allocation.completeHost(second))
    assert.isFalse(allocation.completeHost(second))
    assert.isDefined(allocation.reserveHost(Allocation.messageBytes))
    assert.isTrue(allocation.completeHost(first))
  })
  it("bounds zero-byte host concurrency and releases credits exactly once across connection destruction", () => {
    const allocation = Allocation.make()
    const lease = allocation.admit("realm", 1)!
    const pending = Array.from({ length: 256 }, () => allocation.reserveHost(0))
    assert(pending.every((id) => id !== undefined))
    assert.isUndefined(allocation.reserveHost(0))
    assert.isTrue(allocation.completeHost(pending[0]!))
    assert.isFalse(allocation.completeHost(pending[0]!))
    assert.isDefined(allocation.reserveHost(0))
    allocation.budget.destroy(lease.owner, lease.generation)
    assert.strictEqual(allocation.budget.reserved, Allocation.hostBytes)
    assert.isDefined(allocation.admit("realm", 2))
    allocation.budget.destroy(lease.owner, lease.generation)
    assert.strictEqual(allocation.budget.reserved, Allocation.hostBytes + Allocation.messageBytes)
  })
})
