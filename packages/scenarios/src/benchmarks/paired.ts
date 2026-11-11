export const rotation = (index: number) => {
  const roles = ["base:strider", "head:strider", "head:playwright", "base:playwright"] as const
  // Williams square: each role occupies each position and follows each other role once within rounds.
  const orders = [[0, 1, 3, 2], [1, 2, 0, 3], [2, 3, 1, 0], [3, 0, 2, 1]]
  return orders[index % 4]!.map((i) => roles[i]!)
}

/** Paired log-ratio mean with a two-sided 95% Student t interval. */
export const pairedInterval = (head: ReadonlyArray<number>, base: ReadonlyArray<number>) => {
  if (head.length < 2 || head.length !== base.length || [...head, ...base].some((n) => !Number.isFinite(n) || n <= 0)) {
    throw new Error("A comparison requires at least two complete, finite, positive pairs")
  }
  const logs = head.map((n, i) => Math.log(n / base[i]!))
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length
  const se = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / (logs.length - 1) / logs.length)
  // Conservative table: round degrees of freedom down, including the large-sample tail.
  const table = [
    [1, 12.707],
    [2, 4.303],
    [3, 3.183],
    [4, 2.777],
    [5, 2.571],
    [6, 2.447],
    [7, 2.365],
    [8, 2.307],
    [9, 2.263],
    [10, 2.229],
    [15, 2.132],
    [20, 2.086],
    [30, 2.043],
    [60, 2.001],
    [120, 1.98]
  ]
  const t = table.filter(([df]) => df! <= logs.length - 1).at(-1)![1]!
  return { ratio: Math.exp(mean), low: Math.exp(mean - t * se), high: Math.exp(mean + t * se), pairs: logs.length }
}
