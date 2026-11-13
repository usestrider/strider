/** Production allocation: every reservation belongs to the same registration-wide ledger. */
import * as Admission from "./webSocketAdmission.ts"

export const messageBytes = 1024 * 1024
export const registrationBytes = 16 * messageBytes
export const hostBytes = 2 * messageBytes

export const make = () => {
  // One internal lease owns the shared outbound pool; the other slots belong to matched connections.
  const budget = Admission.make({ bytes: registrationBytes, slots: 1025 })
  let host: Admission.Lease | undefined
  let sequence = 0
  const admit = (owner: string, generation: number) => {
    if (host === undefined) {
      host = budget.enter("$host", 0)!
      budget.grant(host, "host", hostBytes)
    }
    const lease = budget.enter(owner, generation)
    if (lease === undefined) return undefined
    if (!budget.grant(lease, "page", messageBytes)) {
      budget.leave(lease)
      return undefined
    }
    return lease
  }
  return {
    budget,
    admit,
    proxy: (lease: Admission.Lease): boolean => budget.grant(lease, "server", messageBytes),
    reserveHost: (bytes: number): number | undefined => {
      if (host === undefined || bytes > messageBytes || !budget.consume(host, "host", sequence + 1, bytes)) {
        return undefined
      }
      return ++sequence
    },
    completeHost: (id: number): boolean => host !== undefined && budget.complete(host, "host", id)
  }
}
