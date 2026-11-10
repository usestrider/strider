import { assert, describe, it } from "@effect/vitest"
import * as Admission from "../src/internal/webSocketAdmission.ts"

// Mirrors the production policy in src/internal/webSocketRoutes.ts: a 16 MiB registration ceiling and 1024 slots;
// each admitted connection is granted 1 MiB for each browser direction before open, and every host send
// (`page.send` / `server.send` from a handler) is granted from the same ceiling, closing the connection when the
// grant fails.
const MiB = 1024 * 1024
const admit = (budget: Admission.Budget, owner: string) => {
  const lease = budget.enter(owner, 1)
  if (lease === undefined) return undefined
  if (!budget.grant(lease, "page", MiB) || !budget.grant(lease, "server", MiB)) {
    budget.leave(lease)
    return undefined
  }
  return lease
}

describe("WebSocket registration ceiling usability", () => {
  it("lets every admitted connection send a small message from the host", () => {
    const budget = Admission.make({ bytes: 16 * MiB, slots: 1024 })
    const leases = Array.from({ length: 8 }, (_, i) => admit(budget, `realm:${i}`))
    assert(leases.every((lease) => lease !== undefined))
    // A mock server answering "hello" on its eighth open socket must not overflow the registration.
    assert.isTrue(budget.grant(leases[7]!, "host", 5))
  })

  it("admits more than eight concurrent connections under the documented 1024-connection ceiling", () => {
    const budget = Admission.make({ bytes: 16 * MiB, slots: 1024 })
    const leases = Array.from({ length: 9 }, (_, i) => admit(budget, `realm:${i}`))
    assert.isDefined(leases[8])
  })
})
