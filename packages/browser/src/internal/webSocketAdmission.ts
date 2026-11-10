/** Registration-wide reservations. Unused issued credit stays charged until acknowledged surrender or destruction. */
export type Direction = "page" | "server" | "host"

/** Opaque identity; a reused realm/socket name never makes an old lease live again. */
export interface Lease {
  readonly owner: string
  readonly generation: number
}

interface Account {
  credit: number
  readonly pending: Map<number, number>
  sequence: number
  surrendered: number
}

interface Entry {
  readonly lease: Lease
  readonly page: Account
  readonly server: Account
  readonly host: Account
}

const valid = (n: number) => Number.isSafeInteger(n) && n >= 0
const account = (): Account => ({ credit: 0, pending: new Map(), sequence: 0, surrendered: 0 })

export const make = (limits: { readonly bytes: number; readonly slots: number }) => {
  const live = new Map<string, Entry>()
  let reserved = 0
  const entry = (lease: Lease) => {
    const found = live.get(lease.owner)
    return found?.lease === lease ? found : undefined
  }
  const charged = (side: Account) => side.credit + [...side.pending.values()].reduce((sum, n) => sum + n, 0)
  const leave = (lease: Lease) => {
    const found = entry(lease)
    if (found === undefined) return false
    reserved -= charged(found.page) + charged(found.server) + charged(found.host)
    live.delete(lease.owner)
    return true
  }
  return {
    get reserved() {
      return reserved
    },
    get slots() {
      return live.size
    },
    enter: (owner: string, generation: number): Lease | undefined => {
      if (!valid(generation) || live.has(owner) || live.size >= limits.slots) return undefined
      const lease = { owner, generation }
      live.set(owner, { lease, page: account(), server: account(), host: account() })
      return lease
    },
    grant: (lease: Lease, direction: Direction, bytes: number): boolean => {
      const found = entry(lease)
      if (found === undefined || !valid(bytes) || reserved + bytes > limits.bytes) return false
      found[direction].credit += bytes
      reserved += bytes
      return true
    },
    consume: (lease: Lease, direction: Direction, sequence: number, bytes: number): boolean => {
      const found = entry(lease)
      if (found === undefined || !valid(bytes) || !valid(sequence)) return false
      const side = found[direction]
      if (sequence !== side.sequence + 1 || bytes > side.credit || side.pending.size >= 256) return false
      side.sequence = sequence
      side.credit -= bytes
      side.pending.set(sequence, bytes)
      return true
    },
    complete: (lease: Lease, direction: Direction, sequence: number, surrender = false): boolean => {
      const found = entry(lease)
      const side = found?.[direction]
      const bytes = side?.pending.get(sequence)
      if (side === undefined || bytes === undefined) return false
      side.pending.delete(sequence)
      if (surrender) reserved -= bytes
      else side.credit += bytes
      return true
    },
    surrender: (lease: Lease, direction: Direction, sequence: number, bytes: number): boolean => {
      const found = entry(lease)
      if (found === undefined || !valid(bytes) || !valid(sequence)) return false
      const side = found[direction]
      if (sequence <= side.surrendered || bytes > side.credit) return false
      side.surrendered = sequence
      side.credit -= bytes
      reserved -= bytes
      return true
    },
    leave,
    destroy: (owner: string, generation: number): void => {
      const found = live.get(owner)
      if (found?.lease.generation === generation) leave(found.lease)
    }
  }
}

export type Budget = ReturnType<typeof make>

/** Counts UTF-8 bytes without first allocating an unbounded encoded copy. */
export const textBytes = (text: string, limit = 1024 * 1024): number => {
  let bytes = 0
  for (const character of text) {
    const n = character.codePointAt(0)!
    bytes += n <= 127 ? 1 : n <= 2047 ? 2 : n <= 65535 ? 3 : 4
    if (bytes > limit) break
  }
  return bytes
}
