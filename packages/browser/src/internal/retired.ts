/**
 * Forgets an adapter's finished requests past a bound, oldest first (QUIRKS.md, Q177). The request and hop
 * tables answer for a request after it ends, as a body read does, so they keep it while there is room, as the
 * model keeps hops (`maxHops`); before, they kept every request for the connection's life.
 */

/** How many finished requests an adapter keeps answering for. */
export const finishedRequests = 1000

/** Retires a finished request by its table key; `forget` drops the oldest once more than `bound` are kept. */
export const make = <K>(forget: (key: K) => void, bound: number = finishedRequests) => {
  // A set keeps insertion order: its first value is the oldest
  const order = new Set<K>()
  return (key: K): void => {
    order.delete(key)
    order.add(key)
    if (order.size <= bound) return
    const oldest = order.values().next().value as K
    order.delete(oldest)
    forget(oldest)
  }
}
