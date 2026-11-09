import { assert, describe, it } from "@effect/vitest"
import * as Admission from "../src/internal/webSocketAdmission.ts"

describe("WebSocket registration admission", () => {
  it("counts unused grants across realms and rejects exhausted local capacity", () => {
    const budget = Admission.make({ bytes: 16, slots: 3 })
    const a = budget.enter("a", 1)
    const b = budget.enter("b", 1)
    assert(a !== undefined && b !== undefined)
    assert.isTrue(budget.grant(a, "page", 12))
    assert.isFalse(budget.grant(b, "page", 5))
    assert.isTrue(budget.grant(b, "page", 4))
    assert.isTrue(budget.consume(a, "page", 8))
    assert.isFalse(budget.consume(a, "page", 5))
    assert.strictEqual(budget.reserved, 16)
    assert.isTrue(budget.complete(a, "page", 8))
    assert.strictEqual(budget.reserved, 16)
  })

  it("does not reclaim a pending conversion or an unacknowledged surrender", () => {
    const budget = Admission.make({ bytes: 8, slots: 1 })
    const lease = budget.enter("a", 1)!
    budget.grant(lease, "page", 8)
    budget.consume(lease, "page", 8)
    assert.isFalse(budget.surrender(lease, "page", 8))
    assert.strictEqual(budget.reserved, 8)
    budget.complete(lease, "page", 8)
    assert.isTrue(budget.surrender(lease, "page", 8))
    assert.strictEqual(budget.reserved, 0)
  })

  it("rejects stale acknowledgements and reclaims destroyed realms exactly once", () => {
    const budget = Admission.make({ bytes: 8, slots: 1 })
    const old = budget.enter("a", 1)!
    budget.grant(old, "server", 8)
    budget.consume(old, "server", 4)
    assert.isUndefined(budget.enter("b", 1))
    budget.destroy("a", 1)
    budget.destroy("a", 1)
    assert.strictEqual(budget.reserved, 0)
    const next = budget.enter("a", 2)!
    assert.isTrue(budget.grant(next, "server", 8))
    assert.isFalse(budget.complete(old, "server", 4))
    assert.isFalse(budget.surrender(old, "server", 4))
    assert.isFalse(budget.grant(old, "page", 1))
    budget.destroy("a", 1)
    assert.strictEqual(budget.reserved, 8)
  })

  it("bounds constructor slots and treats invalid or duplicate operations as faults", () => {
    const budget = Admission.make({ bytes: 8, slots: 1 })
    const lease = budget.enter("a", 1)!
    assert.isUndefined(budget.enter("a", 1))
    assert.isUndefined(budget.enter("b", 1))
    assert.isFalse(budget.grant(lease, "page", -1))
    assert.isFalse(budget.grant(lease, "page", Number.NaN))
    assert.isTrue(budget.grant(lease, "page", 8))
    assert.isFalse(budget.complete(lease, "page", 1))
    assert.isTrue(budget.consume(lease, "page", 4))
    assert.isTrue(budget.complete(lease, "page", 4))
    assert.isFalse(budget.complete(lease, "page", 4))
    assert.isTrue(budget.leave(lease))
    assert.isFalse(budget.leave(lease))
    assert.strictEqual(budget.reserved, 0)
    assert.isDefined(budget.enter("b", 1))
  })
})
